/*
 * Identidad (nivel 1 de agricultores y MYPE; registro de transportistas y almacenes):
 * - nombre como figura en el DNI, número y dígito de verificación (el que va después del guion);
 *   mientras escribe se consulta si el nombre coincide (RENIEC o, en la demo, el padrón de prueba);
 * - fotos del DNI por los dos lados;
 * - tres fotos del rostro (de frente, girando a su derecha y a su izquierda) con la cámara guiada:
 *   la visión por computadora del celular revisa que haya una sola cara, en el ángulo pedido, con
 *   buena luz y sin moverse, y toma la foto sola. Si la cámara en vivo no abre, cada foto se toma
 *   con la cámara del celular y se revisa igual.
 * La revisión automática orienta; quien decide es una persona del equipo (RN-16).
 * ID-01: manda la identidad a verificación (o la vuelve a mandar si el equipo la observó).
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { reg } from './registry';
import { useApp, type AppCtx } from '../ctx';
import { Screen, Btn, Icon, Field, Inp, Card, Chip, Note, Photo } from '../ui/kit';
import { api } from '../net';
import { compressImage } from '../media';
import { uid } from '@mesagri/shared/ids';
import { isDniValid } from '@mesagri/shared/rules';
import { dniDigitOk, facesConsistent, normName } from '@mesagri/shared/identity';
import type { FacePose, FaceShot, RegistryStatus } from '@mesagri/shared/types';
import { analyzeFace, judgeFace, faceApi, loadImage, docQuality, type FaceInfo } from '../vision/faces';

/* ---------- Lo que se va llenando ---------- */
export interface DocInfo { ok: boolean; faces: number; sharp?: number; light?: number; note?: string }
export interface IdCheck { key: string; status: RegistryStatus | 'ERROR'; source?: string; provider?: string; digitOk: boolean | null; deceased: boolean | null; message?: string }
export interface IdDraft {
  name: string;
  dni: string;
  digit: string;
  dniFront?: string;
  dniBack?: string;
  docs?: { front?: DocInfo; back?: DocInfo };
  faces: FaceShot[];
  check?: IdCheck;
}
export const emptyId = (name = '', dni = ''): IdDraft => ({ name, dni, digit: '', faces: [] });
/** Lo que va al expediente (VERIF_SUBMIT / VERIF_RESPOND). */
export const idPayload = (d: IdDraft) => ({ dni: d.dni, digit: d.digit || undefined, name: d.name.replace(/\s+/g, ' ').trim(), dniFront: d.dniFront, dniBack: d.dniBack, faces: d.faces });
const keyOf = (d: IdDraft) => `${d.dni}|${normName(d.name)}|${d.digit.toUpperCase()}`;
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
export const POSES: FacePose[] = ['FRONT', 'RIGHT', 'LEFT'];
/** Cómo se le dice a la persona en la app (el panel usa POSE_LABEL: «girando a su derecha»). */
const MY_POSE: Record<FacePose, string> = { FRONT: 'De frente', RIGHT: 'A tu derecha', LEFT: 'A tu izquierda' };

