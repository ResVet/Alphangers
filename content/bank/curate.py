import json, os, re, sys
D = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, D)
from curate_a import A as PA, DROP_A
from curate_b import B as PB, DROP_B, TOPIC_B

TOPICS = [
    ('bio', 'Karbohidrat & lipid'),
    ('prot', 'Protein & asam amino'),
    ('min', 'Mineral & elektrolit'),
    ('ab', 'Asam-basa & larutan'),
    ('ana', 'Kimia analitik'),
    ('org', 'Kimia organik'),
    ('fis', 'Biofisika'),
    ('saraf', 'Saraf & otot'),
    ('ling', 'Lingkungan & K3'),
    ('tek', 'Teknologi kedokteran'),
]
TORDER = {k: i for i, (k, _) in enumerate(TOPICS)}

HIDDEN = re.compile('[​‌‍⁠﻿­]')

def clean(s):
    s = HIDDEN.sub('', str(s))
    s = s.replace('—', '-').replace('–', '-')
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def stem(s):
    s = clean(s)
    s = re.sub(r'^\d+\s*\.\s*', '', s)            # "4. Seorang..." / "8.Seorang..."
    s = re.sub(r'\s*(\.{2,}|…\.*|\.…)$', '…', s)   # trailing "..", "...", "…." -> "…"
    s = re.sub(r'\s+…$', '…', s)
    if s and s[0].islower() and (len(s) < 2 or not s[1].isupper()):
        s = s[0].upper() + s[1:]
    if s and s[-1] not in '.?!…:)':
        s += '…'
    return s

def opt(s):
    s = clean(s)
    s = re.sub(r'\.$', '', s) if not re.search(r'\d\.$', s) else s
    if s and s[0].islower() and (len(s) < 2 or not s[1].isupper()) and not s.startswith(('pH', 'pK')):
        s = s[0].upper() + s[1:]
    return s

REFER = re.compile(r'(semua jawaban|di atas|tidak ada pilihan|keduanya|kedua jawaban|\b[a-e] dan [a-e]\b)', re.I)

src89 = json.load(open(os.path.join(D, 'src89.json'), encoding='utf-8'))
src200 = json.load(open(os.path.join(D, 'src200.json'), encoding='utf-8'))

out, problems = [], []

for q in src89:
    key = q['id'] if q['id'] == 'NEW' else int(q['id'])
    if key in DROP_A:
        continue
    p = PA.get(key)
    if p is None:
        problems.append('A%s has no patch (no explanation)' % key); continue
    o = p.get('o') or q['opts']
    a = p.get('a') or [q['ans']]
    if 'o' in p and 'a' not in p:
        # options were rewritten without a key change: keep the same index, but make sure the text still matches
        old = clean(q['opts'][q['ans']]).lower().replace(' ', '')
        new = clean(o[q['ans']]).lower().replace(' ', '')
        if old[:6] != new[:6]:
            problems.append('A%s option rewrite moved the key? %r -> %r' % (key, q['opts'][q['ans']], o[q['ans']]))
    item = dict(id='a' + str(key).lower(), src='89', t='mc', tp=p['topic'], q=stem(p.get('q') or q['q']),
                o=[opt(x) for x in o], a=sorted(set(a)), e=clean(p['e']))
    if p.get('note'): item['n'] = clean(p['note'])
    out.append(item)

for i, q in enumerate(src200):
    if i in DROP_B:
        continue
    p = PB.get(i, {})
    o = p.get('o') or q['o']
    a = p.get('a') or [q['a']]
    if 'o' in p and 'a' not in p:
        old = clean(q['o'][q['a']]).lower().replace(' ', '')
        new = clean(o[q['a']]).lower().replace(' ', '')
        if old[:5] != new[:5]:
            problems.append('B%03d option rewrite moved the key? %r -> %r' % (i, q['o'][q['a']], o[q['a']]))
    item = dict(id='b%03d' % i, src='200', t=q['t'], tp=TOPIC_B[i], q=stem(p.get('q') or q['q']),
                o=[opt(x) for x in o], a=sorted(set(a)), e=clean(p.get('e') or q['e']))
    if p.get('note'): item['n'] = clean(p['note'])
    out.append(item)

for it in out:
    if it['t'] == 'tf':
        assert it['o'] == ['Benar', 'Salah'], it
        it['ns'] = 1
    elif any(REFER.search(x) for x in it['o']):
        it['ns'] = 1
    assert all(0 <= k < len(it['o']) for k in it['a']), it['id']
    assert len(set(x.lower() for x in it['o'])) == len(it['o']), ('dup option', it['id'], it['o'])
    for f in ('q', 'e', 'n'):
        if f in it:
            assert '—' not in it[f] and '–' not in it[f], (it['id'], f)
            assert not HIDDEN.search(it[f]), (it['id'], f)
    if re.search(r'rangkuman|file kedua|dicantumkan|tercantum', it['e'], re.I):
        problems.append('%s explanation still meta: %s' % (it['id'], it['e'][:80]))

out.sort(key=lambda it: (TORDER[it['tp']], 0 if it['src'] == '89' else 1, it['id']))
ids = [it['id'] for it in out]
assert len(ids) == len(set(ids))

bank = {'v': 1, 'blok': {'b2': {'name': 'Blok 2', 'title': 'Kimia dan Fisika Kehidupan', 'sem': 'Semester 1',
        'topics': dict(TOPICS), 'q': out}}}
json.dump(bank, open(os.path.join(D, 'bank.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

# readable dump for review
L = 'ABCDE'
with open(os.path.join(D, 'bank_review.txt'), 'w', encoding='utf-8') as f:
    for it in out:
        f.write('[%s] (%s, %s) %s\n' % (it['id'], it['tp'], it['t'], it['q']))
        for j, x in enumerate(it['o']):
            f.write('    %s%s %s\n' % (L[j], '*' if j in it['a'] else '.', x))
        f.write('    PEMBAHASAN: %s\n' % it['e'])
        if 'n' in it: f.write('    CATATAN: %s\n' % it['n'])
        f.write('\n')

from collections import Counter
print('total', len(out), Counter(it['t'] for it in out), Counter(it['src'] for it in out))
print(Counter(it['tp'] for it in out))
print('multi-key', [it['id'] for it in out if len(it['a']) > 1])
print('noshuffle mc', [it['id'] for it in out if it.get('ns') and it['t'] == 'mc'])
print('notes', len([1 for it in out if 'n' in it]))
print('PROBLEMS:' if problems else 'no problems', *problems, sep='\n  ')
print('bytes', os.path.getsize(os.path.join(D, 'bank.json')))
