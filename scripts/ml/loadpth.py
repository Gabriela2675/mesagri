"""Lee un checkpoint de PyTorch (formato antiguo, no zip) sin instalar torch: devuelve arrays de numpy."""
import collections, pickle, struct, sys
import numpy as np

DT = {'FloatStorage': np.float32, 'HalfStorage': np.float16, 'DoubleStorage': np.float64, 'LongStorage': np.int64,
      'IntStorage': np.int32, 'ByteStorage': np.uint8, 'BoolStorage': np.bool_, 'CharStorage': np.int8, 'ShortStorage': np.int16}

class Storage:
    def __init__(self, dtype, numel): self.dtype, self.numel, self.data = dtype, numel, None

class Lazy:
    def __init__(self, st, off, size, stride): self.st, self.off, self.size, self.stride = st, off, tuple(size), tuple(stride)
    def get(self):
        a = self.st.data
        it = a.itemsize
        return np.lib.stride_tricks.as_strided(a[self.off:], shape=self.size, strides=tuple(s * it for s in self.stride)).copy()

def rebuild_tensor_v2(st, off, size, stride, *rest): return Lazy(st, off, size, stride)
def rebuild_parameter(t, *rest): return t

class StorageType:
    def __init__(self, name): self.name = name

def load(path):
    f = open(path, 'rb')
    storages = {}
    class U(pickle.Unpickler):
        def find_class(self, mod, name):
            if mod.startswith('torch'):
                if name in DT: return StorageType(name)
                if name == '_rebuild_tensor_v2': return rebuild_tensor_v2
                if name == '_rebuild_parameter': return rebuild_parameter
                raise pickle.UnpicklingError(f'no permitido: {mod}.{name}')
            if (mod, name) == ('collections', 'OrderedDict'): return collections.OrderedDict
            if mod in ('builtins', '__builtin__') and name in ('set', 'frozenset', 'dict', 'list', 'tuple', 'int', 'float', 'str', 'slice'): return getattr(__import__('builtins'), name)
            if mod == 'numpy.core.multiarray' or mod == 'numpy._core.multiarray' or mod == 'numpy': 
                raise pickle.UnpicklingError(f'no permitido: {mod}.{name}')
            raise pickle.UnpicklingError(f'no permitido: {mod}.{name}')
        def persistent_load(self, pid):
            typ, stype, key, loc, numel, view = pid
            assert typ == 'storage'
            if key not in storages: storages[key] = Storage(DT[stype.name], numel)
            return storages[key]
    magic = U(f).load(); proto = U(f).load(); info = U(f).load()
    obj = U(f).load()
    keys = U(f).load()
    for k in keys:
        st = storages[k]
        n = struct.unpack('<q', f.read(8))[0]
        st.data = np.frombuffer(f.read(n * np.dtype(st.dtype).itemsize), dtype=st.dtype)
    def walk(o):
        if isinstance(o, Lazy): return o.get()
        if isinstance(o, dict): return collections.OrderedDict((k, walk(v)) for k, v in o.items())
        if isinstance(o, (list, tuple)): return type(o)(walk(v) for v in o)
        return o
    return walk(obj)

if __name__ == '__main__':
    sd = load(sys.argv[1])
    if 'state_dict' in sd: sd = sd['state_dict']
    tot = 0
    for k, v in sd.items():
        if hasattr(v, 'shape'): tot += v.size
    print(len(sd), 'tensores', tot / 1e6, 'M parámetros')
    for k, v in list(sd.items())[:12]: print(k, getattr(v, 'shape', v), getattr(v, 'dtype', ''))
    print('...')
    for k, v in list(sd.items())[-8:]: print(k, getattr(v, 'shape', v), getattr(v, 'dtype', ''))
