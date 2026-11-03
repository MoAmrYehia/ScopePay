// Renders the sample "delivered website" screenshots used as demo evidence.
// The fictional client site intentionally has gaps the AI review should catch:
//   services.png    → only 3 of the 4 required service packages (partial)
//   portfolio.png   → not part of the seeded evidence (missing until uploaded)
//   services-v2.png → the fixed Services page with all four packages
// Usage: node scripts/generate-sample-evidence.mjs   (CHROMIUM_PATH optional)

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = 'samples/evidence';
const palette = ['#e8d5c4', '#c9d8cf', '#d5d2e8', '#f0dfb8', '#cfe0ea', '#e7c9cf'];

const shell = (active, body) => `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box} body{margin:0;font-family:Georgia,serif;color:#1d1b19;background:#fbf8f3}
  nav{display:flex;justify-content:space-between;align-items:center;padding:26px 64px;border-bottom:1px solid #e7e0d5;font-family:Helvetica,Arial,sans-serif;font-size:14px}
  nav b{font-family:Georgia,serif;font-size:22px;letter-spacing:-.5px} nav span{margin-left:28px;color:#6d655c} nav span.on{color:#1d1b19;border-bottom:2px solid #c2603b;padding-bottom:4px}
  main{padding:56px 64px} h1{font-size:52px;font-weight:400;letter-spacing:-1.5px;margin:0 0 18px} h2{font-size:30px;font-weight:400;margin:0 0 24px}
  p,li,label,input,textarea{font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#5c554d}
  .btn{display:inline-block;background:#c2603b;color:#fff;font-family:Helvetica,Arial,sans-serif;padding:14px 26px;border-radius:30px;font-size:15px}
  .grid{display:grid;gap:22px} .card{background:#fff;border:1px solid #ebe4d9;border-radius:14px;overflow:hidden}
  .img{height:150px} .cap{padding:16px 18px;font-family:Helvetica,Arial,sans-serif} .cap b{display:block;color:#1d1b19;font-size:16px} .cap small{color:#8a8178}
  footer{padding:28px 64px;border-top:1px solid #e7e0d5;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#9a9188}
</style></head><body><nav><b>Acme Studio</b><div>${['Home', 'About', 'Services', 'Portfolio', 'Contact'].map((n) => `<span class="${n === active ? 'on' : ''}">${n}</span>`).join('')}</div></nav><main>${body}</main><footer>© 2026 Acme Studio · acmestudio.example</footer></body></html>`;

const project = (title, client, i) => `<div class="card"><div class="img" style="background:linear-gradient(135deg,${palette[i % 6]},${palette[(i + 2) % 6]})"></div><div class="cap"><b>${title}</b><small>${client}</small></div></div>`;
const person = (name, role, i) => `<div class="card" style="text-align:center;padding:26px"><div style="width:110px;height:110px;border-radius:50%;margin:0 auto 14px;background:radial-gradient(circle at 50% 38%,#8a6f5c 0 22%,transparent 23%),radial-gradient(circle at 50% 100%,#8a6f5c 0 45%,transparent 46%),${palette[i]}"></div><div class="cap" style="padding:0"><b>${name}</b><small>${role}</small></div></div>`;
const pkg = (name, price, items) => `<div class="card" style="padding:28px"><h2 style="font-size:24px;margin-bottom:6px">${name}</h2><p style="margin:0 0 14px;color:#c2603b;font-weight:bold">From ${price}</p><ul style="padding-left:18px;margin:0">${items.map((x) => `<li>${x}</li>`).join('')}</ul></div>`;

const packages = [
  pkg('Brand', '$2,400', ['Identity system', 'Logo refresh', 'Brand guidelines']),
  pkg('Web', '$4,800', ['Website design', 'Development', 'Launch support']),
  pkg('Content', '$1,600', ['Photography direction', 'Copy editing', 'Social templates']),
];
const growth = pkg('Growth', '$1,200/mo', ['SEO audits', 'Campaign landing pages', 'Monthly reporting']);

const pages = {
  home: shell('Home', `
    <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:48px;align-items:center;margin-bottom:64px">
      <div><h1>Design that moves<br>people to act.</h1><p style="max-width:460px">We are a small studio building brands and websites for independent businesses.</p><br><span class="btn">Book a call</span></div>
      <div style="height:300px;border-radius:20px;background:linear-gradient(135deg,#e8d5c4,#c2603b)"></div>
    </div>
    <h2>Featured work</h2>
    <div class="grid" style="grid-template-columns:repeat(3,1fr)">${project('Harbor Coffee rebrand', 'Brand · 2026', 0)}${project('Lumen Clinic website', 'Web · 2026', 1)}${project('Field Notes journal', 'Content · 2025', 2)}</div>`),
  about: shell('About', `
    <h1>About us</h1><p style="max-width:620px">Acme Studio was founded in 2019. We work with founders who care about craft.</p><br>
    <h2>Our team</h2>
    <div class="grid" style="grid-template-columns:repeat(4,1fr)">${person('Dana Ortiz', 'Founder & creative director', 0)}${person('Sam Okafor', 'Lead designer', 1)}${person('Priya Raman', 'Developer', 2)}${person('Leo Brandt', 'Strategist', 3)}</div>`),
  services: shell('Services', `
    <h1>Services</h1><p style="max-width:620px">Pick a package, or combine them. Every engagement starts with a free call.</p><br>
    <div class="grid" style="grid-template-columns:repeat(3,1fr)">${packages.join('')}</div>`),
  'services-v2': shell('Services', `
    <h1>Services</h1><p style="max-width:620px">Pick a package, or combine them. Every engagement starts with a free call.</p><br>
    <div class="grid" style="grid-template-columns:repeat(4,1fr)">${packages.join('')}${growth}</div>`),
  portfolio: shell('Portfolio', `
    <h1>Portfolio</h1><p>Selected case studies from the last three years.</p><br>
    <div class="grid" style="grid-template-columns:repeat(3,1fr)">${[
      ['Harbor Coffee rebrand', 'Brand'], ['Lumen Clinic website', 'Web'], ['Field Notes journal', 'Content'],
      ['Northwind Bikes launch', 'Web'], ['Olive & Thyme menu system', 'Brand'], ['Kite Labs growth site', 'Growth'],
    ].map(([t, c], i) => project(t, c, i)).join('')}</div>`),
  contact: shell('Contact', `
    <div style="display:grid;grid-template-columns:1.3fr 1fr;gap:56px">
      <div><h1>Let's talk.</h1>
        <div class="card" style="padding:28px;display:grid;gap:14px">
          <label>Name<input style="display:block;width:100%;padding:12px;border:1px solid #ddd;border-radius:8px;margin-top:6px" placeholder="Your name"></label>
          <label>Email<input style="display:block;width:100%;padding:12px;border:1px solid #ddd;border-radius:8px;margin-top:6px" placeholder="you@company.com"></label>
          <label>Message<textarea style="display:block;width:100%;height:110px;padding:12px;border:1px solid #ddd;border-radius:8px;margin-top:6px" placeholder="Tell us about your project"></textarea></label>
          <span class="btn" style="justify-self:start">Send message</span>
        </div></div>
      <div style="padding-top:90px"><h2>Visit the studio</h2><p>Acme Studio<br>214 Mercer Street, Floor 3<br>Portland, OR 97209</p><p>hello@acmestudio.example<br>(503) 555-0142</p></div>
    </div>`),
};

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await mkdir(OUT, { recursive: true });
for (const [name, html] of Object.entries(pages)) {
  await page.setContent(html);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log(`wrote ${OUT}/${name}.png`);
}
await browser.close();
