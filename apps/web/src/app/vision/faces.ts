/*
 * Visión por computadora (face-api con TensorFlow en el navegador). Se carga solo cuando hace falta:
 * al tomar las fotos del rostro (detector y 68 puntos de la cara, unos 550 KB de modelos) o, en el
 * panel, al comparar el rostro con la foto del DNI (más modelos, solo en la versión con servidor).
 *
 * - analyzeFace: cuántas caras hay, cuánto giró la cabeza (grados), la luz y la nitidez de la cara.
 * - judgeFace: si la foto sirve para el ángulo pedido y, si no, qué decirle a la persona.
 * - faceDescriptor / faceDistance: huella del rostro para el parecido con la foto del DNI.
 */
import { FACE_ANGLES } from '@mesagri/shared/identity';
import type { FacePose } from '@mesagri/shared/types';

type FaceApi = typeof import('@vladmandic/face-api');
type Src = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;

const modelsUrl = () => new URL(import.meta.env.BASE_URL + 'vision', location.href).href;
let basic: Promise<FaceApi> | undefined;
let full: Promise<FaceApi> | undefined;

/** face-api con el detector y los puntos de la cara (lo que usa el celular). */
export function faceApi(): Promise<FaceApi> {
  if (!basic) {
    basic = (async () => {
      const f = await import('@vladmandic/face-api');
      // WebGL (rápido en el celular); si el navegador no lo tiene, el procesador
      const tf = f.tf as any;
      if (!(await tf.setBackend?.('webgl').catch(() => false))) await tf.setBackend?.('cpu');
      await tf.ready?.();
      await Promise.all([f.nets.tinyFaceDetector.loadFromUri(modelsUrl()), f.nets.faceLandmark68Net.loadFromUri(modelsUrl())]);
      return f;
    })();
    basic.catch(() => { basic = undefined; });
  }
  return basic;
}
/** Además, el detector fino y la huella del rostro (lo que usa el panel). */
export function faceApiFull(): Promise<FaceApi> {
  if (!full) {
    full = (async () => {
      const f = await faceApi();
      await Promise.all([f.nets.ssdMobilenetv1.loadFromUri(modelsUrl()), f.nets.faceRecognitionNet.loadFromUri(modelsUrl())]);
      return f;
    })();
    full.catch(() => { full = undefined; });
  }
  return full;
}

export interface FaceInfo {
  faces: number;
  /** grados: positivo si la nariz va hacia la derecha de la imagen (la persona giró a SU izquierda) */
  yaw?: number;
  score?: number;
  /** alto de la cara / alto de la imagen */
  size?: number;
  /** luz promedio de la cara (0 a 255) */
  light?: number;
  /** nitidez de la cara (varianza del laplaciano; menos de ~18 es una foto movida) */
  sharp?: number;
}

const dims = (s: Src) => (s instanceof HTMLVideoElement ? { w: s.videoWidth, h: s.videoHeight } : s instanceof HTMLImageElement ? { w: s.naturalWidth, h: s.naturalHeight } : { w: s.width, h: s.height });

/** Luz promedio y nitidez (varianza del laplaciano) de una zona de la imagen, reducida a W × H. */
function lapStats(src: Src, sx: number, sy: number, sw: number, sh: number, W: number, H: number): { light?: number; sharp?: number } {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return {};
  g.drawImage(src, sx, sy, sw, sh, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data;
  const L = new Float32Array(W * H);
  let sum = 0;
  for (let i = 0; i < W * H; i++) { const v = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; L[i] = v; sum += v; }
  let m = 0, m2 = 0, n = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    const lap = L[i - W] + L[i + W] + L[i - 1] + L[i + 1] - 4 * L[i];
    m += lap; m2 += lap * lap; n++;
  }
  const mean = m / Math.max(1, n);
  return { light: Math.round(sum / (W * H)), sharp: Math.round((m2 / Math.max(1, n) - mean * mean) * 10) / 10 };
}
/** Luz y nitidez de la cara (en un recorte de 96 × 96). */
const quality = (src: Src, box: { x: number; y: number; width: number; height: number }) => lapStats(src, box.x, box.y, box.width, box.height, 96, 96);
/** Luz y nitidez de la foto de un documento (en una versión de 360 px de ancho). */
export function docQuality(src: Src): { light?: number; sharp?: number } {
  const { w, h } = dims(src);
  if (!w || !h) return {};
  return lapStats(src, 0, 0, w, h, 360, Math.max(1, Math.round((h * 360) / w)));
}

