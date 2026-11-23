/*
 * ¿Dónde está la chacra? Buscador como el de un mapa: mientras la persona escribe salen los lugares
 * que coinciden (los 4 727 centros poblados y los 109 distritos del INEI, sin internet, y con
 * internet también direcciones), el GPS del celular, un mapa del distrito con el punto y el enlace
 * para verlo en Google Maps. Lo que se elige existe: viene del registro del INEI, del GPS o del
 * buscador de direcciones, y el servidor comprueba que el punto esté dentro del distrito.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PlacePin } from '@mesagri/shared/types';
import { DISTRICT_BY_CODE, PROVINCES, districtChoices, mapsLink, inBox } from '@mesagri/shared/ubigeo';
import { searchPlaces, locatePoint, placeSub, nearestPlaces, type PlaceData, type Place } from '@mesagri/shared/places';
import { Icon, Field, Inp, Btn, Sel, ICirc, Note } from './kit';
import { api } from '../net';
import { LOCAL } from '../routes';
import { openExternal } from '../platform';

/* ---------- datos (se cargan una vez, al abrir el buscador) ---------- */

let loading: Promise<PlaceData> | undefined;
export function loadPlaces(): Promise<PlaceData> {
  return (loading ??= import('@mesagri/shared/places-data').then(m => m.placeData()).catch(e => { loading = undefined; throw e; }));
}
export function usePlaces(): PlaceData | undefined {
  const [d, setD] = useState<PlaceData>();
  useEffect(() => {
    let on = true;
    loadPlaces().then(x => { if (on) setD(x); }).catch(() => undefined);
    return () => { on = false; };
  }, []);
  return d;
}

export interface PlaceValue { district: string; pin?: PlacePin }
/** Dirección encontrada por internet (mismo formato que GET /places/search). */
interface GeoHit { label: string; sub: string; lat: number; lng: number; district?: string; candidates: string[]; ambiguous: boolean }

const km = (n: number) => (n < 1 ? `${Math.round(n * 1000 / 10) * 10} m` : `${n.toFixed(1).replace('.', ',')} km`);
const distLine = (code: string) => { const d = DISTRICT_BY_CODE[code]; return d ? `${d.name} · ${PROVINCES[d.province].name}` : code; };

/** De dónde salió el punto, en palabras. */
export function pinSource(pin: PlacePin, provider?: string): string {
  if (pin.source === 'CCPP') return 'Existe en el registro de centros poblados del INEI';
  if (pin.source === 'GPS') return `Marcado con el GPS del celular${pin.accuracy !== undefined ? ` (±${pin.accuracy >= 1000 ? km(pin.accuracy / 1000) : `${pin.accuracy} m`})` : ''}`;
  if (pin.source === 'BUSCADOR') return `Dirección encontrada en ${provider === 'google' ? 'Google' : 'OpenStreetMap'}`;
  return 'Distrito oficial del INEI (sin el lugar exacto)';
}

/* ---------- mapa del distrito con el punto ---------- */

/**
 * Mapa dibujado con los datos del INEI (sin internet): el distrito, los pueblos de alrededor con sus
 * nombres y el punto elegido. Con un lugar exacto se acerca (~9 km); con solo el distrito, lo muestra entero.
 */
