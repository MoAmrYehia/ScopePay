// Accounts: scrypt password hashing, input validation, sign-in throttling and
// session cookies. Session tokens are random, sent only as HttpOnly cookies,
// and stored hashed (see store.js).

import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { newId, now, findUserByEmail, saveUser, deleteUser, deleteWorkspace, createSession, deleteSession, userForSession } from './store.js';
import { parseCookies } from './http.js';
import { badRequest } from './documents.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1 };
export const SESSION_COOKIE = 'sp_session';
export const DEMO_COOKIE = 'sp_ws';

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, n, salt, expected] = String(stored || '').split('$');
  if (scheme !== 'scrypt') return false;
  const key = await scrypt(password, Buffer.from(salt, 'base64'), 64, { ...SCRYPT, N: Number(n) });
  const want = Buffer.from(expected, 'base64');
  return key.length === want.length && crypto.timingSafeEqual(key, want);
}

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const clean = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 10) throw badRequest('Use a password of at least 10 characters.');
  if (password.length > 200) throw badRequest('Use a password of 200 characters or fewer.');
}

// --- throttling ----------------------------------------------------------------------
// At most 10 failed attempts per IP and per email in 15 minutes.

const failures = new Map();
const WINDOW = 15 * 60_000;
function tooManyFailures(...keys) {
  const cutoff = Date.now() - WINDOW;
  return keys.some((k) => (failures.get(k) || []).filter((t) => t > cutoff).length >= 10);
}
function recordFailure(...keys) {
  for (const k of keys) failures.set(k, [...(failures.get(k) || []).filter((t) => t > Date.now() - WINDOW), Date.now()]);
  if (failures.size > 10_000) failures.clear();
}

// --- public API -----------------------------------------------------------------------

export function publicUser(user) {
  return user && { id: user.id, email: user.email, name: user.name, businessName: user.businessName, createdAt: user.createdAt };
}

export async function signUp({ name, businessName, email, password }) {
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 200) throw badRequest('Enter a valid email address.');
  const cleanName = clean(name, 80);
  if (cleanName.length < 2) throw badRequest('Enter your name.');
  validatePassword(password);
  if (findUserByEmail(normalized)) throw Object.assign(new Error('An account with this email already exists. Sign in instead.'), { status: 409 });
  const user = {
    id: newId('usr'),
    email: normalized,
    name: cleanName,
    businessName: clean(businessName, 120) || cleanName,
    passwordHash: await hashPassword(password),
    createdAt: now(),
  };
  await saveUser(user);
  return user;
}

export async function signIn({ email, password }, ip) {
  const normalized = normalizeEmail(email);
  if (tooManyFailures(`ip:${ip}`, `email:${normalized}`)) {
    throw Object.assign(new Error('Too many sign-in attempts. Wait 15 minutes and try again.'), { status: 429 });
  }
  const user = findUserByEmail(normalized);
  // Hash even when the user does not exist, so timing does not reveal which emails have accounts.
  const ok = await verifyPassword(String(password || ''), user?.passwordHash || 'scrypt$16384$AAAA$AAAA');
  if (!user || !ok) {
    recordFailure(`ip:${ip}`, `email:${normalized}`);
    throw Object.assign(new Error('Email or password is incorrect.'), { status: 401 });
  }
  return user;
}

export async function updateProfile(user, { name, businessName }) {
  const cleanName = clean(name, 80);
  if (cleanName.length < 2) throw badRequest('Enter your name.');
  user.name = cleanName;
  user.businessName = clean(businessName, 120) || cleanName;
  return saveUser(user);
}

export async function changePassword(user, { currentPassword, newPassword }) {
  if (!(await verifyPassword(String(currentPassword || ''), user.passwordHash))) throw badRequest('Your current password is incorrect.');
  validatePassword(newPassword);
  user.passwordHash = await hashPassword(newPassword);
  return saveUser(user);
}

export async function deleteAccount(user, { password }) {
  if (!(await verifyPassword(String(password || ''), user.passwordHash))) throw badRequest('Your password is incorrect.');
  await deleteWorkspace(user.id);
  await deleteUser(user.id);
}

// --- cookies --------------------------------------------------------------------------

const secureFlag = (req) => ((req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '');

export function cookie(req, name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag(req)}`;
}

export async function startSession(req, res, user) {
  const { token, maxAge } = await createSession(user.id);
  // Signing in ends any demo session in this browser.
  res.setHeader('Set-Cookie', [cookie(req, SESSION_COOKIE, token, maxAge), cookie(req, DEMO_COOKIE, '', 0)]);
}

export async function endSession(req, res) {
  await deleteSession(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
  res.setHeader('Set-Cookie', [cookie(req, SESSION_COOKIE, '', 0), cookie(req, DEMO_COOKIE, '', 0)]);
}

export function currentUser(req) {
  return userForSession(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
}

export function demoWorkspace(req) {
  const id = parseCookies(req.headers.cookie)[DEMO_COOKIE];
  return /^ws_[A-Za-z0-9_-]{20,}$/.test(id || '') ? id : null;
}

export function newDemoWorkspace(req, res) {
  const id = 'ws_' + crypto.randomBytes(18).toString('base64url');
  res.setHeader('Set-Cookie', cookie(req, DEMO_COOKIE, id, 7 * 86_400));
  return id;
}
