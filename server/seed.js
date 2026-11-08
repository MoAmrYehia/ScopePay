// The sample project: a website redesign where milestone 1 is paid and
// milestone 2 has four of five pages delivered. Demo workspaces get it
// automatically; signed-in users can add it from their empty overview.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { createProject, saveProject, newId, logActivity, listProjects, putUpload } from './store.js';
import { ruleBasedExtract, finalizeExtraction } from './ai/extract.js';

const SAMPLES = path.resolve('samples');
const SEED_EVIDENCE = ['home.png', 'about.png', 'services.png', 'contact.png'];
export const DEMO_FREELANCER = { name: 'Jamie Lee', businessName: 'Jamie Lee Studio', email: '' };

export async function ensureSeeded(workspaceId) {
  if (listProjects(workspaceId).length) return;
  await addSampleProject(workspaceId, DEMO_FREELANCER);
}

export async function addSampleProject(workspaceId, freelancer) {
  const text = await readFile(path.join(SAMPLES, 'agreement-website-redesign.md'), 'utf8');
  const { terms, extraction } = finalizeExtraction(ruleBasedExtract(text), text);
  const project = createProject({
    workspaceId,
    freelancer,
    name: 'Website redesign (sample)',
    client: { name: 'Acme Studio LLC', email: config.paypal.defaultRecipientEmail || 'client@example.com' },
    agreement: { filename: 'agreement-website-redesign.md', text },
    terms,
    extraction: { ...extraction, by: 'sample', model: 'pre-loaded sample' },
  });

  // History: milestone 1 was accepted and paid before the sample starts.
  const [first, second] = project.terms.milestones;
  const approvedAt = '2026-10-21T15:12:00.000Z';
  const approval = { id: newId('apr'), kind: 'milestone', targetId: first.id, name: 'Dana Ortiz', at: approvedAt, openItemsAcknowledged: 0, sample: true };
  project.approvals.push(approval);
  first.status = 'paid';
  project.invoices.push({
    id: newId('inv'), kind: 'milestone', targetId: first.id, title: `${first.name} milestone`, amount: first.amount,
    lines: [], approvalId: approval.id, approvedBy: approval.name, approvedAt, mode: 'sample', status: 'PAID',
    number: 'SAMPLE-0001', paypalId: '', createdAt: approvedAt, sentAt: approvedAt, paidAt: '2026-10-24T09:30:00.000Z', reminders: [], sample: true,
  });

  // Milestone 2: four page screenshots delivered so far.
  for (const file of SEED_EVIDENCE) {
    const buffer = await readFile(path.join(SAMPLES, 'evidence', file));
    const id = newId('ev');
    await putUpload(project.id, id, buffer);
    project.evidence.push({ id, milestoneId: second.id, filename: `${file.replace('.png', '')}-page.png`, mime: 'image/png', size: buffer.length, kind: 'image', text: '', note: '', uploadedAt: '2026-11-02T16:40:00.000Z' });
  }

  project.activity = [];
  logActivity(project, 'Sample project added: Website redesign for Acme Studio', 'info');
  project.activity.push({ at: '2026-10-24T09:30:00.000Z', text: 'Discovery and design milestone paid (sample history)', kind: 'paid' });
  return saveProject(project);
}
