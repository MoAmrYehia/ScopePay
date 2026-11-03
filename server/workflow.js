// The ScopePay workflow: agreed terms → evidence → AI review → client acceptance
// → PayPal invoice → payment. All state transitions and guards live here.

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { newId, now, logActivity, saveProject } from './store.js';
import { reviewMilestone } from './ai/evidence.js';
import { checkScope, draftReminder } from './ai/scope.js';
import { payments, PAID_STATUSES } from './paypal.js';
import { IMAGE_TYPES, documentText, badRequest } from './documents.js';

const uploadDir = (projectId) => path.join(config.dataDir, 'uploads', projectId);
const conflict = (message) => Object.assign(new Error(message), { status: 409 });

export const milestoneOf = (project, id) => {
  const milestone = project.terms.milestones.find((m) => m.id === id);
  if (!milestone) throw Object.assign(new Error('Milestone not found.'), { status: 404 });
  return milestone;
};

export function portalUrl(project, origin) {
  return `${config.publicUrl || origin}/portal.html#${project.portalToken}`;
}

// --- evidence -------------------------------------------------------------------

export async function addEvidence(project, { milestoneId, note, file }) {
  const milestone = milestoneOf(project, milestoneId);
  if (['approved', 'invoiced', 'paid'].includes(milestone.status)) throw conflict('This milestone is already approved.');
  const id = newId('ev');
  await mkdir(uploadDir(project.id), { recursive: true });
  await writeFile(path.join(uploadDir(project.id), id), file.buffer, { mode: 0o600 });
  const isImage = IMAGE_TYPES.has(file.mime);
  const text = isImage ? '' : (await documentText(file)).slice(0, 20000);
  project.evidence.push({ id, milestoneId, filename: file.filename, mime: file.mime, size: file.buffer.length, kind: isImage ? 'image' : 'document', text, note: String(note || '').slice(0, 300), uploadedAt: now() });
  if (milestone.status === 'changes_requested') milestone.status = 'in_progress';
  logActivity(project, `Evidence added to ${milestone.name}: ${file.filename}`, 'evidence');
  return saveProject(project);
}

export async function removeEvidence(project, evidenceId) {
  const item = project.evidence.find((e) => e.id === evidenceId);
  if (!item) throw Object.assign(new Error('Evidence not found.'), { status: 404 });
  const milestone = milestoneOf(project, item.milestoneId);
  if (!['in_progress', 'changes_requested', 'submitted'].includes(milestone.status)) throw conflict('Approved evidence cannot be removed.');
  project.evidence = project.evidence.filter((e) => e.id !== evidenceId);
  await rm(path.join(uploadDir(project.id), evidenceId), { force: true });
  return saveProject(project);
}

export async function evidenceFile(project, evidenceId) {
  const item = project.evidence.find((e) => e.id === evidenceId);
  if (!item) return null;
  return { item, buffer: await readFile(path.join(uploadDir(project.id), evidenceId)) };
}

// --- AI review ---------------------------------------------------------------------

export async function runReview(project, milestoneId) {
  const milestone = milestoneOf(project, milestoneId);
  const items = project.evidence.filter((e) => e.milestoneId === milestoneId);
  const loaded = await Promise.all(
    items.map(async (e) => ({
      ...e,
      base64: e.kind === 'image' ? (await readFile(path.join(uploadDir(project.id), e.id))).toString('base64') : undefined,
    })),
  );
  const review = await reviewMilestone(milestone, loaded);
  review.evidenceIds = items.map((e) => e.id);
  project.reviews[milestoneId] = review;
  const { met, partial, missing } = review.counts;
  logActivity(project, `AI review of ${milestone.name}: ${met} met, ${partial} partial, ${missing} missing`, 'review');
  return saveProject(project);
}

export function reviewIsCurrent(project, milestoneId) {
  const review = project.reviews[milestoneId];
  if (!review) return false;
  const ids = project.evidence.filter((e) => e.milestoneId === milestoneId).map((e) => e.id).sort().join();
  return ids === [...review.evidenceIds].sort().join();
}

export async function submitForApproval(project, milestoneId) {
  const milestone = milestoneOf(project, milestoneId);
  if (!reviewIsCurrent(project, milestoneId)) throw conflict('Run the evidence review again: the evidence changed since the last review.');
  if (!['in_progress', 'changes_requested'].includes(milestone.status)) throw conflict('This milestone is not open for submission.');
  milestone.status = 'submitted';
  milestone.submittedAt = now();
  logActivity(project, `${milestone.name} shared with ${project.client.name} for acceptance`, 'submit');
  return saveProject(project);
}

// --- client decisions (portal) -------------------------------------------------------

