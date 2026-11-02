/*
 * Generador mínimo de PDF (A4, Helvetica con WinAnsiEncoding). Sirve para la constancia de
 * depósito, el estado de cuenta y la copia de la hoja de reclamación, sin librerías externas.
 */
import { qrMatrix } from './media';

const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELVB = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
const SPECIAL: Record<string, number> = { '€': 0x80, '‚': 0x82, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99 };

function toWin(s: string): string {
  let out = '';
  for (const ch of s.replace(/−/g, '-').replace(/→/g, '->').replace(/✓/g, 'v').replace(/★/g, '*')) {
    const c = ch.charCodeAt(0);
    if (c < 128) out += ch;
    else if (SPECIAL[ch] !== undefined) out += String.fromCharCode(SPECIAL[ch]);
    else if (c >= 0xa0 && c <= 0xff) out += ch;
    else out += ch.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?');
  }
  return out;
}

export function textWidth(s: string, size: number, bold = false): number {
  const tbl = bold ? HELVB : HELV;
  let w = 0;
  for (const ch of toWin(s)) {
    const c = ch.charCodeAt(0);
    if (c >= 32 && c <= 126) w += tbl[c - 32];
    else if (c === 0xa0) w += 278;
    else if (c === 0x97) w += 1000;
    else if (c === 0xb7 || c === 0x95) w += 350;
    else { const base = ch.normalize('NFD')[0]; const bc = base.charCodeAt(0); w += bc >= 32 && bc <= 126 ? tbl[bc - 32] : 556; }
  }
  return (w * size) / 1000;
}

