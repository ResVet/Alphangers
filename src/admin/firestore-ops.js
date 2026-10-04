// Every Firestore read and write the admin makes. Kept apart from the UI so
// the rules tests can drive the exact same code against the emulator.
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';

import { ConflictError } from './errors.js';

export { ConflictError };

// Firestore keeps microseconds; the rules see whole milliseconds.
export function stampMillis(ts) {
  return ts.seconds * 1000 + Math.floor(ts.nanoseconds / 1e6);
}

export function historyId(key, rev, updatedAt) {
  return `${key}-${rev}-${stampMillis(updatedAt)}`;
}

function snapToRemote(snap) {
  if (!snap.exists()) return { exists: false, rev: 0, json: null, updatedAt: null, updatedBy: null, stamp: null };
  const d = snap.data();
  return {
    exists: true,
    rev: d.rev,
    json: d.json,
    updatedAt: d.updatedAt ? d.updatedAt.toDate() : null,
    updatedBy: d.updatedBy || null,
    stamp: d.updatedAt || null,
  };
}

export async function isAdmin(db, uid) {
  const snap = await getDoc(doc(db, 'admins', uid));
  return snap.exists();
}

export async function readContent(db, key) {
  return snapToRemote(await getDocFromServer(doc(db, 'content', key)));
}

// One transaction: check the rev we started from, snapshot the old version
// into history, write the new one. The rules enforce the same contract, so a
// client that skips a step is refused.
export async function saveContent(db, { key, json, baseRev, uid, note = '' }) {
  const ref = doc(db, 'content', key);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = snapToRemote(snap);
    if (current.rev !== baseRev) throw new ConflictError(current);
    if (current.exists) {
      tx.set(doc(db, 'history', historyId(key, current.rev, current.stamp)), {
        key,
        op: 'save',
        rev: current.rev,
        json: current.json,
        at: serverTimestamp(),
        by: uid,
        note: note.slice(0, 200),
      });
    }
    tx.set(ref, { json, rev: current.rev + 1, updatedAt: serverTimestamp(), updatedBy: uid });
    return { rev: current.rev + 1 };
  });
}

// "Back to bundled": the document goes away, its last version stays in history.
export async function resetContent(db, { key, baseRev, uid, note = '' }) {
  const ref = doc(db, 'content', key);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = snapToRemote(snap);
    if (current.rev !== baseRev) throw new ConflictError(current);
    if (!current.exists) return { rev: 0 };
    tx.set(doc(db, 'history', historyId(key, current.rev, current.stamp)), {
      key,
      op: 'reset',
      rev: current.rev,
      json: current.json,
      at: serverTimestamp(),
      by: uid,
      note: note.slice(0, 200),
    });
    tx.delete(ref);
    return { rev: 0 };
  });
}

export async function listHistory(db, key, n = 20) {
  const q = query(collection(db, 'history'), where('key', '==', key), orderBy('at', 'desc'), limit(Math.min(n, 50)));
  const snaps = await getDocs(q);
  return snaps.docs.map((s) => {
    const d = s.data();
    return { id: s.id, key: d.key, op: d.op, rev: d.rev, json: d.json, at: d.at ? d.at.toDate() : null, by: d.by, note: d.note || '' };
  });
}

export async function deleteHistory(db, id) {
  await deleteDoc(doc(db, 'history', id));
}
