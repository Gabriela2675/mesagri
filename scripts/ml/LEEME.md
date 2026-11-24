# Machine Learning de Mesagri: cómo se armó y cómo se probó

El primer filtro de cada publicación usa **CLIP** (un modelo que pone fotos y textos en el mismo
espacio): se compara el vector de la foto con el de 103 frases («a pile of red onions», «a bottle of
sports drink», «a screenshot of a phone screen»…) y gana la más parecida. Es clasificación
**«zero-shot»**: no hizo falta juntar ni etiquetar fotos de Mesagri para entrenarlo. Todo corre en el
servidor de Mesagri (ONNX Runtime) o en el navegador (ONNX Runtime Web), sin servicios pagados.

## Pasos (Python 3, numpy, onnx, onnxruntime, ftfy, regex, pillow, scipy; sin PyTorch)

1. Bajar los pesos de OpenCLIP (`vit_b_32-laion2b_e16-af8dbd0c.pth`, 605 MB) de
   <https://github.com/mlfoundations/open_clip/releases/tag/v0.2-weights>.
2. `loadpth.py` los lee sin PyTorch (formato antiguo de `torch.save`) y se guardan en `clip_b32.npz`.
3. `clip_np.py`: tokenizador BPE de CLIP (`bpe_simple_vocab_16e6.txt.gz`) y los codificadores de texto
   e imagen en numpy (referencia).
4. `export_onnx.py clip_b32.npz vision_fp32.onnx`: arma el codificador de imagen en ONNX.
5. `qmix.py vision_pre.onnx vision_mix.onnx` (antes, `quant_pre_process` de onnxruntime): int8
   dinámico por canal; parches y bloque 0 con pesos int8 y cálculo en float32.
6. `split_external.py vision_mix.onnx carpeta/`: pesos en dos archivos alineados a 4 KB.
7. `labels_spec.py` (etiquetas y frases) → `make_labels.py` (vectores de las etiquetas; guarda las
   frases ya calculadas) → `export_labels.py labels.json`.
8. `decide.py`: la decisión por foto en Python, igual a `judgePhoto` de `packages/shared/src/ml.ts`.

## Cómo se probó (noviembre de 2026)

- **Igual a la referencia**: el ONNX en float32 da el mismo vector que numpy (coseno 1,00000). El int8
  conserva el vector (coseno promedio 0,992 en 130 fotos) y tarda unos **30 ms por foto** en un núcleo
  de una computadora (unos 0,3 s en el navegador; menos de 1 s en el plan gratis de Render).
- **Fotos de prueba** (no van en el repositorio): 1 174 fotos. 214 de productos (Fruits-360, licencia
  CC BY-SA 4.0, y fotos reales de ImageNet de choclo, zapallo, pimiento, etc.) y 960 de cosas que no
  son productos (una foto de cada clase de ImageNet: animales, botellas, pantallas, vehículos, comida
  preparada…) más las fotos de `apps/web/public/muestras` (DNI y rostros).
- **Resultados por foto** (cada foto contra cada uno de los 19 productos del catálogo):
  - la foto **sí** muestra el producto declarado: «sí» 50 %, «dudoso» 47 %, «no» 3 % (en fotos reales
    de ImageNet, 5 de 5 «sí»; las dudas vienen sobre todo de fotos de estudio de 100×100 px y de las
    variedades de papa, que el modelo distingue mal);
  - la foto muestra **otro producto** que no se parece: «sí» 0,5 %, «no» 91 %;
  - la foto **no es de un producto** del campo: «sí» 0,1 %, «no» 84 %, «dudoso» 16 %.
  Es decir: casi nunca deja pasar una foto equivocada; cuando no está seguro, lo manda a revisar.
- **Fotos copiadas**: la huella (dHash de 64 bits) cambia 0 a 5 bits si la foto se recomprime, se
  achica o se aclara; entre 79 800 pares de fotos distintas, la menor diferencia fue de 10 bits. Se
  marca como copiada con 6 bits o menos, o con 12 o menos si además el modelo ve lo mismo (coseno ≥ 0,93).
- **Límites**: conoce poco los cultivos andinos (olluco, oca, chuño), confunde variedades de papa
  (amarilla, blanca, nativa) y ajo morado con cebolla roja; por eso esos casos salen «dudoso» o con
  una nota para que el equipo mire la foto. La decisión final siempre es del equipo.
