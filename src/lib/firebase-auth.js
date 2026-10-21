// One Firebase app and Auth for the page, made on first use, so a visitor who never signs in
// downloads none of it. Google sign-in opens a popup and falls back to a redirect when the
// browser blocks the popup. Shared by the admin page (src/admin/backend-firebase.js) and the
// try out (src/features/tryout/access.js).
import { getApps, initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  getAuth,
  getRedirectResult,
  initializeAuth,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';
import { firebaseConfig } from './firebase-config.js';

// Only a blocked popup is worth a redirect. When the browser refuses storage to the auth
// domain, the redirect would fail the same way, so that error is shown instead.
const POPUP_FALLBACK = new Set(['auth/popup-blocked']);
// The student closed the popup, or tapped twice: nothing to report.
const CLOSED = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request']);

// A flag in sessionStorage is set just before a redirect sign-in, so the page can tell when it
// comes back empty-handed. Its value can carry a little context (the try out keeps the bank).
function takeFlag(flag) {
  try {
    const v = sessionStorage.getItem(flag);
    sessionStorage.removeItem(flag);
    return v;
  } catch {
    return null;
  }
}

async function create(config, appCheckSiteKey) {
  // getApps() and getAuth() only matter when an earlier attempt failed halfway
  const app = getApps()[0] || initializeApp(config);

  // App Check has to exist before Auth, so Auth's requests carry its token.
  if (appCheckSiteKey) {
    const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import('firebase/app-check');
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey), isTokenAutoRefreshEnabled: true });
  }

  let auth;
  try {
    auth = initializeAuth(app, { persistence: browserLocalPersistence, popupRedirectResolver: browserPopupRedirectResolver });
  } catch {
    auth = getAuth(app);
  }
  auth.languageCode = 'id';

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  return {
    app,
    auth,
    provider,
    /** After a redirect: an Error when the sign-in got lost or failed, else null. */
    async finishRedirect(flag) {
      const pending = takeFlag(flag) != null;
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
    /** The signed-in user, or null when the popup was closed. A redirect leaves the page. */
    async signIn(flag, value = '1') {
      try {
        await signInWithPopup(auth, provider);
        return auth.currentUser;
      } catch (e) {
        if (POPUP_FALLBACK.has(e.code)) {
          try {
            sessionStorage.setItem(flag, value);
          } catch {
            /* the flag only makes a failed redirect easier to explain */
          }
          try {
            return await signInWithRedirect(auth, provider);
          } catch (err) {
            // Still on this page (unauthorized domain, offline): no redirect is pending.
            takeFlag(flag);
            throw err;
          }
        }
        if (CLOSED.has(e.code)) return null;
        throw e;
      }
    },
    signOut: () => signOut(auth),
  };
}

let made = null;
/** The page's Firebase Auth. The first call decides the config; later calls share it. */
export function firebaseAuth({ config = firebaseConfig, appCheckSiteKey = null } = {}) {
  return (
    made ||
    (made = create(config, appCheckSiteKey).catch((e) => {
      made = null;
      throw e;
    }))
  );
}