const esc = (s: string) => toWin(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const hex = (c: string) => { const m = c.replace('#', ''); return [0, 2, 4].map(i => (parseInt(m.slice(i, i + 2), 16) / 255).toFixed(3)).join(' '); };

export class Pdf {
  private pages: string[] = [];
  private cur = '';
  readonly W = 595.28;
  readonly H = 841.89;
  constructor() { this.addPage(); }
  addPage() { if (this.cur) this.pages.push(this.cur); this.cur = ' '; }
  text(x: number, y: number, s: string, o: { size?: number; bold?: boolean; color?: string; align?: 'left' | 'right' | 'center' } = {}) {
    const size = o.size ?? 10;
    let xx = x;
    if (o.align === 'right') xx = x - textWidth(s, size, o.bold);
    if (o.align === 'center') xx = x - textWidth(s, size, o.bold) / 2;
    this.cur += `BT /${o.bold ? 'F2' : 'F1'} ${size} Tf ${hex(o.color ?? '#222B1F')} rg ${xx.toFixed(2)} ${(this.H - y).toFixed(2)} Td (${esc(s)}) Tj ET\n`;
  }
  /** Texto en varias líneas; devuelve la y siguiente. */
  para(x: number, y: number, s: string, width: number, o: { size?: number; bold?: boolean; color?: string; lead?: number } = {}): number {
    const size = o.size ?? 10, lead = o.lead ?? size * 1.35;
    const words = s.split(/\s+/);
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (textWidth(t, size, o.bold) > width && line) { this.text(x, y, line, o); y += lead; line = w; } else line = t;
    }
    if (line) { this.text(x, y, line, o); y += lead; }
    return y;
  }
  rect(x: number, y: number, w: number, h: number, o: { fill?: string; stroke?: string; lw?: number } = {}) {
    const op = o.fill && o.stroke ? 'B' : o.fill ? 'f' : 'S';
    this.cur += `${o.fill ? hex(o.fill) + ' rg ' : ''}${o.stroke ? hex(o.stroke) + ' RG ' : ''}${o.lw ?? 1} w ${x.toFixed(2)} ${(this.H - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${op}\n`;
  }
  line(x1: number, y1: number, x2: number, y2: number, o: { color?: string; lw?: number } = {}) {
    this.cur += `${hex(o.color ?? '#D5DFD1')} RG ${o.lw ?? 1} w ${x1.toFixed(2)} ${(this.H - y1).toFixed(2)} m ${x2.toFixed(2)} ${(this.H - y2).toFixed(2)} l S\n`;
  }
  qr(x: number, y: number, size: number, data: string) {
    const m = qrMatrix(data);
    const n = m.length, cell = size / (n + 2);
    this.rect(x, y, size, size, { fill: '#FFFFFF' });
    let ops = hex('#1E3F20') + ' rg\n';
    m.forEach((row, r) => row.forEach((on, c) => { if (on) ops += `${(x + (c + 1) * cell).toFixed(2)} ${(this.H - y - (r + 2) * cell).toFixed(2)} ${cell.toFixed(2)} ${cell.toFixed(2)} re\n`; }));
    this.cur += ops + 'f\n';
  }
  bytes(): Uint8Array {
    if (this.cur) { this.pages.push(this.cur); this.cur = ''; }
    const objs: string[] = [];
    const pageIds: number[] = [];
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    let id = 5;
    for (const content of this.pages) {
      const cid = id++, pid = id++;
      objs[cid] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
      objs[pid] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.W} ${this.H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${cid} 0 R >>`;
      pageIds.push(pid);
    }
    objs[2] = `<< /Type /Pages /Kids [${pageIds.map(p => p + ' 0 R').join(' ')}] /Count ${pageIds.length} >>`;
    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const offsets: number[] = [];
    for (let i = 1; i < objs.length; i++) { offsets[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
    const xref = out.length;
    out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objs.length; i++) out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const b = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) b[i] = out.charCodeAt(i) & 0xff;
    return b;
  }
}

export interface DocSpec {
  kicker: string;
  title: string;
  subtitle?: string;
  qr?: string;
  badge?: string;
  rows?: [string, string][];
  table?: { cols: string[]; rows: string[][]; align?: ('left' | 'right')[]; total?: [string, string] };
  notes?: string[];
  footer?: string;
}

/** Documento estándar de Mesagri (encabezado, datos, tabla, notas y pie). */
export function docPdf(d: DocSpec): Uint8Array {
  const p = new Pdf();
  const L = 48, R = p.W - 48;
  p.rect(0, 0, p.W, 92, { fill: '#1E3F20' });
  p.text(L, 40, 'Mesagri', { size: 22, bold: true, color: '#FFFFFF' });
  p.text(L, 60, 'Del campo a tu mesa · demo del MVP', { size: 9, color: '#97BC62' });
  p.text(R, 40, d.kicker.toUpperCase(), { size: 9, bold: true, color: '#E39A5C', align: 'right' });
  p.text(R, 58, d.badge ?? '', { size: 9, color: '#FFFFFF', align: 'right' });
  let y = 130;
  p.text(L, y, d.title, { size: 18, bold: true });
  y += 18;
  if (d.subtitle) { y = p.para(L, y, d.subtitle, d.qr ? 330 : R - L, { size: 10, color: '#5B6B57' }); }
  if (d.qr) { p.qr(R - 110, 110, 110, d.qr); p.text(R - 55, 232, d.qr, { size: 7, color: '#5B6B57', align: 'center' }); y = Math.max(y, 250); }
  y += 10;
  for (const [k, v] of d.rows ?? []) {
    p.line(L, y + 6, R, y + 6);
    p.text(L, y, k, { size: 10, color: '#5B6B57' });
    p.text(R, y, v, { size: 10, bold: true, align: 'right' });
    y += 22;
  }
  if (d.table) {
    y += 14;
    const cols = d.table.cols, n = cols.length, colW = (R - L) / n;
    p.rect(L, y - 13, R - L, 20, { fill: '#E7F0DC' });
    cols.forEach((c, i) => { const al = d.table!.align?.[i] ?? 'left'; p.text(al === 'right' ? L + colW * (i + 1) - 6 : L + colW * i + 6, y, c, { size: 9, bold: true, align: al }); });
    y += 22;
    for (const row of d.table.rows) {
      if (y > p.H - 120) { p.addPage(); y = 60; }
      row.forEach((c, i) => { const al = d.table!.align?.[i] ?? 'left'; p.text(al === 'right' ? L + colW * (i + 1) - 6 : L + colW * i + 6, y, c, { size: 9, align: al }); });
      p.line(L, y + 6, R, y + 6);
      y += 19;
    }
    if (d.table.total) {
      y += 6;
      p.text(L + 6, y, d.table.total[0], { size: 11, bold: true });
      p.text(R - 6, y, d.table.total[1], { size: 11, bold: true, align: 'right' });
      y += 20;
    }
  }
  y += 12;
  for (const n of d.notes ?? []) {
    if (y > p.H - 90) { p.addPage(); y = 60; }
    p.rect(L, y - 9, 3, 11, { fill: '#97BC62' });
    y = p.para(L + 12, y, n, R - L - 12, { size: 9, color: '#5B6B57' }) + 4;
  }
  p.line(L, p.H - 52, R, p.H - 52);
  p.text(L, p.H - 36, d.footer ?? 'Documento generado por la demo del MVP de Mesagri. Datos de ejemplo.', { size: 8, color: '#5B6B57' });
  return p.bytes();
}
