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

// Only a blocked popup is worth a redirect. When the browser refuses storage to the auth
// domain, the redirect would fail the same way, so that error is shown instead.
const POPUP_FALLBACK = new Set(['auth/popup-blocked']);
// Set just before a redirect sign-in, so the page can tell when it comes back empty-handed.
const REDIRECT_FLAG = 'alpha.admin.redirect';

function takeRedirectFlag() {
  try {
    const set = sessionStorage.getItem(REDIRECT_FLAG) === '1';
    sessionStorage.removeItem(REDIRECT_FLAG);
    return set;
  } catch {
    return false;
  }
}

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
    async finishRedirect() {
      const pending = takeRedirectFlag();
      try {
        const result = await getRedirectResult(auth);
        // Back from Google with no result and nobody signed in: the browser dropped the
        // sign-in on the way (third-party storage blocked for the firebaseapp.com domain).
        if (pending && !result && !auth.currentUser) return Object.assign(new Error('Redirect sign-in did not complete.'), { code: 'app/redirect-lost' });
        return null;
      } catch (e) {
        return e;
      }
    },
    async signIn() {
      try {
        await signInWithPopup(auth, provider);
      } catch (e) {
        if (POPUP_FALLBACK.has(e.code)) {
          try {
            sessionStorage.setItem(REDIRECT_FLAG, '1');
          } catch {
            /* the flag only makes a failed redirect easier to explain */
          }
          try {
            return await signInWithRedirect(auth, provider);
          } catch (err) {
            // Still on this page (unauthorized domain, offline): no redirect is pending.
            takeRedirectFlag();
            throw err;
          }
        }
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
