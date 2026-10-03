"""Builds the schedule and lecturer data the site ships with.

  python3 scripts/build_data.py [path/to/kontak-dosen.xlsx]

Schedules come from the hand-checked transcripts in content/jadwal/*.txt.
The lecturer contact sheet is optional; without it the script keeps the
contact list from the last build (src/data/dosen.json) and only refreshes
the lecturers named in the block schedules.
"""
import json, os, re, sys, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JADWAL = os.path.join(ROOT, 'content', 'jadwal')
OUT = os.path.join(ROOT, 'src', 'data')

# ---------- names ----------
TITLE_TOKENS = r'''
prof dr drs dra drg drh ir apt dokter
s ked skm s.km s kep skep spd s.pd sfarm s.farm ssi s.si s.si skom s.kom sst s.s.t str s.tr keb s.tr.keb sgz s.gz rd skes s.kes ftr
m kes mkes m.kes mbiomed m.biomed biomed bmd m.bmd msc m.sc msi m.si ms mph mkm m.km mars mhpm m.hpm mpd m.pd pd ked ked.klin klin mmedsc m.medsc
mbiomedsc phd med m.med mkk mkkk hima mo mgizi gizi aif fics fina fipm k ker dahk subsp kfm
'''.split()

def fold(s):
    s = unicodedata.normalize('NFKD', s)
    return ''.join(c for c in s if not unicodedata.combining(c))

def core_name(full):
    """Lower-case name without academic titles, used to match people across files."""
    s = fold(full).lower()
    s = s.split(',')[0]                     # titles after the first comma are degrees
    s = re.sub(r'\bsp\.?\s?[a-z().\-]+', ' ', s)
    s = re.sub(r"[^a-z' ]", ' ', s)
    toks = [t for t in s.split() if t not in TITLE_TOKENS and len(t) > 1]
    return ' '.join(toks)

def clean_name(n):
    n = re.sub(r'\s+', ' ', n.replace('\n', ' ')).strip()
    n = re.sub(r'\s+,', ',', n)
    return n

# ---------- phones ----------
def phones(raw):
    out = []
    for part in re.split(r'[/\n;]|\s{2,}', str(raw or '')):
        d = re.sub(r'\D', '', part)
        if len(d) < 6:
            continue
        if d.startswith('62'):
            d = '0' + d[2:]
        if not d.startswith('0'):
            d = '0711' + d if len(d) <= 8 else '0' + d   # bare Palembang landline, or a mobile missing its 0
        mobile = d.startswith('08')
        out.append({'n': d, 'wa': ('62' + d[1:]) if mobile else '', 'm': mobile})
    seen, uniq = set(), []
    for p in out:
        if p['n'] not in seen:
            seen.add(p['n']); uniq.append(p)
    return uniq

def fmt_phone(d):
    if d.startswith('0711'):
        return '0711-' + d[4:]
    if d.startswith('08') and len(d) >= 10:
        return d[:4] + '-' + d[4:8] + '-' + d[8:]
    return d

# ---------- specialties ----------
SPEC = [
    (r'sp\.?\s?pd\b|sp\.?\s?pd-', 'Penyakit Dalam'), (r'sp\.?\s?jp\b|kkv', 'Jantung'), (r'sp\.?\s?a\b|sp\.?\s?a\(|sp\.?\s?a,', 'Anak'),
    (r'sp\.?\s?og|obgin', 'Obstetri dan Ginekologi'), (r'sp\.?\s?bs\b', 'Bedah Saraf'), (r'sp\.?\s?ba\b|spb-spba', 'Bedah Anak'),
    (r'sp\.?\s?btkv|spbtkv', 'Bedah Toraks Kardiovaskular'), (r'sp\.?\s?bp', 'Bedah Plastik'), (r'sp\.?\s?b\b|sp\.?\s?b-|sp\.?\s?b\(', 'Bedah'),
    (r'sp\.?\s?s\b|sp\.?\s?s\(|sp\.?\s?n\b', 'Neurologi'), (r'sp\.?\s?m\b|sp\.?\s?m\(', 'Mata'), (r'sp\.?\s?kk|sp\.?\s?dv|sp\.?\s?d\.?\s?v', 'Kulit dan Kelamin'),
    (r'sp\.?\s?pa\b', 'Patologi Anatomi'), (r'sp\.?\s?pk\b', 'Patologi Klinik'), (r'sp\.?\s?kj', 'Kedokteran Jiwa'), (r'sp\.?\s?rad', 'Radiologi'),
    (r'sp\.?\s?tht', 'THT-KL'), (r'sp\.?\s?ot\b|sp\.?\s?ot\(|sport', 'Ortopedi'), (r'sp\.?\s?u\b|sp\.?\s?u\(|urog', 'Urologi'), (r'sp\.?\s?an\b', 'Anestesiologi'),
    (r'sp\.?\s?f\b|sp\.?\s?f\.|sp\.?\s?fm', 'Forensik'), (r'sp\.?\s?kfr|sp\.?\s?rm|sp\.?\s?kfm', 'Rehabilitasi Medik'), (r'sp\.?\s?p\b|sp\.?\s?p\(', 'Pulmonologi'),
    (r'sp\.?\s?gk', 'Gizi Klinik'), (r'sp\.?\s?mk\b', 'Mikrobiologi Klinik'), (r'sp\.?\s?fk\b', 'Farmakologi Klinik'), (r'sp\.?\s?ko\b', 'Kedokteran Olahraga'),
    (r'sp\.?\s?ok\b', 'Kedokteran Okupasi'), (r'sp\.?\s?par', 'Parasitologi Klinik'), (r'sp\.?\s?ak\b', 'Akupunktur'),
]