/* ---------- Consulta del DNI ---------- */
type RegistryInfo = { source: string; provider?: string; tests: { dni: string; note: string }[] };
let regInfo: Promise<RegistryInfo> | undefined;
function registryInfo(): Promise<RegistryInfo> {
  if (!regInfo) { regInfo = api<RegistryInfo>('/identity/registry'); regInfo.catch(() => { regInfo = undefined; }); }
  return regInfo;
}
async function precheck(A: AppCtx, d: IdDraft): Promise<IdCheck> {
  const key = keyOf(d);
  try {
    const token = A.me ? await A.store.sessions.token(A.me.id) : undefined;
    const phone = String(A.dev.flow?.reg?.phone ?? '');
    const ticket = phone ? A.store.tickets.get(phone) : undefined;
    const r = await api<any>('/identity/dni-check', { body: { dni: d.dni, name: d.name, digit: d.digit || undefined, ticket }, token });
    return { key, status: r.status, source: r.source, provider: r.provider, digitOk: r.digitOk ?? null, deceased: r.deceased ?? null };
  } catch (e: any) {
    return { key, status: 'ERROR', digitOk: dniDigitOk(d.dni, d.digit), deceased: null, message: e?.message };
  }
}
function checkLine(c: IdCheck): { tone: string; icon: string; text: string } {
  const demo = c.source === 'PADRON_PRUEBA';
  switch (c.status) {
    case 'MATCH': return { tone: 'soft', icon: 'circle-check', text: demo ? 'Coincide con el padrón de prueba (la versión real consulta RENIEC).' : `Tu nombre coincide con tu DNI en RENIEC.` };
    case 'PARTIAL': return { tone: 'warn', icon: 'info', text: 'Coincide en parte: escribe tu nombre completo, con tus dos apellidos, como figura en tu DNI.' };
    case 'NAME_MISMATCH': return { tone: 'danger', icon: 'triangle-alert', text: 'El nombre no coincide con este DNI en RENIEC. Escríbelo tal como figura en tu DNI.' };
    case 'DECEASED': return { tone: 'danger', icon: 'circle-x', text: 'Este DNI figura en RENIEC como de una persona fallecida. No se puede usar para crear una cuenta.' };
    case 'NOT_FOUND': return demo ? { tone: 'warn', icon: 'info', text: 'Ese DNI no está en el padrón de prueba de la demo: lo revisa una persona del equipo.' } : { tone: 'danger', icon: 'triangle-alert', text: 'Ese DNI no figura en RENIEC: revisa el número.' };
    default: return { tone: 'warn', icon: 'info', text: 'Ahora no pudimos consultar tu DNI: lo revisa una persona del equipo.' };
  }
}

/* ---------- Cámara en vivo ---------- */
function useCamera(facing: 'user' | 'environment') {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'starting' | 'on' | 'off'>('starting');
  // el recuadro toma la forma del video (vertical en el celular, horizontal en una computadora)
  const [ratio, setRatio] = useState<string | undefined>();
  useEffect(() => {
    let stream: MediaStream | undefined;
    let alive = true;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('sin cámara en vivo');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
        if (!alive) { stream.getTracks().forEach(t => t.stop()); return; }
        const v = video.current;
        if (!v) return;
        v.srcObject = stream;
        v.muted = true;
        await v.play().catch(() => undefined);
        if (v.videoWidth && v.videoHeight) setRatio(`${v.videoWidth} / ${v.videoHeight}`);
        setState('on');
      } catch { if (alive) setState('off'); }
    })();
    return () => { alive = false; stream?.getTracks().forEach(t => t.stop()); };
  }, [facing]);
  return { video, state, ratio };
}
/** El cuadro actual del video (sin espejo), de hasta `max` px de lado. */
function grab(v: HTMLVideoElement, max = 1280): HTMLCanvasElement {
  const s = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(v.videoWidth * s); c.height = Math.round(v.videoHeight * s);
  c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
  return c;
}
async function saveCanvas(A: AppCtx, c: HTMLCanvasElement, kind: string, prefix: string): Promise<string> {
  let q = 0.86, data = c.toDataURL('image/jpeg', q);
  while (data.length * 0.75 > 320_000 && q > 0.4) { q -= 0.12; data = c.toDataURL('image/jpeg', q); }
  const id = `${prefix}-${uid()}`;
  await A.photos.put(id, data, { kind, userId: A.dev.userId });
  return id;
}

const SAY: Record<FacePose, string> = { FRONT: 'Pon tu cara dentro del óvalo y mira de frente a la cámara.', RIGHT: 'Ahora gira despacio la cabeza hacia tu derecha.', LEFT: 'Ahora gira la cabeza hacia tu izquierda.' };
const TITLE: Record<FacePose, string> = { FRONT: 'Mira de frente', RIGHT: 'Gira a tu derecha', LEFT: 'Gira a tu izquierda' };

