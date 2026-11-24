"""
Arma el modelo ONNX del codificador de imágenes de CLIP ViT-B/32 (pesos de clip_b32.npz), sin torch.
Entrada: pixels [N, 3, 224, 224] (ya normalizado como CLIP). Salida: embedding [N, 512] de norma 1.
La proyección de los parches se hace con MatMul (no Conv) para que también se cuantice a int8.
"""
import sys

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

W = dict(np.load(sys.argv[1]))
out_path = sys.argv[2]
D, HEADS, HD, LAYERS = 768, 12, 64, 12

nodes, inits = [], []
_n = [0]


def name(p):
    _n[0] += 1
    return f'{p}_{_n[0]}'


def const(arr, p='c'):
    n = name(p)
    inits.append(numpy_helper.from_array(np.asarray(arr), n))
    return n


def op(t, ins, p=None, **kw):
    o = name(p or t.lower())
    nodes.append(helper.make_node(t, ins, [o], name=o, **kw))
    return o


def linear(x, w, b, p):
    """x @ w.T + b (w con forma [salida, entrada] como en PyTorch)."""
    y = op('MatMul', [x, const(np.ascontiguousarray(w.T.astype(np.float32)), p + '_w')], p)
    return op('Add', [y, const(b.astype(np.float32), p + '_b')], p + '_add') if b is not None else y


def ln(x, w, b, p):
    return op('LayerNormalization', [x, const(w.astype(np.float32), p + '_g'), const(b.astype(np.float32), p + '_b')], p, axis=-1, epsilon=1e-5)


def gelu(x):
    e = op('Erf', [op('Div', [x, const(np.float32(np.sqrt(2.0)))])])
    return op('Mul', [op('Mul', [x, op('Add', [e, const(np.float32(1.0))])]), const(np.float32(0.5))])


x = 'pixels'
# parches de 32×32: [N,3,7,32,7,32] → [N,7,7,3,32,32] → [N,49,3072] y proyección (equivale a conv1)
p = op('Reshape', [x, const(np.array([-1, 3, 7, 32, 7, 32], np.int64))])
p = op('Transpose', [p], perm=[0, 2, 4, 1, 3, 5])
p = op('Reshape', [p, const(np.array([-1, 49, 3 * 32 * 32], np.int64))])
p = linear(p, W['visual.conv1.weight'].reshape(D, -1), None, 'patch')
# token de clase + posiciones
n = op('Slice', [op('Shape', [x]), const(np.array([0], np.int64)), const(np.array([1], np.int64))])
cls_shape = op('Concat', [n, const(np.array([1, D], np.int64))], axis=0)
cls = op('Expand', [const(W['visual.class_embedding'].reshape(1, 1, D).astype(np.float32), 'cls'), cls_shape])
h = op('Concat', [cls, p], axis=1)
h = op('Add', [h, const(W['visual.positional_embedding'].astype(np.float32), 'pos')])
h = ln(h, W['visual.ln_pre.weight'], W['visual.ln_pre.bias'], 'ln_pre')

shape4 = const(np.array([0, 0, HEADS, HD], np.int64))
shape3 = const(np.array([0, 0, D], np.int64))
for i in range(LAYERS):
    k = f'visual.transformer.resblocks.{i}.'
    a = ln(h, W[k + 'ln_1.weight'], W[k + 'ln_1.bias'], f'b{i}_ln1')
    wqkv = W[k + 'attn.in_proj_weight'].copy()
    bqkv = W[k + 'attn.in_proj_bias'].copy()
    # la escala 1/√64 = 1/8 va dentro de q (exacto: potencia de 2)
    wqkv[:D] *= 1.0 / np.sqrt(HD)
    bqkv[:D] *= 1.0 / np.sqrt(HD)
    qkv = linear(a, wqkv, bqkv, f'b{i}_qkv')
    q, kk, v = [f'b{i}_{s}' for s in 'qkv']
    nodes.append(helper.make_node('Split', [qkv, const(np.array([D, D, D], np.int64))], [q, kk, v], name=f'b{i}_split', axis=-1))
    q = op('Transpose', [op('Reshape', [q, shape4])], perm=[0, 2, 1, 3])
    kk = op('Transpose', [op('Reshape', [kk, shape4])], perm=[0, 2, 3, 1])
    v = op('Transpose', [op('Reshape', [v, shape4])], perm=[0, 2, 1, 3])
    att = op('Softmax', [op('MatMul', [q, kk])], axis=-1)
    o = op('Reshape', [op('Transpose', [op('MatMul', [att, v])], perm=[0, 2, 1, 3]), shape3])
    h = op('Add', [h, linear(o, W[k + 'attn.out_proj.weight'], W[k + 'attn.out_proj.bias'], f'b{i}_out')])
    m = ln(h, W[k + 'ln_2.weight'], W[k + 'ln_2.bias'], f'b{i}_ln2')
    m = gelu(linear(m, W[k + 'mlp.c_fc.weight'], W[k + 'mlp.c_fc.bias'], f'b{i}_fc'))
    h = op('Add', [h, linear(m, W[k + 'mlp.c_proj.weight'], W[k + 'mlp.c_proj.bias'], f'b{i}_proj')])

c = op('Gather', [h, const(np.array(0, np.int64))], axis=1)
c = ln(c, W['visual.ln_post.weight'], W['visual.ln_post.bias'], 'ln_post')
e = op('MatMul', [c, const(W['visual.proj'].astype(np.float32), 'proj')])
nrm = op('ReduceL2', [e], keepdims=1, axes=[-1])
nodes.append(helper.make_node('Div', [e, nrm], ['embedding'], name='normalize'))

g = helper.make_graph(nodes, 'clip_vit_b32_vision', [helper.make_tensor_value_info('pixels', TensorProto.FLOAT, ['N', 3, 224, 224])],
                      [helper.make_tensor_value_info('embedding', TensorProto.FLOAT, ['N', 512])], inits)
model = helper.make_model(g, opset_imports=[helper.make_opsetid('', 17)], producer_name='mesagri')
model.ir_version = 8
onnx.checker.check_model(model)
onnx.save(model, out_path)
print('guardado', out_path, len(nodes), 'nodos')