/** Caras en la imagen y, de la más grande, el giro, la luz y la nitidez. */
export async function analyzeFace(src: Src, opts: { inputSize?: number } = {}): Promise<FaceInfo> {
  const f = await faceApi();
  const { h } = dims(src);
  if (!h) return { faces: 0 };
  const list = await f.detectAllFaces(src, new f.TinyFaceDetectorOptions({ inputSize: opts.inputSize ?? 320, scoreThreshold: 0.45 })).withFaceLandmarks();
  if (!list.length) return { faces: 0 };
  const big = list.reduce((a, b) => (b.detection.box.height > a.detection.box.height ? b : a));
  // una cara de fondo muy chica no cuenta; otra cara grande (alguien al lado, una foto) sí
  const faces = list.filter(x => x.detection.box.height >= big.detection.box.height * 0.5).length;
  const p = big.landmarks.positions;
  const jl = p[0], jr = p[16], nose = p[30];
  const span = jr.x - jl.x;
  const ratio = span > 0 ? ((nose.x - jl.x) - (jr.x - nose.x)) / span : 0;
  const yaw = Math.round(Math.asin(Math.max(-1, Math.min(1, ratio / 1.25))) * 180 / Math.PI);
  return { faces, yaw, score: Math.round(big.detection.score * 100) / 100, size: Math.round((big.detection.box.height / h) * 100) / 100, ...quality(src, big.detection.box) };
}

const SIDE: Record<FacePose, string> = { FRONT: '', RIGHT: 'tu derecha', LEFT: 'tu izquierda' };
/** ¿Sirve para el ángulo pedido? Si no, la indicación para la persona. knownSide: imagen sin espejo (cámara en vivo). */
export function judgeFace(info: FaceInfo, pose: FacePose, knownSide: boolean, minSize = 0.15): { ok: boolean; hint: string } {
  if (!info.faces) return { ok: false, hint: 'No vemos tu cara: ponla dentro del óvalo.' };
  if (info.faces > 1) return { ok: false, hint: 'Hay más de una cara: que salgas solo tú.' };
  if ((info.size ?? 0) < minSize) return { ok: false, hint: 'Acércate un poco a la cámara.' };
  if ((info.light ?? 128) < 55) return { ok: false, hint: 'Hay poca luz: busca un lugar más claro.' };
  if ((info.light ?? 128) > 228) return { ok: false, hint: 'Hay demasiada luz: no te pongas contra el sol.' };
  if ((info.sharp ?? 99) < 18) return { ok: false, hint: 'Salió movida: quédate quieto un momento.' };
  const y = info.yaw ?? 0, a = Math.abs(y);
  if (pose === 'FRONT') return a <= FACE_ANGLES.frontMax ? { ok: true, hint: '' } : { ok: false, hint: 'Mira de frente a la cámara.' };
  if (a > FACE_ANGLES.turnMax) return { ok: false, hint: 'Giraste demasiado: vuelve un poco.' };
  if (knownSide && a >= 8 && (pose === 'LEFT' ? y < 0 : y > 0)) return { ok: false, hint: `Al otro lado: gira hacia ${SIDE[pose]}.` };
  if (a < FACE_ANGLES.turnMin) return { ok: false, hint: `Gira un poco más la cabeza hacia ${SIDE[pose]}.` };
  return { ok: true, hint: '' };
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => rej(new Error('No se pudo abrir la foto')); i.src = src; });
}

/** Huella del rostro más grande (con el detector fino: sirve para la foto chica del DNI). */
export async function faceDescriptor(src: Src): Promise<Float32Array | undefined> {
  const f = await faceApiFull();
  const r = await f.detectAllFaces(src, new f.SsdMobilenetv1Options({ minConfidence: 0.35 })).withFaceLandmarks().withFaceDescriptors();
  if (!r.length) return undefined;
  return r.reduce((a, b) => (b.detection.box.height > a.detection.box.height ? b : a)).descriptor;
}
export function faceDistance(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.round(Math.sqrt(s) * 1000) / 1000;
}
