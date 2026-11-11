// Records the ScopePay demo video (under 3 minutes) from a running server.
// Frames come from Chrome's screencast at 1920x1080, with an on-page cursor
// and subtitles, then ffmpeg assembles them at a constant 30 fps.
//
// The video follows the narration in scripts/demo-narration.json: each line
// is a cue, shown as a subtitle while the matching step plays on screen.
//
// Usage: BASE_URL=http://localhost:3000 OUT=demo node scripts/record-demo-video.mjs
//
// With VOICE=<dir> (one <cue>.wav per line plus durations.json, as written by
// scripts/kokoro-voiceover.py) each step lasts as long as its spoken line and
// the voice-over is mixed in. Without it, timing is estimated from the text
// and the video is silent; cues.tsv lists when each line starts.
//
// With an AI key and PayPal sandbox keys set on the server, the video shows
// the live integrations; otherwise it shows demo mode.

import { chromium } from 'playwright';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const PUBLIC = (process.env.PUBLIC_DEMO_URL || 'scopepay-wjm5.onrender.com').replace(/^https?:\/\//, '');
const OUT = process.env.OUT || 'demo';
const FRAMES = path.join(OUT, 'frames');
const VOICE = process.env.VOICE || '';
const narration = JSON.parse(readFileSync(process.env.NARRATION || 'scripts/demo-narration.json', 'utf8'));
const clipSeconds = VOICE ? JSON.parse(readFileSync(path.join(VOICE, 'durations.json'), 'utf8')) : {};
await rm(OUT, { recursive: true, force: true });
await mkdir(FRAMES, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });

// Cursor and caption layer, re-created on every page load.
await context.addInitScript(() => {
  const mount = () => {
    if (document.getElementById('__rec')) return;
    const root = document.createElement('div');
    root.id = '__rec';
    root.innerHTML = `
      <style>
        #__cursor { position: fixed; z-index: 2147483647; width: 22px; height: 22px; pointer-events: none; transition: left .6s cubic-bezier(.3,.7,.2,1), top .6s cubic-bezier(.3,.7,.2,1); }
        #__cursor svg { filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
        #__cursor .ring { position: absolute; left: -11px; top: -11px; width: 22px; height: 22px; border-radius: 50%; border: 2px solid #1b5fc1; opacity: 0; }
        #__cursor.press .ring { animation: __press .45s ease-out; }
        @keyframes __press { from { opacity: .9; transform: scale(.4); } to { opacity: 0; transform: scale(1.8); } }
        #__cap { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 2147483646; max-width: 980px; width: max-content;
          background: rgba(15, 39, 71, .94); color: #fff; font: 500 19px/1.4 'IBM Plex Sans', system-ui, sans-serif; padding: 12px 22px; border-radius: 8px;
          box-shadow: 0 10px 30px rgba(0,0,0,.25); opacity: 0; transition: opacity .35s; pointer-events: none; text-align: center; }
        #__cap.on { opacity: 1; }
        #__cap b { color: #9cc3ff; font-weight: 600; }
        .toast { bottom: 96px !important; }
      </style>
      <div id="__cursor"><span class="ring"></span><svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l15 8.2-6.6 1.6L8.6 18z" fill="#fff" stroke="#0f2747" stroke-width="1.5" stroke-linejoin="round"/></svg></div>
      <div id="__cap"></div>`;
    document.documentElement.appendChild(root);
    const saved = JSON.parse(sessionStorage.getItem('__rec') || '{"x":640,"y":400,"cap":""}');
    const cursor = root.querySelector('#__cursor');
    cursor.style.left = saved.x + 'px';
    cursor.style.top = saved.y + 'px';
    const cap = root.querySelector('#__cap');
    if (saved.cap) { cap.innerHTML = saved.cap; cap.classList.add('on'); }
    const store = (patch) => sessionStorage.setItem('__rec', JSON.stringify({ ...JSON.parse(sessionStorage.getItem('__rec') || '{}'), ...patch }));
    window.__cursorTo = (x, y) => { cursor.style.left = x + 'px'; cursor.style.top = y + 'px'; store({ x, y }); };
    window.__press = () => { cursor.classList.remove('press'); void cursor.offsetWidth; cursor.classList.add('press'); };
    window.__caption = (html) => { store({ cap: html }); cap.classList.remove('on'); setTimeout(() => { cap.innerHTML = html; if (html) cap.classList.add('on'); }, html ? 180 : 0); };
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
});

const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const frames = [];
cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
  const file = path.join(FRAMES, `${String(frames.length).padStart(6, '0')}.jpg`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  frames.push({ file, t: metadata.timestamp });
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});

