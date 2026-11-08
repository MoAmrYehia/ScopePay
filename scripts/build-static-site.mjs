// Exports the public website (home, how it works, pricing, security, privacy,
// terms) as static files for GitHub Pages. The app itself needs the Node
// server, so app links (demo, sign in, sign up, open app) point to APP_URL.
//
// Usage: APP_URL=https://scopepay-wjm5.onrender.com BASE_PATH=/ScopePay node scripts/build-static-site.mjs
// Output: dist/

import { mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { renderSitePage } from '../server/site.js';

const APP_URL = (process.env.APP_URL || 'https://scopepay-wjm5.onrender.com').replace(/\/$/, '');
const BASE = (process.env.BASE_PATH || '').replace(/\/$/, '');
const OUT = 'dist';
const PAGES = ['/', '/how-it-works', '/pricing', '/security', '/privacy', '/terms'];
const APP_ROUTES = /^\/(demo|signin|signup|app)(?=$|[/?#])/;

function rewrite(url) {
  if (APP_ROUTES.test(url)) return APP_URL + url;
  if (PAGES.includes(url.replace(/\/$/, '') || '/')) return `${BASE}${url === '/' ? '/' : `${url}/`}`;
  return BASE + url; // assets: /site.css, /fonts/..., /img/...
}

const html = (text) => text.replace(/(href|src)="(\/(?!\/)[^"]*)"/g, (_, attr, url) => `${attr}="${rewrite(url)}"`);

await rm(OUT, { recursive: true, force: true });
for (const route of [...PAGES, '/404']) {
  const page = html(await renderSitePage(route, { user: null }));
  const file = route === '/' ? 'index.html' : route === '/404' ? '404.html' : `${route.slice(1)}/index.html`;
  await mkdir(path.dirname(path.join(OUT, file)), { recursive: true });
  await writeFile(path.join(OUT, file), page);
  console.log('page', file);
}

await cp('public/img', `${OUT}/img`, { recursive: true });
await cp('public/fonts', `${OUT}/fonts`, { recursive: true });
const css = (await readFile('public/site.css', 'utf8')).replace("@import url('/fonts/fonts.css');", "@import url('fonts/fonts.css');");
await writeFile(`${OUT}/site.css`, css);
const fonts = (await readFile('public/fonts/fonts.css', 'utf8')).replaceAll("url('/fonts/", "url('");
await writeFile(`${OUT}/fonts/fonts.css`, fonts);
await writeFile(`${OUT}/.nojekyll`, '');
console.log(`static site written to ${OUT}/ (app links → ${APP_URL}, base path "${BASE || '/'}")`);
