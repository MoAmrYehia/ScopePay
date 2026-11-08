// Public website pages: each page in site/pages is wrapped in site/layout.html.
// A page starts with a JSON comment holding its title and description, e.g.
//   <!--{"title": "Pricing", "description": "..."}-->

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { esc } from './html.js';

const SITE_DIR = path.resolve('site');
const ROUTES = {
  '/': 'home',
  '/how-it-works': 'how-it-works',
  '/pricing': 'pricing',
  '/security': 'security',
  '/privacy': 'privacy',
  '/terms': 'terms',
  '/signin': 'signin',
  '/signup': 'signup',
};
export const SITE_PAGES = new Set(Object.keys(ROUTES));

const cache = new Map();
async function load(file) {
  if (process.env.NODE_ENV === 'production' && cache.has(file)) return cache.get(file);
  const text = await readFile(path.join(SITE_DIR, file), 'utf8');
  cache.set(file, text);
  return text;
}

export async function renderSitePage(route, { user } = {}) {
  const page = ROUTES[route] || '404';
  const [layout, source] = await Promise.all([load('layout.html'), load(`pages/${page}.html`)]);
  const match = /^<!--(\{.*?\})-->\s*/s.exec(source);
  const meta = match ? JSON.parse(match[1]) : {};
  const body = match ? source.slice(match[0].length) : source;

  const account = user
    ? `<a class="nav-link" href="/app">Signed in as ${esc(user.name.split(' ')[0])}</a><a class="btn btn-light" href="/app">Open ScopePay</a>`
    : `<a class="nav-link" href="/signin">Sign in</a><a class="btn btn-light" href="/signup">Create account</a>`;

  return layout
    .replaceAll('{{title}}', esc(meta.title ? `${meta.title} | ScopePay` : 'ScopePay: get paid for the work you agreed to'))
    .replaceAll('{{description}}', esc(meta.description || 'ScopePay checks delivered work against your agreement, lets your client accept it with the evidence in front of them, and issues the PayPal invoice when they do.'))
    .replaceAll('{{page}}', page)
    .replace('{{account}}', account)
    .replace(`data-nav="${page}"`, `data-nav="${page}" aria-current="page"`)
    .replace('{{content}}', body)
    .replaceAll('{{year}}', String(new Date().getFullYear()));
}
