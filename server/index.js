// ScopePay server: the public website, accounts, the JSON API for the
// freelancer app, a token-based client portal, and the PayPal webhook receiver.

import http from 'node:http';
import path from 'node:path';
import { config, capabilities } from './config.js';
import { createRouter, readBody, sendJson, serveStatic, sendFile } from './http.js';
import { loadStore, listProjects, getProject, getProjectByPortalToken, findInvoice, createProject, saveProject, deleteWorkspace, logActivity } from './store.js';
import { extractAgreement } from './ai/extract.js';
import { decodeUpload, documentText, badRequest } from './documents.js';
import { verifyWebhook } from './paypal.js';
import { ensureSeeded, addSampleProject, DEMO_FREELANCER } from './seed.js';
import * as auth from './auth.js';
import { renderSitePage, SITE_PAGES } from './site.js';
import * as flow from './workflow.js';

const PUBLIC_DIR = path.resolve('public');
const SAMPLES_DIR = path.resolve('samples');
const api = createRouter();
const notFound = (what = 'Not found.') => Object.assign(new Error(what), { status: 404 });

// --- views ---------------------------------------------------------------------

function workspaceView(project, origin) {
  const { workspaceId, ...rest } = project;
  return {
    ...rest,
    portalUrl: flow.portalUrl(project, origin),
    reviewCurrent: Object.fromEntries(project.terms.milestones.map((m) => [m.id, flow.reviewIsCurrent(project, m.id)])),
  };
}

function portalView(project) {
  const visibleOrders = new Set(['sent', 'approved', 'declined', 'invoiced', 'paid']);
  return {
    name: project.name,
    client: project.client,
    currency: project.currency,
    freelancer: project.freelancer?.businessName || config.paypal.businessName,
    agreement: project.agreement,
    terms: project.terms,
    evidence: project.evidence.map(({ text, ...e }) => e),
    reviews: project.reviews,
    approvals: project.approvals,
    changeOrders: project.scopeChecks.filter((c) => c.changeOrder && visibleOrders.has(c.changeOrder.status)).map((c) => ({ id: c.id, message: c.message, reason: c.reason, source: c.source, ...c.changeOrder })),
    invoices: project.invoices.filter((i) => i.status !== 'CREATING' && i.status !== 'CREATE_FAILED').map((i) => ({ id: i.id, kind: i.kind, targetId: i.targetId, title: i.title, amount: i.amount, number: i.number, status: i.status, payerUrl: i.payerUrl, mode: i.mode, paidAt: i.paidAt })),
    payments: capabilities().payments,
  };
}

// --- who is calling: a signed-in user or a demo visitor ------------------------------

const seeding = new Map();

async function identify(req, ctx) {
  const user = auth.currentUser(req);
  if (user) {
    Object.assign(ctx, { user, workspace: user.id, freelancer: { name: user.name, businessName: user.businessName, email: user.email } });
    return;
  }
  const demo = auth.demoWorkspace(req);
  if (demo) {
    if (!seeding.has(demo)) seeding.set(demo, ensureSeeded(demo).catch((e) => (seeding.delete(demo), Promise.reject(e))));
    await seeding.get(demo);
    Object.assign(ctx, { demo: true, workspace: demo, freelancer: DEMO_FREELANCER });
  }
}

const requireWorkspace = (ctx) => {
  if (!ctx.workspace) throw Object.assign(new Error('Sign in to continue.'), { status: 401 });
};
const project = (ctx) => getProject(ctx.workspace, ctx.params.id) || (() => { throw notFound('Project not found.'); })();
const clientIp = (req) => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

// --- session and accounts ------------------------------------------------------------

api.get('/api/session', async (ctx) => ({
  user: auth.publicUser(ctx.user),
  demo: Boolean(ctx.demo),
  freelancer: ctx.freelancer || null,
  capabilities: capabilities(),
  defaults: { clientEmail: config.paypal.defaultRecipientEmail || (config.paypal.mode === 'simulated' ? 'client@example.com' : '') },
}));

api.post('/api/auth/signup', async (ctx) => {
  const user = await auth.signUp(ctx.body);
  await auth.startSession(ctx.req, ctx.res, user);
  return { user: auth.publicUser(user) };
});

api.post('/api/auth/signin', async (ctx) => {
  const user = await auth.signIn(ctx.body, clientIp(ctx.req));
  await auth.startSession(ctx.req, ctx.res, user);
  return { user: auth.publicUser(user) };
});

