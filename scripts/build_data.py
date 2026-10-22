"""Builds the schedule and lecturer data the site ships with.

  python3 scripts/build_data.py [path/to/kontak-dosen.xlsx]

Schedules come from the hand-checked transcripts in content/jadwal/*.txt.
The lecturer contact sheet is optional; without it the script keeps the
contact list from the last build (src/data/dosen.json): everyone in it keeps
their id and every number, and the lecturers named in the block schedules are
refreshed from the transcripts.

A blok that was not in the last build gets an `added` time, and both files get
`base`, the newest of those times. The portal uses them to show a new blok even
where the admin has published an older copy of the schedule (src/lib/bundled.js).
"""
import datetime, json, os, re, sys, unicodedata

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
# The official sheet names the day but not the time yet: kept with a placeholder start of 00:00
# and shown as "jam menyusul" until the admin fills the time in.
NO_TIME = re.compile(r'^jam menyusul$', re.I)

def kind_of(title):
    t = title.lower()
    # "Her Dini", "Her OSPE": the remedial sitting of an exam is an exam too
    if t.startswith('ujian') or t.startswith('her '): return 'ujian'
    if t.startswith('tutorial'): return 'tutorial'
    if t.startswith('pleno'): return 'pleno'
    if t.startswith('skill lab'): return 'skilllab'
    # PK, PF, PB (Blok 2 and 3), PA and PH (praktikum anatomi and histologi, Blok 4)
    if re.match(r'^(pk|pf|pb|pa|ph)-?\d', t) or t.startswith('pengantar praktikum'): return 'praktikum'
    if t == 'mkdu': return 'mkdu'
    if t.startswith('pendahuluan') or t.startswith('block introduction') or t.startswith('introduction of blok'): return 'intro'
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
        later = bool(NO_TIME.match(cols[0]))
        m = None if later else TIME.match(cols[0])
        assert later or m, (path, line)
        start = '00:00' if later else m.group(1) + ':' + m.group(2)
        end = None if later or m.group(3).lower() == 'selesai' else m.group(3).replace('.', ':')
        who = cols[2] if len(cols) > 2 else '-'
        pj = who.startswith('PJ:')
        codes = [] if who in ('-', 'TIM') else [c.strip() for c in who.replace('PJ:', '').split(',')]
        sess = {'s': start, 'e': end, 't': cols[1], 'k': kind_of(cols[1]), 'dz': codes}
        if later: sess['menyusul'] = True
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

# one person can sit in two files under slightly different spellings; two people can share a name
# but not a specialty (dr. Susilawati, M.Kes and dr. Susilawati, SpPA)
def compatible(spec_a, spec_b):
    return spec_a == spec_b or (spec_a in ('Dokter', 'Dosen') and spec_b in ('Dokter', 'Dosen'))

def same_person(k, key):
    kk = k.split('#')[0]
    a, b = set(kk.split()), set(key.split())
    return kk == key or (len(a & b) >= 2 and (a <= b or b <= a)) or (len(key) > 8 and lev(kk, key) <= 1)

def merge_previous(people, previous):
    """Without the contact sheet, the last build's list stands in for it. Everyone in it keeps their
    id and every number. A person who now teaches is merged into their schedule entry, first by the
    exact name the last build used, then by the same name test the contact sheet goes through; the
    schedule's spelling of the name wins. Everyone else is carried over as they were."""
    taught = list(people)
    claimed = set()
    pending = []

    def take(target, d):
        claimed.add(target)
        p = people[target]
        p['id'] = d['id']
        for ph in d.get('phones', []):
            if ph['n'] not in [x['n'] for x in p['phones']]:
                p['phones'].append({'n': ph['n'], 'wa': ph.get('wa', '')})
        p['src'].add('kontak')

    for d in previous:
        key = core_name(d['name'])
        if key in people and key not in claimed: take(key, d)
        else: pending.append(d)
    for d in pending:
        key, spec = core_name(d['name']), specialty(d['name'])
        target = next((k for k in taught if k not in claimed and compatible(specialty(people[k]['name']), spec) and same_person(k, key)), None)
        if target:
            take(target, d)
            continue
        k2 = key
        while k2 in people: k2 += '#'
        people[k2] = {'name': d['name'], 'phones': [{'n': x['n'], 'wa': x.get('wa', '')} for x in d.get('phones', [])],
                      'bloks': [], 'codes': {}, 'src': set(['kontak']), 'id': d['id']}

