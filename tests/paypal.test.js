// PayPal Invoicing v2 adapter with a mocked network: token caching, idempotent
// creation, payload contents, payer link, reminders and webhook verification.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.PAYPAL_CLIENT_ID = 'cid';
process.env.PAYPAL_CLIENT_SECRET = 'secret';
process.env.PAYPAL_WEBHOOK_ID = 'WH-1';
const calls = [];
const routes = {
  'POST /v1/oauth2/token': { access_token: 'tok', expires_in: 3600 },
  'POST /v2/invoicing/generate-next-invoice-number': { invoice_number: '0042' },
  'POST /v2/invoicing/invoices': { id: 'INV2-ABCD-1234', status: 'DRAFT', detail: { invoice_number: '0042' } },
  'POST /v2/invoicing/invoices/INV2-ABCD-1234/send': { rel: 'payer-view', href: 'https://www.sandbox.paypal.com/invoice/p/#INV2-ABCD-1234' },
  'GET /v2/invoicing/invoices/INV2-ABCD-1234': { status: 'UNPAID', detail: { metadata: { recipient_view_url: 'https://www.sandbox.paypal.com/invoice/p/#INV2-ABCD-1234' } } },
  'POST /v2/invoicing/invoices/INV2-ABCD-1234/remind': null,
  'POST /v1/notifications/verify-webhook-signature': { verification_status: 'SUCCESS' },
};
globalThis.fetch = async (url, init = {}) => {
  const path = new URL(url).pathname;
  const key = `${init.method || 'GET'} ${path}`;
  calls.push({ key, headers: init.headers, body: init.body });
  if (!(key in routes)) return new Response('{}', { status: 404 });
  return routes[key] === null ? new Response(null, { status: 204 }) : new Response(JSON.stringify(routes[key]), { status: 200 });
};

const { payments, verifyWebhook } = await import('../server/paypal.js');

const project = { id: 'prj_1', currency: 'USD', client: { name: 'Acme Studio LLC', email: 'buyer@example.com' } };
const invoice = {
  id: 'inv_1', kind: 'milestone', targetId: 'ms_2', title: 'Development milestone', amount: 2250,
  approvedBy: 'Dana Ortiz', approvedAt: '2026-11-03T10:00:00.000Z', portalUrl: 'https://scopepay.example/portal.html#t',
  lines: [{ name: 'Website redesign: Development', description: '3.1 Home page; 3.4 Portfolio page', quantity: 1, unitAmount: 2250 }],
};

test('creates a sandbox invoice idempotently with approval context', async () => {
  const result = await payments().create(project, invoice);
  assert.deepEqual(result, { paypalId: 'INV2-ABCD-1234', number: '0042', status: 'DRAFT' });
  const create = calls.find((c) => c.key === 'POST /v2/invoicing/invoices');
  assert.equal(create.headers['PayPal-Request-Id'], 'scopepay-inv_1');
  assert.equal(create.headers.Prefer, 'return=representation');
  const body = JSON.parse(create.body);
  assert.equal(body.detail.invoice_number, '0042');
  assert.equal(body.primary_recipients[0].billing_info.email_address, 'buyer@example.com');
  assert.equal(body.items[0].unit_amount.value, '2250.00');
  assert.match(body.detail.note, /accepted by Dana Ortiz on 2026-11-03/);
  assert.ok(calls[0].key === 'POST /v1/oauth2/token');
});

test('send returns the payer link and reuses the cached token', async () => {
  const sent = await payments().send({ ...invoice, paypalId: 'INV2-ABCD-1234' });
  assert.equal(sent.status, 'UNPAID');
  assert.match(sent.payerUrl, /sandbox\.paypal\.com\/invoice/);
  assert.equal(calls.filter((c) => c.key === 'POST /v1/oauth2/token').length, 1);
  const send = calls.find((c) => c.key.endsWith('/send'));
  assert.equal(JSON.parse(send.body).send_to_recipient, true);
});

test('reminder posts subject and note', async () => {
  await payments().remind({ paypalId: 'INV2-ABCD-1234' }, { subject: 'Reminder', note: 'Thanks!' });
  const remind = calls.find((c) => c.key.endsWith('/remind'));
  assert.deepEqual(JSON.parse(remind.body), { subject: 'Reminder', note: 'Thanks!', send_to_invoicer: false });
});

test('webhook verification passes the raw event through byte-for-byte', async () => {
  const raw = '{"id":"WH-EVT","event_type":"INVOICING.INVOICE.PAID",  "resource":{"invoice":{"id":"INV2-ABCD-1234","status":"PAID"}}}';
  const ok = await verifyWebhook({ 'paypal-auth-algo': 'SHA256withRSA', 'paypal-transmission-id': 't1', 'paypal-transmission-sig': 'sig', 'paypal-transmission-time': 'now', 'paypal-cert-url': 'https://api.paypal.com/cert' }, raw);
  assert.equal(ok, true);
  const verify = calls.find((c) => c.key.endsWith('verify-webhook-signature'));
  assert.ok(verify.body.endsWith(`"webhook_event":${raw}}`));
  assert.equal(JSON.parse(verify.body).webhook_id, 'WH-1');
});