const wait = (ms) => page.waitForTimeout(ms);
const caption = (html) => page.evaluate((h) => window.__caption?.(h), html);

// Narration. say(cue) waits for the previous line to finish, notes when this one
// starts, and shows it as subtitles one sentence at a time. It returns at once,
// so the steps that follow play while the line is spoken; spoken() waits it out.
const LINE_GAP = 350;
const lines = Object.fromEntries(narration.map((line) => [line.cue, line]));
const cues = [];
let voiceEnds = 0;
let subtitleTimers = [];
const showSubtitle = async (text) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    try { return await caption(text); } catch { await new Promise((r) => setTimeout(r, 300)); } // page was navigating
  }
};
async function say(cue, { subtitles = true, note = '' } = {}) {
  const line = lines[cue];
  if (!line) throw new Error(`No narration for cue "${cue}"`);
  await spoken(LINE_GAP);
  subtitleTimers.forEach(clearTimeout);
  subtitleTimers = [];
  const ms = (clipSeconds[cue] ?? line.text.split(/\s+/).length / 2.6) * 1000;
  cues.push({ cue, t: Date.now() });
  voiceEnds = Date.now() + ms;
  if (!subtitles) return;
  const sentences = (line.caption || line.text).split(/(?<=[.?!])\s+/);
  if (note) sentences[sentences.length - 1] += ` ${note}`;
  const total = sentences.join('').length;
  let offset = 0;
  for (const sentence of sentences) {
    if (offset === 0) await showSubtitle(sentence);
    else subtitleTimers.push(setTimeout(() => showSubtitle(sentence), offset));
    offset += ms * sentence.length / total;
  }
}
async function spoken(extra = 300) {
  const left = voiceEnds + extra - Date.now();
  if (left > 0) await wait(left);
}
const marks = [];
const scene = (name) => { marks.push({ name, t: Date.now() }); console.log('scene', name); };

async function moveTo(locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  await page.evaluate(([x, y]) => window.__cursorTo(x, y), [box.x + box.width / 2, box.y + box.height / 2]);
  await wait(700);
}
async function click(locator, after = 500) {
  await moveTo(locator);
  await page.evaluate(() => window.__press());
  await wait(120);
  await locator.click();
  await wait(after);
}
async function type(locator, text) {
  if ((await locator.inputValue()) === text) return moveTo(locator); // already prefilled
  await click(locator, 150);
  await locator.fill('');
  await locator.pressSequentially(text, { delay: 38 });
}
async function scrollTo(locator, offset = 90) {
  await locator.first().evaluate((el, off) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - off, behavior: 'smooth' }), offset);
  await wait(900);
}
const scrollTop = async () => { await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })); await wait(700); };