api.post('/api/auth/signout', async (ctx) => {
  await auth.endSession(ctx.req, ctx.res);
  return { ok: true };
});

api.post('/api/account', async (ctx) => {
  if (!ctx.user) throw Object.assign(new Error('Sign in to continue.'), { status: 401 });
  const user = await auth.updateProfile(ctx.user, ctx.body);
  // Keep the name clients see on open projects in step with the profile.
  for (const p of listProjects(user.id)) {
    p.freelancer = { name: user.name, businessName: user.businessName, email: user.email };
    await saveProject(p);
  }
  return { user: auth.publicUser(user) };
});

api.post('/api/account/password', async (ctx) => {
  if (!ctx.user) throw Object.assign(new Error('Sign in to continue.'), { status: 401 });
  await auth.changePassword(ctx.user, ctx.body);
  return { ok: true };
});

api.post('/api/account/delete', async (ctx) => {
  if (!ctx.user) throw Object.assign(new Error('Sign in to continue.'), { status: 401 });
  await auth.deleteAccount(ctx.user, ctx.body);
  await auth.endSession(ctx.req, ctx.res);
  return { ok: true };
});

// --- workspace API -------------------------------------------------------------------

api.get('/api/projects', async (ctx) => listProjects(ctx.workspace).map((p) => workspaceView(p, ctx.origin)));

api.get('/api/projects/:id', async (ctx) => {
  let p = project(ctx);
  if (ctx.query.get('sync')) p = await flow.syncOpenInvoices(p);
  return workspaceView(p, ctx.origin);
});

api.post('/api/agreements/extract', async (ctx) => {
  let text = typeof ctx.body.text === 'string' ? ctx.body.text : '';
  let filename = String(ctx.body.filename || 'agreement.txt');
  if (ctx.body.base64) {
    const file = decodeUpload(ctx.body);
    text = await documentText(file);
    filename = file.filename;
  }
  text = text.replace(/\r\n/g, '\n').trim();
  if (text.length < 80) throw badRequest('The agreement text is too short to extract terms from.');
  if (text.length > 60000) throw badRequest('Agreements must be under 60,000 characters.');
  const { terms, extraction } = await extractAgreement(text);
  return { agreement: { filename, text }, terms, extraction };
});

