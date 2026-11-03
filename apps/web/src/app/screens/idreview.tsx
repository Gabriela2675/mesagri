/*
 * Panel · revisión automática de la identidad de un expediente (W-04 y transportistas/almacenes).
 * En la computadora de quien verifica, con visión por computadora:
 * - lee el código de abajo del reverso del DNI (número, nombres, nacimiento y vencimiento, con sus
 *   dígitos de control) y lo compara con lo que escribió la persona;
 * - busca el número del DNI en la foto del frente;
 * - compara el rostro de frente con la foto del DNI (parecido alto, medio o bajo);
 * - vuelve a medir el ángulo de las tres fotos del rostro (prueba de vida).
 * Junto con la consulta del DNI que hizo el servidor (RENIEC o el padrón de prueba). Lo que encuentra
 * se guarda en el expediente (VERIF_AUTOCHECK, queda en auditoría). Orienta: decide una persona (RN-16).
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useApp, type AppCtx } from '../ctx';
import { Icon, Btn, Photo } from '../ui/kit';
import { api } from '../net';
import { LOCAL } from '../routes';
import { compareNames, dniDigitOk, facesConsistent, mrzDate, ageOn, faceMatchLevel, POSE_LABEL, ID_ALERTS } from '@mesagri/shared/identity';
import type { VerifCase, DocReview, FacePose, CaseIdentity } from '@mesagri/shared/types';
import { analyzeFace, judgeFace, faceDescriptor, faceDistance, loadImage } from '../vision/faces';

function Pill({ tone, children }: { tone?: 'warn' | 'danger' | 'info' | 'gray' | ''; children: ReactNode }) { return <span className={'pill' + (tone ? ' ' + tone : '')}>{children}</span>; }
const POSES: FacePose[] = ['FRONT', 'RIGHT', 'LEFT'];
const canDecide = (A: AppCtx) => A.me?.role === 'ADMIN' && ['GENERAL', 'VERIFIER'].includes(A.me?.adminRole ?? '');

async function imageOf(A: AppCtx, id?: string): Promise<HTMLImageElement | undefined> {
  if (!id) return undefined;
  const src = await A.photos.get(id);
  if (!src) return undefined;
  try { return await loadImage(src); } catch { return undefined; }
}

/** Mira las fotos y arma la revisión (cada parte por separado: si una falla, las demás siguen). */
/** Deja respirar a la pantalla entre un paso pesado y otro. */
const breathe = () => new Promise(r => setTimeout(r, 40));

async function review(A: AppCtx, id: CaseIdentity, step: (s: string) => void): Promise<DocReview> {
  const out: DocReview = { at: Date.now(), by: A.me?.id ?? '' };
  const notes: string[] = [];
  step('Revisando las fotos del rostro...');
  const faces: NonNullable<DocReview['faces']> = [];
  for (const p of POSES) {
    const s = id.faces.find(f => f.pose === p);
    const img = await imageOf(A, s?.photoId);
    if (!s || !img) continue;
    try { const fi = await analyzeFace(img); faces.push({ pose: p, ok: judgeFace(fi, p, !!s.live, 0.1).ok, yaw: fi.yaw }); } catch { /* sin modelo */ }
    await breathe();
  }
  if (faces.length) out.faces = faces;
  const front = await imageOf(A, id.dniFront);
  const back = await imageOf(A, id.dniBack);
  // la versión sin internet (APK) no lleva el lector de texto ni la huella del rostro (pesan unos 19 MB)
  if (LOCAL) { out.note = 'el lector de texto y la comparación del rostro están solo en el panel en línea'; return out; }
  step('Comparando el rostro con la foto del DNI...');
  await breathe();
  try {
    const selfie = await imageOf(A, id.faces.find(f => f.pose === 'FRONT')?.photoId);
    if (front && selfie) {
      const [a, b] = await Promise.all([faceDescriptor(front), faceDescriptor(selfie)]);
      out.faceMatch = a && b ? { distance: faceDistance(a, b), level: faceMatchLevel(faceDistance(a, b)) } : null;
      if (!a) notes.push('no se encontró la cara en la foto del DNI');
    }
  } catch (e) { console.warn('[mesagri] comparación del rostro:', e); notes.push('la comparación del rostro no está disponible aquí'); }
  step('Leyendo el código del reverso del DNI...');
  await breathe();
  try {
    const { readMrz, findNumber } = await import('../vision/ocr');
    if (back) {
      const m = await readMrz(back);
      out.mrz = m ? { read: true, checks: m.ok, dni: m.dni, digit: m.ninth || undefined, surnames: m.surnames.join(' '), given: m.given.join(' '), birth: m.birth, expiry: m.expiry, sex: m.sex === '<' ? undefined : m.sex } : { read: false };
    }
    if (front) { step('Buscando el número en el frente del DNI...'); out.frontDni = await findNumber(front, id.dni); }
  } catch (e) { console.warn('[mesagri] lector de texto:', e); notes.push('el lector de texto no está disponible aquí (solo en el panel en línea)'); }
  if (notes.length) out.note = notes.join('; ');
  return out;
}

