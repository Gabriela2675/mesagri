/*
 * Machine Learning en el navegador, solo en la demo sin internet (en la computadora): el mismo modelo
 * de visión que usa el servidor (CLIP ViT-B/32 int8, models/clip-vit-b32) con ONNX Runtime Web.
 * Los archivos (89 MB) están en ml/ junto a la app y se cargan la primera vez que hacen falta; no van
 * en el APK ni se guardan en el celular. Las decisiones salen de @mesagri/shared/ml, como en el servidor.
 */
import { parseMlModel, toPixels, photoQuality, judgePhoto, dHash, ML_IMAGE_SIZE, type MlModel } from '@mesagri/shared/ml';

const base = () => new URL(import.meta.env.BASE_URL + 'ml/', location.href).href;
let labels: Promise<MlModel> | undefined;
let loading: Promise<{ ort: any; session: any; model: MlModel }> | undefined;
let avail: Promise<boolean> | undefined;

/** ¿Están los archivos del modelo junto a la app? (en el APK no). */
export function mlAvailable(): Promise<boolean> {
  avail ??= fetch(base() + 'labels.json', { method: 'HEAD', cache: 'no-store' }).then(r => r.ok).catch(() => false);
  return avail;
}

/** Solo las etiquetas (para revisar publicaciones sin fotos que analizar, sin cargar el modelo). */
export function mlLabels(): Promise<MlModel> {
  if (!labels) { labels = fetch(base() + 'labels.json').then(r => { if (!r.ok) throw new Error('sin modelo'); return r.json(); }).then(parseMlModel); labels.catch(() => { labels = undefined; }); }
  return labels;
}

export function loadClip() {
  if (!loading) {
    loading = (async () => {
      const ort: any = await import('onnxruntime-web/wasm');
      ort.env.wasm.wasmPaths = base();
      // sin «aislamiento de origen» el navegador no da hilos: un hilo
      ort.env.wasm.numThreads = 1;
      const [model, onnx] = await Promise.all([mlLabels(), fetch(base() + 'vision.onnx').then(r => { if (!r.ok) throw new Error('sin modelo'); return r.arrayBuffer(); })]);
      const session = await ort.InferenceSession.create(new Uint8Array(onnx), {
        executionProviders: ['wasm'], graphOptimizationLevel: 'all',
        externalData: [{ path: 'vision-1.bin', data: base() + 'vision-1.bin' }, { path: 'vision-2.bin', data: base() + 'vision-2.bin' }],
      });
      return { ort, session, model };
    })();
    loading.catch(() => { loading = undefined; });
  }
  return loading;
}

/** Foto (data URL o enlace) → 224×224: lado corto a 224 y recorte al centro, como en el servidor. */
async function prepare(src: string): Promise<{ px: Float32Array; light: number; sharp: number; hash: string }> {
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const S = ML_IMAGE_SIZE;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  const w = img.naturalWidth, h = img.naturalHeight, s = Math.min(w, h);
  g.drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, S, S);
  const d = g.getImageData(0, 0, S, S).data;
  // huella: la foto entera en gris de 9×8
  const hc = document.createElement('canvas');
  hc.width = 9; hc.height = 8;
  const hg = hc.getContext('2d', { willReadFrequently: true })!;
  hg.imageSmoothingEnabled = true;
  hg.imageSmoothingQuality = 'high';
  hg.drawImage(img, 0, 0, 9, 8);
  const hd = hg.getImageData(0, 0, 9, 8).data;
  const gray = Array.from({ length: 72 }, (_, i) => 0.299 * hd[i * 4] + 0.587 * hd[i * 4 + 1] + 0.114 * hd[i * 4 + 2]);
  return { px: toPixels(d, 4), ...photoQuality(d, 4), hash: dHash(gray) };
}

/** Vector de cada foto (o nada, si no se pudo leer), con su luz y nitidez. */
export async function embedPhotos(srcs: string[]): Promise<({ emb: Float32Array; light: number; sharp: number; hash: string } | undefined)[]> {
  const { ort, session } = await loadClip();
  const out: ({ emb: Float32Array; light: number; sharp: number; hash: string } | undefined)[] = [];
  for (const src of srcs) {
    try {
      const p = await prepare(src);
      const r = await session.run({ pixels: new ort.Tensor('float32', p.px, [1, 3, ML_IMAGE_SIZE, ML_IMAGE_SIZE]) });
      out.push({ emb: (r.embedding.data as Float32Array).slice(), light: p.light, sharp: p.sharp, hash: p.hash });
    } catch { out.push(undefined); }
  }
  return out;
}

/** Prueba con una foto suelta: qué ve el modelo y si muestra el producto (como POST /review/ml/try). */
export async function tryPhotoLocal(src: string, productId: string) {
  const { model } = await loadClip();
  const [e] = await embedPhotos([src]);
  if (!e) throw new Error('No pudimos leer esa foto.');
  const j = judgePhoto(model, e.emb, productId);
  return { match: j.match, declared: j.declared, sees: j.sees, white: Math.round(j.white * 100), light: e.light, sharp: e.sharp };
}