api.post('/api/projects', async (ctx) => {
  const { agreement, terms, extraction, client, name } = ctx.body;
  if (!agreement?.text || !terms?.milestones?.length) throw badRequest('Extract and confirm the agreement terms first.');
  const email = String(client?.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('Enter the client email address that will receive PayPal invoices.');
  for (const m of terms.milestones) {
    if (!(Number(m.amount) > 0)) throw badRequest(`Set an amount for "${m.name}".`);
    if (!m.deliverables?.length) throw badRequest(`Add at least one deliverable to "${m.name}".`);
    m.amount = Math.round(Number(m.amount) * 100) / 100;
  }
  const p = createProject({
    workspaceId: ctx.workspace,
    freelancer: ctx.freelancer,
    name: String(name || terms.projectName || 'New project').slice(0, 120),
    client: { name: String(client?.name || terms.clientName || 'Client').slice(0, 120), email },
    agreement: { filename: String(agreement.filename || 'agreement').slice(0, 120), text: String(agreement.text).slice(0, 60000) },
    terms,
    extraction: { ...extraction, confirmedAt: new Date().toISOString() },
  });
  logActivity(p, `Agreement confirmed: ${p.terms.milestones.length} milestones, ${p.terms.milestones.reduce((n, m) => n + m.deliverables.length, 0)} acceptance conditions`, 'agreement');
  return workspaceView(await saveProject(p), ctx.origin);
});

api.post('/api/projects/:id/evidence', async (ctx) => workspaceView(await flow.addEvidence(project(ctx), { milestoneId: ctx.body.milestoneId, note: ctx.body.note, file: decodeUpload(ctx.body) }), ctx.origin));
api.delete('/api/projects/:id/evidence/:evidenceId', async (ctx) => workspaceView(await flow.removeEvidence(project(ctx), ctx.params.evidenceId), ctx.origin));
api.get('/api/projects/:id/evidence/:evidenceId', async (ctx) => {
  const file = await flow.evidenceFile(project(ctx), ctx.params.evidenceId);
  if (!file) throw notFound();
  return { file };
});

api.post('/api/projects/:id/milestones/:milestoneId/review', async (ctx) => workspaceView(await flow.runReview(project(ctx), ctx.params.milestoneId), ctx.origin));
api.post('/api/projects/:id/milestones/:milestoneId/submit', async (ctx) => workspaceView(await flow.submitForApproval(project(ctx), ctx.params.milestoneId), ctx.origin));

api.post('/api/projects/:id/scope-checks', async (ctx) => workspaceView(await flow.addScopeCheck(project(ctx), ctx.body.message), ctx.origin));
api.post('/api/projects/:id/scope-checks/:checkId/send', async (ctx) => workspaceView(await flow.sendChangeOrder(project(ctx), ctx.params.checkId, { amount: Number(ctx.body.amount), hours: Number(ctx.body.hours) }), ctx.origin));

api.post('/api/projects/:id/invoices/:invoiceId/retry', async (ctx) => workspaceView(await flow.retryCreate(project(ctx), ctx.params.invoiceId), ctx.origin));
api.post('/api/projects/:id/invoices/:invoiceId/send', async (ctx) => workspaceView(await flow.sendInvoice(project(ctx), ctx.params.invoiceId), ctx.origin));
api.post('/api/projects/:id/invoices/:invoiceId/refresh', async (ctx) => workspaceView(await flow.refreshInvoice(project(ctx), ctx.params.invoiceId), ctx.origin));
api.post('/api/projects/:id/invoices/:invoiceId/reminder-draft', async (ctx) => flow.reminderDraft(project(ctx), ctx.params.invoiceId));
api.post('/api/projects/:id/invoices/:invoiceId/remind', async (ctx) => workspaceView(await flow.sendReminder(project(ctx), ctx.params.invoiceId, ctx.body), ctx.origin));
api.post('/api/projects/:id/invoices/:invoiceId/simulate-payment', async (ctx) => workspaceView(await flow.simulatePayment(project(ctx), ctx.params.invoiceId), ctx.origin));

api.post('/api/workspace/sample', async (ctx) => workspaceView(await addSampleProject(ctx.workspace, ctx.freelancer), ctx.origin));

api.post('/api/workspace/reset', async (ctx) => {
  if (!ctx.demo) throw Object.assign(new Error('Only the demo workspace can be reset.'), { status: 403 });
  await deleteWorkspace(ctx.workspace);
  seeding.delete(ctx.workspace);
  await ensureSeeded(ctx.workspace);
  return { ok: true };
});

// --- client portal API (token in the URL fragment, sent as a path segment) -----------

const portalProject = (ctx) => getProjectByPortalToken(ctx.params.token) || (() => { throw notFound('This review link is not valid.'); })();

api.get('/api/portal/:token', async (ctx) => {
  let p = portalProject(ctx);
  if (ctx.query.get('sync')) p = await flow.syncOpenInvoices(p);
  return portalView(p);
});
api.get('/api/portal/:token/evidence/:evidenceId', async (ctx) => {
  const file = await flow.evidenceFile(portalProject(ctx), ctx.params.evidenceId);
  if (!file) throw notFound();
  return { file };
});
api.post('/api/portal/:token/milestones/:milestoneId/approve', async (ctx) =>
  portalView(await flow.approveMilestone(portalProject(ctx), ctx.params.milestoneId, { name: ctx.body.name, acknowledgeOpenItems: ctx.body.acknowledgeOpenItems === true, origin: ctx.origin })));
api.post('/api/portal/:token/milestones/:milestoneId/request-changes', async (ctx) =>
  portalView(await flow.requestChanges(portalProject(ctx), ctx.params.milestoneId, ctx.body)));
api.post('/api/portal/:token/change-orders/:checkId/decision', async (ctx) =>
  portalView(await flow.decideChangeOrder(portalProject(ctx), ctx.params.checkId, { name: ctx.body.name, approve: ctx.body.approve === true, origin: ctx.origin })));

// --- PayPal webhooks ------------------------------------------------------------------

async function handleWebhook(req, res) {
  const raw = await readBody(req, 1024 * 1024);
  let verified = false;
  try {
    verified = await verifyWebhook(req.headers, raw);
  } catch (error) {
    console.error('Webhook verification error:', error.message);
  }
  if (!verified) return sendJson(res, { error: 'Webhook signature could not be verified.' }, 400);
  const event = JSON.parse(raw);
  const resource = event.resource?.invoice || event.resource || {};
  const match = resource.id && findInvoice(resource.id);
  if (match && resource.status) {
    const before = match.invoice.status;
    match.invoice.status = resource.status;
    if (before !== resource.status) flow.applyStatus(match.project, match.invoice, `PayPal webhook ${event.event_type}`);
    await saveProject(match.project);
  }
  return sendJson(res, { received: true });
}

// --- server -------------------------------------------------------------------------------

const AI_ROUTES = /\/(extract|review|scope-checks|reminder-draft)$/;
const rate = new Map();
function rateLimited(req, limit = 12) {
  const minute = Math.floor(Date.now() / 60000);
  const key = `${clientIp(req)}:${limit}:${minute}`;
  rate.set(key, (rate.get(key) || 0) + 1);
  if (rate.size > 5000) rate.clear();
  return rate.get(key) > limit;
}

function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

function sendHtml(res, html, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
  res.end(html);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0];
  const origin = `${proto}://${req.headers.host}`;
  try {
    if (url.pathname === '/api/health') return sendJson(res, { status: 'ok', ...capabilities() });
    if (url.pathname === '/api/webhooks/paypal' && req.method === 'POST') return await handleWebhook(req, res);

    if (url.pathname.startsWith('/api/')) {
      const route = api.match(req.method, url.pathname);
      if (!route) return sendJson(res, { error: 'Unknown endpoint.' }, 404);
      if (req.method !== 'GET') {
        // Same-origin only: the API is not meant to be called from other sites.
        if (req.headers.origin && req.headers.origin !== origin) return sendJson(res, { error: 'Cross-origin requests are not allowed.' }, 403);
        if (req.method === 'POST' && AI_ROUTES.test(url.pathname) && rateLimited(req)) return sendJson(res, { error: 'Too many AI requests. Wait a minute and try again.' }, 429);
      }
      const ctx = { req, res, params: route.params, query: url.searchParams, origin, body: {} };
      if (req.method === 'POST') {
        const raw = await readBody(req);
        try {
          ctx.body = raw ? JSON.parse(raw) : {};
        } catch {
          throw badRequest('Invalid JSON body.');
        }
      }
      if (!url.pathname.startsWith('/api/portal/')) {
        await identify(req, ctx);
        const open = ['/api/session', '/api/auth/signup', '/api/auth/signin', '/api/auth/signout', '/api/account', '/api/account/password', '/api/account/delete'];
        if (!open.includes(url.pathname)) requireWorkspace(ctx);
        if (url.pathname.startsWith('/api/auth/sign') && url.pathname !== '/api/auth/signout' && rateLimited(req, 20)) {
          return sendJson(res, { error: 'Too many attempts. Wait a minute and try again.' }, 429);
        }
      }
      const result = await route.handler(ctx);
      if (result?.file) return sendFile(res, result.file.buffer, result.file.item.mime, result.file.item.filename);
      return sendJson(res, result);
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, { error: 'Method not allowed.' }, 405);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    const user = auth.currentUser(req);

    // The app: signed-in users, or visitors who chose the demo.
    if (pathname === '/demo') {
      if (user) return redirect(res, '/app');
      if (!auth.demoWorkspace(req)) auth.newDemoWorkspace(req, res);
      return redirect(res, '/app');
    }
    if (pathname === '/app' || pathname === '/app.html') {
      if (!user && !auth.demoWorkspace(req)) return redirect(res, '/signin?next=/app');
      return void (await serveStatic(res, PUBLIC_DIR, '/app.html'));
    }
    if ((pathname === '/signin' || pathname === '/signup') && user) return redirect(res, '/app');

    // The public website.
    if (SITE_PAGES.has(pathname)) return sendHtml(res, await renderSitePage(pathname, { user }));
    if (url.pathname === '/vendor/ag-grid-community.min.js') return void (await serveStatic(res, path.resolve('node_modules/ag-grid-community/dist'), '/ag-grid-community.min.js'));
    if (url.pathname.startsWith('/samples/') && (await serveStatic(res, SAMPLES_DIR, url.pathname.slice('/samples'.length)))) return;
    if (await serveStatic(res, PUBLIC_DIR, url.pathname)) return;
    sendHtml(res, await renderSitePage('/404', { user }), 404);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error(error);
    sendJson(res, { error: status >= 500 && !error.message ? 'Something went wrong.' : error.message }, status);
  }
});

const storage = await loadStore();
server.listen(config.port, '0.0.0.0', () => {
  const caps = capabilities();
  console.log(`ScopePay on http://localhost:${config.port}  ·  storage: ${storage}  ·  AI: ${caps.ai.provider} (${caps.ai.model})  ·  PayPal: ${caps.payments.mode}${caps.payments.webhooks ? ' + webhooks' : ''}`);
});
