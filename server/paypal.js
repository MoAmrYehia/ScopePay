// PayPal Invoicing v2 (sandbox). Creates, sends, tracks and reminds milestone and
// change-order invoices, and verifies invoice webhooks. When no sandbox
// credentials are configured, a simulated adapter with the same shape is used
// and every invoice is labelled "simulated" in the UI.

import crypto from 'node:crypto';
import { config } from './config.js';

let token = { value: '', expiresAt: 0 };

async function accessToken() {
  if (token.value && Date.now() < token.expiresAt - 60_000) return token.value;
  const basic = Buffer.from(`${config.paypal.clientId}:${config.paypal.clientSecret}`).toString('base64');
  const response = await fetch(`${config.paypal.baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!response.ok) throw new Error('PayPal sandbox authentication failed. Check the client ID and secret.');
  const data = await response.json();
  token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return token.value;
}

async function paypal(path, { method = 'GET', body, rawBody, headers = {} } = {}) {
  const response = await fetch(`${config.paypal.baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json', ...headers },
    body: rawBody ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const detail = data.details?.[0]?.description || data.message || data.error_description || '';
    throw Object.assign(new Error(`PayPal request failed (HTTP ${response.status}) ${detail}`.trim()), { status: 502, paypal: data });
  }
  return data;
}

const isoDay = (d = new Date()) => d.toISOString().slice(0, 10);

function invoicePayload(project, invoice, number) {
  const milestone = invoice.kind === 'milestone';
  return {
    detail: {
      invoice_number: number,
      reference: project.id,
      invoice_date: isoDay(),
      currency_code: project.currency,
      payment_term: { term_type: 'NET_10' },
      note: milestone
        ? `${invoice.title} was accepted by ${invoice.approvedBy} on ${invoice.approvedAt.slice(0, 10)}. Evidence pack: ${invoice.portalUrl}`
        : `Approved change request: ${invoice.title}. Approved by ${invoice.approvedBy} on ${invoice.approvedAt.slice(0, 10)}.`,
      memo: `ScopePay ${invoice.kind} ${invoice.targetId}`,
    },
    invoicer: {
      business_name: project.freelancer?.businessName || config.paypal.businessName,
      ...(config.paypal.invoicerEmail ? { email_address: config.paypal.invoicerEmail } : {}),
    },
    primary_recipients: [{ billing_info: { business_name: project.client.name, email_address: project.client.email } }],
    items: invoice.lines.map((line) => ({
      name: line.name.slice(0, 200),
      description: (line.description || '').slice(0, 1000),
      quantity: String(line.quantity),
      unit_amount: { currency_code: project.currency, value: line.unitAmount.toFixed(2) },
      unit_of_measure: line.unit || 'AMOUNT',
    })),
    configuration: { allow_tip: false, tax_calculated_after_discount: true, tax_inclusive: false },
  };
}

// --- live sandbox adapter ----------------------------------------------------

const live = {
  async create(project, invoice) {
    const { invoice_number: number } = await paypal('/v2/invoicing/generate-next-invoice-number', { method: 'POST' });
    const created = await paypal('/v2/invoicing/invoices', {
      method: 'POST',
      body: invoicePayload(project, invoice, number),
      // Idempotency: retrying "create" for the same approval never makes a second invoice.
      headers: { 'PayPal-Request-Id': `scopepay-${invoice.id}`, Prefer: 'return=representation' },
    });
    const id = created.id || created.href?.split('/').pop();
    return { paypalId: id, number: created.detail?.invoice_number || number, status: created.status || 'DRAFT' };
  },
  async send(invoice) {
    await paypal(`/v2/invoicing/invoices/${encodeURIComponent(invoice.paypalId)}/send`, {
      method: 'POST',
      body: { send_to_invoicer: true, send_to_recipient: true, subject: `Invoice: ${invoice.title}` },
      headers: { 'PayPal-Request-Id': `scopepay-send-${invoice.id}` },
    });
    return live.get(invoice);
  },
  async get(invoice) {
    const data = await paypal(`/v2/invoicing/invoices/${encodeURIComponent(invoice.paypalId)}`);
    return {
      status: data.status,
      payerUrl: data.detail?.metadata?.recipient_view_url || invoice.payerUrl || '',
      merchantUrl: data.detail?.metadata?.invoicer_view_url || '',
      paidAmount: data.payments?.paid_amount?.value || null,
    };
  },
  async remind(invoice, { subject, note }) {
    await paypal(`/v2/invoicing/invoices/${encodeURIComponent(invoice.paypalId)}/remind`, {
      method: 'POST',
      body: { subject, note, send_to_invoicer: false },
    });
  },
};

// --- simulated adapter -------------------------------------------------------

const simulated = {
  async create(project, invoice) {
    return { paypalId: `SIM-${crypto.randomBytes(4).toString('hex').toUpperCase()}`, number: `SP-${Date.now().toString().slice(-6)}`, status: 'DRAFT' };
  },
  async send(invoice) {
    return { status: 'UNPAID', payerUrl: '' };
  },
  async get(invoice) {
    return { status: invoice.status, payerUrl: invoice.payerUrl || '' };
  },
  async remind() {},
};

export const payments = () => (config.paypal.mode === 'sandbox' ? live : simulated);

// --- webhooks -----------------------------------------------------------------

/** Verifies a PayPal webhook with PayPal's verification API using the raw body. */
export async function verifyWebhook(headers, rawBody) {
  if (config.paypal.mode !== 'sandbox' || !config.paypal.webhookId) return false;
  const field = (name) => JSON.stringify(String(headers[name] || ''));
  // Build the request by hand so the event is passed through byte-for-byte.
  const request =
    `{"auth_algo":${field('paypal-auth-algo')},"cert_url":${field('paypal-cert-url')},` +
    `"transmission_id":${field('paypal-transmission-id')},"transmission_sig":${field('paypal-transmission-sig')},` +
    `"transmission_time":${field('paypal-transmission-time')},"webhook_id":${JSON.stringify(config.paypal.webhookId)},` +
    `"webhook_event":${rawBody}}`;
  const result = await paypal('/v1/notifications/verify-webhook-signature', { method: 'POST', rawBody: request });
  return result.verification_status === 'SUCCESS';
}

export const PAID_STATUSES = new Set(['PAID', 'MARKED_AS_PAID']);
