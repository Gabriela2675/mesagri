"""Decisión por foto (la misma lógica que packages/shared/src/ml.ts)."""
import numpy as np
T = dict(scale=100.0, si_p=0.25, si_cos=0.22, var_p=0.45, no_p=0.30, no_rest=0.05, no_cos=0.18, white=0.90)
def judge(cos, white_logit, meta, decl, T=T):
    labels = meta['labels']; ids = [l['id'] for l in labels]; idx = {k: i for i, k in enumerate(ids)}
    z = T['scale'] * cos; P = np.exp(z - z.max()); P /= P.sum()
    d = idx[decl]
    var = next((g for g in meta['variety'] if decl in g), [decl])
    vi = [idx[x] for x in var if x != decl]
    si = [idx[x] for x in meta['similar'].get(decl, []) if x in idx and x not in var]
    pd, pv, ps = P[d], P[vi].sum() if vi else 0.0, P[si].sum() if si else 0.0
    top = int(P.argmax()); g = labels[top]['group']
    white = 1 / (1 + np.exp(-T['scale'] * white_logit))
    if cos[d] >= T['si_cos'] and pd >= T['si_p']: m = 'SI'
    elif cos[d] >= T['si_cos'] and top in vi and pd + pv >= T['var_p']: m = 'SI'  # otra variedad del mismo producto
    elif g == 'duda' and P[top] >= T['no_p']: m = 'DUDA'
    elif top != d and top not in vi and top not in si and P[top] >= T['no_p'] and pd + pv + ps < T['no_rest']: m = 'NO'
    elif cos[d] < T['no_cos'] and pd + pv + ps < T['no_rest']: m = 'NO'
    else: m = 'DUDA'
    if m == 'SI' and white >= T['white']: m = 'DUDA'
    return m, P, top, white
