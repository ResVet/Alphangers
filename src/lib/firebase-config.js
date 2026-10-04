// Firebase web config for Alphangers.
//
// These values are public on purpose. They only say which Firebase project to
// talk to; they do not grant access to anything. Access is decided by
// firestore.rules, and the API key should also be restricted to the site's
// domains in Google Cloud (docs/FIREBASE_SETUP.md, step 7).
//
// How to fill it in:
//   1. Firebase console > Project settings (gear icon) > General.
//   2. Under "Your apps", pick the web app (or add one with the </> button).
//   3. In "SDK setup and configuration" choose "Config" and copy the object.
//   4. Replace null below with that object. Only these four fields are used:
//
//      export const firebaseConfig = {
//        apiKey: 'AIza...',
//        authDomain: 'your-project-id.firebaseapp.com',
//        projectId: 'your-project-id',
//        appId: '1:1234567890:web:abc123',
//      };
//
// While this is null the portal uses the bundled JSON only and makes no
// network requests, and /admin/ shows the setup guide.
export const firebaseConfig = null;

// Optional. A reCAPTCHA Enterprise site key turns on App Check for the admin
// page, e.g. export const appCheckSiteKey = '6Lc...';
// Read the App Check section of docs/FIREBASE_SETUP.md first: it also needs
// extra hosts in the /admin/* CSP in netlify.toml.
export const appCheckSiteKey = null;
