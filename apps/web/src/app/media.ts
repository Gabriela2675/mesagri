/*
 * Fotos (compresión a 300 KB como pide RNF-23), fotos de ejemplo para la demo,
 * QR (qrcode-generator, licencia MIT) y voz (Web Speech API, si el navegador la da).
 */
import qrcode from 'qrcode-generator';
import { PRODUCTS } from '@mesagri/shared/catalog';

/* ---------- Fotos ---------- */
export async function compressImage(file: Blob, maxSide = 1024, maxBytes = 300_000): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0, w, h);
    let q = 0.82, out = c.toDataURL('image/jpeg', q);
    while (out.length * 0.75 > maxBytes && q > 0.3) { q -= 0.12; out = c.toDataURL('image/jpeg', q); }
    return out;
  } finally { URL.revokeObjectURL(url); }
}

const PALETTE = { forest: '#1E3F20', field: '#2C5F2D', leaf: '#97BC62', terra: '#C97C3E', mint: '#E7F0DC', paper: '#F4F7EE', ink: '#222B1F' };

/** Foto de ejemplo dibujada en la app (para probar sin cámara). Lleva la marca «EJEMPLO · DEMO». */
export function samplePhoto(kind: string, opts: { label?: string; color?: string; letter?: string; stamp?: string; value?: string } = {}): string {
  const W = 480, H = 360;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  if (!g) return '';
  const color = opts.color ?? PALETTE.field;
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#dfe9d2'); grad.addColorStop(1, '#c4d6b0');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  g.lineCap = 'round'; g.lineJoin = 'round';
  const text = (s: string, x: number, y: number, size: number, col = PALETTE.ink, weight = '700', align: CanvasTextAlign = 'center') => {
    g.fillStyle = col; g.font = `${weight} ${size}px Nunito, system-ui, sans-serif`; g.textAlign = align; g.fillText(s, x, y);
  };
  const sack = (x: number, y: number, s = 1, fill = '#d8c39a') => {
    g.save(); g.translate(x, y); g.scale(s, s);
    g.fillStyle = fill; g.strokeStyle = '#8a6a3a'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(-34, -40); g.quadraticCurveTo(0, -52, 34, -40); g.lineTo(40, 36); g.quadraticCurveTo(0, 48, -40, 36); g.closePath(); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(-20, -44); g.lineTo(20, -44); g.stroke();
    g.restore();
  };
  switch (kind) {
    case 'producto': {
      g.fillStyle = '#7a5a33'; g.beginPath(); g.ellipse(W / 2, H * 0.72, 190, 60, 0, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 14; i++) {
        const x = W / 2 - 150 + (i % 7) * 50 + (i > 6 ? 25 : 0), y = H * 0.62 - (i > 6 ? 38 : 0);
        g.fillStyle = color; g.beginPath(); g.ellipse(x, y, 30, 24, (i % 3) * 0.4, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.ellipse(x - 8, y - 8, 9, 6, 0, 0, Math.PI * 2); g.fill();
      }
      break;
    }
    case 'chacra': {
      g.fillStyle = '#9cc4e4'; g.fillRect(0, 0, W, H * 0.38);
      g.fillStyle = '#7d8f72'; g.beginPath(); g.moveTo(0, H * 0.4); g.lineTo(120, 70); g.lineTo(230, H * 0.38); g.lineTo(330, 60); g.lineTo(W, H * 0.4); g.fill();
      for (let r = 0; r < 7; r++) { g.fillStyle = r % 2 ? '#4f7a26' : '#6e9a3a'; g.beginPath(); g.moveTo(0, H * 0.4 + r * 32); g.lineTo(W, H * 0.4 + r * 26); g.lineTo(W, H * 0.4 + r * 26 + 22); g.lineTo(0, H * 0.4 + r * 32 + 26); g.fill(); }
      break;
    }
    case 'sacos': case 'carga': {
      g.fillStyle = '#b9a98e'; g.fillRect(0, H * 0.7, W, H * 0.3);
      for (let i = 0; i < 4; i++) sack(110 + i * 88, H * 0.6, 1);
      for (let i = 0; i < 3; i++) sack(154 + i * 88, H * 0.38, 0.92, '#cdb68a');
      break;
    }
    case 'balanza': {
      g.fillStyle = '#9aa39a'; g.fillRect(90, 230, 300, 40);
      g.fillStyle = '#5b6b57'; g.fillRect(200, 140, 80, 90);
      g.fillStyle = '#10261a'; g.fillRect(120, 70, 240, 80); g.strokeStyle = '#c9d6c0'; g.lineWidth = 4; g.strokeRect(120, 70, 240, 80);
      text(opts.value ?? '40,2 kg', 240, 126, 44, '#9df29a', '800');
      sack(240, 200, 0.6);
      break;
    }
    case 'dni': case 'licencia': {
      g.fillStyle = '#f7f7f2'; roundRect(g, 60, 60, 360, 230, 18); g.fill(); g.strokeStyle = '#8fa48a'; g.lineWidth = 3; g.stroke();
      g.fillStyle = '#c9d6c0'; roundRect(g, 84, 104, 110, 140, 10); g.fill();
      g.fillStyle = '#8fa48a'; g.beginPath(); g.arc(139, 156, 30, 0, Math.PI * 2); g.fill(); g.beginPath(); g.ellipse(139, 230, 46, 30, 0, Math.PI, 0); g.fill();
      text(kind === 'dni' ? 'DOCUMENTO DE IDENTIDAD' : 'LICENCIA DE CONDUCIR', 300, 98, 16, PALETTE.ink, '800');
      for (let i = 0; i < 5; i++) { g.fillStyle = '#c9d0c4'; g.fillRect(214, 126 + i * 26, 170 - (i % 2) * 40, 12); }
      break;
    }
    case 'selfie': {
      g.fillStyle = '#e8d9c4'; g.beginPath(); g.ellipse(W / 2, 160, 70, 86, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#3d2c22'; g.beginPath(); g.ellipse(W / 2, 110, 76, 50, 0, Math.PI, 0); g.fill();
      g.fillStyle = color; g.beginPath(); g.ellipse(W / 2, 360, 150, 110, 0, Math.PI, 0); g.fill();
      g.fillStyle = PALETTE.ink; g.beginPath(); g.arc(W / 2 - 25, 160, 6, 0, 7); g.arc(W / 2 + 25, 160, 6, 0, 7); g.fill();
      g.strokeStyle = PALETTE.ink; g.lineWidth = 4; g.beginPath(); g.arc(W / 2, 190, 22, 0.2, Math.PI - 0.2); g.stroke();
      break;
    }
    case 'local': case 'vehiculo': {
      g.fillStyle = '#9cc4e4'; g.fillRect(0, 0, W, H * 0.5);
      if (kind === 'local') {
        g.fillStyle = '#e7dcc6'; g.fillRect(80, 90, 320, 200); g.fillStyle = color; g.fillRect(70, 70, 340, 40);
        g.fillStyle = '#5b4632'; g.fillRect(200, 180, 80, 110); g.fillStyle = '#bcd3e6'; g.fillRect(105, 150, 70, 60); g.fillRect(305, 150, 70, 60);
      } else {
        g.fillStyle = '#7b8a90'; g.fillRect(0, H * 0.72, W, H * 0.28);
        g.fillStyle = color; roundRect(g, 70, 120, 250, 140, 10); g.fill(); g.fillStyle = '#e9efe4'; roundRect(g, 320, 160, 100, 100, 12); g.fill();
        g.fillStyle = '#bcd3e6'; g.fillRect(340, 172, 64, 40);
        g.fillStyle = '#222'; for (const x of [130, 260, 370]) { g.beginPath(); g.arc(x, 268, 26, 0, 7); g.fill(); }
        g.fillStyle = '#f6e27a'; g.fillRect(186, 222, 70, 22); text(opts.value ?? 'V7K-812', 221, 239, 15, '#222', '800');
      }
      break;
    }
    case 'pago': {
      g.fillStyle = '#ffffff'; roundRect(g, 110, 30, 260, 300, 22); g.fill(); g.strokeStyle = '#c9d6c0'; g.lineWidth = 3; g.stroke();
      g.fillStyle = PALETTE.mint; g.beginPath(); g.arc(240, 90, 30, 0, 7); g.fill();
      g.strokeStyle = PALETTE.field; g.lineWidth = 6; g.beginPath(); g.moveTo(226, 90); g.lineTo(236, 100); g.lineTo(256, 80); g.stroke();
      text('Captura de tu pago', 240, 152, 18, PALETTE.ink, '800');
      text(opts.value ?? 'S/ 0,00', 240, 196, 30, PALETTE.ink, '800');
      text(opts.label ?? '', 240, 230, 14, '#5B6B57', '600');
      text('N.º de operación', 240, 266, 13, '#5B6B57', '600');
      text(opts.stamp ?? '', 240, 290, 16, PALETTE.ink, '800');
      break;
    }
    default: {
      g.fillStyle = color; g.beginPath(); g.arc(W / 2, H / 2 - 10, 70, 0, 7); g.fill();
      if (opts.letter) text(opts.letter, W / 2, H / 2 + 14, 70, '#fff', '900');
    }
  }
  // marca de agua de la demo y datos de la foto (RN-22: fecha y lugar)
  g.fillStyle = 'rgba(30,63,32,.82)'; g.fillRect(0, H - 34, W, 34);
  text(opts.stamp && kind !== 'pago' ? opts.stamp : (opts.label ?? 'Foto tomada en la app'), 14, H - 12, 13, '#fff', '700', 'left');
  text('EJEMPLO · DEMO', W - 14, H - 12, 12, '#97BC62', '800', 'right');
  return c.toDataURL('image/jpeg', 0.78);
}

/** Fotos de las publicaciones sembradas en la demo (seed-photo-<producto>): se dibujan una vez y se guardan en memoria. */
const seedCache = new Map<string, string>();
export function seedPhoto(id?: string): string | undefined {
  if (!id || !id.startsWith('seed-photo-')) return undefined;
  if (seedCache.has(id)) return seedCache.get(id);
  const p = PRODUCTS.find(x => x.id === id.slice('seed-photo-'.length));
  let v = '';
  try { v = samplePhoto('producto', { color: p?.color, label: p ? `${p.name} · foto del agricultor` : 'Foto del agricultor' }); } catch { v = ''; }
  if (v) seedCache.set(id, v);
  return v || undefined;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/* ---------- QR ---------- */
export function qrMatrix(text: string): boolean[][] {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  const m: boolean[][] = [];
  for (let r = 0; r < n; r++) { const row: boolean[] = []; for (let c = 0; c < n; c++) row.push(q.isDark(r, c)); m.push(row); }
  return m;
}

export function qrPath(text: string): { d: string; n: number } {
  const m = qrMatrix(text);
  let d = '';
  m.forEach((row, r) => row.forEach((on, c) => { if (on) d += `M${c} ${r}h1v1h-1z`; }));
  return { d, n: m.length };
}

/* ---------- Voz ---------- */
let voices: SpeechSynthesisVoice[] = [];
try {
  const s = (globalThis as any).speechSynthesis as SpeechSynthesis | undefined;
  if (s) { voices = s.getVoices(); s.onvoiceschanged = () => { voices = s.getVoices(); }; }
} catch { /* sin síntesis */ }

/** En el APK de Android la voz la pone el celular (texto a voz y dictado de Google). */
interface AndroidVoice { speak?(text: string): void; stopSpeaking?(): void; canSpeak?(): boolean; listen?(): void; stopListening?(): void }
const androidVoice = (): AndroidVoice | undefined => { try { return (globalThis as any).MesagriAndroid; } catch { return undefined; } };

function spokenText(text: string): string {
  return text
      .replace(/S\/\s?(\d[\d\s ]*(?:,\d+)?)/g, (_m, n: string) => `${n.replace(/[\s ]/g, '')} soles`)
      .replace(/(\d+),(\d+)/g, '$1 con $2')
      .replace(/\bkg\b/g, 'kilos').replace(/·/g, ',');
}

export function canSpeak(): boolean {
  try {
    if ((globalThis as any).speechSynthesis && typeof SpeechSynthesisUtterance !== 'undefined') return true;
    return !!androidVoice()?.canSpeak?.();
  } catch { return false; }
}

export function speak(text: string, onEnd?: () => void): boolean {
  try {
    const s = (globalThis as any).speechSynthesis as SpeechSynthesis;
    if (!s) {
      const a = androidVoice();
      if (!a?.speak) return false;
      (globalThis as any).__mesagriSpoken = () => { (globalThis as any).__mesagriSpoken = undefined; onEnd?.(); };
      a.speak(spokenText(text));
      return true;
    }
    s.cancel();
    const u = new SpeechSynthesisUtterance(spokenText(text));
    const v = voices.find(v => /es[-_]PE/i.test(v.lang)) ?? voices.find(v => /es[-_](419|US|MX|CO|AR|CL)/i.test(v.lang)) ?? voices.find(v => /^es/i.test(v.lang));
    if (v) u.voice = v;
    u.lang = v?.lang ?? 'es-PE';
    u.rate = 0.95;
    u.onend = () => onEnd?.();
    u.onerror = () => onEnd?.();
    s.speak(u);
    return true;
  } catch { return false; }
}
export function stopSpeaking() { try { (globalThis as any).speechSynthesis?.cancel(); androidVoice()?.stopSpeaking?.(); } catch { /* */ } }

export function canListen(): boolean {
  try { return !!((globalThis as any).SpeechRecognition || (globalThis as any).webkitSpeechRecognition || androidVoice()?.listen); } catch { return false; }
}

/** Escucha una frase. Rechaza con un mensaje en palabras simples si no hay micrófono o permiso. */
export function listen(onPartial?: (t: string) => void): { done: Promise<string>; stop: () => void } {
  const Rec = (globalThis as any).SpeechRecognition || (globalThis as any).webkitSpeechRecognition;
  const av = androidVoice();
  if (!Rec && av?.listen) {
    // APK: pide el permiso del micrófono y escucha dentro de la app (o abre el dictado de Google)
    const g = globalThis as any;
    const done = new Promise<string>((resolve, reject) => {
      g.__mesagriPartial = (t: string) => { if (t && t.trim()) onPartial?.(t.trim()); };
      g.__mesagriHeard = (text: string | null, err: string | null) => {
        g.__mesagriHeard = undefined;
        g.__mesagriPartial = undefined;
        if (text && text.trim()) { onPartial?.(text.trim()); resolve(text.trim()); } else reject(new Error(err || 'No te escuchamos. Intenta otra vez, más cerca del celular.'));
      };
    });
    try { av.listen(); } catch { /* sin dictado */ }
    return { done, stop: () => { try { av.stopListening?.(); } catch { /* sin dictado */ } } };
  }
  if (!Rec) return { done: Promise.reject(new Error('Este navegador no reconoce la voz. Escribe la frase o elige una de ejemplo.')), stop: () => {} };
  const r = new Rec();
  r.lang = 'es-PE';
  r.interimResults = true;
  r.maxAlternatives = 1;
  r.continuous = false;
  let finalText = '';
  const done = new Promise<string>((resolve, reject) => {
    r.onresult = (ev: any) => {
      let t = '';
      for (let i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript;
      finalText = t;
      onPartial?.(t);
    };
    r.onerror = (ev: any) => {
      const code = ev?.error;
      reject(new Error(code === 'not-allowed' || code === 'service-not-allowed' ? 'No hay permiso para usar el micrófono aquí. Escribe la frase o elige una de ejemplo.' : code === 'no-speech' ? 'No te escuchamos. Intenta otra vez, más cerca del celular.' : 'No pudimos usar el micrófono. Escribe la frase o elige una de ejemplo.'));
    };
    r.onend = () => { finalText.trim() ? resolve(finalText.trim()) : reject(new Error('No te escuchamos. Intenta otra vez, más cerca del celular.')); };
  });
  try { r.start(); } catch { /* ya iniciado */ }
  return { done, stop: () => { try { r.stop(); } catch { /* */ } } };
}

/* ---------- Leer un código QR de una foto (T-12) ---------- */
/**
 * Lee el QR de una foto tomada con la cámara del celular. Usa el lector del navegador si existe
 * (BarcodeDetector, Chrome en Android) y si no, jsQR. Funciona sin HTTPS porque no abre la cámara
 * en vivo: la foto la toma la app de cámara del celular.
 */
export async function readQrFromFile(file: File): Promise<string | undefined> {
  const bmp = await loadBitmap(file);
  if (!bmp) return undefined;
  try {
    const BD = (globalThis as any).BarcodeDetector;
    if (BD) {
      const det = new BD({ formats: ['qr_code'] });
      const found = await det.detect(bmp.source);
      if (found?.[0]?.rawValue) return String(found[0].rawValue);
    }
  } catch { /* sin lector del navegador */ }
  const { default: jsQR } = await import('jsqr');
  for (const max of [1200, 800, 1600]) {
    const scale = Math.min(1, max / Math.max(bmp.w, bmp.h));
    const w = Math.max(1, Math.round(bmp.w * scale)), h = Math.max(1, Math.round(bmp.h * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D | null;
    if (!g) return undefined;
    g.drawImage(bmp.source as any, 0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    const r = jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' });
    if (r?.data) return r.data;
  }
  return undefined;
}

async function loadBitmap(file: File): Promise<{ source: CanvasImageSource; w: number; h: number } | undefined> {
  try {
    if ((globalThis as any).createImageBitmap) {
      const b = await createImageBitmap(file);
      return { source: b, w: b.width, h: b.height };
    }
  } catch { /* formato que no lee */ }
  return await new Promise(res => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { res({ source: im, w: im.naturalWidth, h: im.naturalHeight }); URL.revokeObjectURL(url); };
    im.onerror = () => { res(undefined); URL.revokeObjectURL(url); };
    im.src = url;
  });
}