COMPACT = [('spthtkl', 'THT-KL'), ('spfkr', 'Rehabilitasi Medik'), ('spdlp', 'Kedokteran Layanan Primer'), ('spand', 'Andrologi'),
           ('sppm', 'Penyakit Mulut')]

def specialty(full):
    s = fold(full).lower()
    compact = re.sub(r'[\s.\-]', '', s)
    if 'spsi' in compact.split(','):
        return 'Dosen'
    for key, label in COMPACT:
        if key in compact:
            return label
    for pat, label in SPEC:
        if re.search(pat, s):
            return label
    if re.search(r'\bsp\.?\s?[a-z]', s):
        return 'Spesialis lain'
    if re.search(r'\bdrg\b', s):
        return 'Dokter gigi'
    raw = fold(full)
    if re.search(r'(^|\s)dr\.?\s', raw):                 # lower-case dr. is the medical title
        return 'Dokter'
    nonmed = re.search(r'\b(s\.?\s?km|skm|s\.?\s?si|s\.?\s?pd|s\.?\s?farm|s\.?\s?kep|s\.?\s?s\.?\s?t|s\.?\s?tr|s\.?\s?kom|s\.?\s?gz|drs|dra|apt|drh)\b', s)
    if re.search(r'(^|\s)dr\.?\s', s) and not nonmed:    # "Dr." without a non-medical degree, almost always a physician here
        return 'Dokter'
    return 'Dosen'

# ---------- schedule ----------
TIME = re.compile(r'^(\d{2})\.(\d{2})\s*-\s*(\d{2}\.\d{2}|selesai)$', re.I)

def kind_of(title):
    t = title.lower()
    if t.startswith('ujian') or t.startswith('her dini'): return 'ujian'
    if t.startswith('tutorial'): return 'tutorial'
    if t.startswith('pleno'): return 'pleno'
    if t.startswith('skill lab'): return 'skilllab'
    if re.match(r'^(pk|pf|pb)-?\d', t) or t.startswith('pengantar praktikum'): return 'praktikum'
    if t == 'mkdu': return 'mkdu'
    if t.startswith('pendahuluan') or t.startswith('block introduction'): return 'intro'
    return 'kuliah'

def parse_blok(path):
    meta, days, dosen, day = {}, [], {}, None
    section = 'jadwal'
    for raw in open(path, encoding='utf-8'):
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        if line == '[dosen]':
            section = 'dosen'; continue
        if section == 'dosen':
            code, name, ph = [x.strip() for x in line.split('|')]
            dosen[code] = {'name': clean_name(name), 'phones': phones(ph)}
            continue
        if line.startswith('@'):
            k, v = line[1:].split(' ', 1); meta[k] = v.strip(); continue
        if line.startswith('='):
            day = {'d': line[1:].strip(), 's': []}; days.append(day); continue
        cols = [c.strip() for c in line.split('|')]
        if cols[0] == 'LIBUR':
            day['libur'] = cols[1]; continue
        m = TIME.match(cols[0])
        assert m, (path, line)
        start = m.group(1) + ':' + m.group(2)
        end = None if m.group(3).lower() == 'selesai' else m.group(3).replace('.', ':')
        who = cols[2] if len(cols) > 2 else '-'
        pj = who.startswith('PJ:')
        codes = [] if who in ('-', 'TIM') else [c.strip() for c in who.replace('PJ:', '').split(',')]
        sess = {'s': start, 'e': end, 't': cols[1], 'k': kind_of(cols[1]), 'dz': codes}
        if pj: sess['pj'] = True
        if who == 'TIM': sess['tim'] = True
        if len(cols) > 3 and cols[3]: sess['n'] = cols[3]
        day['s'].append(sess)
    for d in days:
        for s in d['s']:
            for c in s['dz']:
                assert c in dosen, (path, d['d'], c)
    return meta, days, dosen

