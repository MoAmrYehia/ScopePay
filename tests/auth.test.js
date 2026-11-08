// Accounts: password hashing, sign-up validation, sign-in throttling, sessions
// and account deletion, against the file store in a temporary folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = await mkdtemp(path.join(os.tmpdir(), 'scopepay-auth-'));
delete process.env.DATABASE_URL;

const store = await import('../server/store.js');
const auth = await import('../server/auth.js');
await store.loadStore();

test('passwords are hashed with a unique salt and verified in constant time', async () => {
  const a = await auth.hashPassword('correct horse battery');
  const b = await auth.hashPassword('correct horse battery');
  assert.match(a, /^scrypt\$16384\$/);
  assert.notEqual(a, b, 'salts differ');
  assert.equal(await auth.verifyPassword('correct horse battery', a), true);
  assert.equal(await auth.verifyPassword('correct horse batterz', a), false);
  assert.equal(await auth.verifyPassword('anything', 'not-a-hash'), false);
});

test('sign-up validates input and normalises email', async () => {
  await assert.rejects(auth.signUp({ name: 'Ana', email: 'not-an-email', password: 'long enough password' }), /valid email/);
  await assert.rejects(auth.signUp({ name: 'A', email: 'a@example.com', password: 'long enough password' }), /your name/);
  await assert.rejects(auth.signUp({ name: 'Ana', email: 'a@example.com', password: 'short' }), /at least 10/);
  const user = await auth.signUp({ name: '  Ana   Ruiz ', email: ' Ana@Example.COM ', password: 'long enough password' });
  assert.equal(user.email, 'ana@example.com');
  assert.equal(user.name, 'Ana Ruiz');
  assert.equal(user.businessName, 'Ana Ruiz', 'business name defaults to the name');
  assert.equal('passwordHash' in auth.publicUser(user), false, 'public view never includes the hash');
  await assert.rejects(auth.signUp({ name: 'Ana', email: 'ANA@example.com', password: 'long enough password' }), (e) => e.status === 409);
});

test('sign-in checks the password and throttles repeated failures', async () => {
  const ok = await auth.signIn({ email: 'ana@example.com', password: 'long enough password' }, '10.0.0.1');
  assert.equal(ok.email, 'ana@example.com');
  for (let i = 0; i < 10; i++) {
    await assert.rejects(auth.signIn({ email: 'ana@example.com', password: 'wrong password!' }, '10.0.0.2'), (e) => e.status === 401);
  }
  await assert.rejects(auth.signIn({ email: 'ana@example.com', password: 'long enough password' }, '10.0.0.3'), (e) => e.status === 429, 'email is locked after 10 failures');
  await assert.rejects(auth.signIn({ email: 'nobody@example.com', password: 'whatever it is' }, '10.0.0.4'), /incorrect/);
});

test('sessions store only a hash and end on sign-out', async () => {
  const user = await auth.signUp({ name: 'Ben Ko', email: 'ben@example.com', password: 'another long password' });
  const { token } = await store.createSession(user.id);
  assert.equal(store.userForSession(token).id, user.id);
  assert.equal(store.userForSession(token + 'x'), null);
  await store.deleteSession(token);
  assert.equal(store.userForSession(token), null);
});

test('deleting an account removes the user, sessions and projects', async () => {
  const user = await auth.signUp({ name: 'Cara Diaz', email: 'cara@example.com', password: 'yet another password' });
  const { token } = await store.createSession(user.id);
  const project = store.createProject({ workspaceId: user.id, freelancer: {}, name: 'P', client: { name: 'C', email: 'c@example.com' }, agreement: { filename: 'a', text: 't' }, terms: { milestones: [] }, extraction: {} });
  await store.saveProject(project);
  await store.putUpload(project.id, 'ev_1', Buffer.from('png'));
  await assert.rejects(auth.deleteAccount(user, { password: 'wrong' }), /incorrect/);
  await auth.deleteAccount(user, { password: 'yet another password' });
  assert.equal(store.findUserByEmail('cara@example.com'), null);
  assert.equal(store.userForSession(token), null);
  assert.deepEqual(store.listProjects(user.id), []);
  await assert.rejects(store.getUpload(project.id, 'ev_1'));
});