/** Cámara guiada: toma sola las tres fotos del rostro cuando cada una sale bien. */
export function FaceScan({ onDone, onClose }: { onDone: (shots: FaceShot[]) => void; onClose: (why?: 'nocam') => void }) {
  const A = useApp();
  const cam = useCamera('user');
  const [i, setI] = useState(0);
  const [hint, setHint] = useState('');
  const [model, setModel] = useState<'loading' | 'ok' | 'fail'>('loading');
  const [good, setGood] = useState(false);
  const [flash, setFlash] = useState(0);
  const shots = useRef<FaceShot[]>([]);
  const busy = useRef(false);
  const pose = POSES[i];
  useEffect(() => { faceApi().then(() => setModel('ok'), () => setModel('fail')); }, []);
  useEffect(() => { A.say(SAY[pose]); }, [i]);
  useEffect(() => { if (cam.state === 'off') onClose('nocam'); }, [cam.state]);
  const take = async (manual: boolean): Promise<boolean> => {
    const v = cam.video.current;
    if (!v || busy.current || !v.videoWidth) return false;
    busy.current = true;
    try {
      const c = grab(v);
      let info: FaceInfo = { faces: 0 };
      let j = { ok: false, hint: 'Sin revisión automática en este celular.' };
      if (model === 'ok') { info = await analyzeFace(c); j = judgeFace(info, pose, true); }
      if (!j.ok && !manual) return false;
      const photoId = await saveCanvas(A, c, 'selfie', 'ph-cam');
      const auto = model === 'ok' ? { ok: j.ok, faces: info.faces, yaw: info.yaw, light: info.light, sharp: info.sharp, note: j.ok ? undefined : j.hint } : undefined;
      shots.current = [...shots.current.filter(s => s.pose !== pose), { pose, photoId, live: true, at: Date.now(), auto }];
      setFlash(f => f + 1);
      if (i < POSES.length - 1) setI(i + 1);
      else { A.say('Listo. Tomamos las tres fotos de tu rostro.'); onDone(shots.current); }
      return true;
    } finally { busy.current = false; }
  };
  // revisión en vivo: mira el video unas 5 veces por segundo; con 3 lecturas buenas seguidas, toma la foto
  useEffect(() => {
    if (cam.state !== 'on' || model !== 'ok') return;
    let alive = true, streak = 0;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      const v = cam.video.current;
      if (!alive || !v) return;
      if (!busy.current && v.readyState >= 2 && v.videoWidth) {
        try {
          const info = await analyzeFace(v, { inputSize: 224 });
          if (!alive) return;
          const j = judgeFace(info, pose, true);
          setGood(j.ok);
          setHint(j.ok ? 'Así, quieto un momento...' : j.hint);
          streak = j.ok ? streak + 1 : 0;
          if (streak >= 3) { streak = 0; await take(false); }
        } catch { /* sigue mirando */ }
      }
      if (alive) timer = setTimeout(loop, 180);
    };
    timer = setTimeout(loop, 400);
    return () => { alive = false; clearTimeout(timer); };
  }, [cam.state, model, i]);
  const status = cam.state === 'starting' ? 'Abriendo la cámara...' : model === 'loading' ? 'Preparando la revisión automática...' : model === 'fail' ? 'Toca «Tomar la foto» cuando estés listo.' : hint || SAY[pose];
  return (
    <div className="stack tight" role="group" aria-label="Cámara para las fotos de tu rostro">
      <div className="row between"><b className="h3">{TITLE[pose]}</b><span className="cap">Foto {i + 1} de 3</span></div>
      <div className={'cam selfie' + (good ? ' good' : '')} data-pose={pose} style={cam.ratio ? { aspectRatio: cam.ratio } : undefined}>
        <video ref={cam.video} playsInline muted autoPlay aria-hidden="true" />
        <div className="oval" />
        {pose !== 'FRONT' && <span className={'turn ' + (pose === 'RIGHT' ? 'r' : 'l')} aria-hidden="true"><Icon n={pose === 'RIGHT' ? 'arrow-big-right' : 'arrow-big-left'} s="2.6em" /></span>}
        {flash > 0 && <div key={flash} className="flash" />}
        <div className="camhint" role="status" aria-live="polite">{status}</div>
      </div>
      <div className="dots3" aria-hidden="true">{POSES.map((p, k) => <span key={p} className={k < i ? 'done' : k === i ? 'cur' : ''}>{k < i ? <Icon n="check" s="1em" w={3} /> : k + 1}</span>)}</div>
      <Btn full kind="dark" icon="aperture" disabled={cam.state !== 'on'} onClick={() => { void take(true); }}>Tomar la foto</Btn>
      <button className="linkbtn" style={{ alignSelf: 'center' }} onClick={() => onClose()}>Cancelar</button>
    </div>
  );
}

