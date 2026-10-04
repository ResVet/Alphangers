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
//   4. Put that object below (it starts out as null in a fresh project). Only
//      these four fields are used:
//
//      export const firebaseConfig = {
//        apiKey: 'AIza...',
//        authDomain: 'your-project-id.firebaseapp.com',
//        projectId: 'your-project-id',
//        appId: '1:1234567890:web:abc123',
//      };
//
// Set to null, the portal uses the bundled JSON only and makes no network
// requests, and /admin/ shows the setup guide.
export const firebaseConfig = {
  apiKey: 'AIzaSyCHQeayP3Bnl-H6K9S4Ha1vNyIXMkGTnOA',
  authDomain: 'alphangers-1ba79.firebaseapp.com',
  projectId: 'alphangers-1ba79',
  appId: '1:564363174627:web:6334e40eb62ae51ff89bd6',
};

// Optional. A reCAPTCHA Enterprise site key turns on App Check for the admin
// page, e.g. export const appCheckSiteKey = '6Lc...';
// Read the App Check section of docs/FIREBASE_SETUP.md first: it also needs
// extra hosts in the /admin/* CSP in netlify.toml.
export const appCheckSiteKey = null;