def lev(a, b):
    if abs(len(a) - len(b)) > 1: return 2
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]

def main():
    contacts_xlsx = sys.argv[1] if len(sys.argv) > 1 else None
    bloks, people = [], {}
    order = sorted(f for f in os.listdir(JADWAL) if f.endswith('.txt'))
    for f in order:
        meta, days, dz = parse_blok(os.path.join(JADWAL, f))
        bid = meta['blok']
        codes = {}
        for code, d in dz.items():
            key = core_name(d['name'])
            p = people.setdefault(key, {'name': d['name'], 'phones': [], 'bloks': [], 'codes': {}, 'src': set()})
            for ph in d['phones']:
                if ph['n'] not in [x['n'] for x in p['phones']]:
                    p['phones'].append(ph)
            if bid not in p['bloks']: p['bloks'].append(bid)
            p['codes'][bid] = code
            p['src'].add('jadwal')
            codes[code] = key
        bloks.append({'id': bid, 'name': meta['nama'], 'title': meta['judul'], 'loc': meta['lokasi'],
                      'ketua': meta.get('ketua'), 'start': days[0]['d'], 'end': days[-1]['d'],
                      'days': days, 'codes': codes})

    if contacts_xlsx:
        import openpyxl
        ws = openpyxl.load_workbook(contacts_xlsx, data_only=True).active
        for row in ws.iter_rows(values_only=True):
            vals = [v for v in row if v not in (None, '')]
            if len(vals) < 2: continue
            name, ph = clean_name(str(vals[0])), str(vals[1])
            key = core_name(name)
            if not key: continue
            spec = specialty(name)
            # one person can sit in both files under slightly different spellings; two people can share a name
            # but not a specialty (dr. Susilawati, M.Kes and dr. Susilawati, SpPA)
            match = None
            for k, p in people.items():
                if specialty(p['name']) != spec and not (spec in ('Dokter', 'Dosen') and specialty(p['name']) in ('Dokter', 'Dosen')):
                    continue
                kk = k.split('#')[0]
                a, b = set(kk.split()), set(key.split())
                if kk == key or (len(a & b) >= 2 and (a <= b or b <= a)) or (len(key) > 8 and lev(kk, key) <= 1):
                    match = p; break
            if not match:
                k2 = key
                while k2 in people: k2 += '#'
                match = people[k2] = {'name': name, 'phones': [], 'bloks': [], 'codes': {}, 'src': set()}
            for x in phones(ph):
                if x['n'] not in [y['n'] for y in match['phones']]:
                    match['phones'].append(x)
            match['src'].add('kontak')
    else:
        old = os.path.join(OUT, 'dosen.json')
        if os.path.exists(old):
            for d in json.load(open(old, encoding='utf-8'))['list']:
                if d['bloks']: continue
                k2 = core_name(d['name'])
                while k2 in people: k2 += '#'
                people[k2] = {'name': d['name'], 'phones': [{'n': x['n'], 'wa': x['wa']} for x in d['phones']], 'bloks': [], 'codes': {}, 'src': set(['kontak'])}

    lst, key_id = [], {}
    for key, p in people.items():
        lst.append({'key': key, 'id': re.sub(r'[^a-z0-9]+', '-', key).strip('-'), 'name': p['name'],
                    'spec': specialty(p['name']),
                    'phones': [{'n': x['n'], 'f': fmt_phone(x['n']), 'wa': x['wa']} for x in p['phones']],
                    'bloks': p['bloks'], 'codes': p['codes']})
    lst.sort(key=lambda d: core_name(d['name']))
    ids = {}
    for d in lst:
        if d['id'] in ids:
            ids[d['id']] += 1; d['id'] += '-' + str(ids[d['id']])
        else:
            ids[d['id']] = 1
        key_id[d.pop('key')] = d['id']
    for b in bloks:
        b['codes'] = {c: key_id[k] for c, k in b['codes'].items()}
        if b['ketua']: b['ketua'] = b['codes'][b['ketua']]

    os.makedirs(OUT, exist_ok=True)
    json.dump({'v': 1, 'cls': 'Alpha', 'bloks': bloks}, open(os.path.join(OUT, 'schedule.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    json.dump({'v': 1, 'list': lst}, open(os.path.join(OUT, 'dosen.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    n_s = sum(len(d['s']) for b in bloks for d in b['days'])
    print('schedule:', len(bloks), 'bloks,', sum(len(b['days']) for b in bloks), 'days,', n_s, 'sessions')
    print('dosen:', len(lst), 'people,', sum(1 for d in lst if d['bloks']), 'teach in Blok 1-3,', sum(1 for d in lst if not d['phones']), 'without a phone')

if __name__ == '__main__':
    main()
