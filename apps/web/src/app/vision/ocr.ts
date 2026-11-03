/*
 * Lector de texto para el panel (Tesseract en el navegador, se carga solo al revisar un expediente):
 * - readMrz: el código de 3 líneas del reverso del DNI (número, nombres, nacimiento, vencimiento),
 *   validado con sus dígitos de control. Prueba varias versiones de la foto (la parte de abajo, toda,
 *   con más contraste, al revés) hasta que los dígitos cuadren.
 * - findNumber: si el número del DNI se lee en el frente.
 * Solo está en la versión con servidor (pesa unos 7 MB); en la versión sin internet no hay lector.
 */
import { parseMrz, type MrzRead } from '@mesagri/shared/identity';

type Worker = import('tesseract.js').Worker;
let worker: Promise<Worker> | undefined;

/** ¿El navegador tiene WebAssembly con SIMD? (las computadoras de los últimos años, sí) */
function simd(): boolean {
  try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); } catch { return false; }
}

export function ocrWorker(): Promise<Worker> {
  if (!worker) {
    worker = (async () => {
      const T = await import('tesseract.js');
      const root = new URL(import.meta.env.BASE_URL + 'ocr/', location.href).href;
      return T.createWorker('eng', 1, { workerPath: root + 'worker.min.js', corePath: root + (simd() ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js'), langPath: root.replace(/\/$/, ''), gzip: true, workerBlobURL: false, logger: () => undefined, errorHandler: () => undefined });
    })();
    worker.catch(() => { worker = undefined; });
  }
  return worker;
}

/** Una versión de la foto lista para leer: recorte, escala, gris con contraste y, si hace falta, al revés. */
function prepare(img: HTMLImageElement | HTMLCanvasElement, opts: { part: 'bottom' | 'all'; flip?: boolean; binarize?: boolean }): HTMLCanvasElement {
  const W = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const H = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
  const sy = opts.part === 'bottom' ? Math.round(H * (opts.flip ? 0 : 0.45)) : 0;
  const sh = opts.part === 'bottom' ? Math.round(H * 0.55) : H;
  const scale = Math.min(2.2, 1600 / W);
  const c = document.createElement('canvas');
  c.width = Math.round(W * scale); c.height = Math.round(sh * scale);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  if (opts.flip) { g.translate(c.width, c.height); g.rotate(Math.PI); }
  g.drawImage(img, 0, sy, W, sh, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height);
  const px = d.data;
  // gris y estirar el contraste (2 % más oscuro → negro, 2 % más claro → blanco)
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) { const v = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000 | 0; px[i] = v; hist[v]++; }
  const total = px.length / 4;
  let lo = 0, hi = 255, acc = 0;
  for (; lo < 255; lo++) { acc += hist[lo]; if (acc > total * 0.02) break; }
  acc = 0;
  for (; hi > 0; hi--) { acc += hist[hi]; if (acc > total * 0.02) break; }
  const span = Math.max(1, hi - lo);
  // umbral de Otsu para la versión en blanco y negro
  let thr = 128;
  if (opts.binarize) {
    let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sumB = 0, wB = 0, best = -1;
    for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = total - wB; if (!wF) break; sumB += t * hist[t]; const mB = sumB / wB, mF = (sum - sumB) / wF; const between = wB * wF * (mB - mF) ** 2; if (between > best) { best = between; thr = t; } }
  }
  for (let i = 0; i < px.length; i += 4) {
    let v = Math.max(0, Math.min(255, ((px[i] - lo) * 255) / span));
    if (opts.binarize) v = px[i] > thr ? 255 : 0;
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  g.putImageData(d, 0, 0);
  return c;
}

const score = (r: MrzRead | null) => (!r ? -1 : (r.ok ? 10 : 0) + [r.docOk, r.birthOk, r.expiryOk, r.compositeOk].filter(Boolean).length);

/** Lee el código del reverso del DNI. Devuelve la mejor lectura (ok = todos los dígitos de control cuadran). */
export async function readMrz(img: HTMLImageElement | HTMLCanvasElement): Promise<MrzRead | null> {
  const w = await ocrWorker();
  await w.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<', tessedit_pageseg_mode: '6' as any, preserve_interword_spaces: '0', user_defined_dpi: '300' });
  let best: MrzRead | null = null;
  const tries: Parameters<typeof prepare>[1][] = [{ part: 'bottom' }, { part: 'bottom', binarize: true }, { part: 'all' }, { part: 'bottom', flip: true }, { part: 'all', binarize: true }];
  for (const t of tries) {
    const { data } = await w.recognize(prepare(img, t));
    const r = parseMrz(data.text);
    if (score(r) > score(best)) best = r;
    if (best?.ok) break;
  }
  return best;
}

/** ¿Se lee el número del DNI en la foto del frente? (perdona letras que parecen números) */
export async function findNumber(img: HTMLImageElement | HTMLCanvasElement, dni: string): Promise<boolean> {
  const w = await ocrWorker();
  await w.setParameters({ tessedit_char_whitelist: '0123456789-OoIlSB', tessedit_pageseg_mode: '11' as any, user_defined_dpi: '300' });
  for (const t of [{ part: 'all' as const }, { part: 'all' as const, binarize: true }]) {
    const { data } = await w.recognize(prepare(img, t));
    const digits = data.text.replace(/[Oo]/g, '0').replace(/[Il]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/[^\d\n]/g, '');
    if (digits.includes(dni)) return true;
  }
  return false;
}
