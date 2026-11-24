"""
CLIP ViT-B/32 (OpenCLIP, LAION-2B) en numpy, sin torch: tokenizador BPE de CLIP, codificador de
texto y de imagen. Sirve de referencia para comprobar el modelo ONNX y para calcular, una sola vez,
los vectores de las etiquetas (productos y cosas que no son productos).
El tokenizador es el de OpenAI CLIP (licencia MIT).
"""
import functools
import gzip
import html
import os

import ftfy
import numpy as np
import regex as re
from scipy.special import erf

HERE = os.path.dirname(os.path.abspath(__file__))
MEAN = np.array([0.48145466, 0.4578275, 0.40821073], np.float32)
STD = np.array([0.26862954, 0.26130258, 0.27577711], np.float32)


@functools.lru_cache()
def bytes_to_unicode():
    bs = list(range(ord('!'), ord('~') + 1)) + list(range(ord('¡'), ord('¬') + 1)) + list(range(ord('®'), ord('ÿ') + 1))
    cs = bs[:]
    n = 0
    for b in range(2 ** 8):
        if b not in bs:
            bs.append(b)
            cs.append(2 ** 8 + n)
            n += 1
    return dict(zip(bs, [chr(c) for c in cs]))


def get_pairs(word):
    return {(a, b) for a, b in zip(word[:-1], word[1:])}


class Tokenizer:
    def __init__(self, bpe_path=os.path.join(HERE, 'bpe_simple_vocab_16e6.txt.gz')):
        self.byte_encoder = bytes_to_unicode()
        merges = gzip.open(bpe_path).read().decode('utf-8').split('\n')[1:49152 - 256 - 2 + 1]
        merges = [tuple(m.split()) for m in merges]
        vocab = list(bytes_to_unicode().values())
        vocab = vocab + [v + '</w>' for v in vocab] + [''.join(m) for m in merges] + ['<|startoftext|>', '<|endoftext|>']
        self.encoder = dict(zip(vocab, range(len(vocab))))
        self.bpe_ranks = dict(zip(merges, range(len(merges))))
        self.cache = {}
        self.pat = re.compile(r"""<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+""", re.IGNORECASE)
        self.sot, self.eot = self.encoder['<|startoftext|>'], self.encoder['<|endoftext|>']

    def bpe(self, token):
        if token in self.cache:
            return self.cache[token]
        word = tuple(token[:-1]) + (token[-1] + '</w>',)
        pairs = get_pairs(word)
        if not pairs:
            return token + '</w>'
        while True:
            bigram = min(pairs, key=lambda p: self.bpe_ranks.get(p, float('inf')))
            if bigram not in self.bpe_ranks:
                break
            first, second = bigram
            new, i = [], 0
            while i < len(word):
                try:
                    j = word.index(first, i)
                except ValueError:
                    new.extend(word[i:])
                    break
                new.extend(word[i:j])
                i = j
                if word[i] == first and i < len(word) - 1 and word[i + 1] == second:
                    new.append(first + second)
                    i += 2
                else:
                    new.append(word[i])
                    i += 1
            word = tuple(new)
            if len(word) == 1:
                break
            pairs = get_pairs(word)
        out = ' '.join(word)
        self.cache[token] = out
        return out

    def encode(self, text):
        text = re.sub(r'\s+', ' ', html.unescape(html.unescape(ftfy.fix_text(text))).strip()).strip().lower()
        ids = []
        for tok in re.findall(self.pat, text):
            tok = ''.join(self.byte_encoder[b] for b in tok.encode('utf-8'))
            ids.extend(self.encoder[t] for t in self.bpe(tok).split(' '))
        return ids

    def __call__(self, texts, ctx=77):
        out = np.zeros((len(texts), ctx), np.int64)
        for i, t in enumerate(texts):
            ids = [self.sot] + self.encode(t)[:ctx - 2] + [self.eot]
            out[i, :len(ids)] = ids
        return out


def layer_norm(x, w, b, eps=1e-5):
    m = x.mean(-1, keepdims=True)
    v = ((x - m) ** 2).mean(-1, keepdims=True)
    return (x - m) / np.sqrt(v + eps) * w + b


