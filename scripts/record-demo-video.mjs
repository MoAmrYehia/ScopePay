// Records the ScopePay demo video (under 3 minutes) from a running server.
// Frames come from Chrome's screencast at 1920x1080, with an on-page cursor
// and captions, then ffmpeg assembles them at a constant 30 fps.
//
// Usage: BASE_URL=http://localhost:3000 OUT=demo node scripts/record-demo-video.mjs
// With an AI key and PayPal sandbox keys set on the server, the video shows
// the live integrations; otherwise it shows demo mode.

import { chromium } from 'playwright';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const PUBLIC = (process.env.PUBLIC_DEMO_URL || 'scopepay-wjm5.onrender.com').replace(/^https?:\/\//, '');
const OUT = process.env.OUT || 'demo';
const FRAMES = path.join(OUT, 'frames');
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
const caption = async (html, holdMs = 0) => { await page.evaluate((h) => window.__caption?.(h), html); if (holdMs) await wait(holdMs); };
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
  .url { margin-top: 40px; display: inline-block; background: #fff; color: #0f2747; font-size: 30px; font-weight: 600; padding: 14px 26px; border-radius: 10px; }
  .small { font-size: 19px; color: #93a7c4; margin-top: 22px; }
  .fade > * { animation: in .7s ease-out both; } .fade > *:nth-child(2) { animation-delay: .25s; } .fade > *:nth-child(3) { animation-delay: .5s; } .fade > *:nth-child(4) { animation-delay: .75s; }
  @keyframes in { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
</style></head><body><div class="wrap fade">${body}</div></body></html>`;

async function showCard(body, ms) {
  await page.setContent(card(body), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await caption('');
  await wait(ms);
}

await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
const started = Date.now();

// 1. Title
scene('title');
await showCard(`<span class="mark"><i>S</i>ScopePay</span><h1>Get paid for the work you agreed to.</h1>
  <p>AI checks delivered work against the signed agreement. The client accepts with the evidence in front of them. PayPal invoices the moment they do.</p>`, 6500);

// 2. Problem
scene('problem');
await showCard(`<h2>Freelance payments stall on three sentences</h2>
  <div class="row"><div><q>That wasn’t in the brief.</q><span>Extra work goes unpaid when nobody can point to the clause.</span></div>
  <div><q>It’s not finished yet.</q><span>“Done” means something different to each side.</span></div>
  <div><q>We’ll pay once we’ve checked.</q><span>Evidence is scattered across email and chat.</span></div></div>`, 9000);

// 3. The website
scene('website');
await page.goto(`${BASE}/`);
await page.getByRole('heading', { name: 'Get paid for the work you agreed to.' }).waitFor();
await caption('<b>ScopePay</b> connects the signed agreement, the delivered work and the PayPal payment.', 4200);
await click(page.getByRole('link', { name: 'Try the live demo' }).first(), 600);
await page.getByRole('heading', { name: 'Your projects' }).waitFor();
await caption('A freelancer’s workspace: projects, milestones, and what has been paid.', 3000);

// 4. Agreement extraction
scene('extraction');
await page.goto(`${BASE}/app#/new`);
await page.getByRole('button', { name: /Use the sample website agreement/ }).waitFor();
await caption('Start from the signed agreement: PDF, Word or text.', 2200);
await click(page.getByRole('button', { name: /Use the sample website agreement/ }));
await page.getByRole('heading', { name: 'Agreement' }).waitFor();
await caption('<b>AI extracts</b> every milestone, amount and acceptance condition, each quoting its clause.', 4200);
await click(page.locator('.terms-ms').nth(1).locator('.clause').nth(3), 1600);
await caption('Every quote is checked word for word against the agreement. You confirm before anything is used.', 4300);

// 4. Evidence review
scene('review');
await page.goto(`${BASE}/app#/projects`);
await click(page.getByRole('link', { name: /Website redesign/ }).first(), 900);
await page.getByRole('heading', { name: 'Acceptance checklist' }).waitFor();
await caption('Milestone 2: the designer has delivered four page screenshots.', 3000);
await click(page.getByRole('button', { name: /Run AI review/ }), 300);
await page.locator('.review-bar .chip.green').waitFor({ timeout: 120_000 });
await wait(400);
await scrollTo(page.locator('.deliverable', { hasText: 'Portfolio page' }), 260);
await caption('<b>AI checks each condition against the screenshots.</b> The Portfolio page required by §3.4 is missing.', 5200);
await scrollTo(page.locator('.sample-files'), 200);
await caption('The designer uploads the missing page and the corrected Services page.', 600);
await click(page.getByRole('button', { name: /Portfolio page/ }), 700);
await click(page.getByRole('button', { name: /Services page \(fixed\)/ }), 700);
await scrollTo(page.locator('.review-bar'), 120);
await click(page.getByRole('button', { name: /Re-run/ }), 300);
await page.waitForFunction(() => !document.querySelector('.review-bar .chip.red'), null, { timeout: 120_000 });
await caption('Re-run the review: every acceptance condition is now backed by evidence.', 3800);

// 5. Scope check and change order
scene('scope');
await scrollTo(page.locator('.tabs'), 80);
await caption('The client writes: <b>“Can you also add a blog?”</b> Is that in the agreement?', 2000);
await click(page.getByRole('button', { name: /Can you also add a blog/ }), 300);
await click(page.getByRole('button', { name: /Check against agreement/ }), 300);
await page.locator('.scope-item .chip.red').first().waitFor({ timeout: 120_000 });
await scrollTo(page.locator('.scope-item').first(), 140);
await caption('<b>Out of scope:</b> §5.1 excludes a blog. A change order is priced at the agreement’s $95 per hour.', 5000);
await click(page.getByRole('button', { name: /Send to client for approval/ }), 900);

// 6. Client acceptance
scene('client');
await scrollTop();
await caption('Share the evidence pack with the client.', 1200);
await click(page.getByRole('button', { name: /Share for client acceptance/ }), 900);
const portalUrl = await page.getByRole('link', { name: /Open client view/ }).getAttribute('href');
await page.goto(portalUrl);
await page.getByRole('heading', { name: /Development/ }).waitFor();
await caption('The client sees each screenshot beside the clause it satisfies. <b>No account needed.</b>', 3600);
const review = page.locator('section', { hasText: 'Ready for your acceptance' });
await scrollTo(review.locator('.deliverable').first(), 200);
await wait(1400);
await type(review.getByPlaceholder('e.g. Dana Ortiz'), 'Dana Ortiz');
await caption('They accept with their name. People decide; AI only prepares the evidence.', 1500);
await click(review.getByRole('button', { name: /Accept milestone/ }), 1200);
const order = page.locator('section', { hasText: 'Change request' });
await scrollTo(order, 120);
await caption('They approve the blog change order too.', 1200);
await type(order.getByPlaceholder('e.g. Dana Ortiz'), 'Dana Ortiz');
await click(order.getByRole('button', { name: /Approve change order/ }), 1300);
await scrollTo(page.locator('h2', { hasText: 'Invoices' }), 120);
await caption('<b>Acceptance issues the PayPal invoice automatically</b>, with the approval recorded on it.', 3800);

// 7. PayPal invoice
scene('paypal');
await page.goto(page.url().split('/portal.html')[0] + '/app#/projects');
await click(page.getByRole('link', { name: /Website redesign/ }).first(), 900);
await page.getByRole('heading', { name: 'PayPal invoice' }).first().waitFor();
await caption('Send it through <b>PayPal Invoicing</b>: create, send, track and remind.', 1600);
await click(page.getByRole('button', { name: 'Send via PayPal' }).first(), 1200);
const simulate = page.getByRole('button', { name: 'Simulate payment' }).first();
if (await simulate.count()) {
  await caption('When the client pays, PayPal’s webhook marks the milestone paid. (Payment simulated in demo mode.)', 1800);
  await click(simulate, 1400);
  await page.locator('.callout.green', { hasText: 'Paid' }).first().waitFor();
  await wait(2200);
} else {
  await caption('Sent from the PayPal sandbox. When the client pays, a verified PayPal webhook marks the milestone paid.', 5000);
}

// 8. AG Grid views
scene('grids');
await page.goto(`${BASE}/app#/projects`);
await page.locator('#pipeline-grid .ag-row').first().waitFor();
await scrollTo(page.locator('section:has(#pipeline-grid)'), 90);
await caption('Every milestone in one <b>payment pipeline</b>, built with <b>AG Grid</b>.', 4000);
await page.goto(`${BASE}/app#/invoices`);
await page.locator('#invoice-grid .ag-row').first().waitFor();
await caption('The invoice ledger: filter, search, live totals and CSV export for the accountant.', 1800);
await click(page.getByRole('button', { name: /^Paid/ }), 1100);
await click(page.getByRole('button', { name: /^All/ }), 2200);

// 9. How it's built
scene('built');
await showCard(`<h2>How it’s built</h2><ul>
  <li><b>PayPal Invoicing v2</b>Invoice created on client acceptance, sent, tracked and reminded; verified webhooks mark it paid.</li>
  <li><b>AI with citations</b>Structured extraction and vision review; every term and verdict quotes its clause.</li>
  <li><b>People decide</b>You confirm terms, the client accepts. AI never sends money.</li>
  <li><b>AG Grid, Node, Postgres, Render</b>Accounts, client links, audit trail, 14 unit tests and a browser walkthrough.</li></ul>`, 11000);

// 10. Close
scene('close');
await showCard(`<span class="mark"><i>S</i>ScopePay</span><h1 style="font-size:54px">Agreed work. Proven. Paid.</h1>
  <span class="url">${PUBLIC}/demo</span><p class="small">Open source on GitHub: MoAmrYehia/ScopePay</p>`, 5500);

await cdp.send('Page.stopScreencast');
const ended = Date.now();
await browser.close();

// --- assemble ---------------------------------------------------------------------------
const lines = [];
for (let i = 0; i < frames.length; i++) {
  const next = i + 1 < frames.length ? frames[i + 1].t : frames[i].t + 0.5;
  lines.push(`file '${path.resolve(frames[i].file)}'`, `duration ${Math.max(0.001, next - frames[i].t).toFixed(4)}`);
}
lines.push(`file '${path.resolve(frames.at(-1).file)}'`);
await writeFile(path.join(OUT, 'frames.txt'), lines.join('\n'));
const video = path.join(OUT, 'scopepay-demo.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(OUT, 'frames.txt'),
  '-vf', 'scale=1920:1080:flags=lanczos,fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-movflags', '+faststart', video + '.part.mp4']);
execFileSync('mv', [video + '.part.mp4', video]);
const scenes = marks.map((m, i) => `${m.name} ${((m.t - started) / 1000).toFixed(1)}s`).join(', ');
await writeFile(path.join(OUT, 'scenes.txt'), scenes + `\nend ${((ended - started) / 1000).toFixed(1)}s\n`);
console.log(`frames: ${frames.length}, length ≈ ${((ended - started) / 1000).toFixed(1)}s\n${scenes}\nvideo: ${video}`);
