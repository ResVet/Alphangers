// Security rules tests. They need the Firestore emulator (Java 21+):
//
//   npx firebase emulators:exec --only firestore --project demo-alphangers \
//     "node --test tests/firestore.rules.test.mjs"
//
// The save, reset and history helpers are the ones the admin page uses
// (src/admin/firestore-ops.js), so these tests cover the real write path.
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, updateDoc, where, writeBatch, Timestamp } from 'firebase/firestore';
import { ConflictError, historyId, listHistory, readContent, resetContent, saveContent } from '../src/admin/firestore-ops.js';

const ADMIN = 'admin-uid';
const OTHER = 'someone-else';
const GOOGLE = { email_verified: true, firebase: { sign_in_provider: 'google.com' } };
const json = (n = 1) => JSON.stringify({ v: 1, channels: [{ id: 'lobby', name: `Lobby ${n}`, tag: '', sub: '', url: '' }] });

let env;

before(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-alphangers',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host, port: Number(port) },
  });
});

after(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'admins', ADMIN), { name: 'owner' });
  });
});

const admin = () => env.authenticatedContext(ADMIN, GOOGLE).firestore();
const other = () => env.authenticatedContext(OTHER, GOOGLE).firestore();
const anon = () => env.unauthenticatedContext().firestore();

async function seed(key = 'links', rev = 1, body = json(rev)) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'content', key), { json: body, rev, updatedAt: Timestamp.fromMillis(1_700_000_000_123 + rev), updatedBy: ADMIN });
  });
}

test('anyone can read the five content documents', async () => {
  await seed('links');
  await assertSucceeds(getDoc(doc(anon(), 'content', 'links')));
  await assertSucceeds(getDoc(doc(anon(), 'content', 'heart')));
});

test('reading other content ids or listing the collection is denied', async () => {
  await assertFails(getDoc(doc(anon(), 'content', 'secrets')));
  await assertFails(getDocs(collection(anon(), 'content')));
});

test('anonymous writes are denied', async () => {
  await assertFails(setDoc(doc(anon(), 'content', 'links'), { json: json(), rev: 1, updatedAt: serverTimestamp(), updatedBy: 'x' }));
});

test('a signed-in user who is not an admin is denied', async () => {
  await assertFails(saveContent(other(), { key: 'links', json: json(), baseRev: 0, uid: OTHER }));
});

test('an admin can create, then update with history', async () => {
  await assertSucceeds(saveContent(admin(), { key: 'links', json: json(1), baseRev: 0, uid: ADMIN }));
  await assertSucceeds(saveContent(admin(), { key: 'links', json: json(2), baseRev: 1, uid: ADMIN, note: 'ganti nama' }));
  const now = await readContent(admin(), 'links');
  assert.equal(now.rev, 2);
  assert.equal(now.json, json(2));
  const hist = await listHistory(admin(), 'links', 10);
  assert.equal(hist.length, 1);
  assert.equal(hist[0].rev, 1);
  assert.equal(hist[0].json, json(1));
  assert.equal(hist[0].note, 'ganti nama');
  assert.equal(hist[0].op, 'save');
});

test('admin rights need a verified Google sign-in', async () => {
  const notVerified = env.authenticatedContext(ADMIN, { email_verified: false, firebase: { sign_in_provider: 'google.com' } }).firestore();
  await assertFails(saveContent(notVerified, { key: 'links', json: json(), baseRev: 0, uid: ADMIN }));
  const password = env.authenticatedContext(ADMIN, { email_verified: true, firebase: { sign_in_provider: 'password' } }).firestore();
  await assertFails(saveContent(password, { key: 'links', json: json(), baseRev: 0, uid: ADMIN }));
});

test('content keys outside the five are denied even for an admin', async () => {
  await assertFails(saveContent(admin(), { key: 'secrets', json: json(), baseRev: 0, uid: ADMIN }));
});

test('a stale rev is denied (the client sees a conflict)', async () => {
  await seed('links', 3);
  await assert.rejects(saveContent(admin(), { key: 'links', json: json(9), baseRev: 2, uid: ADMIN }), ConflictError);
  // Skipping the client check does not help: the rules refuse a rev that does not move by one.
  const db = admin();
  const b = writeBatch(db);
  const before = (await getDoc(doc(db, 'content', 'links'))).data();
  b.set(doc(db, 'history', historyId('links', 3, before.updatedAt)), { key: 'links', op: 'save', rev: 3, json: before.json, at: serverTimestamp(), by: ADMIN, note: '' });
  b.set(doc(db, 'content', 'links'), { json: json(9), rev: 3, updatedAt: serverTimestamp(), updatedBy: ADMIN });
  await assertFails(b.commit());
});

test('an update without its history snapshot is denied', async () => {
  await seed('links', 1);
  await assertFails(setDoc(doc(admin(), 'content', 'links'), { json: json(2), rev: 2, updatedAt: serverTimestamp(), updatedBy: ADMIN }));
});

