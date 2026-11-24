"""Guarda el modelo con los pesos aparte, en dos archivos de menos de 50 MB, alineados a 4 KB
(así el servidor los lee con mmap y gasta menos memoria). Uso: split_external.py modelo.onnx carpeta/"""
import os, sys
import onnx
from onnx import numpy_helper
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
m = onnx.load(src)
big = [i for i in m.graph.initializer if numpy_helper.to_array(i).nbytes >= 4096]
total = sum(numpy_helper.to_array(i).nbytes for i in big)
files, cur, off, size = {}, 1, 0, 0
fh = open(os.path.join(out, 'vision-1.bin'), 'wb')
for init in big:
    raw = numpy_helper.to_array(init).tobytes()
    if size > total / 2 and cur == 1:
        fh.close(); cur = 2; off = 0; fh = open(os.path.join(out, 'vision-2.bin'), 'wb')
    pad = (-off) % 4096
    fh.write(b'\0' * pad); off += pad
    fh.write(raw)
    init.ClearField('raw_data'); del init.float_data[:]; del init.int32_data[:]; del init.int64_data[:]
    init.data_location = onnx.TensorProto.EXTERNAL
    del init.external_data[:]
    for k, v in (('location', f'vision-{cur}.bin'), ('offset', str(off)), ('length', str(len(raw)))):
        e = init.external_data.add(); e.key = k; e.value = v
    off += len(raw); size += len(raw)
fh.close()
onnx.save(m, os.path.join(out, 'vision.onnx'))
for f in ('vision.onnx', 'vision-1.bin', 'vision-2.bin'): print(f, round(os.path.getsize(os.path.join(out, f)) / 1e6, 1), 'MB')
