"""Cuantiza el modelo: int8 dinámico (pesos por canal) en casi todo; la proyección de parches y el
bloque 0 (los más sensibles) con pesos int8 y cálculo en float32 (DequantizeLinear)."""
import sys, os, re
import numpy as np, onnx
from onnx import numpy_helper, helper, TensorProto
from onnxruntime.quantization import quantize_dynamic, QuantType
src, dst, pat = sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else r'^(patch|b0_)'
m = onnx.load(src)
inits = {i.name: i for i in m.graph.initializer}
weight_only = []
new_nodes = []
for n in m.graph.node:
    if n.op_type == 'MatMul' and re.match(pat, n.name) and n.input[1] in inits:
        w = numpy_helper.to_array(inits[n.input[1]]).astype(np.float32)  # [K, N]
        sc = np.abs(w).max(0) / 127.0
        sc[sc == 0] = 1e-8
        q = np.clip(np.round(w / sc), -127, 127).astype(np.int8)
        base = n.input[1]
        m.graph.initializer.remove(inits[base])
        m.graph.initializer.extend([numpy_helper.from_array(q, base + '_q'), numpy_helper.from_array(sc.astype(np.float32), base + '_s'), numpy_helper.from_array(np.zeros(sc.shape, np.int8), base + '_z')])
        dq = helper.make_node('DequantizeLinear', [base + '_q', base + '_s', base + '_z'], [base + '_dq'], name=base + '_dqn', axis=1)
        new_nodes.append(dq)
        n.input[1] = base + '_dq'
        weight_only.append(n.name)
    new_nodes.append(n)
del m.graph.node[:]
m.graph.node.extend(new_nodes)
onnx.save(m, dst + '.tmp.onnx')
quantize_dynamic(dst + '.tmp.onnx', dst, weight_type=QuantType.QInt8, per_channel=True, op_types_to_quantize=['MatMul'], nodes_to_exclude=weight_only)
os.remove(dst + '.tmp.onnx')
print('solo pesos int8:', len(weight_only), 'MatMul;', round(os.path.getsize(dst) / 1e6, 1), 'MB')
