// Persistence for projects, users, sessions and uploaded evidence.
//
// Two backends with the same behaviour:
//   - Postgres when DATABASE_URL is set (production on Render)
//   - a JSON file plus an uploads folder otherwise (local development, tests)
// Records are kept in memory and written through on every change, which keeps
// request handling synchronous and is plenty for this scale.

import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

let db = { projects: {}, users: {}, sessions: {} };
let backend = null;

export const newId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
export const now = () => new Date().toISOString();
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const SESSION_DAYS = 30;
const DEMO_RETENTION_DAYS = 7;

// --- file backend --------------------------------------------------------------------

function fileBackend() {
  const dbFile = path.join(config.dataDir, 'db.json');
  const uploadPath = (projectId, id) => path.join(config.dataDir, 'uploads', projectId, id);
  let queue = Promise.resolve();
  const writeAll = () => {
    queue = queue.then(async () => {
      await mkdir(config.dataDir, { recursive: true });
      await writeFile(dbFile + '.tmp', JSON.stringify(db, null, 2), { mode: 0o600 });
      await rename(dbFile + '.tmp', dbFile);
    });
    return queue;
  };
  return {
    name: 'file',
    async load() {
      try {
        const saved = JSON.parse(await readFile(dbFile, 'utf8'));
        db = { projects: saved.projects || {}, users: saved.users || {}, sessions: saved.sessions || {} };
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    },
    saveProject: writeAll,
    deleteProjects: writeAll,
    saveUser: writeAll,
    deleteUser: writeAll,
    saveSession: writeAll,
    deleteSession: writeAll,
    async putUpload(projectId, id, buffer) {
      await mkdir(path.dirname(uploadPath(projectId, id)), { recursive: true });
      await writeFile(uploadPath(projectId, id), buffer, { mode: 0o600 });
    },
    getUpload: (projectId, id) => readFile(uploadPath(projectId, id)),
    deleteUpload: (projectId, id) => rm(uploadPath(projectId, id), { force: true }),
    async deleteUploads(projectIds) {
      for (const id of projectIds) await rm(path.join(config.dataDir, 'uploads', id), { recursive: true, force: true });
    },
  };
}

// --- Postgres backend ----------------------------------------------------------------

async function postgresBackend() {
  const { default: pg } = await import('pg');
  const external = /\.render\.com|sslmode=require/.test(config.databaseUrl);
  const pool = new pg.Pool({ connectionString: config.databaseUrl, ssl: external ? { rejectUnauthorized: false } : false, max: 5 });
  let queue = Promise.resolve();
  // Writes run in order so a later save never lands before an earlier one.
  const write = (sql, params) => {
    queue = queue.then(() => pool.query(sql, params)).catch((error) => console.error('Database write failed:', error.message));
    return queue;
  };
  return {
    name: 'postgres',
    async load() {
      await pool.query(`
        create table if not exists sp_projects (id text primary key, workspace_id text not null, data jsonb not null, updated_at timestamptz not null default now());
        create index if not exists sp_projects_workspace on sp_projects (workspace_id);
        create table if not exists sp_users (id text primary key, email text unique not null, data jsonb not null);
        create table if not exists sp_sessions (token_hash text primary key, user_id text not null, expires_at timestamptz not null);
        create table if not exists sp_uploads (project_id text not null, id text not null, data bytea not null, primary key (project_id, id));
      `);
      // Demo workspaces are disposable: drop the ones nobody has touched for a week.
      const stale = await pool.query(`delete from sp_projects where workspace_id like 'ws_%' and updated_at < now() - interval '${DEMO_RETENTION_DAYS} days' returning id`);
      if (stale.rowCount) await pool.query('delete from sp_uploads where project_id = any($1)', [stale.rows.map((r) => r.id)]);
      await pool.query('delete from sp_sessions where expires_at < now()');
      db = { projects: {}, users: {}, sessions: {} };
      for (const row of (await pool.query('select data from sp_projects')).rows) db.projects[row.data.id] = row.data;
      for (const row of (await pool.query('select data from sp_users')).rows) db.users[row.data.id] = row.data;
      for (const row of (await pool.query('select token_hash, user_id, expires_at from sp_sessions')).rows) {
        db.sessions[row.token_hash] = { userId: row.user_id, expiresAt: row.expires_at.toISOString() };
      }
    },
    saveProject: (p) => write(
      'insert into sp_projects (id, workspace_id, data, updated_at) values ($1, $2, $3, now()) on conflict (id) do update set data = excluded.data, updated_at = now()',
      [p.id, p.workspaceId, p],
    ),
    async deleteProjects(ids) {
      await write('delete from sp_projects where id = any($1)', [ids]);
      await write('delete from sp_uploads where project_id = any($1)', [ids]);
    },
    saveUser: (u) => write('insert into sp_users (id, email, data) values ($1, $2, $3) on conflict (id) do update set email = excluded.email, data = excluded.data', [u.id, u.email, u]),
    async deleteUser(id) {
      await write('delete from sp_sessions where user_id = $1', [id]);
      await write('delete from sp_users where id = $1', [id]);
    },
    saveSession: (hash, s) => write('insert into sp_sessions (token_hash, user_id, expires_at) values ($1, $2, $3) on conflict (token_hash) do nothing', [hash, s.userId, s.expiresAt]),
    deleteSession: (hash) => write('delete from sp_sessions where token_hash = $1', [hash]),
    putUpload: (projectId, id, buffer) => write('insert into sp_uploads (project_id, id, data) values ($1, $2, $3) on conflict do nothing', [projectId, id, buffer]),
    async getUpload(projectId, id) {
      await queue;
      const { rows } = await pool.query('select data from sp_uploads where project_id = $1 and id = $2', [projectId, id]);
      if (!rows.length) throw Object.assign(new Error('File not found.'), { status: 404 });
      return rows[0].data;
    },
    deleteUpload: (projectId, id) => write('delete from sp_uploads where project_id = $1 and id = $2', [projectId, id]),
    deleteUploads: () => Promise.resolve(), // removed together with the projects
  };
}

export async function loadStore() {
  backend = config.databaseUrl ? await postgresBackend() : fileBackend();
  await backend.load();
  return backend.name;
}

// --- projects -------------------------------------------------------------------------

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
  await backend.saveProject(project);
  return project;
}