test('a history snapshot that does not match the replaced version is denied', async () => {
  await seed('links', 1);
  const db = admin();
  const before = (await getDoc(doc(db, 'content', 'links'))).data();
  const b = writeBatch(db);
  b.set(doc(db, 'history', historyId('links', 1, before.updatedAt)), { key: 'links', op: 'save', rev: 1, json: '{"forged":true}', at: serverTimestamp(), by: ADMIN, note: '' });
  b.set(doc(db, 'content', 'links'), { json: json(2), rev: 2, updatedAt: serverTimestamp(), updatedBy: ADMIN });
  await assertFails(b.commit());
});

test('extra fields, a wrong author or a client timestamp are denied', async () => {
  const db = admin();
  await assertFails(setDoc(doc(db, 'content', 'links'), { json: json(), rev: 1, updatedAt: serverTimestamp(), updatedBy: ADMIN, extra: 1 }));
  await assertFails(setDoc(doc(db, 'content', 'links'), { json: json(), rev: 1, updatedAt: serverTimestamp(), updatedBy: OTHER }));
  await assertFails(setDoc(doc(db, 'content', 'links'), { json: json(), rev: 1, updatedAt: Timestamp.now(), updatedBy: ADMIN }));
  await assertFails(setDoc(doc(db, 'content', 'links'), { json: json(), rev: '1', updatedAt: serverTimestamp(), updatedBy: ADMIN }));
  await assertFails(setDoc(doc(db, 'content', 'links'), { json: json(), rev: 2, updatedAt: serverTimestamp(), updatedBy: ADMIN }));
  await assertSucceeds(setDoc(doc(db, 'content', 'links'), { json: json(), rev: 1, updatedAt: serverTimestamp(), updatedBy: ADMIN }));
});

test('oversized json is denied', async () => {
  const big = JSON.stringify({ v: 1, pad: 'x'.repeat(900_000) });
  await assertFails(saveContent(admin(), { key: 'dosen', json: big, baseRev: 0, uid: ADMIN }));
  const fits = JSON.stringify({ v: 1, pad: 'x'.repeat(800_000) });
  await assertSucceeds(saveContent(admin(), { key: 'dosen', json: fits, baseRev: 0, uid: ADMIN }));
});

test('reset deletes the document and keeps the old version in history', async () => {
  await seed('schedule', 4);
  await assertSucceeds(resetContent(admin(), { key: 'schedule', baseRev: 4, uid: ADMIN, note: 'balik ke bawaan' }));
  assert.equal((await readContent(admin(), 'schedule')).exists, false);
  const hist = await listHistory(admin(), 'schedule', 5);
  assert.equal(hist[0].op, 'reset');
  assert.equal(hist[0].rev, 4);
  // After a reset the next save starts again at rev 1.
  await assertSucceeds(saveContent(admin(), { key: 'schedule', json: json(), baseRev: 0, uid: ADMIN }));
});

test('a bare delete without a history snapshot is denied, and non-admins can not delete', async () => {
  await seed('links', 2);
  await assertFails(deleteDoc(doc(admin(), 'content', 'links')));
  await assertFails(resetContent(other(), { key: 'links', baseRev: 2, uid: OTHER }));
});

test('history is immutable and admin-only', async () => {
  await seed('links', 1);
  await saveContent(admin(), { key: 'links', json: json(2), baseRev: 1, uid: ADMIN });
  const [h] = await listHistory(admin(), 'links', 5);
  await assertFails(updateDoc(doc(admin(), 'history', h.id), { note: 'edited' }));
  await assertFails(getDoc(doc(anon(), 'history', h.id)));
  await assertFails(getDoc(doc(other(), 'history', h.id)));
  await assertFails(getDocs(query(collection(other(), 'history'), where('key', '==', 'links'), limit(5))));
  await assertFails(deleteDoc(doc(other(), 'history', h.id)));
  await assertSucceeds(deleteDoc(doc(admin(), 'history', h.id)));
});

test('history can not be written on its own or listed without a limit', async () => {
  await seed('links', 1);
  const db = admin();
  const before = (await getDoc(doc(db, 'content', 'links'))).data();
  await assertFails(setDoc(doc(db, 'history', historyId('links', 1, before.updatedAt)), { key: 'links', op: 'save', rev: 1, json: before.json, at: serverTimestamp(), by: ADMIN, note: '' }));
  await assertFails(getDocs(query(collection(db, 'history'), where('key', '==', 'links'))));
  await assertFails(getDocs(query(collection(db, 'history'), where('key', '==', 'links'), limit(500))));
});

test('admins docs: readable only by their owner, never writable by a client', async () => {
  await assertSucceeds(getDoc(doc(admin(), 'admins', ADMIN)));
  await assertFails(getDoc(doc(other(), 'admins', ADMIN)));
  await assertFails(getDoc(doc(anon(), 'admins', ADMIN)));
  await assertSucceeds(getDoc(doc(other(), 'admins', OTHER)));
  await assertFails(setDoc(doc(other(), 'admins', OTHER), { name: 'me' }));
  await assertFails(setDoc(doc(admin(), 'admins', OTHER), { name: 'friend' }));
  await assertFails(getDocs(collection(admin(), 'admins')));
});

test('everything else is denied', async () => {
  await assertFails(setDoc(doc(admin(), 'misc', 'x'), { a: 1 }));
  await assertFails(getDoc(doc(anon(), 'misc', 'x')));
});