/** Cámara de atrás con el marco del DNI. */
export function DocCam({ side, onDone, onClose }: { side: 'front' | 'back'; onDone: (c: HTMLCanvasElement) => void; onClose: (why?: 'nocam') => void }) {
  const cam = useCamera('environment');
  useEffect(() => { if (cam.state === 'off') onClose('nocam'); }, [cam.state]);
  return (
    <div className="stack tight" role="group" aria-label={`Cámara para el DNI (${side === 'front' ? 'frente' : 'reverso'})`}>
      <b className="h3">{side === 'front' ? 'DNI · el lado de tu foto' : 'DNI · el reverso (con el código de abajo)'}</b>
      <div className="cam doc" style={cam.ratio ? { aspectRatio: cam.ratio } : undefined}>
        <video ref={cam.video} playsInline muted autoPlay aria-hidden="true" />
        <div className="cardframe" />
        <div className="camhint" role="status">{cam.state === 'starting' ? 'Abriendo la cámara...' : 'Pon el DNI dentro del marco, sin reflejos, y toma la foto.'}</div>
      </div>
      <Btn full kind="dark" icon="aperture" disabled={cam.state !== 'on'} onClick={() => { const v = cam.video.current; if (v?.videoWidth) onDone(grab(v, 1600)); }}>Tomar la foto</Btn>
      <button className="linkbtn" style={{ alignSelf: 'center' }} onClick={() => onClose()}>Cancelar</button>
    </div>
  );
}

/** Revisa la foto del DNI: nítida, con luz y del lado que corresponde (el frente lleva la foto de la persona). */
async function checkDoc(c: HTMLCanvasElement | HTMLImageElement, side: 'front' | 'back'): Promise<DocInfo> {
  const q = docQuality(c);
  let faces = 0;
  try { faces = (await analyzeFace(c, { inputSize: 416 })).faces; } catch { return { ok: true, faces: 0, ...q, note: 'Sin revisión automática.' }; }
  if ((q.sharp ?? 99) < 25) return { ok: false, faces, ...q, note: 'Salió borrosa: apoya los codos y toma otra.' };
  if ((q.light ?? 128) < 50) return { ok: false, faces, ...q, note: 'Salió oscura: busca más luz.' };
  if (side === 'front' && !faces) return { ok: false, faces, ...q, note: 'No se ve la foto del DNI: ¿es el frente?' };
  if (side === 'back' && faces) return { ok: false, faces, ...q, note: 'Parece el frente: voltea el DNI.' };
  return { ok: true, faces, ...q };
}
async function canvasOfFile(f: Blob): Promise<HTMLCanvasElement> {
  const data = await compressImage(f, 1600, 600_000);
  const img = await loadImage(data);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext('2d')!.drawImage(img, 0, 0);
  return c;
}
const sampleUrl = (f: string) => new URL(import.meta.env.BASE_URL + 'muestras/' + f, location.href).href;
async function sampleCanvas(f: string): Promise<HTMLCanvasElement> {
  const r = await fetch(sampleUrl(f));
  return canvasOfFile(await r.blob());
}

