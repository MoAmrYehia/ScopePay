// A small JSON-file store. Each visitor gets an isolated workspace (cookie based),
// so several judges can try the hosted demo at once without seeing each other's data.

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const dbFile = () => path.join(config.dataDir, 'db.json');
let db = { projects: {} };
let writeQueue = Promise.resolve();

export async function loadStore() {
  try {
    db = JSON.parse(await readFile(dbFile(), 'utf8'));
    db.projects ||= {};
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function persist() {
  // Serialise writes and replace the file atomically.
  writeQueue = writeQueue.then(async () => {
    await mkdir(config.dataDir, { recursive: true });
    const temp = dbFile() + '.tmp';
    await writeFile(temp, JSON.stringify(db, null, 2), { mode: 0o600 });
    await rename(temp, dbFile());
  });
  return writeQueue;
}

export const newId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
export const now = () => new Date().toISOString();

export function listProjects(workspaceId) {
  return Object.values(db.projects)
    .filter((p) => p.workspaceId === workspaceId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getProject(workspaceId, id) {
  const project = db.projects[id];
  return project && project.workspaceId === workspaceId ? project : null;
}

export function getProjectByPortalToken(token) {
  if (!token || token.length < 20) return null;
  return Object.values(db.projects).find((p) =>
    p.portalToken.length === token.length &&
    crypto.timingSafeEqual(Buffer.from(p.portalToken), Buffer.from(token)),
  ) || null;
}

export function findInvoice(paypalId) {
  for (const project of Object.values(db.projects)) {
    const invoice = project.invoices.find((i) => i.paypalId === paypalId);
    if (invoice) return { project, invoice };
  }
  return null;
}

export async function saveProject(project) {
  project.updatedAt = now();
  db.projects[project.id] = project;
  await persist();
  return project;
}

export async function deleteWorkspace(workspaceId) {
  for (const project of listProjects(workspaceId)) delete db.projects[project.id];
  await persist();
}

export function logActivity(project, text, kind = 'info') {
  project.activity.unshift({ at: now(), text, kind });
  project.activity = project.activity.slice(0, 200);
}

export function createProject({ workspaceId, name, client, agreement, terms, extraction }) {
  const project = {
    id: newId('prj'),
    workspaceId,
    portalToken: crypto.randomBytes(24).toString('base64url'),
    name,
    client, // { name, email }
    currency: terms.currency || 'USD',
    createdAt: now(),
    updatedAt: now(),
    agreement, // { filename, text }
    extraction, // { by, model, at, warnings }
    terms, // milestones, exclusions, changePolicy
    evidence: [],
    reviews: {},
    scopeChecks: [],
    approvals: [],
    invoices: [],
    activity: [],
  };
  for (const milestone of project.terms.milestones) milestone.status ||= 'in_progress';
  return project;
}