// Title cards are set with page.setContent, which cannot load the server's fonts
// cross-origin, so the font files are embedded as data URLs.
const fontFace = (weight) => `@font-face { font-family: 'IBM Plex Sans'; font-weight: ${weight}; src: url(data:font/woff2;base64,${readFileSync(`public/fonts/ibm-plex-sans-latin-${weight}-normal.woff2`).toString('base64')}) format('woff2'); }`;
const card = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>
  ${fontFace(300)} ${fontFace(400)} ${fontFace(600)}
  html, body { margin: 0; height: 100%; background: #0f2747; color: #fff; font-family: 'IBM Plex Sans', sans-serif; }
  .wrap { height: 100%; display: flex; flex-direction: column; justify-content: center; padding: 0 110px; box-sizing: border-box; }
  .mark { display: inline-flex; align-items: center; gap: 14px; font-weight: 600; font-size: 30px; }
  .mark i { width: 44px; height: 44px; border-radius: 9px; background: #fff; color: #0f2747; display: grid; place-items: center; font-style: normal; font-size: 26px; }
  h1 { font-size: 64px; font-weight: 600; letter-spacing: -2px; line-height: 1.05; margin: 34px 0 0; max-width: 15ch; }
  h2 { font-size: 46px; font-weight: 600; letter-spacing: -1.2px; margin: 0 0 34px; }
  p { color: #c3d1e6; font-size: 24px; margin: 22px 0 0; max-width: 34em; line-height: 1.45; }
  .row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 40px; margin-top: 10px; }
  .row div { border-top: 2px solid #7fb0f5; padding-top: 18px; }
  .row q { display: block; font-size: 28px; font-weight: 600; quotes: '\\201C' '\\201D'; }
  .row span { display: block; color: #c3d1e6; font-size: 19px; margin-top: 10px; line-height: 1.4; }
  ul { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 22px 56px; }
  li { font-size: 21px; color: #c3d1e6; line-height: 1.4; border-left: 3px solid #7fb0f5; padding-left: 16px; }
  li b { display: block; color: #fff; font-size: 23px; font-weight: 600; margin-bottom: 4px; }
  .url { margin-top: 40px; align-self: flex-start; background: #fff; color: #0f2747; font-size: 30px; font-weight: 600; padding: 14px 26px; border-radius: 10px; }
  .small { font-size: 19px; color: #93a7c4; margin-top: 22px; }
  .fade > * { animation: in .7s ease-out both; } .fade > *:nth-child(2) { animation-delay: .25s; } .fade > *:nth-child(3) { animation-delay: .5s; } .fade > *:nth-child(4) { animation-delay: .75s; }
  @keyframes in { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
</style></head><body><div class="wrap fade">${body}</div></body></html>`;

async function showCard(body) {
  await spoken(LINE_GAP);
  subtitleTimers.forEach(clearTimeout);
  await page.setContent(card(body), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await caption('');
}

await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });

// 1. Title
scene('title');
await showCard(`<span class="mark"><i>S</i>ScopePay</span><h1>Get paid for the work you agreed to.</h1>
  <p>AI checks delivered work against the signed agreement. The client accepts with the evidence in front of them. PayPal invoices the moment they do.</p>`);
await wait(600);
await say('title', { subtitles: false });
await spoken(1000);

// 2. Problem
scene('problem');
await showCard(`<h2>Freelance payments stall on three sentences</h2>
  <div class="row"><div><q>That wasn’t in the brief.</q><span>Extra work goes unpaid when nobody can point to the clause.</span></div>
  <div><q>It’s not finished yet.</q><span>“Done” means something different to each side.</span></div>
  <div><q>We’ll pay once we’ve checked.</q><span>Evidence is scattered across email and chat.</span></div></div>`);
await say('problem', { subtitles: false });
await spoken(700);

// 3. The website
scene('website');
await page.goto(`${BASE}/`);
await page.getByRole('heading', { name: 'Get paid for the work you agreed to.' }).waitFor();
await say('website');
await spoken(200);
await click(page.getByRole('link', { name: 'Try the live demo' }).first(), 600);
await page.getByRole('heading', { name: 'Your projects' }).waitFor();
await say('workspace');
await spoken(300);

// 4. Agreement extraction
scene('extraction');
await page.goto(`${BASE}/app#/new`);
await page.getByRole('button', { name: /Use the sample website agreement/ }).waitFor();
await say('extract-start');
await wait(1000);
await click(page.getByRole('button', { name: /Use the sample website agreement/ }));
await page.getByRole('heading', { name: 'Agreement' }).waitFor();
await say('extract-ai');
await wait(4300);
await click(page.locator('.terms-ms').nth(1).locator('.clause').nth(3), 600); // "…quotes the clause it came from"
await say('extract-verify');
await spoken(600);

// 5. Evidence review
scene('review');
await page.goto(`${BASE}/app#/projects`);
await click(page.getByRole('link', { name: /Website redesign/ }).first(), 900);
await page.getByRole('heading', { name: 'Acceptance checklist' }).waitFor();
await say('review-start');
await wait(3200);
await click(page.getByRole('button', { name: /Run AI review/ }), 300); // "Let's run the review."
await page.locator('.review-bar .chip.green').waitFor({ timeout: 120_000 });
await say('review-missing');
await wait(4600);
await scrollTo(page.locator('.deliverable', { hasText: 'Portfolio page' }), 260); // "The portfolio page…"
await spoken(300);
await scrollTo(page.locator('.sample-files'), 200);
await say('review-upload');
await click(page.getByRole('button', { name: /Portfolio page/ }), 700);
await click(page.getByRole('button', { name: /Services page \(fixed\)/ }), 700);
await spoken(100);
await scrollTo(page.locator('.review-bar'), 120);
await click(page.getByRole('button', { name: /Re-run/ }), 300);
await page.waitForFunction(() => !document.querySelector('.review-bar .chip.red'), null, { timeout: 120_000 });
await say('review-rerun');
await spoken(900);

// 6. Scope check and change order
scene('scope');
await scrollTo(page.locator('.tabs'), 80);
await say('scope-ask');
await click(page.getByRole('button', { name: /Can you also add a blog/ }), 300);
await spoken(100);
await click(page.getByRole('button', { name: /Check against agreement/ }), 300);
await page.locator('.scope-item .chip.red').first().waitFor({ timeout: 120_000 });
await scrollTo(page.locator('.scope-item').first(), 140);
await say('scope-result');
await spoken(200);
await click(page.getByRole('button', { name: /Send to client for approval/ }), 900);

// 7. Client acceptance
scene('client');
await scrollTop();
await say('client-share');
await click(page.getByRole('button', { name: /Share for client acceptance/ }), 900);
const portalUrl = await page.getByRole('link', { name: /Open client view/ }).getAttribute('href');
await spoken(100);
await page.goto(portalUrl);
await page.getByRole('heading', { name: /Development/ }).waitFor();
await say('client-view');
await wait(1700);
const review = page.locator('section', { hasText: 'Ready for your acceptance' });
await scrollTo(review.locator('.deliverable').first(), 200); // "…each screenshot next to the clause"
await spoken(300);
await say('client-accept');
await type(review.getByPlaceholder('e.g. Dana Ortiz'), 'Dana Ortiz');
await wait(700);
await click(review.getByRole('button', { name: /Accept milestone/ }), 1200);
await spoken(300);
const order = page.locator('section', { hasText: 'Change request' });
await scrollTo(order, 120);
await say('client-order');
await type(order.getByPlaceholder('e.g. Dana Ortiz'), 'Dana Ortiz');
await click(order.getByRole('button', { name: /Approve change order/ }), 1300);
await scrollTo(page.locator('h2', { hasText: 'Invoices' }), 120);
await say('client-invoice');
await spoken(900);

// 8. PayPal invoice
scene('paypal');
await page.goto(page.url().split('/portal.html')[0] + '/app#/projects');
await click(page.getByRole('link', { name: /Website redesign/ }).first(), 900);
await page.getByRole('heading', { name: 'PayPal invoice' }).first().waitFor();
await say('paypal-send');
await wait(1500);
await click(page.getByRole('button', { name: 'Send via PayPal' }).first(), 1200);
const simulate = page.getByRole('button', { name: 'Simulate payment' }).first();
if (await simulate.count()) {
  await say('paypal-paid', { note: '(Payment simulated here: demo mode.)' });
  await wait(1000);
  await click(simulate, 1400);
  await page.locator('.callout.green', { hasText: 'Paid' }).first().waitFor();
} else {
  await say('paypal-paid');
}
await spoken(1000);

// 9. AG Grid views
scene('grids');
await page.goto(`${BASE}/app#/projects`);
await page.locator('#pipeline-grid .ag-row').first().waitFor();
await scrollTo(page.locator('section:has(#pipeline-grid)'), 90);
await say('grid-pipeline');
await spoken(500);
await page.goto(`${BASE}/app#/invoices`);
await page.locator('#invoice-grid .ag-row').first().waitFor();
await say('grid-ledger');
await wait(1300);
await click(page.getByRole('button', { name: /^Paid/ }), 1100); // "…filters, live totals…"
await click(page.getByRole('button', { name: /^All/ }), 1100);
await spoken(700);

// 10. How it's built
scene('built');
await showCard(`<h2>How it’s built</h2><ul>
  <li><b>PayPal Invoicing v2</b>Invoice created on client acceptance, sent, tracked and reminded; verified webhooks mark it paid.</li>
  <li><b>AI with citations</b>Structured extraction and vision review; every term and verdict quotes its clause.</li>
  <li><b>People decide</b>You confirm terms, the client accepts. AI never sends money.</li>
  <li><b>AG Grid, Node, Postgres, Render</b>Accounts, client links, audit trail, 14 unit tests and a browser walkthrough.</li></ul>`);
await say('built', { subtitles: false });
await spoken(1500);

// 11. Close
scene('close');
await showCard(`<span class="mark"><i>S</i>ScopePay</span><h1 style="font-size:54px">Agreed work. Proven. Paid.</h1>
  <span class="url">${PUBLIC}/demo</span><p class="small">Open source on GitHub: MoAmrYehia/ScopePay</p>`);
await say('close', { subtitles: false });
await spoken(3200);

await cdp.send('Page.stopScreencast');
const ended = Date.now();
await browser.close();

// --- assemble ---------------------------------------------------------------------------
const list = [];
for (let i = 0; i < frames.length; i++) {
  const next = i + 1 < frames.length ? frames[i + 1].t : ended / 1000;
  list.push(`file '${path.resolve(frames[i].file)}'`, `duration ${Math.max(0.001, next - frames[i].t).toFixed(4)}`);
}
list.push(`file '${path.resolve(frames.at(-1).file)}'`);
await writeFile(path.join(OUT, 'frames.txt'), list.join('\n'));
const video = path.join(OUT, 'scopepay-demo.mp4');
const silent = path.join(OUT, 'silent.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(OUT, 'frames.txt'),
  '-vf', 'scale=1920:1080:flags=lanczos,fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-movflags', '+faststart', silent]);

// Scene and narration start times on the video's own clock (0 = first frame).
const t0 = frames[0].t;
const at = (ms) => Math.max(0, ms / 1000 - t0);
const length = at(ended);
const scenes = marks.map((m) => `${m.name}\t${at(m.t).toFixed(2)}`).join('\n');
await writeFile(path.join(OUT, 'scenes.tsv'), scenes + `\nend\t${length.toFixed(2)}\n`);
await writeFile(path.join(OUT, 'cues.tsv'), cues.map((c) => `${c.cue}\t${at(c.t).toFixed(2)}`).join('\n') + '\n');

if (VOICE) {
  // Place each spoken line at its cue, bring the mix to about -16 LUFS, and add it to the video.
  const clips = cues.filter((c) => existsSync(path.join(VOICE, `${c.cue}.wav`)));
  const inputs = clips.flatMap((c) => ['-i', path.join(VOICE, `${c.cue}.wav`)]);
  const placed = clips.map((c, i) => `[${i + 1}:a]aresample=48000,adelay=${Math.round(at(c.t) * 1000)}:all=1[a${i}]`);
  const mix = `${clips.map((_, i) => `[a${i}]`).join('')}amix=inputs=${clips.length}:normalize=0:dropout_transition=0,volume=${process.env.VOICE_GAIN || '5dB'},alimiter=limit=0.84:attack=3:release=60:level=disabled,apad,aformat=channel_layouts=stereo[voice]`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, ...inputs, '-filter_complex', [...placed, mix].join(';'),
    '-map', '0:v', '-map', '[voice]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', length.toFixed(2), '-movflags', '+faststart', video + '.part.mp4']);
  execFileSync('mv', [video + '.part.mp4', video]);
} else {
  execFileSync('cp', [silent, video]);
}
console.log(`frames: ${frames.length}, length ${length.toFixed(1)}s, ${VOICE ? 'with voice-over' : 'silent'}\n${scenes}\nvideo: ${video}`);