def gelu(x):
    return 0.5 * x * (1.0 + erf(x / np.sqrt(2.0)))


def softmax(x, axis=-1):
    x = x - x.max(axis, keepdims=True)
    e = np.exp(x)
    return e / e.sum(axis, keepdims=True)


def block(x, W, p, heads, mask=None):
    B, T, D = x.shape
    h = layer_norm(x, W[p + 'ln_1.weight'], W[p + 'ln_1.bias'])
    qkv = h @ W[p + 'attn.in_proj_weight'].T + W[p + 'attn.in_proj_bias']
    q, k, v = np.split(qkv, 3, axis=-1)
    hd = D // heads
    q = q.reshape(B, T, heads, hd).transpose(0, 2, 1, 3)
    k = k.reshape(B, T, heads, hd).transpose(0, 2, 1, 3)
    v = v.reshape(B, T, heads, hd).transpose(0, 2, 1, 3)
    a = q @ k.transpose(0, 1, 3, 2) / np.sqrt(hd)
    if mask is not None:
        a = a + mask
    a = softmax(a) @ v
    a = a.transpose(0, 2, 1, 3).reshape(B, T, D)
    x = x + a @ W[p + 'attn.out_proj.weight'].T + W[p + 'attn.out_proj.bias']
    h = layer_norm(x, W[p + 'ln_2.weight'], W[p + 'ln_2.bias'])
    h = gelu(h @ W[p + 'mlp.c_fc.weight'].T + W[p + 'mlp.c_fc.bias'])
    return x + h @ W[p + 'mlp.c_proj.weight'].T + W[p + 'mlp.c_proj.bias']


class Clip:
    def __init__(self, npz):
        self.W = dict(np.load(npz))
        self.tok = Tokenizer()

    def encode_text(self, texts, batch=64):
        W = self.W
        out = []
        mask = np.triu(np.full((77, 77), -np.inf, np.float32), 1)
        for s in range(0, len(texts), batch):
            ids = self.tok(texts[s:s + batch])
            x = W['token_embedding.weight'][ids] + W['positional_embedding']
            for i in range(12):
                x = block(x, W, f'transformer.resblocks.{i}.', 8, mask)
            x = layer_norm(x, W['ln_final.weight'], W['ln_final.bias'])
            x = x[np.arange(len(ids)), ids.argmax(-1)] @ W['text_projection']
            out.append(x / np.linalg.norm(x, axis=-1, keepdims=True))
        return np.concatenate(out).astype(np.float32)

    def encode_image(self, px):
        """px: [B, 3, 224, 224] ya normalizado."""
        W = self.W
        B = px.shape[0]
        w = W['visual.conv1.weight']  # [768, 3, 32, 32]
        patches = px.reshape(B, 3, 7, 32, 7, 32).transpose(0, 2, 4, 1, 3, 5).reshape(B, 49, 3 * 32 * 32)
        x = patches @ w.reshape(768, -1).T
        cls = np.broadcast_to(W['visual.class_embedding'], (B, 1, 768))
        x = np.concatenate([cls, x], 1) + W['visual.positional_embedding']
        x = layer_norm(x, W['visual.ln_pre.weight'], W['visual.ln_pre.bias'])
        for i in range(12):
            x = block(x, W, f'visual.transformer.resblocks.{i}.', 12)
        x = layer_norm(x[:, 0], W['visual.ln_post.weight'], W['visual.ln_post.bias']) @ W['visual.proj']
        return (x / np.linalg.norm(x, axis=-1, keepdims=True)).astype(np.float32)


def preprocess(img, size=224):
    """PIL.Image → [3, 224, 224]: lado corto a 224 (bicúbico), recorte al centro, normalizado como CLIP."""
    from PIL import Image
    img = img.convert('RGB')
    w, h = img.size
    s = size / min(w, h)
    img = img.resize((max(size, round(w * s)), max(size, round(h * s))), Image.BICUBIC)
    w, h = img.size
    l, t = (w - size) // 2, (h - size) // 2
    img = img.crop((l, t, l + size, t + size))
    a = (np.asarray(img, np.float32) / 255.0 - MEAN) / STD
    return a.transpose(2, 0, 1)
