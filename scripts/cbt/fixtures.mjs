// Small fake question banks for the try out tests and the mock build (`vite --mode mock`),
// sealed exactly like the real ones but with a throwaway key that is written right here.
// Nothing in them is real exam content, and the key opens nothing else.
//
//   node scripts/cbt/fixtures.mjs
//
// Writes tests/fixtures/cbt/manifest.json and the sealed files next to it. Sealing is
// deterministic, so running it again on the same machine changes nothing. The pictures are drawn
// from SVG with sharp (already used by scripts/media.mjs).
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import sharp from 'sharp';
import { derive, seal, hashHex, LABEL, parseSecret } from '../../src/lib/seal.js';

// Throwaway. Tests and the mock build only; never used for a real bank.
export const SECRET = '0FBDA8R_Sb0sG6c56YmPo8pDvaVoFtX-6LGsqK-faK8';
const OUT = fileURLToPath(new URL('../../tests/fixtures/cbt/', import.meta.url));

const font = `font-family="DejaVu Sans, Arial, Helvetica, sans-serif"`;
const label = (x, y, t, anchor = 'middle') =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" ${font} font-size="26" font-weight="700" fill="#24211d">${t}</text>`;
const lead = (x1, y1, x2, y2) => `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="#24211d" stroke-width="2.5" fill="none"/><circle cx="${x2}" cy="${y2}" r="4" fill="#24211d"/>`;
const mito = (sx = 1) => `
  <ellipse rx="${46 * sx}" ry="${23 * sx}" fill="#f2b48c" stroke="#9c4f27" stroke-width="${3.5 * sx}"/>
  <path d="M${-32 * sx} ${-15 * sx} q${6 * sx} ${16 * sx} 0 ${30 * sx} M${-17 * sx} ${18 * sx} q${-6 * sx} ${-18 * sx} 0 ${-36 * sx} M${-2 * sx} ${-21 * sx} q${6 * sx} ${21 * sx} 0 ${42 * sx} M${13 * sx} ${20 * sx} q${-6 * sx} ${-20 * sx} 0 ${-40 * sx} M${28 * sx} ${-16 * sx} q${6 * sx} ${16 * sx} 0 ${32 * sx}" stroke="#9c4f27" stroke-width="${3 * sx}" fill="none" stroke-linecap="round"/>`;

// An animal cell with three organelles marked A, B and C (B is a mitochondrion).
const CELL = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="440" viewBox="0 0 640 440">
  <rect width="640" height="440" fill="#f6f2ea"/>
  <path d="M118 226 C112 118 222 62 330 66 C452 70 556 132 548 232 C540 334 438 386 318 380 C204 374 124 330 118 226 Z" fill="#fbe8cf" stroke="#b07235" stroke-width="5"/>
  <g fill="none" stroke="#6d8fb8" stroke-width="4" stroke-linecap="round">
    <path d="M206 148 q-30 70 2 150"/><path d="M190 160 q-26 62 2 128"/><path d="M176 176 q-18 46 2 96"/>
  </g>
  <g fill="#6d8fb8"><circle cx="198" cy="182" r="3.5"/><circle cx="186" cy="222" r="3.5"/><circle cx="190" cy="262" r="3.5"/><circle cx="174" cy="206" r="3.5"/><circle cx="176" cy="246" r="3.5"/></g>
  <circle cx="298" cy="222" r="72" fill="#e8c4de" stroke="#87507b" stroke-width="4.5"/>
  <circle cx="316" cy="206" r="21" fill="#b7779d"/>
  <g transform="translate(456 186) rotate(-22)">${mito()}</g>
  <g transform="translate(410 312) rotate(14)">${mito(0.7)}</g>
  <g fill="none" stroke="#7a9a3c" stroke-width="5" stroke-linecap="round">
    <path d="M222 322 q40 -22 80 0"/><path d="M226 338 q36 -18 72 0"/><path d="M232 353 q30 -14 60 0"/>
  </g>
  <g fill="#c86a7a"><circle cx="386" cy="118" r="12"/><circle cx="246" cy="104" r="9"/></g>
  ${lead(108, 86, 262, 170)}${label(92, 80, 'A')}
  ${lead(590, 104, 486, 172)}${label(604, 100, 'B')}
  ${lead(112, 392, 238, 336)}${label(96, 404, 'C')}
