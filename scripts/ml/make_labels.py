import sys, os, json, time, importlib
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
import labels_spec as LS
CACHE = 'phrase_cache.npz'
cache = dict(np.load(CACHE)) if os.path.exists(CACHE) else {}
labels, texts, owner = [], [], []
def add(id_, es, group, phrases, temps):
    i = len(labels); labels.append({'id': id_, 'es': es, 'group': group})
    for ph in phrases:
        for t in temps: texts.append(t.format(ph)); owner.append(i)
for row in LS.PRODUCTS: add(row[0], row[1], 'producto', row[2], row[3] if len(row) > 3 else LS.T_PROD)
for row in LS.OTHER: add(row[0], row[1], 'otro', row[2], row[3] if len(row) > 3 else LS.T_PROD)
for id_, es, ph, t in LS.NOT: add(id_, es, 'no', ph, t)
for id_, es, ph, t in LS.UNCLEAR: add(id_, es, 'duda', ph, t)
stexts = LS.WHITE[0] + LS.WHITE[1]
need = sorted(set(t for t in texts + stexts if t not in cache))
if need:
    from clip_np import Clip
    m = Clip('clip_b32.npz')
    t0 = time.time(); E = m.encode_text(need); print(len(need), 'frases nuevas en', round(time.time() - t0, 1), 's')
    for t, e in zip(need, E): cache[t] = e
    np.savez(CACHE, **cache)
E = np.stack([cache[t] for t in texts]); owner = np.array(owner)
L = np.stack([E[owner == i].mean(0) for i in range(len(labels))]); L /= np.linalg.norm(L, axis=1, keepdims=True)
wa = np.mean([cache[t] for t in LS.WHITE[0]], 0); wa /= np.linalg.norm(wa)
wb = np.mean([cache[t] for t in LS.WHITE[1]], 0); wb /= np.linalg.norm(wb)
np.savez('labels.npz', L=L.astype(np.float32), S=np.stack([wa, wb]).astype(np.float32))
json.dump({'labels': labels, 'similar': LS.SIMILAR, 'variety': LS.VARIETY}, open('labels_meta.json', 'w'), ensure_ascii=False, indent=1)
print(len(labels), 'etiquetas,', len(texts), 'frases')