/* ---------- Formulario de identidad ---------- */
export function IdentityForm({ value, onChange, nameLabel = 'Tu nombre completo', who = 'tu', compact }: { value: IdDraft; onChange: (d: IdDraft) => void; nameLabel?: string; who?: 'tu' | 'su'; compact?: boolean }) {
  const A = useApp();
  const cur = useRef(value);
  cur.current = value;
  // cada cambio parte del último (varios pueden llegar antes de que la pantalla se vuelva a dibujar:
  // la consulta del DNI, las fotos que se están revisando)
  const set = (patch: Partial<IdDraft>) => { const next = { ...cur.current, ...patch }; cur.current = next; onChange(next); };
  const [info, setInfo] = useState<RegistryInfo | undefined>();
  const [busy, setBusy] = useState<string>('');
  const [nolive, setNolive] = useState(false);
  useEffect(() => { registryInfo().then(setInfo, () => undefined); }, []);
  // fotos de ejemplo: en el escenario de la demo y donde el DNI se consulta en el padrón de prueba
  // (la versión de prueba en línea); con RENIEC de verdad, solo fotos reales
  const stage = A.store.mode === 'stage' || info?.source === 'PADRON_PRUEBA';
  // consulta del DNI al terminar de escribir (no en cada letra)
  useEffect(() => {
    const d = cur.current;
    if (!isDniValid(d.dni) || words(d.name) < 2 || d.check?.key === keyOf(d)) return;
    const t = setTimeout(async () => { const c = await precheck(A, cur.current); if (c.key === keyOf(cur.current)) set({ check: c }); }, 650);
    return () => clearTimeout(t);
  }, [value.dni, value.name, value.digit]);
  // la visión por computadora se va cargando mientras escribe
  useEffect(() => { void faceApi().catch(() => undefined); }, []);

  const digitBad = isDniValid(value.dni) && value.digit !== '' && dniDigitOk(value.dni, value.digit) === false;
  const c = value.check && value.check.key === keyOf(value) ? value.check : undefined;
  const line = c ? checkLine(c) : undefined;

  /* fotos del DNI */
  const setDoc = async (side: 'front' | 'back', canvas: HTMLCanvasElement) => {
    setBusy(side);
    try {
      const dinfo = await checkDoc(canvas, side);
      const id = await saveCanvas(A, canvas, 'dni', 'ph-dni');
      set(side === 'front' ? { dniFront: id, docs: { ...cur.current.docs, front: dinfo } } : { dniBack: id, docs: { ...cur.current.docs, back: dinfo } });
      if (!dinfo.ok && dinfo.note) A.toast(dinfo.note, 'warn');
    } catch { A.toast('No pudimos leer esa foto. Prueba con otra.', 'err'); }
    setBusy('');
  };
  const docInput = useRef<Record<string, HTMLInputElement | null>>({});
  const openDocCam = (side: 'front' | 'back') => {
    A.sheet(<DocCam side={side} onDone={(cv) => { A.sheet(null); void setDoc(side, cv); }} onClose={(why) => { A.sheet(null); if (why === 'nocam') docInput.current[side + '-cam']?.click(); }} />);
  };
  const docTile = (side: 'front' | 'back') => {
    const id = side === 'front' ? value.dniFront : value.dniBack;
    const di = value.docs?.[side];
    const label = side === 'front' ? 'DNI · frente' : 'DNI · reverso';
    return (
      <div className="stack tight" key={side}>
        {id ? <Photo id={id} label={label} /> : <button className="photo add" onClick={() => openDocCam(side)} aria-label={`Tomar foto: ${label}`}><div className="stack tight" style={{ alignItems: 'center' }}>{busy === side ? <i className="spin" /> : <Icon n="id-card" s="1.8em" w={1.6} />}<span className="cap">{label}</span></div></button>}
        {id && di && <Chip tone={di.ok ? 'leaf' : 'warn'} icon={di.ok ? 'check' : 'triangle-alert'}>{di.ok ? 'Se ve bien' : di.note ?? 'Revísala'}</Chip>}
        <div className="row g8 wrap" style={{ fontSize: '.82em' }}>
          {id && <button className="linkbtn" style={{ padding: '.2em 0' }} onClick={() => openDocCam(side)}>Repetir</button>}
          <button className="linkbtn" style={{ padding: '.2em 0' }} onClick={() => docInput.current[side + '-gal']?.click()} aria-label={`Elegir de la galería: ${label}`}>De la galería</button>
          {stage && <button className="linkbtn" style={{ padding: '.2em 0' }} onClick={async () => setDoc(side, await sampleCanvas(side === 'front' ? 'dni-frente.jpg' : 'dni-reverso.jpg'))} aria-label={`Usar foto de ejemplo: ${label}`}>Usar ejemplo</button>}
        </div>
        <input ref={el => { docInput.current[side + '-cam'] = el; }} type="file" accept="image/*" capture="environment" className="sr" tabIndex={-1} aria-label={`Tomar foto con la cámara: ${label}`} onChange={async (e: any) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) void setDoc(side, await canvasOfFile(f)); }} />
        <input ref={el => { docInput.current[side + '-gal'] = el; }} type="file" accept="image/*" className="sr" tabIndex={-1} aria-label={`Foto de la galería: ${label}`} data-fuente="galeria" onChange={async (e: any) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) void setDoc(side, await canvasOfFile(f)); }} />
      </div>
    );
  };

  /* fotos del rostro */
  const faceInput = useRef<Record<string, HTMLInputElement | null>>({});
  const setFaceFromCanvas = async (pose: FacePose, canvas: HTMLCanvasElement, live: boolean) => {
    setBusy(pose);
    try {
      let auto: FaceShot['auto'];
      try {
        const fi = await analyzeFace(canvas);
        const j = judgeFace(fi, pose, false);
        auto = { ok: j.ok, faces: fi.faces, yaw: fi.yaw, light: fi.light, sharp: fi.sharp, note: j.ok ? undefined : j.hint };
        if (!j.ok) A.toast(j.hint, 'warn');
      } catch { auto = undefined; }
      const photoId = await saveCanvas(A, canvas, 'selfie', 'ph-cam');
      set({ faces: [...cur.current.faces.filter(f => f.pose !== pose), { pose, photoId, live, at: Date.now(), auto }] });
    } catch { A.toast('No pudimos leer esa foto. Prueba con otra.', 'err'); }
    setBusy('');
  };
  const openFaceScan = () => {
    if (nolive || !navigator.mediaDevices?.getUserMedia) { setNolive(true); faceInput.current.FRONT?.click(); return; }
    A.sheet(<FaceScan onDone={(shots) => { A.sheet(null); set({ faces: shots }); }} onClose={(why) => { A.sheet(null); if (why === 'nocam') { setNolive(true); A.toast('No se pudo abrir la cámara en vivo: toma cada foto con la cámara del celular.', 'info'); } }} />);
  };
  const useSampleFaces = async () => {
    setBusy('FRONT');
    const files: Record<FacePose, string> = { FRONT: 'rostro-frente.jpg', RIGHT: 'rostro-derecha.jpg', LEFT: 'rostro-izquierda.jpg' };
    for (const p of POSES) await setFaceFromCanvas(p, await sampleCanvas(files[p]), false);
    setBusy('');
  };
  const shot = (p: FacePose) => value.faces.find(f => f.pose === p);
  const allFaces = POSES.every(p => shot(p));
  const consistent = allFaces && facesConsistent(value.faces);
  const pron = who === 'tu' ? 'tu' : 'su';

  return (
    <div className="stack">
      <Field label={nameLabel} help="Como figura en el DNI, con los dos apellidos."><Inp value={value.name} onInput={(v) => set({ name: v })} placeholder="Nombres y apellidos" label="Nombre completo" /></Field>
      <div className="row top g8">
        <div className="grow"><Field label="Número de DNI"><Inp value={value.dni} onInput={(v) => set({ dni: v.replace(/\D/g, '').slice(0, 8) })} mode="numeric" placeholder="8 números" label="DNI" /></Field></div>
        <div className="iddigit"><Field label="Dígito"><Inp value={value.digit} onInput={(v) => set({ digit: v.replace(/[^0-9a-kA-K]/g, '').slice(0, 1).toUpperCase() })} placeholder="0" label="Dígito de verificación" /></Field></div>
      </div>
      <div className="cap" style={{ marginTop: '-.5em' }}>El dígito es el número que va después del guion, al lado del número de {pron} DNI (por ejemplo, 12345678 - <b>9</b>).</div>
      {digitBad && <Note icon="triangle-alert" tone="warn">El dígito no corresponde a ese número de DNI: revisa los dos.</Note>}
      {line && <div className={'card ' + line.tone} role="status"><div className="row top g8"><Icon n={line.icon} s="1.15em" /><div className="bodym grow">{line.text}</div></div></div>}
      {info?.source === 'PADRON_PRUEBA' && !isDniValid(value.dni) && (
        <div className="chips">{info.tests.map(t => <button key={t.dni} className="chip line" onClick={() => { const p = t.note.match(/fallecido/) ? '' : t.note; set({ dni: t.dni, name: p || cur.current.name, digit: '' }); }} title={t.note}>Prueba: {t.dni} ({t.note})</button>)}</div>
      )}

      <div className="sect">Fotos de {pron} DNI</div>
      <div className="grid2">{docTile('front')}{docTile('back')}</div>

      <div className="sect">Fotos de {pron} rostro</div>
      <Card>
        <div className="stack tight">
          {!compact && <div className="row top g8"><Icon n="scan-face" s="1.6em" /><div className="bodym grow">Tres fotos: de frente, girando la cabeza a {pron} derecha y a {pron} izquierda. La cámara te guía con la voz y toma cada foto sola cuando sale bien. Sin lentes oscuros ni gorra.</div></div>}
          <div className="idfaces">
            {POSES.map(p => {
              const s = shot(p);
              return (
                <figure key={p}>
                  {s ? <Photo id={s.photoId} label={MY_POSE[p]} /> : <div className="photo"><div className="stack tight" style={{ alignItems: 'center' }}>{busy === p ? <i className="spin" /> : <Icon n="scan-face" s="1.6em" w={1.6} />}<span className="cap" style={{ textAlign: 'center', padding: '0 .3em' }}>{MY_POSE[p]}</span></div></div>}
                  {s && <Chip tone={s.auto?.ok ? 'leaf' : 'warn'} icon={s.auto?.ok ? 'check' : 'triangle-alert'} title={s.auto?.note}>{s.auto ? (s.auto.ok ? 'Bien' : 'Revisar') : 'Sin revisar'}</Chip>}
                  {nolive && <button className="linkbtn" style={{ fontSize: '.8em', padding: '.2em 0' }} onClick={() => faceInput.current[p]?.click()} aria-label={`Tomar foto del rostro: ${MY_POSE[p].toLowerCase()}`}>{s ? 'Repetir' : 'Tomar foto'}</button>}
                  <input ref={el => { faceInput.current[p] = el; }} type="file" accept="image/*" capture="user" className="sr" tabIndex={-1} aria-label={`Foto del rostro: ${MY_POSE[p].toLowerCase()}`} onChange={async (e: any) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) await setFaceFromCanvas(p, await canvasOfFile(f), false); }} />
                </figure>
              );
            })}
          </div>
          {allFaces && !consistent && <Note icon="triangle-alert" tone="warn">Alguna foto no salió como pedimos ({value.faces.filter(f => !f.auto?.ok).map(f => `${MY_POSE[f.pose].toLowerCase()}: ${f.auto?.note ?? 'sin revisar'}`).join(' · ') || 'las dos giradas van al mismo lado'}). Puedes repetirlas; si las dejas, una persona del equipo las revisa.</Note>}
          {!nolive && <Btn full kind={allFaces ? 'sec' : 'dark'} icon="scan-face" onClick={openFaceScan}>{allFaces ? 'Volver a tomar las tres fotos' : `Tomar las 3 fotos de ${pron} rostro`}</Btn>}
          {stage && <button className="linkbtn" style={{ alignSelf: 'flex-start', fontSize: '.85em' }} onClick={() => { void useSampleFaces(); }} aria-label="Usar fotos de ejemplo del rostro">Usar fotos de ejemplo</button>}
        </div>
      </Card>
    </div>
  );
}