export function PlaceMap({ data, district, pin, height = 170 }: { data?: PlaceData; district: string; pin?: { lat: number; lng: number; accuracy?: number; source?: PlacePin['source']; label?: string }; height?: number }) {
  const W = 320, H = height;
  const close = !!pin && pin.source !== 'DISTRITO';
  const view = useMemo(() => {
    if (!data || !DISTRICT_BY_CODE[district]) return undefined;
    let cx: number, cy: number, w: number, h: number;
    if (close && pin) {
      cx = pin.lng; cy = pin.lat;
      h = 0.07; w = h * (W / H);
    } else {
      const polys = data.limits[district] ?? [];
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const grow = (lng: number, lat: number) => { x0 = Math.min(x0, lng); x1 = Math.max(x1, lng); y0 = Math.min(y0, lat); y1 = Math.max(y1, lat); };
      for (const p of polys) for (const r of p) for (const [lng, lat] of r) grow(lng, lat);
      if (pin) grow(pin.lng, pin.lat);
      if (!Number.isFinite(x0)) { const d = DISTRICT_BY_CODE[district]; grow(d.lng - 0.05, d.lat - 0.05); grow(d.lng + 0.05, d.lat + 0.05); }
      cx = (x0 + x1) / 2; cy = (y0 + y1) / 2;
      const c = Math.cos((cy * Math.PI) / 180);
      // margen y tamaño mínimo (~2 km) para que un distrito chico se vea
      w = Math.max((x1 - x0) * c, 0.02) * 1.18; h = Math.max(y1 - y0, 0.02) * 1.18;
      if (w / h < W / H) w = h * (W / H); else h = w / (W / H);
    }
    const cos = Math.cos((cy * Math.PI) / 180);
    const k = W / w;
    const X = (lng: number) => ((lng - cx) * cos * k + W / 2);
    const Y = (lat: number) => (H / 2 - (lat - cy) * k);
    const vb: [number, number, number, number] = [cx - w / cos / 2, cy - h / 2, cx + w / cos / 2, cy + h / 2];
    const path = (code: string) => (data.limits[code] ?? []).map(p => p.map(r => r.map(([lng, lat], i) => `${i ? 'L' : 'M'}${X(lng).toFixed(1)} ${Y(lat).toFixed(1)}`).join(' ') + 'Z').join(' ')).join(' ');
    const others = Object.keys(data.limits).filter(c => c !== district && inBoxes(data.limits[c], vb));
    const dots = data.places.filter(p => p.kind !== 'DISTRITO' && inBox(p.lat, p.lng, vb)).slice(0, 200);
    // nombres de los pueblos más cercanos al punto (sin que se encimen)
    const labels: { x: number; y: number; t: string }[] = [];
    if (close && pin) {
      const boxes: [number, number, number, number][] = [[X(pin.lng) - 9, Y(pin.lat) - 20, X(pin.lng) + 9, Y(pin.lat) + 2]];
      for (const n of nearestPlaces(data, pin.lat, pin.lng, 12, 9)) {
        if (labels.length >= 4) break;
        const x = X(n.place.lng), y = Y(n.place.lat);
        const t = n.place.name.length > 22 ? n.place.name.slice(0, 21) + '…' : n.place.name;
        const bw = t.length * 5.6 + 6;
        const b: [number, number, number, number] = [x + 3, y - 9, x + 3 + bw, y + 4];
        if (b[2] > W - 4 || b[1] < 26 || b[3] > H - 24 || x < 4) continue;
        if (boxes.some(o => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])) continue;
        boxes.push(b);
        labels.push({ x: x + 5, y: y + 1, t });
      }
    }
    // escala: la que ocupe ~1/5 del ancho
    const kmPerPx = (w * 111.32) / W;
    const bar = [0.5, 1, 2, 5, 10, 20, 50].find(n => n / kmPerPx >= W / 6) ?? 50;
    return { X, Y, k, path, others, dots, labels, bar, barPx: bar / kmPerPx, kmPerPx };
  }, [data, district, pin?.lat, pin?.lng, close]);
  const d = DISTRICT_BY_CODE[district];
  if (!view || !d) return <div className="plc-map" style={{ height: `${H}px` }} aria-hidden="true" />;
  const px = pin ? view.X(pin.lng) : 0, py = pin ? view.Y(pin.lat) : 0;
  const accPx = pin?.accuracy ? Math.min(60, pin.accuracy / 1000 / view.kmPerPx) : 0;
  return (
    <div className="plc-map">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Mapa de ${d.name}${pin ? ' con el punto de tu chacra' : ''}${view.labels.length ? `; cerca: ${view.labels.map(l => l.t).join(', ')}` : ''}`}>
        <rect width={W} height={H} fill="#EEF3E7" />
        {view.others.map(c => <path key={c} d={view.path(c)} fill="#F6F8F1" stroke="#C9D6C3" strokeWidth="1" />)}
        <path d={view.path(district)} fill="#DCEBCB" stroke="#2C5F2D" strokeWidth="1.6" strokeDasharray="5 3" strokeLinejoin="round" />
        {view.dots.map(p => <circle key={p.id} cx={view.X(p.lng)} cy={view.Y(p.lat)} r={p.kind === 'CCPP_U' ? 2.4 : 1.6} fill={p.kind === 'CCPP_U' ? '#5B6B57' : '#97A893'} />)}
        {view.labels.map((l, i) => <text key={i} x={l.x} y={l.y} fontSize="9.5" fontWeight="700" fill="#3E4A3B" stroke="#F6F8F1" strokeWidth="3" paintOrder="stroke" strokeLinejoin="round">{l.t}</text>)}
        {pin && accPx > 3 && <circle cx={px} cy={py} r={accPx} fill="rgba(166,102,51,.15)" stroke="rgba(166,102,51,.5)" />}
        {pin && <g transform={`translate(${px.toFixed(1)} ${py.toFixed(1)})`}><path d="M0 0 C -7 -9, -8 -15, 0 -18 C 8 -15, 7 -9, 0 0 Z" fill="#A66633" stroke="#fff" strokeWidth="1.5" /><circle cy="-11.5" r="3" fill="#fff" /></g>}
        <g transform={`translate(10 ${H - 12})`}><rect x="-4" y="-12" width={view.barPx + 40} height="18" rx="4" fill="rgba(255,255,255,.85)" /><path d={`M0 0 H${view.barPx.toFixed(1)}`} stroke="#222B1F" strokeWidth="2" /><text x={view.barPx + 5} y="4" fontSize="10" fontWeight="700" fill="#222B1F">{view.bar < 1 ? `${view.bar * 1000} m` : `${view.bar} km`}</text></g>
      </svg>
      <span className="plc-tag">{d.name} · límite aproximado</span>
    </div>
  );
}
function inBoxes(polys: number[][][][], b: [number, number, number, number]): boolean {
  for (const p of polys) for (const r of p) for (const [lng, lat] of r) if (inBox(lat, lng, b)) return true;
  return false;
}

/* ---------- el buscador ---------- */

export function PlacePicker({ value, onChange, label = '¿Dónde está tu chacra?', help }: { value: PlaceValue; onChange: (v: PlaceValue) => void; label?: ReactNode; help?: ReactNode }) {
  const data = usePlaces();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(!value.pin);
  const [online, setOnline] = useState<GeoHit[]>([]);
  const [onState, setOnState] = useState<'idle' | 'loading' | 'ok' | 'error' | 'off'>('idle');
  const [provider, setProvider] = useState<string>();
  const [amb, setAmb] = useState<string[]>();
  const [msg, setMsg] = useState('');
  const [gpsBusy, setGpsBusy] = useState(false);
  const [manual, setManual] = useState(false);
  const cur = useRef('');
  cur.current = q.trim();
  const near = value.district && DISTRICT_BY_CODE[value.district] ? { lat: DISTRICT_BY_CODE[value.district].lat, lng: DISTRICT_BY_CODE[value.district].lng } : undefined;

  const local = useMemo(() => (data && q.trim().length >= 2 ? searchPlaces(data, q, { limit: 7, near }) : []), [data, q]);

  // direcciones por internet (calles, lugares de OpenStreetMap o Google), un momento después de dejar de escribir
  useEffect(() => {
    const text = q.trim();
    if (LOCAL || !open || text.length < 4 || (typeof navigator !== 'undefined' && navigator.onLine === false)) { setOnline([]); setOnState(LOCAL ? 'off' : 'idle'); return; }
    setOnState('loading');
    const t = setTimeout(async () => {
      try {
        const r = await api<{ results: GeoHit[]; provider: string; error?: string }>(`/places/search?q=${encodeURIComponent(text)}${near ? `&lat=${near.lat}&lng=${near.lng}` : ''}`, { timeoutMs: 9000 });
        if (cur.current !== text) return;
        setProvider(r.provider);
        setOnline((r.results ?? []).filter(h => h.district && DISTRICT_BY_CODE[h.district]));
        setOnState(r.provider === 'off' ? 'off' : r.error ? 'error' : 'ok');
      } catch { if (cur.current === text) { setOnline([]); setOnState('error'); } }
    }, 700);
    return () => clearTimeout(t);
  }, [q, open]);

  const choose = (pin: Omit<PlacePin, 'at' | 'ref'>, district: string, cands?: string[]) => {
    onChange({ district, pin: { ...pin, ...(value.pin?.ref ? { ref: value.pin.ref } : {}), at: Date.now() } });
    setAmb(cands && cands.length > 1 ? cands : undefined);
    setOpen(false); setQ(''); setEditing(false); setMsg(''); setManual(false);
  };
  const pickPlace = (p: Place) => choose(
    p.kind === 'DISTRITO'
      ? { lat: p.lat, lng: p.lng, label: `${p.name} (distrito)`, source: 'DISTRITO' }
      : { lat: p.lat, lng: p.lng, label: p.name, source: 'CCPP', ccpp: p.id },
    p.district,
  );
  const pickAddress = (h: GeoHit) => choose({ lat: h.lat, lng: h.lng, label: h.label, source: 'BUSCADOR' }, h.district!, h.ambiguous ? h.candidates : undefined);
  const pickDistrict = (code: string) => { const d = DISTRICT_BY_CODE[code]; if (d) choose({ lat: d.lat, lng: d.lng, label: `${d.name} (distrito)`, source: 'DISTRITO' }, code); };

  const gps = () => {
    setMsg('');
    if (typeof navigator === 'undefined' || !navigator.geolocation || !(window as any).isSecureContext) {
      setMsg('Aquí no se puede usar el GPS (la app necesita conexión segura). Escribe el nombre de tu anexo, pueblo o sector.');
      return;
    }
    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const d = data ?? (await loadPlaces());
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        const loc = locatePoint(d, lat, lng);
        if (!loc.inside || !loc.district) { setMsg('Tu ubicación está fuera de la región Arequipa. Si no estás en tu chacra, busca su nombre.'); return; }
        const n = loc.near;
        const label = n ? (n.km < 0.25 ? `En ${n.place.name}` : `A ${km(n.km)} de ${n.place.name}`) : 'Mi ubicación';
        choose({ lat, lng, label, source: 'GPS', accuracy: Math.round(accuracy) }, loc.district, loc.ambiguous ? loc.candidates : undefined);
        if (accuracy > 1500) setMsg(`El GPS no está preciso ahora (±${km(accuracy / 1000)}). Si puedes, sal a un lugar abierto y vuelve a marcar, o busca el nombre del lugar.`);
      } finally { setGpsBusy(false); }
    }, (err) => {
      setGpsBusy(false);
      setMsg(err.code === 1 ? 'No diste permiso para usar tu ubicación. Puedes darlo en los ajustes del celular o buscar tu anexo por su nombre.' : 'No pudimos leer el GPS. Sal a un lugar abierto o busca tu anexo por su nombre.');
    }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 });
  };

  const pin = value.pin;
  const d = DISTRICT_BY_CODE[value.district];
  const showList = open && q.trim().length >= 2;
  const nearPlace = data && pin && pin.source !== 'CCPP' ? nearestPlaces(data, pin.lat, pin.lng, 1, 15)[0] : undefined;

  return (
    <div className="stack tight plc">
      {pin && d && !editing ? (
        <div className="card line plc-sel" role="group" aria-label="Lugar de la chacra">
          <div className="row">
            <ICirc n="map-pin-check" tone="dark" />
            <div className="grow">
              <b className="bodym">{pin.label}</b>
              <div className="cap">{pin.source === 'CCPP' || pin.source === 'DISTRITO' ? distLine(value.district) : `${distLine(value.district)}${nearPlace && pin.source === 'BUSCADOR' ? ` · cerca de ${nearPlace.place.name}` : ''}`}</div>
            </div>
            <button className="linkbtn" onClick={() => { setEditing(true); setOpen(true); }}>Cambiar</button>
          </div>
          <PlaceMap data={data} district={value.district} pin={pin} />
          <div className="row between wrap g8">
            <span className="cap row g4"><Icon n="badge-check" s="1.15em" />{pinSource(pin, provider)}</span>
            <button className="linkbtn" onClick={() => openExternal(mapsLink(pin.lat, pin.lng))}><Icon n="external-link" s="1em" /> Ver en Google Maps</button>
          </div>
          {amb && amb.length > 1 && (
            <div className="card warn plc-amb" role="group" aria-label="Confirma el distrito">
              <b className="bodym">¿En qué distrito está?</b>
              <div className="cap">El punto está cerca del límite: elige el distrito correcto.</div>
              <div className="chips mt">{amb.map(c => (
                <button key={c} className={'chip ' + (c === value.district ? 'field' : 'line')} aria-pressed={c === value.district ? 'true' : 'false'} onClick={() => onChange({ district: c, pin })}>
                  {c === value.district && <Icon n="check" s="1em" w={3} />}{distLine(c)}
                </button>
              ))}</div>
            </div>
          )}
        </div>
      ) : (
        <Field label={label} help={help ?? 'Escribe el nombre de tu anexo, pueblo, sector o distrito y elige el que corresponde. También puedes usar tu ubicación.'}>
          <div className="plc-search">
            <div className="igrp">
              <Icon n="search" s="1.15em" />
              <input className="plc-in" value={q} placeholder="Ej.: Yanque, Sección B2, Characato" aria-label="Buscar el lugar de la chacra" autoComplete="off" inputMode="search"
                onChange={(e) => { setQ(e.currentTarget.value); setOpen(true); }} onFocus={() => setOpen(true)} />
              {q && <button className="iconbtn plain" aria-label="Borrar" onClick={() => { setQ(''); setOpen(false); }}><Icon n="x" s="1em" /></button>}
            </div>
            {showList && (
              <div className="plc-list" role="listbox" aria-label="Lugares que coinciden">
                {!data && <div className="plc-note"><i className="spin dark" /> Cargando los lugares de Arequipa…</div>}
                {local.map(h => (
                  <button key={h.place.id} role="option" aria-selected="false" className="plc-opt" onClick={() => pickPlace(h.place)}>
                    <Icon n={h.place.kind === 'DISTRITO' ? 'map' : 'map-pin'} s="1.2em" />
                    <span className="grow"><b>{h.place.name}</b><span className="cap">{placeSub(h.place)}</span></span>
                  </button>
                ))}
                {online.length > 0 && <div className="plc-head">Direcciones · {provider === 'google' ? 'Google' : 'OpenStreetMap'}</div>}
                {online.map((h, i) => (
                  <button key={'g' + i} role="option" aria-selected="false" className="plc-opt" onClick={() => pickAddress(h)}>
                    <Icon n="navigation" s="1.2em" />
                    <span className="grow"><b>{h.label}</b><span className="cap">{[h.sub, distLine(h.district!)].filter(Boolean).join(' · ')}</span></span>
                  </button>
                ))}
                {onState === 'loading' && <div className="plc-note"><i className="spin dark" /> Buscando direcciones…</div>}
                {data && !local.length && !online.length && onState !== 'loading' && (
                  <div className="plc-note">No encontramos «{q.trim()}» en Arequipa. Prueba con el nombre del anexo o del distrito, o usa tu ubicación.</div>
                )}
                {online.length > 0 && provider !== 'google' && <div className="plc-attr">Direcciones: datos © colaboradores de OpenStreetMap</div>}
              </div>
            )}
          </div>
        </Field>
      )}
      {(editing || !pin) && (
        <div className="row wrap g8">
          <Btn sm kind="sec" icon="locate-fixed" loading={gpsBusy} onClick={gps}>{gpsBusy ? 'Buscando…' : 'Usar mi ubicación'}</Btn>
          <button className="linkbtn" onClick={() => setManual(!manual)}>{manual ? 'Ocultar la lista' : 'Elegir de la lista de distritos'}</button>
          {pin && <button className="linkbtn" onClick={() => { setEditing(false); setOpen(false); setQ(''); }}>Dejar como estaba</button>}
        </div>
      )}
      {(editing || !pin) && manual && (
        <Field label="Distrito (los 109 de Arequipa)">
          <Sel value={value.district && DISTRICT_BY_CODE[value.district] ? value.district : ''} onChange={(v) => v && pickDistrict(v)} options={[{ v: '', l: 'Elige el distrito' }, ...districtChoices()]} label="Distrito" />
        </Field>
      )}
      {msg && <div role="alert"><Note icon="triangle-alert" tone="warn">{msg}</Note></div>}
      {pin && !editing && (
        <Field label="Referencia para llegar (opcional)" help="Solo la ve el equipo de Mesagri. Los compradores ven tu distrito (RN-17).">
          <Inp value={pin.ref ?? ''} onInput={(v) => onChange({ district: value.district, pin: { ...pin, ref: v.slice(0, 200) } })} placeholder="Ej.: a 200 m del puente, portón verde" label="Referencia para llegar" max={200} />
        </Field>
      )}
    </div>
  );
}