const REG_LABEL: Record<string, [string, 'warn' | 'danger' | 'info' | 'gray' | '']> = {
  MATCH: ['Coincide', ''], PARTIAL: ['Coincide en parte', 'warn'], NAME_MISMATCH: ['No coincide', 'danger'], NOT_FOUND: ['No figura', 'warn'], DECEASED: ['Fallecido', 'danger'], UNAVAILABLE: ['Sin respuesta', 'gray'],
};
function Row({ ok, title, sub, right }: { ok: boolean | null | undefined; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="rowx">
      <span className={'icirc ' + (ok === true ? 'dark' : ok === false ? 'danger' : 'warn')} style={{ width: '22px', height: '22px' }}>{ok === true ? <Icon n="check" s="12" w={3} /> : ok === false ? <Icon n="x" s="12" w={3} /> : <Icon n="info" s="12" />}</span>
      <div><b>{title}</b>{sub && <small>{sub}</small>}</div>
      <div>{right}</div>
    </div>
  );
}

export function IdentityReview({ k }: { k: VerifCase }) {
  const A = useApp();
  const id = k.identity!;
  const [busy, setBusy] = useState('');
  const [local, setLocal] = useState<DocReview | undefined>();
  const [asking, setAsking] = useState(false);
  const r = local ?? id.review;
  const decides = canDecide(A);
  const run = async () => {
    setBusy('Preparando la revisión...');
    try {
      const out = await review(A, id, setBusy);
      setLocal(out);
      if (decides) A.act('VERIF_AUTOCHECK', { caseId: k.id, review: out }, { quiet: true });
    } catch { A.toast('No se pudo hacer la revisión automática aquí.', 'warn'); }
    setBusy('');
  };
  // la primera vez que alguien que verifica abre el expediente, se revisa solo (primero se ve el expediente)
  useEffect(() => {
    if (id.review || !decides || !(id.dniFront || id.dniBack || id.faces.length)) return undefined;
    const t = setTimeout(() => { void run(); }, 600);
    return () => clearTimeout(t);
  }, [k.id]);
  const recheckDni = async () => {
    setAsking(true);
    try { await api(`/admin/cases/${encodeURIComponent(k.id)}/dni-check`, { method: 'POST', body: {}, token: await A.store.sessions.token(A.me!.id) }); A.toast('Consultamos el DNI otra vez.'); }
    catch (e: any) { A.toast(e?.message ?? 'No se pudo consultar.', 'err'); }
    setAsking(false);
  };

  const reg = id.registry;
  const [regText, regTone]: [string, 'warn' | 'danger' | 'info' | 'gray' | ''] = reg ? REG_LABEL[reg.status] ?? ['—', 'gray'] : ['Consultando...', 'gray'];
  const src = !reg ? '' : reg.source === 'PROVEEDOR' ? `RENIEC (por ${reg.provider ?? 'el proveedor'})` : reg.source === 'PADRON_PRUEBA' ? 'padrón de prueba de la demo' : 'sin proveedor configurado';
  const digit = dniDigitOk(id.dni, id.digit);
  const live = id.faces.length === 3 && facesConsistent(id.faces);
  const allLive = id.faces.length > 0 && id.faces.every(f => f.live);
  const m = r?.mrz;
  const mNames = m?.read && m.surnames ? compareNames(id.name, { surnames: m.surnames, given: m.given ?? '' }) : undefined;
  const born = m?.birth ? mrzDate(m.birth, 'birth', A.now) : undefined;
  const exp = m?.expiry ? mrzDate(m.expiry, 'expiry', A.now) : undefined;
  const expired = exp ? Date.parse(exp + 'T23:59:59-05:00') < A.now : undefined;
  const age = born ? ageOn(born, A.now) : undefined;
  const fm = r?.faceMatch;
  const fmTone: 'warn' | 'danger' | 'gray' | '' = fm ? (fm.level === 'ALTA' ? '' : fm.level === 'MEDIA' ? 'warn' : 'danger') : 'gray';
  const pose = (p: FacePose) => r?.faces?.find(f => f.pose === p);
  const deceased = reg?.status === 'DECEASED' || reg?.deceased === true;
  return (
    <div className="wcard" role="region" aria-label="Revisión automática de identidad">
      <div className="row between wrap"><h2>Revisión automática de identidad</h2>
        <div className="row g8">{decides && <Btn sm kind="sec" icon="refresh-cw" disabled={!!busy} onClick={() => { void run(); }}>Revisar de nuevo</Btn>}{decides && <Btn sm kind="sec" disabled={asking} onClick={() => { void recheckDni(); }}>Consultar el DNI otra vez</Btn>}</div>
      </div>
      {busy && <p className="wnote" role="status" style={{ marginTop: 0 }}><i className="spin" style={{ borderColor: 'rgba(44,95,45,.25)', borderTopColor: '#2C5F2D', width: '14px', height: '14px', display: 'inline-block', verticalAlign: '-2px', marginRight: '6px' }} />{busy}</p>}
      <div className="idrev">
        <Row ok={reg ? reg.status === 'MATCH' || reg.status === 'PARTIAL' ? true : reg.status === 'UNAVAILABLE' || (reg.status === 'NOT_FOUND' && reg.source !== 'PROVEEDOR') ? null : false : null}
          title={<>DNI {id.dni}{id.digit ? ` - ${id.digit}` : ''} · {id.name}</>}
          sub={<>{reg ? `Consulta: ${src}${reg.officialName ? ` · nombre oficial: ${reg.officialName}` : ''}${reg.note ? ` · ${reg.note}` : ''}` : 'El servidor está consultando el DNI.'}{digit === false ? ' · el dígito escrito no corresponde al número' : ''}</>}
          right={<Pill tone={regTone}>{regText}</Pill>} />
        <Row ok={deceased ? false : reg?.deceased === false ? true : null}
          title="Persona viva"
          sub={deceased ? 'La fuente dice que el titular de este DNI falleció.' : reg?.deceased === false ? 'Según la fuente, el titular no figura como fallecido.' : 'La fuente no informa fallecimientos (solo el servicio de RENIEC para entidades lo hace). Lo cubren la prueba de vida y el parecido con la foto del DNI.'}
          right={<Pill tone={deceased ? 'danger' : reg?.deceased === false ? '' : 'gray'}>{deceased ? 'Fallecido' : reg?.deceased === false ? 'Vivo' : 'No informado'}</Pill>} />
        <Row ok={id.faces.length ? live : null}
          title="Prueba de vida: rostro en tres ángulos"
          sub={id.faces.length ? `${allLive ? 'Tomadas en vivo con la cámara guiada de la app' : 'Tomadas con la cámara del celular'} · ${id.faces.map(f => `${POSE_LABEL[f.pose].toLowerCase()} ${f.auto?.yaw ?? '?'}°`).join(' · ')}` : 'Sin fotos del rostro.'}
          right={<Pill tone={live ? '' : 'warn'}>{live ? 'Bien' : 'Revisar'}</Pill>} />
        {id.faces.length > 0 && (
          <div className="faces3">{POSES.map(p => { const s = id.faces.find(f => f.pose === p); const c = pose(p); return s ? <figure key={p} style={{ margin: 0 }}><div className="photo"><Photo id={s.photoId} /></div><figcaption className="cap">{POSE_LABEL[p]}{c?.yaw !== undefined ? ` · ${c.yaw}°` : s.auto?.yaw !== undefined ? ` · ${s.auto.yaw}°` : ''} {(c ? c.ok : s.auto?.ok) ? '✓' : '⚠'}</figcaption></figure> : <div key={p} />; })}</div>
        )}
        <Row ok={fm ? fm.level !== 'BAJA' : fm === null ? false : null}
          title="Rostro y foto del DNI"
          sub={fm ? `Distancia ${fm.distance.toFixed(2).replace('.', ',')} (hasta 0,45 es muy parecido; más de 0,58, poco).` : fm === null ? 'No se encontró la cara en alguna de las fotos.' : r?.note?.includes('comparación') ? 'La comparación no está disponible aquí.' : 'Sin comparar todavía.'}
          right={<Pill tone={fmTone}>{fm ? `Parecido ${({ ALTA: 'alto', MEDIA: 'medio', BAJA: 'bajo' } as const)[fm.level]}` : '—'}</Pill>} />
        <Row ok={m ? (m.read && m.checks && m.dni === id.dni && mNames?.status !== 'MISMATCH' && !expired && (age ?? 18) >= 18) : null}
          title="Código del reverso del DNI"
          sub={m ? (m.read ? <>
            {m.checks ? 'Dígitos de control correctos' : 'Leído con dudas (los dígitos de control no cuadran)'} · DNI {m.dni} {m.dni === id.dni ? '✓' : '✗ distinto del escrito'}
            {m.digit ? ` · dígito ${m.digit} ${id.digit ? (m.digit === id.digit ? '✓' : '✗') : ''}` : ''}
            {m.surnames ? ` · ${m.surnames}, ${m.given} ${mNames?.status === 'MISMATCH' ? '✗ no coincide con el nombre escrito' : '✓'}` : ''}
            {born ? ` · nació el ${born.split('-').reverse().join('/')} (${age} años${(age ?? 18) < 18 ? ', menor de edad' : ''})` : ''}
            {exp ? ` · ${expired ? 'venció' : 'vence'} el ${exp.split('-').reverse().join('/')}` : ''}
          </> : 'No se pudo leer: pide una foto más nítida del reverso.') : r?.note?.includes('lector') ? 'El lector de texto está solo en el panel en línea.' : 'Sin leer todavía.'}
          right={<Pill tone={!m ? 'gray' : !m.read ? 'warn' : m.checks && m.dni === id.dni ? '' : 'danger'}>{!m ? '—' : !m.read ? 'Sin leer' : m.checks && m.dni === id.dni ? 'Coincide' : 'Revisar'}</Pill>} />
        <Row ok={r?.frontDni ?? null} title="Número en el frente del DNI" sub={r?.frontDni === true ? 'Se lee el mismo número en la foto del frente.' : r?.frontDni === false ? 'No se lee el número: revisa la foto del frente.' : 'Sin leer todavía.'} right={<Pill tone={r?.frontDni ? '' : r?.frontDni === false ? 'warn' : 'gray'}>{r?.frontDni ? 'Se lee' : r?.frontDni === false ? 'No se lee' : '—'}</Pill>} />
      </div>
      {k.alerts.some(a => Object.values(ID_ALERTS).includes(a)) && <p className="wnote" style={{ color: 'var(--danger)', fontWeight: 700 }}>{k.alerts.filter(a => Object.values(ID_ALERTS).includes(a)).join(' · ')}</p>}
      <p className="wnote">La revisión automática orienta; decide una persona (RN-16). Las fotos del DNI y del rostro se borran a los 90 días (Ley 29733).{id.review ? ` Última revisión: ${new Date(id.review.at).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })}` : ''}</p>
    </div>
  );
}