/* ---------- Antes de mandar ---------- */
/** Qué falta ('' si está completo). Sin fotos: solo nombre y DNI (para registrarse y verificarse después). */
export function identityProblem(d: IdDraft, photos = true): string {
  if (words(d.name) < 2 || d.name.trim().length < 5) return 'Escribe el nombre completo, como figura en el DNI.';
  if (!isDniValid(d.dni)) return 'El DNI tiene 8 números.';
  if (d.check?.key === keyOf(d) && d.check.status === 'DECEASED') return 'Ese DNI figura en RENIEC como de una persona fallecida. No se puede usar.';
  if (!photos) return '';
  if (!d.digit) return 'Escribe el dígito de verificación: el número que va después del guion, al lado del número del DNI.';
  if (!d.dniFront || !d.dniBack) return 'Toma la foto del DNI por los dos lados.';
  if (!POSES.every(p => d.faces.some(f => f.pose === p))) return 'Toma las tres fotos del rostro: de frente, a la derecha y a la izquierda.';
  return '';
}
/** Lo que conviene revisar antes de mandar: se pregunta una vez y queda anotado para el equipo. */
export async function confirmIdentity(A: AppCtx, d: IdDraft): Promise<boolean> {
  const issues: string[] = [];
  const c = d.check?.key === keyOf(d) ? d.check : undefined;
  if (dniDigitOk(d.dni, d.digit) === false) issues.push('el dígito no corresponde al número del DNI');
  if (c?.status === 'NAME_MISMATCH') issues.push('el nombre no coincide con el DNI en RENIEC');
  if (c?.status === 'NOT_FOUND' && c.source === 'PROVEEDOR') issues.push('el DNI no figura en RENIEC');
  if (d.faces.length === 3 && !facesConsistent(d.faces)) issues.push('alguna foto del rostro no salió como pedimos');
  if (d.docs?.front?.ok === false || d.docs?.back?.ok === false) issues.push('alguna foto del DNI no se ve bien');
  if (!issues.length) return true;
  return A.confirm({ title: '¿Mandar así?', text: `Revisa esto: ${issues.join('; ')}. Si lo mandas así, una persona del equipo lo revisa con más cuidado y puede pedirte que lo corrijas.`, ok: 'Mandar así', cancel: 'Corregir' });
}

