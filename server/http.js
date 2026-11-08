// Minimal HTTP helpers: a pattern router, JSON bodies, cookies and static files.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export function createRouter() {
  const routes = [];
  const add = (method) => (pattern, handler) => {
    const keys = [];
    const regex = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
    routes.push({ method, regex, keys, handler });
  };
  return {
    get: add('GET'),
    post: add('POST'),
    delete: add('DELETE'),
    match(method, pathname) {
      for (const route of routes) {
        if (route.method !== method) continue;
        const m = route.regex.exec(pathname);
        if (m) return { handler: route.handler, params: Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
      }
      return null;
    },
  };
}

export async function readBody(req, limit = 9 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request too large.'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function sendJson(res, body, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((c) => c.trim().split('=')).filter(([k, v]) => k && v).map(([k, v]) => [k, decodeURIComponent(v)]));
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

export async function serveStatic(res, root, pathname) {
  const file = path.join(root, pathname);
  if (!file.startsWith(root + path.sep)) return false;
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': /\.(woff2|jpg|webp|png)$/.test(file) ? 'public, max-age=604800' : 'no-cache' });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

export function sendFile(res, buffer, mime, filename) {
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Disposition': `inline; filename="${filename.replace(/"/g, '')}"`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    'Cache-Control': 'private, max-age=3600',
  });
  res.end(buffer);
}
