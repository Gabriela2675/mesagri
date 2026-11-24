# Modelo de visión del primer filtro (CLIP ViT-B/32, int8)

Lo usa la revisión de cada publicación para saber si las fotos muestran el producto declarado
(`apps/api/src/review/ml-review.ts` en el servidor y `apps/web/src/app/vision/clip.ts` en la demo sin
internet). Las decisiones están en `packages/shared/src/ml.ts`.

| Archivo | Qué es |
|---|---|
| `vision.onnx` | El codificador de imágenes de CLIP en ONNX (opset 17): entra la foto de 224×224 normalizada, sale un vector de 512 números de norma 1 |
| `vision-1.bin`, `vision-2.bin` | Sus pesos (88 MB en total, en dos archivos de menos de 50 MB, alineados a 4 KB para leerlos con mmap) |
| `labels.json` | Las 103 etiquetas (id, nombre en español, grupo), sus vectores en float16, los productos que se confunden a la vista y las variedades de un mismo producto |

**Origen.** Pesos de **OpenCLIP ViT-B/32 entrenado con LAION-2B** (`vit_b_32-laion2b_e16`,
<https://github.com/mlfoundations/open_clip>, licencia MIT). Se convirtieron sin PyTorch con los
scripts de `scripts/ml` (ver su LEEME): el codificador de imágenes se armó en ONNX, se comprobó que da
lo mismo que la versión de referencia en numpy y se cuantizó a int8 (pesos por canal; la proyección
de los parches y el primer bloque, que son los más sensibles, con cálculo en float32). Los vectores
de las etiquetas se calcularon una vez con el codificador de texto de CLIP (tokenizador de OpenAI
CLIP, licencia MIT).

**Para cambiar las etiquetas o los umbrales**: editar `scripts/ml/labels_spec.py`, volver a generar
`labels.json` y revisar `ML_T` en `packages/shared/src/ml.ts` (ver `scripts/ml/LEEME.md`).