/* ---------- ID-01 · Mandar la identidad a verificación ---------- */
function IdentityScreen() {
  const A = useApp();
  const level = Number(A.top.p?.level ?? 1);
  const respond = A.top.p?.respond as string | undefined;
  const org = A.org!;
  const me = A.me!;
  const [d, setD] = useState<IdDraft>(() => emptyId(me.name, me.dni ?? ''));
  const [err, setErr] = useState('');
  const send = async () => {
    const p = identityProblem(d);
    if (p) { setErr(p); return; }
    if (!(await confirmIdentity(A, d))) return;
    const identity = idPayload(d);
    const r = respond
      ? A.act('VERIF_RESPOND', { caseId: respond, identity, evidence: [], text: 'Mandé mi identidad otra vez' }, { ok: 'Enviado. Lo revisamos en 48 h.' })
      : A.act('VERIF_SUBMIT', { caseId: 'case-' + uid(), orgId: org.id, targetLevel: level, identity, evidence: [] }, { ok: 'Recibimos tu identidad. Una persona la revisa en 48 h.' });
    if (r.ok) A.back();
  };
  const isBuyer = org.type === 'BUYER';
  return (
    <Screen title={isBuyer ? 'Identidad del representante' : 'Verifica tu identidad'} sub={org.name} foot={<>{err && <div className="errt" role="alert"><Icon n="circle-alert" s="1.2em" />{err}</div>}<Btn full onClick={() => { setErr(''); void send(); }}>Enviar a verificación</Btn></>}>
      <div className="stack">
        <Note icon="lock">Solo lo ve el equipo de verificación. Las fotos del DNI y del rostro se borran a los 90 días (Ley 29733).</Note>
        <IdentityForm value={d} onChange={(v) => { setD(v); setErr(''); }} nameLabel={isBuyer ? 'Tu nombre completo (representante)' : 'Tu nombre completo'} />
      </div>
    </Screen>
  );
}
reg('ID-01', IdentityScreen);

export type { ReactNode };