</svg>`;

// The same mitochondrion up close, for the explanation.
const MITO = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="320" viewBox="0 0 560 320">
  <rect width="560" height="320" fill="#f6f2ea"/>
  <g transform="translate(250 166)">
    <ellipse rx="190" ry="96" fill="#f7c9a8" stroke="#9c4f27" stroke-width="7"/>
    <ellipse rx="174" ry="82" fill="#f2b48c" stroke="#b5643a" stroke-width="3"/>
    <g fill="none" stroke="#9c4f27" stroke-width="5" stroke-linecap="round">
      <path d="M-128 -62 q26 62 0 124"/><path d="M-74 74 q-26 -74 0 -148"/><path d="M-18 -80 q26 80 0 160"/>
      <path d="M38 78 q-26 -78 0 -156"/><path d="M94 -70 q24 70 0 140"/><path d="M140 44 q-14 -44 0 -88"/>
    </g>
    <g fill="#9c4f27"><circle cx="-100" cy="-24" r="3"/><circle cx="-44" cy="30" r="3"/><circle cx="66" cy="-30" r="3"/><circle cx="12" cy="40" r="3"/></g>
  </g>
  <g ${font} font-size="17" font-weight="600" fill="#24211d">
    <path d="M70 34 L120 92" stroke="#24211d" stroke-width="2" fill="none"/><text x="20" y="28">membran luar</text>
    <path d="M300 30 L276 86" stroke="#24211d" stroke-width="2" fill="none"/><text x="300" y="26">membran dalam</text>
    <path d="M470 280 L392 214" stroke="#24211d" stroke-width="2" fill="none"/><text x="440" y="302">krista</text>
    <path d="M110 288 L180 216" stroke="#24211d" stroke-width="2" fill="none"/><text x="40" y="306">matriks</text>
  </g>
</svg>`;

const png = (svg) => sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true }).toBuffer();
const webp = (svg) => sharp(Buffer.from(svg)).webp({ quality: 82, effort: 6 }).toBuffer();
const TF = ['Benar', 'Salah'];

// Blok 2: several topics, both kinds of question, every option count, a fixed order, two
// accepted answers, a note and a stem in two paragraphs.
const b2 = {
  id: 'b2', name: 'Blok 2', title: 'Kimia dan Fisika Kehidupan', sem: 'Semester 1',
  topics: { ab: 'Asam-basa & larutan', bio: 'Karbohidrat & lipid', fis: 'Biofisika' },
  q: [
    { id: 'f01', t: 'tf', tp: 'ab', q: 'Larutan dengan pH 3 sepuluh kali lebih asam daripada larutan dengan pH 4.', o: TF, a: [0], ns: 1,
      e: 'pH adalah logaritma negatif kadar H+. Turun satu angka pH berarti kadar H+ naik sepuluh kali.' },
    { id: 'f02', t: 'mc', tp: 'ab', q: 'Sistem penyangga yang paling besar perannya di plasma darah adalah…', o: ['Fosfat', 'Bikarbonat', 'Hemoglobin', 'Protein plasma'], a: [1],
      e: 'Pasangan HCO3- dan H2CO3 menahan sebagian besar perubahan pH plasma. Kadarnya diatur oleh paru dan ginjal.' },
    { id: 'f03', t: 'mc', tp: 'bio', q: 'Ikatan yang menghubungkan dua monosakarida dalam satu disakarida disebut…', o: ['Ikatan peptida', 'Ikatan glikosidik', 'Ikatan ester', 'Ikatan hidrogen', 'Ikatan fosfodiester'], a: [1],
      e: 'Gugus OH anomerik satu monosakarida bereaksi dengan gugus OH monosakarida lain dan melepas air. Hasilnya ikatan glikosidik.',
      n: 'Laktosa tersusun dari galaktosa dan glukosa dengan ikatan β-1,4.' },
    { id: 'f04', t: 'mc', tp: 'bio', q: 'Penyusun trigliserida adalah…', o: ['Gliserol', 'Asam lemak', 'Gliserol dan asam lemak', 'Bukan keduanya'], a: [2], ns: 1,
      e: 'Satu gliserol mengikat tiga asam lemak lewat ikatan ester.' },
    { id: 'f05', t: 'mc', tp: 'fis', q: 'Satuan tekanan darah yang lazim dipakai di klinik adalah…', o: ['mmHg', 'Pascal', 'Torr', 'atm', 'N/m'], a: [0, 2],
      e: 'Tekanan darah ditulis dalam mmHg. Satu Torr hampir sama dengan satu mmHg, jadi keduanya diterima.', src: 'fixture' },
    { id: 'f06', t: 'mc', tp: 'fis', q: 'Aliran darah di sebuah arteri kecil diukur pada tekanan yang tetap.\n\nJika jari-jari arteri itu menyempit menjadi setengahnya, alirannya menjadi…', o: ['1/2 kali', '1/4 kali', '1/8 kali', '1/16 kali'], a: [3],
      e: 'Menurut hukum Poiseuille, aliran sebanding dengan pangkat empat jari-jari.\n\n(1/2) pangkat 4 sama dengan 1/16.' },
  ],
};