export async function approveMilestone(project, milestoneId, { name, acknowledgeOpenItems, origin }) {
  const milestone = milestoneOf(project, milestoneId);
  if (milestone.status !== 'submitted') throw conflict('This milestone is not awaiting your acceptance.');
  if (!reviewIsCurrent(project, milestoneId)) throw conflict('The evidence changed after review. Ask the freelancer to re-run the review.');
  const signer = String(name || '').trim().slice(0, 120);
  if (signer.length < 2) throw badRequest('Type your full name to record acceptance.');
  const review = project.reviews[milestoneId];
  const open = review.counts.partial + review.counts.missing;
  if (open && !acknowledgeOpenItems) throw badRequest('Confirm that you accept the milestone despite the open items.');
  if (milestone.amount == null || milestone.amount <= 0) throw conflict('This milestone has no amount to invoice.');

  const approval = {
    id: newId('apr'),
    kind: 'milestone',
    targetId: milestoneId,
    name: signer,
    at: now(),
    openItemsAcknowledged: open,
    reviewSnapshot: review.counts,
    evidenceIds: [...review.evidenceIds],
  };
  project.approvals.push(approval);
  milestone.status = 'approved';
  logActivity(project, `${signer} accepted ${milestone.name}`, 'approval');

  const invoice = newInvoice(project, {
    kind: 'milestone',
    targetId: milestoneId,
    title: `${milestone.name} milestone`,
    amount: milestone.amount,
    approval,
    lines: [{ name: `${project.name}: ${milestone.name}`, description: milestone.deliverables.map((d) => `${d.source.clauseRef} ${d.title}`).join('; '), quantity: 1, unitAmount: milestone.amount }],
    origin,
  });
  await createRemoteInvoice(project, invoice);
  return saveProject(project);
}

export async function requestChanges(project, milestoneId, { name, comment }) {
  const milestone = milestoneOf(project, milestoneId);
  if (milestone.status !== 'submitted') throw conflict('This milestone is not awaiting your review.');
  milestone.status = 'changes_requested';
  milestone.clientComment = { name: String(name || 'Client').slice(0, 120), text: String(comment || '').slice(0, 1000), at: now() };
  logActivity(project, `${milestone.clientComment.name} requested changes on ${milestone.name}`, 'changes');
  return saveProject(project);
}

// --- scope checks and change orders ----------------------------------------------

export async function addScopeCheck(project, message) {
  const text = String(message || '').trim();
  if (text.length < 5 || text.length > 2000) throw badRequest('Paste the client request (5 to 2,000 characters).');
  const result = await checkScope(project.terms, project.agreement.text, text);
  const check = { id: newId('sc'), message: text, at: now(), ...result };
  project.scopeChecks.unshift(check);
  logActivity(project, `Scope check: "${text.slice(0, 60)}" → ${result.verdict.replace('_', ' ')}`, 'scope');
  return saveProject(project);
}

export async function sendChangeOrder(project, checkId, { amount, hours }) {
  const check = project.scopeChecks.find((c) => c.id === checkId);
  if (!check?.changeOrder) throw Object.assign(new Error('Change order not found.'), { status: 404 });
  if (check.changeOrder.status !== 'draft') throw conflict('This change order was already sent.');
  if (Number.isFinite(hours) && hours > 0) check.changeOrder.hours = hours;
  if (Number.isFinite(amount) && amount > 0) check.changeOrder.amount = Math.round(amount * 100) / 100;
  if (!(check.changeOrder.amount > 0)) throw badRequest('Set a price for the change order.');
  check.changeOrder.status = 'sent';
  check.changeOrder.sentAt = now();
  logActivity(project, `Change order sent: ${check.changeOrder.title}`, 'scope');
  return saveProject(project);
}

export async function decideChangeOrder(project, checkId, { name, approve, origin }) {
  const check = project.scopeChecks.find((c) => c.id === checkId);
  if (!check?.changeOrder || check.changeOrder.status !== 'sent') throw conflict('This change order is not awaiting a decision.');
  const signer = String(name || '').trim().slice(0, 120);
  if (signer.length < 2) throw badRequest('Type your full name to record your decision.');
  const order = check.changeOrder;
  if (!approve) {
    order.status = 'declined';
    order.decidedAt = now();
    logActivity(project, `${signer} declined change order: ${order.title}`, 'scope');
    return saveProject(project);
  }
  const approval = { id: newId('apr'), kind: 'change_order', targetId: checkId, name: signer, at: now() };
  project.approvals.push(approval);
  order.status = 'approved';
  order.decidedAt = approval.at;
  logActivity(project, `${signer} approved change order: ${order.title}`, 'approval');
  const invoice = newInvoice(project, {
    kind: 'change_order',
    targetId: checkId,
    title: `Change order: ${order.title}`,
    amount: order.amount,
    approval,
    lines: [{ name: `Change request: ${order.title}`, description: order.description, quantity: order.hours, unitAmount: order.rate || order.amount / order.hours, unit: 'HOURS' }],
    origin,
  });
  await createRemoteInvoice(project, invoice);
  return saveProject(project);
}

// --- invoices ------------------------------------------------------------------------

function newInvoice(project, { kind, targetId, title, amount, approval, lines, origin }) {
  const invoice = {
    id: newId('inv'),
    kind,
    targetId,
    title,
    amount,
    lines,
    approvalId: approval.id,
    approvedBy: approval.name,
    approvedAt: approval.at,
    portalUrl: portalUrl(project, origin),
    mode: config.paypal.mode,
    status: 'CREATING',
    createdAt: now(),
    reminders: [],
    error: '',
  };
  project.invoices.unshift(invoice);
  return invoice;
}

