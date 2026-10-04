// The real backend: Firebase Auth (Google) and Firestore. Loaded only when
// firebaseConfig is set, so the setup screen never downloads the SDK.
//
// Every backend (this one and the dev mock) has the same shape:
//   onAuth(cb) -> unsubscribe     cb(user | null)
//   finishRedirect() -> Error | null
//   signIn(), signOut()
//   isAdmin(uid) -> boolean
//   read(key) -> { exists, rev, json, updatedAt, updatedBy }
//   save(key, { json, baseRev, note }) -> { rev }   throws ConflictError
//   reset(key, { baseRev, note }) -> { rev: 0 }     throws ConflictError
//   history(key, n) -> [{ id, op, rev, json, at, by, note }]
import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  getRedirectResult,
  initializeAuth,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';
import { initializeFirestore, memoryLocalCache } from 'firebase/firestore';
import * as ops from './firestore-ops.js';

const POPUP_FALLBACK = new Set(['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported']);

export async function createFirebaseBackend(config, appCheckSiteKey) {
  const app = initializeApp(config);

  if (appCheckSiteKey) {
    const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import('firebase/app-check');
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey), isTokenAutoRefreshEnabled: true });
  }

  const auth = initializeAuth(app, { persistence: browserLocalPersistence, popupRedirectResolver: browserPopupRedirectResolver });
  auth.languageCode = 'id';
  // Memory cache only: the admin should always see the server's current copy.
  const db = initializeFirestore(app, { localCache: memoryLocalCache() });

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

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
    onAuth(cb) {
      return onAuthStateChanged(auth, async (u) => cb(u ? await toUser(u) : null));
    },
    async finishRedirect() {
      try {
        await getRedirectResult(auth);
        return null;
      } catch (e) {
        return e;
      }
    },
    async signIn() {
      try {
        await signInWithPopup(auth, provider);
      } catch (e) {
        if (POPUP_FALLBACK.has(e.code)) return signInWithRedirect(auth, provider);
        if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
        throw e;
      }
    },
    signOut: () => signOut(auth),
    isAdmin: (id) => ops.isAdmin(db, id),
    read: (key) => ops.readContent(db, key),
    save: (key, { json, baseRev, note }) => ops.saveContent(db, { key, json, baseRev, note, uid: uid() }),
    reset: (key, { baseRev, note }) => ops.resetContent(db, { key, baseRev, note, uid: uid() }),
    history: (key, n) => ops.listHistory(db, key, n),
  };
}
