// Lists the text a visitor can see under a root that no page-text key covers, so a browser test
// can check that every text there is editable (src/lib/texts.js). Text made only of digits,
// times and punctuation counts as formatting and is skipped, and so is content that has its own
// editor (session titles, names, notes): pass selectors for it in skip.
//
//   const left = await unkeyedTexts(page, '#jadwal', { skip: ['.jw-s-t', '.jw-p-n'] });
//   assert.deepEqual(left, []);
export function unkeyedTexts(page, root = 'body', { skip = [] } = {}) {
  return page.evaluate(({ root, skip }) => {
    const host = document.querySelector(root);
    if (!host) return ['(nothing matches ' + root + ')'];
    const ignore = ['[data-k]', '.ed-ui', 'script', 'style', 'noscript', 'template', ...skip].join(', ');
    const out = [];
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const s = n.nodeValue.replace(/\s+/g, ' ').trim();
      if (!s || !/\p{L}/u.test(s)) continue;
      const el = n.parentElement;
      if (!el || el.closest(ignore)) continue;
      if (!el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') continue;
      const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : '';
      out.push(s.slice(0, 80) + '  <' + el.tagName.toLowerCase() + cls + '>');
    }
    return out;
  }, { root, skip });
}

// The saved links document the page reads from Firestore, with these changed texts (site.t).
// Pass the result to page.route('https://firestore.googleapis.com/**', ...) against a
// production build (the --mode mock build does not read Firestore): see linksRoute().
export function linksBody(links, t) {
  const doc = { ...links, site: { ...(links.site || {}), t } };
  return JSON.stringify({
    name: 'projects/alphangers-1ba79/databases/(default)/documents/content/links',
    fields: { json: { stringValue: JSON.stringify(doc) }, rev: { integerValue: '999' } },
    updateTime: '2026-10-24T00:00:00.000000Z',
  });
}

// Answers the page's Firestore reads: the links document with the given changed texts, and
// "no document" (so the bundled copy shows) for everything else.
export async function linksRoute(page, links, t) {
  await page.route('https://firestore.googleapis.com/**', (r) => {
    if (r.request().url().includes('/documents/content/links')) {
      return r.fulfill({ status: 200, contentType: 'application/json', body: linksBody(links, t) });
    }
    return r.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
}
