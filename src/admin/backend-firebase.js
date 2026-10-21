// The real backend: Firebase Auth (Google) and Firestore. Loaded only when
// firebaseConfig is set, so the setup screen never downloads the SDK.
//
// Every backend (this one and the dev mock) has the same shape:
//   onAuth(cb, onError?) -> unsubscribe     cb(user | null); onError(e) if the user can't be read
//   finishRedirect() -> Error | null
//   signIn(), signOut()
//   isAdmin(uid) -> boolean
//   read(key) -> { exists, rev, json, updatedAt, updatedBy }
//   save(key, { json, baseRev, note }) -> { rev }   throws ConflictError
//   reset(key, { baseRev, note }) -> { rev: 0 }     throws ConflictError
//   history(key, n) -> [{ id, op, rev, json, at, by, note }]
import { onAuthStateChanged } from 'firebase/auth';
import { initializeFirestore, memoryLocalCache } from 'firebase/firestore';
import { firebaseAuth } from '../lib/firebase-auth.js';
import * as ops from './firestore-ops.js';

// Set just before a redirect sign-in, so the page can tell when it comes back empty-handed.
const REDIRECT_FLAG = 'alpha.admin.redirect';

export async function createFirebaseBackend(config, appCheckSiteKey) {
  // App Check (when a site key is set) and Auth, with the Google popup and redirect sign-in
  const kit = await firebaseAuth({ config, appCheckSiteKey });
  const { app, auth } = kit;
  // Memory cache only: the admin should always see the server's current copy.
  const db = initializeFirestore(app, { localCache: memoryLocalCache() });

  async function toUser(u) {
    const token = await u.getIdTokenResult();
    return {
      uid: u.uid,
      email: u.email || '',
      name: u.displayName || '',
      verified: token.claims.email_verified === true,
      provider: token.signInProvider || '',
    };
  }

  const uid = () => {
    if (!auth.currentUser) throw Object.assign(new Error('Not signed in'), { code: 'permission-denied' });
    return auth.currentUser.uid;
  };

  return {
    kind: 'firebase',
    onAuth(cb, onError) {
      // Events can overlap while a token refresh is in flight; only the newest one may
      // reach the screen, so a slow or failed refresh can't override a later sign-out.
      let seq = 0;
      return onAuthStateChanged(auth, async (u) => {
        const mine = ++seq;
        let user = null;
        try {
          // A saved session needs a fresh token here, which fails without a connection.
          user = u ? await toUser(u) : null;
        } catch (e) {
          if (mine === seq) onError?.(e);
          return;
        }
        if (mine === seq) cb(user);
      });
    },
    finishRedirect: () => kit.finishRedirect(REDIRECT_FLAG),
    async signIn() {
      await kit.signIn(REDIRECT_FLAG);
    },
    signOut: () => kit.signOut(),
    // ID token for the media upload function; refreshed by the SDK when it is close to expiring
    token: (force = false) => (auth.currentUser ? auth.currentUser.getIdToken(force) : Promise.reject(new Error('Belum login.'))),
    isAdmin: (id) => ops.isAdmin(db, id),
    read: (key) => ops.readContent(db, key),
    save: (key, { json, baseRev, note }) => ops.saveContent(db, { key, json, baseRev, note, uid: uid() }),
    reset: (key, { baseRev, note }) => ops.resetContent(db, { key, baseRev, note, uid: uid() }),
    history: (key, n) => ops.listHistory(db, key, n),
  };
}