def load_json(path):
    if not os.path.exists(path): return None
    with open(path, encoding='utf-8') as f:
        return json.load(f)

def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).strftime('%Y-%m-%dT%H:%M:%SZ')

def main():
    contacts_xlsx = sys.argv[1] if len(sys.argv) > 1 else None
    prev_schedule = load_json(os.path.join(OUT, 'schedule.json')) or {}
    prev_dosen = load_json(os.path.join(OUT, 'dosen.json')) or {}
    prev_bloks = {b['id']: b for b in prev_schedule.get('bloks', [])}
    now = utc_now()
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
        blok = {'id': bid, 'name': meta['nama'], 'title': meta['judul'], 'loc': meta['lokasi'],
                'ketua': meta.get('ketua'), 'start': days[0]['d'], 'end': days[-1]['d']}
        # first built now, or the time it was first built; the bloks of the very first build have none
        added = prev_bloks[bid].get('added') if bid in prev_bloks else now
        if added: blok['added'] = added
        blok['days'] = days
        blok['codes'] = codes
        bloks.append(blok)

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
            match = None
            for k, p in people.items():
                if not compatible(specialty(p['name']), spec): continue
                if same_person(k, key):
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
        merge_previous(people, prev_dosen.get('list', []))

    # ids already published stay; a name seen once in the last build keeps its id there too
    prev_ids = {}
    for d in prev_dosen.get('list', []):
        k = core_name(d['name'])
        prev_ids[k] = None if k in prev_ids else d['id']
    lst, key_id = [], {}
    for key, p in people.items():
        fixed = p.get('id')
        if not fixed and '#' not in key: fixed = prev_ids.get(key)
        assert len(p['phones']) <= 4, ('more than four numbers', p['name'])
        lst.append({'key': key, 'fixed': fixed, 'id': fixed or re.sub(r'[^a-z0-9]+', '-', key).strip('-'), 'name': p['name'],
                    'spec': specialty(p['name']),
                    'phones': [{'n': x['n'], 'f': fmt_phone(x['n']), 'wa': x['wa']} for x in p['phones']],
                    'bloks': p['bloks'], 'codes': p['codes']})
    lst.sort(key=lambda d: core_name(d['name']))
    taken = set()
    for d in lst:
        if d['fixed']:
            assert d['id'] not in taken, ('id used twice', d['id'])
            taken.add(d['id'])
    for d in lst:
        if not d['fixed']:
            base, n = d['id'], 1
            while d['id'] in taken:
                n += 1; d['id'] = base + '-' + str(n)
            taken.add(d['id'])
        key_id[d.pop('key')] = d['id']
        d.pop('fixed')
    for b in bloks:
        b['codes'] = {c: key_id[k] for c, k in b['codes'].items()}
        if b['ketua']: b['ketua'] = b['codes'][b['ketua']]

    stamps = {b['id']: b['added'] for b in bloks if b.get('added')}
    base = max(stamps.values()) if stamps else None
    schedule = {'v': 1, 'cls': 'Alpha'}
    if base: schedule['base'] = base
    schedule['bloks'] = bloks
    dosen = {'v': 1}
    if base: dosen['base'] = base
    if stamps: dosen['added'] = stamps
    dosen['list'] = lst

    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'schedule.json'), 'w', encoding='utf-8') as f:
        json.dump(schedule, f, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(OUT, 'dosen.json'), 'w', encoding='utf-8') as f:
        json.dump(dosen, f, ensure_ascii=False, separators=(',', ':'))
    n_s = sum(len(d['s']) for b in bloks for d in b['days'])
    print('schedule:', len(bloks), 'bloks,', sum(len(b['days']) for b in bloks), 'days,', n_s, 'sessions')
    print('dosen:', len(lst), 'people,', sum(1 for d in lst if d['bloks']), 'teach in the schedule,', sum(1 for d in lst if not d['phones']), 'without a phone')

if __name__ == '__main__':
    main()
