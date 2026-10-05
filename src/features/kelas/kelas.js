// The class photo at the end of the page. The picture itself is in index.html so it needs no
// script to show; this adds the full view, and swaps the photo when the editor sets a new one
// (links document, site.photo).
import { pictureHTML, watchLoaded } from '../../lib/photo.js';
import { getViewer } from '../viewer/viewer.js';
import fallback from '../../data/kelas.json';

export function mountKelas(root, { links }) {
  const fig = root.querySelector('#kelasPh');
  const btn = root.querySelector('#kelasOpen');
  let photo = links?.site?.photo || fallback;

  function show(ph) {
    photo = ph || fallback;
    btn.innerHTML = pictureHTML(photo, { sizes: '100vw', cls: 'kelas-img' });
    watchLoaded(btn);
  }
  if (links?.site?.photo) show(links.site.photo);

  function open() {
    getViewer().open({
      photos: [photo],
      kick: root.querySelector('[data-k="kelas.kick"]')?.textContent || '',
      title: (root.querySelector('[data-k="kelas.h1"]')?.textContent || '') + ' ' + (root.querySelector('[data-k="kelas.h2"]')?.textContent || ''),
      desc: root.querySelector('[data-k="kelas.sub"]')?.textContent || '',
      from: btn.querySelector('img'),
      owner: { kind: 'kelas' },
    });
  }
  btn.addEventListener('click', open);

  return {
    update({ links: fresh }) {
      const next = fresh?.site?.photo || fallback;
      if (JSON.stringify(next) !== JSON.stringify(photo)) show(next);
    },
    photo: () => photo,
    open,
  };
}
