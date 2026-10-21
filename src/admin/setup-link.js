// A setup link (/admin/#tryout/pasang=<code>) hands the try out server's setup code to this
// page. The code is the key to every question bank, so it leaves the address bar the moment it
// is read: Google sign-in sends the page address to Firebase, and the browser keeps addresses in
// its history. main.js calls takeSetupLink() before anything else runs, and again whenever the
// hash changes; the try out tab picks the code up once with heldSetupCode().
let held = '';

export function takeSetupLink() {
  const m = /^#tryout\/pasang=(.*)$/s.exec(location.hash);
  if (!m) return;
  try {
    held = decodeURIComponent(m[1]).trim().slice(0, 200);
  } catch {
    held = m[1].trim().slice(0, 200);
  }
  history.replaceState(history.state, '', location.pathname + location.search + '#tryout');
}

export function heldSetupCode() {
  const code = held;
  held = '';
  return code;
}