export async function deleteWorkspace(workspaceId) {
  const ids = listProjects(workspaceId).map((p) => p.id);
  for (const id of ids) delete db.projects[id];
  await backend.deleteProjects(ids);
  await backend.deleteUploads(ids);
}

export function logActivity(project, text, kind = 'info') {
  project.activity.unshift({ at: now(), text, kind });
  project.activity = project.activity.slice(0, 200);
}

export function createProject({ workspaceId, freelancer, name, client, agreement, terms, extraction }) {
  const project = {
    id: newId('prj'),
    workspaceId,
    portalToken: crypto.randomBytes(24).toString('base64url'),
    freelancer, // { name, businessName, email } shown to the client and on invoices
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

// --- evidence files ---------------------------------------------------------------------

export const putUpload = (projectId, id, buffer) => backend.putUpload(projectId, id, buffer);
export const getUpload = (projectId, id) => backend.getUpload(projectId, id);
export const deleteUpload = (projectId, id) => backend.deleteUpload(projectId, id);

// --- users and sessions -------------------------------------------------------------------

export const findUserByEmail = (email) => Object.values(db.users).find((u) => u.email === email) || null;
export const getUser = (id) => db.users[id] || null;

export async function saveUser(user) {
  db.users[user.id] = user;
  await backend.saveUser(user);
  return user;
}

/** Removes a user and all of their sessions. Projects are removed with deleteWorkspace. */
export async function deleteUser(id) {
  delete db.users[id];
  for (const [hash, session] of Object.entries(db.sessions)) if (session.userId === id) delete db.sessions[hash];
  await backend.deleteUser(id);
}

/** Creates a session and returns the raw token; only its hash is stored. */
export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const session = { userId, expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString() };
  db.sessions[sha256(token)] = session;
  await backend.saveSession(sha256(token), session);
  return { token, maxAge: SESSION_DAYS * 86_400 };
}

export function userForSession(token) {
  if (!token) return null;
  const session = db.sessions[sha256(token)];
  if (!session || Date.parse(session.expiresAt) < Date.now()) return null;
  return getUser(session.userId);
}

export async function deleteSession(token) {
  if (!token) return;
  delete db.sessions[sha256(token)];
  await backend.deleteSession(sha256(token));
}
