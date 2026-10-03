"""Part ids shared by the geometry scripts and the site. The index is what the GLB stores per vertex,
so append new parts at the end instead of reordering."""
import colorsys

PARTS = [
    'heart',
    'ra', 'ra_aur', 'rv', 'rvot', 'la', 'la_aur', 'lv', 'apex', 'ivs', 'ias', 'fossa',
    'aorta_asc', 'aorta_arch', 'aorta_desc', 'bct', 'lcca', 'lsa', 'pt', 'rpa', 'lpa',
    'svc', 'ivc', 'rspv', 'ripv', 'lspv', 'lipv', 'lig_art',
    'rca', 'lmca', 'lad', 'diag', 'lcx', 'om', 'rmarg', 'pda',
    'gcv', 'mcv', 'scv', 'cs',
    'tv', 'pv', 'mv', 'av', 'chordae', 'pap_lv', 'pap_rv', 'modband',
    'san', 'internodal', 'avn', 'his', 'lbb', 'rbb', 'purk',
]
PART_INDEX = {k: i for i, k in enumerate(PARTS)}


def color_of(i):
    """Debug colour for previews only; the site colours parts in its shader."""
    h = (i * 0.61803398875) % 1.0
    r, g, b = colorsys.hls_to_rgb(h, 0.55, 0.55)
    return int(r * 255), int(g * 255), int(b * 255), 255
