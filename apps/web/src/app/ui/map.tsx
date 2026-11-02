/*
 * Mapa esquemático (no es un mapa real): provincias del piloto, ríos y la ruta del envío.
 * Muestra el avance del transportista sin compartir la ubicación exacta de la chacra (RN-17).
 */
import { DISTRICT_BY_CODE, districtName } from '@mesagri/shared/ubigeo';

type P = { x: number; y: number };
const pt = (code?: string): P => DISTRICT_BY_CODE[code ?? '']?.geo ?? { x: 75, y: 63 };

function waypoints(a: P, b: P): P[] {
  const prov = (p: P) => (p.x < 30 ? 'CAMANA' : p.y < 30 ? 'COLCA' : p.x < 50 ? 'MAJES' : 'AQP');
  const pa = prov(a), pb = prov(b);
  const key = [pa, pb].sort().join('-');
  let mid: P[] = [];
  if (key === 'AQP-CAMANA') mid = [{ x: 27, y: 72 }, { x: 40, y: 64 }, { x: 55, y: 69 }, { x: 66, y: 63 }];
  else if (key === 'AQP-COLCA') mid = [{ x: 64, y: 32 }, { x: 69, y: 46 }];
  else if (key === 'AQP-MAJES') mid = [{ x: 55, y: 66 }, { x: 66, y: 63 }];
  else if (key === 'CAMANA-MAJES') mid = [{ x: 27, y: 72 }];
  if (pa !== 'AQP' && pb === 'AQP') return [a, ...(a.x < b.x ? mid : mid.reverse()), b];
  if (pa === 'AQP' && pb !== 'AQP') return [a, ...mid.slice().reverse(), b];
  return [a, ...mid, b];
}

function along(pts: P[], t: number): P {
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); seg.push(d); total += d; }
  let target = total * Math.max(0, Math.min(1, t));
  for (let i = 0; i < seg.length; i++) {
    if (target <= seg[i]) { const f = seg[i] ? target / seg[i] : 0; return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * f, y: pts[i].y + (pts[i + 1].y - pts[i].y) * f }; }
    target -= seg[i];
  }
  return pts[pts.length - 1];
}

function split(pts: P[], t: number): [P[], P[]] {
  const cut = along(pts, t);
  let total = 0; const seg: number[] = [];
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); seg.push(d); total += d; }
  let acc = 0, idx = 0;
  const target = total * t;
  for (; idx < seg.length; idx++) { if (acc + seg[idx] >= target) break; acc += seg[idx]; }
  return [[...pts.slice(0, idx + 1), cut], [cut, ...pts.slice(idx + 1)]];
}

const line = (ps: P[]) => ps.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');