// Blok 3: credit, references, one topic, only multiple choice, pictures under the stem and
// under the explanation.
const b3 = {
  id: 'b3', name: 'Blok 3', title: 'Karakter Biologi Tubuh Manusia', sem: 'Semester 1',
  by: 'Batu Alphangers',
  refs: [
    { name: 'Alberts, Molecular Biology of the Cell (contoh)', url: 'https://example.org/alberts' },
    { name: 'Catatan kuliah Blok 3 (contoh)', url: 'http://example.org/catatan' },
    { name: 'Ringkasan praktikum (contoh)', url: 'javascript:alert(1)' },
  ],
  topics: { sel: 'Sel & genetika' },
  q: [
    { id: 'g01', t: 'mc', tp: 'sel', q: 'Perhatikan gambar sel hewan berikut. Organel yang ditunjuk huruf B adalah…', o: ['Nukleus', 'Mitokondria', 'Retikulum endoplasma kasar', 'Aparatus Golgi', 'Lisosom'], a: [1],
      img: [{ id: 'i01', svg: CELL, enc: png, type: 'image/png' }],
      e: 'B menunjuk organel lonjong dengan krista di dalamnya. Itu mitokondria, tempat sebagian besar ATP sel dibuat.',
      ei: [{ id: 'e01', svg: MITO, enc: webp, type: 'image/webp' }] },
    { id: 'g02', t: 'mc', tp: 'sel', q: 'Seorang anak laki-laki menderita hemofilia. Kedua orang tuanya sehat, dan kakek dari pihak ibu juga menderita hemofilia.\n\nPola pewarisan yang paling mungkin adalah…', o: ['Autosomal dominan', 'Autosomal resesif', 'Terpaut X resesif', 'Mitokondrial'], a: [2],
      e: 'Ibu yang sehat membawa alel dari ayahnya, lalu menurunkannya ke anak laki-lakinya.',
      n: 'Ayah tidak menurunkan kromosom X ke anak laki-lakinya.' },
    { id: 'g03', t: 'mc', tp: 'sel', q: 'Fase mitosis saat kromosom berjajar di bidang ekuator adalah…', o: ['Profase', 'Metafase', 'Anafase', 'Telofase'], a: [1],
      e: 'Pada metafase, kinetokor tiap kromosom terikat benang spindel dari dua kutub sehingga kromosom berjajar di tengah.' },
    { id: 'g04', t: 'mc', tp: 'sel', q: 'Kodon awal (start) pada mRNA adalah…', o: ['UAA', 'AUG', 'UGA', 'UAG', 'GUA'], a: [1],
      e: 'AUG mengode metionin dan menjadi tempat ribosom mulai menerjemahkan. UAA, UGA dan UAG adalah kodon stop.' },
  ],
};

