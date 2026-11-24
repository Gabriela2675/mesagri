import json, base64, sys
import numpy as np
meta = json.load(open('labels_meta.json')); Lz = np.load('labels.npz')
b64 = lambda a: base64.b64encode(np.ascontiguousarray(a, '<f2').tobytes()).decode()
out = {
    'model': 'CLIP ViT-B/32 (OpenCLIP, LAION-2B) · int8',
    'dim': 512, 'scale': 100,
    'labels': meta['labels'], 'similar': meta['similar'], 'variety': meta['variety'],
    'emb': b64(Lz['L']), 'white': b64(Lz['S']),
}
json.dump(out, open(sys.argv[1], 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(out['labels']), 'etiquetas,', round(len(json.dumps(out)) / 1024), 'KB')