export function MapSketch({ from, to, progress, km, fromLabel, toLabel, truck = true, height }: { from?: string; to?: string; progress?: number; km?: number; fromLabel?: string; toLabel?: string; truck?: boolean; height?: string }) {
  const a = pt(from), b = pt(to);
  const city = Math.hypot(a.x - b.x, a.y - b.y) < 12;
  const pts = city ? [a, { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 1.2 }, b] : waypoints(a, b);
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = city ? 3 : 7;
  x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
  // relación 2:1
  let w = x1 - x0, hh = y1 - y0;
  if (w / hh < 2) { const nw = hh * 2; x0 -= (nw - w) / 2; w = nw; } else { const nh = w / 2; y0 -= (nh - hh) / 2; hh = nh; }
  const k = w / 100; // escala de trazos
  const t = progress ?? 0;
  const [done, rest] = split(pts, t);
  const pos = along(pts, t);
  return (
    <div className="map" style={height ? { height } : undefined}>
      <svg viewBox={`${x0.toFixed(2)} ${y0.toFixed(2)} ${w.toFixed(2)} ${hh.toFixed(2)}`} role="img" aria-label={`Ruta de ${fromLabel ?? districtName(from)} a ${toLabel ?? districtName(to)}`} preserveAspectRatio="xMidYMid slice">
        <rect x={x0} y={y0} width={w} height={hh} fill="#E3ECD8" />
        {/* océano y costa */}
        <path d="M-10 86 C 5 84, 10 92, 22 96 L 40 110 L -10 110 Z" fill="#CFE3EF" />
        {/* ríos (Camaná-Majes y Colca) */}
        <path d="M14 84 C 22 76, 30 70, 38 62 S 46 44, 50 30 S 56 18, 66 16" fill="none" stroke="#B9D7E8" strokeWidth={1.6 * k} strokeLinecap="round" />
        <path d="M70 70 C 74 66, 76 60, 80 55" fill="none" stroke="#B9D7E8" strokeWidth={1.2 * k} strokeLinecap="round" />
        {/* manchas de cultivo y cerros */}
        {[[22, 74, 5], [38, 58, 6], [60, 22, 5], [72, 58, 3], [50, 40, 4]].map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill="#D3E2C3" />)}
        {[[84, 52], [88, 58], [66, 10], [48, 28]].map(([x, y], i) => <path key={i} d={`M${x - 4} ${y + 3} L${x} ${y - 3} L${x + 4} ${y + 3} Z`} fill="#C9D3BE" />)}
        {city && <g stroke="#FFFFFF" strokeWidth={0.5 * k}>{[59, 61, 63, 65, 67].map(y => <line key={y} x1={68} y1={y} x2={81} y2={y} />)}{[70, 72, 74, 76, 78, 80].map(x => <line key={x} x1={x} y1={57} x2={x} y2={69} />)}</g>}
        {/* ruta */}
        <path d={line(rest)} fill="none" stroke="#C97C3E" strokeWidth={1.3 * k} strokeDasharray={`${2.2 * k} ${1.6 * k}`} strokeLinecap="round" strokeLinejoin="round" />
        <path d={line(done)} fill="none" stroke="#2C5F2D" strokeWidth={1.6 * k} strokeLinecap="round" strokeLinejoin="round" />
        {/* origen y destino */}
        <g transform={`translate(${a.x} ${a.y}) scale(${k})`}><circle r="2.6" fill="#fff" stroke="#2C5F2D" strokeWidth="1.2" /><circle r="1.1" fill="#2C5F2D" /></g>
        <g transform={`translate(${b.x} ${b.y}) scale(${k})`}><path d="M0 0 C -2.6 -3.2, -2.8 -5.6, 0 -6.6 C 2.8 -5.6, 2.6 -3.2, 0 0 Z" fill="#C97C3E" stroke="#fff" strokeWidth=".6" /><circle cy="-4.3" r="1" fill="#fff" /></g>
        {truck && t > 0 && t < 1 && <g transform={`translate(${pos.x} ${pos.y}) scale(${k})`}><circle r="3.2" fill="#1E3F20" /><path d="M-1.8 -0.9 h2.2 v2 h-2.2z M0.4 -0.3 h1.1 l.6 .7 v.8 h-1.7z" fill="#fff" /></g>}
        <g transform={`translate(${a.x} ${a.y + 5.2 * k}) scale(${k})`}><rect x="-9" y="-2.6" width="18" height="4.2" rx="2" fill="#fff" opacity=".92" /><text textAnchor="middle" y=".6" fontSize="2.6" fontWeight="800" fill="#1E3F20" fontFamily="Nunito, sans-serif">{(fromLabel ?? districtName(from)).slice(0, 14)}</text></g>
        <g transform={`translate(${b.x} ${b.y - 9 * k}) scale(${k})`}><rect x="-9" y="-2.6" width="18" height="4.2" rx="2" fill="#fff" opacity=".92" /><text textAnchor="middle" y=".6" fontSize="2.6" fontWeight="800" fill="#1E3F20" fontFamily="Nunito, sans-serif">{(toLabel ?? districtName(to)).slice(0, 14)}</text></g>
        {km !== undefined && <g transform={`translate(${x0 + 3 * k} ${y0 + 3 * k}) scale(${k})`}><rect width="13" height="5" rx="2.5" fill="#2C5F2D" /><text x="6.5" y="3.5" textAnchor="middle" fontSize="2.7" fontWeight="900" fill="#fff" fontFamily="Nunito, sans-serif">{km} km</text></g>}
      </svg>
    </div>
  );
}