async function createRemoteInvoice(project, invoice) {
  try {
    Object.assign(invoice, await payments().create(project, invoice), { error: '' });
    logActivity(project, `PayPal ${invoice.mode} invoice ${invoice.number} created for ${invoice.title}`, 'invoice');
  } catch (error) {
    // Approval stays recorded; the freelancer can retry creation.
    invoice.status = 'CREATE_FAILED';
    invoice.error = error.message;
    logActivity(project, `PayPal invoice creation failed: ${error.message}`, 'error');
  }
}

const invoiceOf = (project, id) => {
  const invoice = project.invoices.find((i) => i.id === id);
  if (!invoice) throw Object.assign(new Error('Invoice not found.'), { status: 404 });
  return invoice;
};

export async function retryCreate(project, invoiceId) {
  const invoice = invoiceOf(project, invoiceId);
  if (invoice.status !== 'CREATE_FAILED') throw conflict('This invoice already exists in PayPal.');
  await createRemoteInvoice(project, invoice);
  return saveProject(project);
}

export async function sendInvoice(project, invoiceId) {
  const invoice = invoiceOf(project, invoiceId);
  if (invoice.status !== 'DRAFT') throw conflict('Only draft invoices can be sent.');
  Object.assign(invoice, await payments().send(invoice), { sentAt: now() });
  setTargetStatus(project, invoice, 'invoiced');
  logActivity(project, `Invoice ${invoice.number} sent to ${project.client.email} through PayPal`, 'invoice');
  return saveProject(project);
}

export async function refreshInvoice(project, invoiceId) {
  const invoice = invoiceOf(project, invoiceId);
  if (!invoice.paypalId) return project;
  const before = invoice.status;
  Object.assign(invoice, await payments().get(invoice));
  if (invoice.status !== before) applyStatus(project, invoice, 'PayPal status refresh');
  return saveProject(project);
}

export async function syncOpenInvoices(project) {
  if (config.paypal.mode !== 'sandbox') return project;
  if (project.lastSyncAt && Date.now() - Date.parse(project.lastSyncAt) < 5000) return project;
  project.lastSyncAt = now();
  for (const invoice of project.invoices.filter((i) => i.paypalId && !PAID_STATUSES.has(i.status) && i.status !== 'CANCELLED')) {
    try {
      const before = invoice.status;
      Object.assign(invoice, await payments().get(invoice));
      if (invoice.status !== before) applyStatus(project, invoice, 'PayPal status refresh');
    } catch {
      /* a transient PayPal error should not break page loads */
    }
  }
  return saveProject(project);
}

export async function reminderDraft(project, invoiceId) {
  const invoice = invoiceOf(project, invoiceId);
  const daysSinceSent = Math.max(0, Math.round((Date.now() - Date.parse(invoice.sentAt || invoice.createdAt)) / 86_400_000));
  return draftReminder({ project, invoice, daysSinceSent });
}

export async function sendReminder(project, invoiceId, { subject, note }) {
  const invoice = invoiceOf(project, invoiceId);
  if (!['SENT', 'UNPAID', 'PARTIALLY_PAID'].includes(invoice.status)) throw conflict('Only sent, unpaid invoices can be reminded.');
  const clean = { subject: String(subject || '').slice(0, 200), note: String(note || '').slice(0, 1000) };
  if (!clean.note.trim()) throw badRequest('Write a reminder note.');
  await payments().remind(invoice, clean);
  invoice.reminders.push({ at: now(), ...clean });
  logActivity(project, `Reminder sent for invoice ${invoice.number}`, 'invoice');
  return saveProject(project);
}

export async function simulatePayment(project, invoiceId) {
  const invoice = invoiceOf(project, invoiceId);
  if (invoice.mode !== 'simulated') throw conflict('Sandbox invoices are paid in PayPal with the sandbox buyer account.');
  if (!['UNPAID', 'SENT'].includes(invoice.status)) throw conflict('Send the invoice first.');
  invoice.status = 'PAID';
  applyStatus(project, invoice, 'Simulated payment');
  return saveProject(project);
}

/** Applies an invoice status change from PayPal (webhook or refresh). */
export function applyStatus(project, invoice, source) {
  if (PAID_STATUSES.has(invoice.status)) {
    invoice.paidAt ||= now();
    setTargetStatus(project, invoice, 'paid');
    logActivity(project, `Invoice ${invoice.number} paid (${source})`, 'paid');
  } else if (invoice.status === 'CANCELLED') {
    logActivity(project, `Invoice ${invoice.number} was cancelled in PayPal`, 'error');
  }
}

function setTargetStatus(project, invoice, status) {
  if (invoice.kind === 'milestone') {
    const milestone = project.terms.milestones.find((m) => m.id === invoice.targetId);
    if (milestone) milestone.status = status;
  } else {
    const check = project.scopeChecks.find((c) => c.id === invoice.targetId);
    if (check?.changeOrder) check.changeOrder.status = status;
  }
}