// OSPE Blok 3 (Try Out OSPE): a bank of the other kind, with a picture under the stem and
// questions that come with the key only, no explanation.
const o3 = {
  id: 'o3', kind: 'ospe', name: 'Blok 3', title: 'Karakter Biologi Tubuh Manusia', sem: 'Semester 1',
  by: 'Praktikum Alphangers',
  topics: { sel: 'Morfologi sel', mitosis: 'Mitosis akar bawang' },
  q: [
    { id: 'p01', t: 'mc', tp: 'sel', q: 'Pada preparat di atas, organel yang ditunjuk huruf B adalah…', o: ['Nukleus', 'Mitokondria', 'Lisosom', 'Ribosom'], a: [1],
      img: [{ id: 'i01', svg: CELL, enc: png, type: 'image/png' }] },
    { id: 'p02', t: 'mc', tp: 'mitosis', q: 'Fase terlama dalam siklus sel adalah…', o: ['Profase', 'Interfase', 'Metafase', 'Telofase'], a: [1] },
    { id: 'p03', t: 'mc', tp: 'mitosis', q: 'Pembagian sitoplasma yang menghasilkan dua sel anak disebut…', o: ['Replikasi', 'Kondensasi', 'Sitokinesis', 'Transkripsi'], a: [2],
      e: 'Sitokinesis membagi sitoplasma setelah inti membelah.' },
  ],
};

const meta = { b3: { new: true } };
const master = parseSecret(SECRET);

async function put(name, bytes) {
  await writeFile(join(OUT, name), bytes);
  return '/cbt/' + name;
}

async function sealBank(src, kv = 1) {
  const key = await derive(master, LABEL.bankKey(src.id, kv));
  const ivKey = await derive(master, LABEL.bankIv(src.id, kv));
  // the kind says which try out lists the bank; like seal.mjs, it stays out of the bank itself
  const { kind, ...rest } = src;
  const bank = structuredClone({ ...rest, q: [] });
  for (const q0 of src.q) {
    const q = { ...q0 };
    for (const field of ['img', 'ei']) {
      if (!q0[field]) continue;
      q[field] = [];
      for (const p of q0[field]) {
        const raw = await p.enc(p.svg);
        const { width: w, height: h } = await sharp(raw).metadata();
        const sealed = await seal(key, ivKey, raw, LABEL.imgAad(src.id, kv, p.id));
        const f = await put(`${src.id}-${p.id}.${await hashHex(sealed)}.bin`, sealed);
        q[field].push({ id: p.id, f, w, h, type: p.type });
      }
    }
    bank.q.push(q);
  }
  const sealed = await seal(key, ivKey, JSON.stringify(bank), LABEL.bankAad(src.id, kv));
  const file = await put(`${src.id}.${await hashHex(sealed)}.bin`, sealed);
  return {
    id: src.id, kv, name: src.name, title: src.title, sem: src.sem, n: bank.q.length,
    topics: Object.keys(bank.topics).length, file, bytes: sealed.length,
    ...(src.by ? { by: src.by } : {}), ...(meta[src.id] || {}), ...(kind ? { kind } : {}),
  };
}

await mkdir(OUT, { recursive: true });
for (const f of await readdir(OUT)) if (f.endsWith('.bin')) await rm(join(OUT, f));
const banks = [await sealBank(b2), await sealBank(b3), await sealBank(o3)];
const manifest = { v: 1, note: 'Fake banks for tests and the mock build. Made by scripts/cbt/fixtures.mjs.', secret: SECRET, banks };
await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(banks.map((b) => `${b.file} ${b.bytes} B, ${b.n} soal`).join('\n'));
