/*
 * Panel web de administración (3): lo que el equipo necesita para administrar de verdad.
 * - Cuentas (W-05): corregir datos (nombre del DNI, DNI, celular, negocio), ver el celular y el DNI
 *   completos (queda en auditoría), sus publicaciones y pedidos, y eliminar la cuenta.
 * - Mensajes de ayuda (W-21): bandeja de consultas con respuesta, cierre y respuestas rápidas.
 * - Cobros (W-14): las cuentas donde le pagan a Mesagri (con doble aprobación) y el cruce de los
 *   pagos por conciliar con el extracto del banco o de Yape.
 * - Pedidos (W-07): el detalle del pago de cada pedido y la cancelación por Soporte.
 * Cada acción exige un motivo y queda en auditoría.
 */
import { useMemo, useRef, useState } from 'react';
import { reg } from './registry';
import { useApp } from '../ctx';
import { Btn, Icon, Inp, Sel, Photo } from '../ui/kit';
import { WebFrame, Pill, Tabs, Row, WSearch, norm, roleOf, adminName } from './admin';
import { DELETE_TOPIC } from './common';
import { product, UNIT_LABEL } from '@mesagri/shared/catalog';
import { deletionCheck } from '@mesagri/shared/engine/accounts';
import { paymentStrikes, ticketNeedsReply, mesagriData } from '@mesagri/shared/queries';
import { isPhoneValid, isDniValid, isRucValid } from '@mesagri/shared/rules';
import { money, dateShort, hhmm, ago, dateNum, numTrim, kg as fkg } from '@mesagri/shared/format';
import { districtName } from '@mesagri/shared/ubigeo';
import { orgName, itemsShort, statusInfo, PAY_LABEL, deliveryText } from '../helpers';
import { districtOptions } from './onboarding';
import { fmtPhone, fmtCci } from '../ui/pay';
import type { Org, User, SubOrder, Ticket, Listing, Statement, SubInvoice, World } from '@mesagri/shared/types';
import type { CollectAccount } from '@mesagri/shared/settings';

const TYPE_LABEL: Record<string, string> = { FARMER: 'agricultor', BUYER: 'MYPE', WAREHOUSE: 'almacén', CARRIER: 'transportista', MESAGRI: 'Mesagri' };
const LISTING_STATUS: Record<Listing['status'], [string, '' | 'warn' | 'danger' | 'info' | 'gray']> = {
  ACTIVE: ['Activa', ''], PAUSED: ['Pausada', 'warn'], SOLD_OUT: ['Agotada', 'gray'], EXPIRED: ['Vencida', 'gray'], IN_REVIEW: ['En revisión', 'warn'],
  REJECTED: ['Oculta', 'danger'], REMOVED: ['Eliminada', 'gray'], QUEUED: ['Por enviar', 'gray'],
};
export const listingPill = (l: Listing) => { const [t, tone] = LISTING_STATUS[l.status] ?? [l.status, 'gray']; return <Pill tone={tone}>{t}</Pill>; };
export const listingTitle = (l: Listing) => `${product(l.productId).name}${l.variety ? ` ${l.variety}` : ''} · ${l.unit === 'kg' ? fkg(l.available) : `${numTrim(l.available)} ${UNIT_LABEL[l.unit].many}`}`;

/* ================= Pago de un pedido: cómo va y con qué datos ================= */
export function payState(s: SubOrder, now: number): [string, '' | 'warn' | 'danger' | 'info' | 'gray'] {
  const p = s.payment;
  if (p.method === 'CASH') return p.status === 'CONFIRMED' ? ['Efectivo cobrado', ''] : ['Efectivo al entregar', 'gray'];
  if (p.status === 'CONFIRMED') return ['Confirmado por el agricultor', ''];
  if (p.status === 'NOT_RECEIVED') return ['El agricultor dice que no llegó', 'danger'];
  if (p.status === 'UPLOADED') return [`Constancia sin confirmar · ${ago(p.uploadedAt ?? now, now).replace('hace ', '')}`, now - (p.uploadedAt ?? now) > 24 * 3600_000 ? 'danger' : 'warn'];
  if (['REJECTED', 'EXPIRED', 'CANCELLED_BY_BUYER', 'CANCELLED_BY_SELLER', 'PENDING_CONFIRMATION'].includes(s.status)) return ['—', 'gray'];
  return ['Por pagar', 'info'];
}

/** Los datos de la constancia, para comparar con lo que muestra quien cobra. */
export function ProofTable({ pay, amount }: { pay: { method: string; operation?: string; payerName?: string; securityCode?: string; photoId?: string; at?: number; paidAt?: number }; amount?: number }) {
  const at = pay.paidAt ?? pay.at;
  return (
    <div className="stack tight">
      <table className="wtable"><tbody>
        <tr><td>Medio</td><td className="r"><b>{PAY_LABEL[pay.method as 'YAPE'] ?? pay.method}</b></td></tr>
        {amount !== undefined && <tr><td>Monto</td><td className="r"><b>{money(amount)}</b></td></tr>}
        <tr><td>N.º de operación</td><td className="r"><b className="tnum">{pay.operation || '—'}</b></td></tr>
        <tr><td>A nombre de</td><td className="r"><b>{pay.payerName ?? '— (no lo indicó)'}</b></td></tr>
        {pay.method === 'YAPE' && <tr><td>Código de seguridad de Yape</td><td className="r"><b className="tnum" style={{ letterSpacing: '.12em' }}>{pay.securityCode ?? '— (no lo indicó)'}</b></td></tr>}
        {at !== undefined && <tr><td>Fecha y hora del pago</td><td className="r"><b>{dateShort(at)} · {hhmm(at)}</b></td></tr>}
      </tbody></table>
      {pay.photoId && <div style={{ maxWidth: '260px' }}><Photo id={pay.photoId} label="Captura de la constancia" /></div>}
    </div>
  );
}

/* ================= W-05 · Herramientas de una cuenta ================= */
export function AccountTools({ o }: { o: Org }) {
  const A = useApp();
  const role = roleOf(A);
  const w = A.w;
  const [mode, setMode] = useState<'' | 'edit' | 'delete'>(A.top.p?.del && A.top.p?.id === o.id ? 'delete' : '');
  const [shown, setShown] = useState(false);
  const members = Object.values(w.users).filter(u => u.orgId === o.id);
  const strikes = o.type === 'BUYER' ? paymentStrikes(w, o.id) : 0;
  const listings = Object.values(w.listings).filter(l => l.orgId === o.id && l.status !== 'REMOVED').sort((a, b) => b.createdAt - a.createdAt);
  const open = Object.values(w.subOrders).filter(s => (s.buyerOrgId === o.id || s.sellerOrgId === o.id) && ['PENDING_CONFIRMATION', 'CONFIRMED', 'AWAITING_HARVEST', 'PREPARING', 'READY', 'IN_TRANSIT', 'DELIVERED', 'DISPUTED'].includes(s.status)).sort((a, b) => b.createdAt - a.createdAt);
  const tickets = Object.values(w.tickets).filter(t => t.orgId === o.id && t.status === 'OPEN');
  const comments = Object.values(w.reviews).flatMap(r => [...(r.fromOrg === o.id && r.comment ? [{ r, part: 'comment' as const }] : []), ...(r.toOrg === o.id && r.reply ? [{ r, part: 'reply' as const }] : [])]).sort((a, b) => b.r.at - a.r.at);
  const asksDelete = tickets.find(t => t.topic === DELETE_TOPIC);
  const canEdit = role === 'GENERAL' || role === 'SUPPORT';
  if (o.status === 'DELETED') return (
    <div className="stack tight" style={{ marginTop: '12px' }}>
      <p className="wnote" style={{ color: 'var(--danger)', fontWeight: 700, margin: 0 }}>Cuenta eliminada{o.deletedAt ? ` el ${dateNum(o.deletedAt)}` : ''}{o.deletedReason ? `: ${o.deletedReason}` : ''}.</p>
      <p className="wnote" style={{ margin: 0 }}>Sus datos personales, fotos de identidad y publicaciones se borraron. Quedan sus pedidos y pagos sin su nombre (la otra parte y la SUNAT los necesitan). El detalle está en la auditoría.</p>
    </div>
  );
  const reveal = () => {
    if (!shown) A.act('AUDIT_VIEW', { entity: o.id, detail: 'Vio el celular y el DNI completos de la cuenta' }, { quiet: true });
    setShown(!shown);
  };
  return (
    <div className="stack" style={{ marginTop: '14px' }}>
      {strikes > 0 && <p className="wnote" style={{ color: 'var(--danger)', fontWeight: 700, margin: 0 }}><Icon n="triangle-alert" s="15" /> {strikes === 1 ? 'Un pago suyo no llegó' : `${strikes} pagos suyos no llegaron`} (Soporte lo confirmó). Puede estar usando constancias falsas: si se repite, suspende la cuenta.</p>}
      {asksDelete && <p className="wnote" style={{ color: 'var(--terra6)', fontWeight: 700, margin: 0 }}><Icon n="user-x" s="15" /> Pidió que borren su cuenta ({asksDelete.code}, {ago(asksDelete.at, A.now)}).</p>}
      <div>
        <div className="sect">Personas{canEdit ? '' : ''}</div>
        <div className="stack tight">{members.map(u => <div key={u.id} style={{ fontSize: '14.5px' }}><b>{u.name}</b>{u.status !== 'ACTIVE' ? <span className="cap"> · {u.status === 'SUSPENDED' ? 'sin acceso' : 'eliminada'}</span> : null}<div className="cap">{shown ? `Celular ${fmtPhone(u.phone)}${u.dni ? ` · DNI ${u.dni}` : ''}` : `Celular ${u.phone.slice(0, 3)} ••• ${u.phone.slice(-3)}${u.dni ? ` · DNI ••••${u.dni.slice(-3)}` : ''}`}{u.id === o.memberIds[0] ? ' · titular' : ''}</div></div>)}</div>
        {shown && o.address && <div className="cap" style={{ marginTop: '6px' }}>Dirección: {o.address}</div>}
      </div>
      <div className="row g8 wrap">
        {role !== 'ANALYST' && <Btn sm kind="sec" icon={shown ? 'eye-off' : 'eye'} onClick={reveal}>{shown ? 'Ocultar datos' : 'Ver celular y DNI'}</Btn>}
        {shown && members[0] && isPhoneValid(members[0].phone) && <a className="btn sec sm" href={`https://wa.me/51${members[0].phone}`} target="_blank" rel="noopener noreferrer"><Icon n="smartphone" s="1.25em" />WhatsApp</a>}
        {canEdit && <Btn sm kind={mode === 'edit' ? 'dark' : 'sec'} icon="pencil" onClick={() => setMode(mode === 'edit' ? '' : 'edit')}>Corregir datos</Btn>}
        {role === 'GENERAL' && <Btn sm kind={mode === 'delete' ? 'danger' : 'secd'} icon="trash" onClick={() => setMode(mode === 'delete' ? '' : 'delete')}>Eliminar cuenta</Btn>}
      </div>
      {mode === 'edit' && <EditAccount o={o} members={members} onDone={() => setMode('')} />}
      {mode === 'delete' && <DeleteAccount o={o} onDone={() => setMode('')} />}
      {(listings.length > 0 || o.type === 'FARMER') && <div>
        <div className="sect">Publicaciones ({listings.length})</div>
        {listings.length ? <table className="wtable"><tbody>{listings.slice(0, 8).map(l => <tr key={l.id}><td>{listingTitle(l)}<div className="cap">{money(l.price)} por {l.unit === 'kg' ? 'kg' : UNIT_LABEL[l.unit].one} · {dateShort(l.createdAt)}</div></td><td className="r">{listingPill(l)}</td><td className="r"><Btn xs kind="sec" onClick={() => A.go('W-06', { id: l.id, all: 1 })}>Abrir</Btn></td></tr>)}</tbody></table> : <p className="wnote" style={{ margin: 0 }}>Sin publicaciones.</p>}
        {listings.length > 8 && <button className="linkbtn" onClick={() => A.go('W-06', { q: o.name, all: 1 })}>Ver las {listings.length}</button>}
      </div>}
      {comments.length > 0 && <div>
        <div className="sect">Comentarios que escribió ({comments.length})</div>
        <table className="wtable"><tbody>{comments.slice(0, 6).map(({ r, part }) => <tr key={r.id + part}><td>«{part === 'reply' ? r.reply : r.comment}»<div className="cap">{part === 'reply' ? 'respuesta a una opinión' : `${r.stars} ★ a ${orgName(w, r.toOrg)}`} · {dateShort(r.at)}</div></td><td className="r">{canEdit && <Btn xs kind="secd" onClick={async () => { if (await A.confirm({ title: '¿Retirar este comentario?', text: 'Se borra el texto (las estrellas quedan). Le avisamos y queda en auditoría.', ok: 'Retirar', danger: true })) A.act('REVIEW_MODERATE', { reviewId: r.id, part, reason: 'No cumple las reglas de convivencia de Mesagri' }, { ok: 'Comentario retirado.' }); }}>Retirar</Btn>}</td></tr>)}</tbody></table>
      </div>}
      {open.length > 0 && <div>
        <div className="sect">Pedidos en curso ({open.length})</div>
        <table className="wtable"><tbody>{open.slice(0, 6).map(s => { const st = statusInfo(s, s.buyerOrgId === o.id ? 'buyer' : 'seller'); return <tr key={s.id}><td><b>{s.code}</b><div className="cap">{s.buyerOrgId === o.id ? `compra a ${orgName(w, s.sellerOrgId)}` : `vende a ${orgName(w, s.buyerOrgId)}`} · {money(s.total)}</div></td><td className="r"><Pill tone={st.tone === 'danger' ? 'danger' : st.tone === 'terra' || st.tone === 'warn' ? 'warn' : ''}>{st.label}</Pill></td><td className="r"><Btn xs kind="sec" onClick={() => A.go('W-07', { order: s.id })}>Abrir</Btn></td></tr>; })}</tbody></table>
      </div>}
    </div>
  );
}

function EditAccount({ o, members, onDone }: { o: Org; members: User[]; onDone: () => void }) {
  const A = useApp();
  const [org, setOrg] = useState({ name: o.name, legalName: o.legalName ?? '', ruc: o.ruc ?? '', district: o.district, address: o.address ?? '', receiver: o.receiver ?? '', pickupPoint: o.pickupPoint ?? '' });
  const [people, setPeople] = useState(members.filter(u => u.status !== 'DELETED').map(u => ({ userId: u.id, name: u.name, shortName: u.shortName, phone: u.phone, dni: u.dni ?? '' })));
  const [reason, setReason] = useState('');
  const setP = (i: number, patch: Partial<(typeof people)[number]>) => setPeople(people.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const changedOrg = Object.fromEntries(Object.entries(org).filter(([k, v]) => v !== ((o as any)[k] ?? (k === 'district' ? o.district : ''))));
  const changedUsers = people.map(p => { const u = A.w.users[p.userId]; const d: any = { userId: p.userId }; for (const k of ['name', 'shortName', 'phone', 'dni'] as const) if (p[k] !== ((u as any)[k] ?? '')) d[k] = p[k]; return d; }).filter(d => Object.keys(d).length > 1);
  const err = (() => {
    if (changedOrg.ruc && !isRucValid(changedOrg.ruc as string)) return 'El RUC no es válido (11 dígitos).';
    for (const p of people) { if (!isPhoneValid(p.phone)) return `El celular de ${p.shortName} tiene 9 dígitos y empieza con 9.`; if (p.dni && !isDniValid(p.dni)) return `El DNI de ${p.shortName} tiene 8 números.`; }
    if (!Object.keys(changedOrg).length && !changedUsers.length) return 'No hay cambios.';
    if (reason.trim().length < 5) return 'Escribe el motivo (queda en auditoría).';
    return '';
  })();
  const phoneChange = changedUsers.some(d => d.phone);
  const save = () => {
    const r = A.act('ACCOUNT_EDIT', { orgId: o.id, org: changedOrg, users: changedUsers, reason }, { ok: phoneChange ? 'Datos corregidos. Cerramos sus sesiones: entra con el celular nuevo.' : 'Datos corregidos. Le avisamos a la cuenta.' });
    if (r.ok) onDone();
  };
  const f = (label: string, k: keyof typeof org, opt: { area?: boolean; mode?: 'numeric' } = {}) => (
    <label className="fld"><span className="lbl">{label}</span><Inp value={org[k]} onInput={v => setOrg({ ...org, [k]: v })} label={label} area={opt.area} mode={opt.mode} /></label>
  );
  return (
    <div className="wcard" style={{ background: '#f7faf3' }}>
      <h2>Corregir datos</h2>
      <div className="grid2">
        {f(o.type === 'FARMER' ? 'Nombre que ven los compradores' : 'Nombre comercial', 'name')}
        {o.type !== 'FARMER' && f('Razón social', 'legalName')}
        {f(o.type === 'FARMER' ? 'RUC (si tiene)' : 'RUC', 'ruc', { mode: 'numeric' })}
        <label className="fld"><span className="lbl">Distrito</span><Sel value={org.district} onChange={v => setOrg({ ...org, district: v })} options={districtOptions()} label="Distrito" /></label>
        {f('Dirección', 'address')}
        {o.type === 'BUYER' && f('Quién recibe', 'receiver')}
        {o.type === 'FARMER' && f('Punto de recojo', 'pickupPoint')}
      </div>
      {people.map((p, i) => (
        <div key={p.userId} style={{ marginTop: '10px' }}>
          <div className="sect">{i === 0 ? 'Titular' : 'Persona'} · {A.w.users[p.userId]?.name}</div>
          <div className="grid2">
            <label className="fld"><span className="lbl">Nombre completo (como en el DNI)</span><Inp value={p.name} onInput={v => setP(i, { name: v })} label="Nombre completo" /></label>
            <label className="fld"><span className="lbl">Cómo lo llamamos</span><Inp value={p.shortName} onInput={v => setP(i, { shortName: v })} label="Cómo lo llamamos" /></label>
            <label className="fld"><span className="lbl">Celular con el que entra</span><Inp value={p.phone} onInput={v => setP(i, { phone: v.replace(/\D/g, '').slice(0, 9) })} mode="numeric" label="Celular" /></label>
            <label className="fld"><span className="lbl">DNI</span><Inp value={p.dni} onInput={v => setP(i, { dni: v.replace(/\D/g, '').slice(0, 8) })} mode="numeric" label="DNI" /></label>
          </div>
        </div>
      ))}
      <label className="fld" style={{ marginTop: '10px' }}><span className="lbl">Motivo (queda en auditoría)</span><Inp value={reason} onInput={setReason} placeholder="Lo pidió por WhatsApp: cambió de celular" label="Motivo" /></label>
      {phoneChange && <p className="wnote" style={{ margin: '6px 0 0' }}>Al cambiar el celular se cierran sus sesiones: vuelve a entrar con el número nuevo y el código que le llega.</p>}
      <div className="row g8 wrap" style={{ marginTop: '10px' }}><Btn sm kind="dark" disabled={!!err} why={err || undefined} onClick={save}>Guardar cambios</Btn><Btn sm kind="sec" onClick={onDone}>Cancelar</Btn></div>
      <p className="wnote">Verifica antes con la persona (por ejemplo, con una llamada a su celular registrado o con la foto de su DNI en el expediente). Se le avisa en la app.</p>
    </div>
  );
}

function DeleteAccount({ o, onDone }: { o: Org; onDone: () => void }) {
  const A = useApp();
  const chk = useMemo(() => deletionCheck(A.w, o.id), [A.w, o.id]);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const err = chk.blockers.length ? 'Primero resuelve lo que está en curso.' : reason.trim().length < 5 ? 'Escribe el motivo.' : typed.trim().toUpperCase() !== 'ELIMINAR' ? 'Escribe ELIMINAR para confirmar.' : '';
  const sample = !!A.w.users[o.memberIds[0]]?.persona;
  const del = () => { const r = A.act('ACCOUNT_DELETE', { orgId: o.id, reason }, { ok: `Cuenta eliminada: ${o.name}. Sus datos personales se borraron.` }); if (r.ok) onDone(); };
  return (
    <div className="wcard" style={{ borderColor: 'var(--danger)' }}>
      <h2>Eliminar la cuenta de {o.name}</h2>
      <table className="wtable"><tbody>
        <tr><td>Se borra</td><td>Nombre, celular, DNI, dirección, cuentas de cobro, fotos del DNI y del rostro, y {chk.listings} {chk.listings === 1 ? 'publicación' : 'publicaciones'} con sus fotos. No vuelve a entrar.</td></tr>
        <tr><td>Queda</td><td>Sus pedidos, pagos, calificaciones y reclamos, sin su nombre: la otra parte y la SUNAT los necesitan.</td></tr>
        <tr><td>Celular y DNI</td><td>Quedan libres: podría registrarse otra vez.</td></tr>
      </tbody></table>
      {chk.blockers.length > 0 && <div className="stack tight" style={{ marginTop: '10px' }}><b style={{ color: 'var(--danger)' }}>Todavía no se puede:</b>{chk.blockers.map(b => <div key={b} className="wnote" style={{ margin: 0 }}>• {b}</div>)}</div>}
      {chk.warnings.map(x => <p key={x} className="wnote" style={{ margin: '6px 0 0' }}><Icon n="info" s="14" /> {x}</p>)}
      {sample && <p className="wnote" style={{ margin: '6px 0 0' }}><Icon n="info" s="14" /> Es una cuenta de ejemplo de la demo: vuelve al reiniciar la demo.</p>}
      <p className="wnote" style={{ fontWeight: 700 }}>Si es por fraude o malas prácticas, mejor «Suspender»: así no puede registrarse otra vez con el mismo DNI y celular.</p>
      <label className="fld"><span className="lbl">Motivo (queda en auditoría)</span><Inp value={reason} onInput={setReason} placeholder="Lo pidió desde la app (consulta #118), Ley 29733" label="Motivo" /></label>
      <label className="fld"><span className="lbl">Escribe ELIMINAR para confirmar</span><Inp value={typed} onInput={setTyped} placeholder="ELIMINAR" label="Confirmación" /></label>
      <div className="row g8 wrap" style={{ marginTop: '10px' }}><Btn sm kind="danger" disabled={!!err} why={err || undefined} onClick={del}>Eliminar la cuenta</Btn><Btn sm kind="sec" onClick={onDone}>Cancelar</Btn></div>
    </div>
  );
}

/* ================= W-21 · Mensajes de ayuda ================= */
const QUICK_REPLIES = [
  'Gracias por escribirnos. Ya lo revisamos y te avisamos por aquí.',
  'Para cambiar tu número de Yape: Perfil › Cuentas de cobro. La cuenta nueva se verifica con tu DNI.',
  'Para pagar tu estado de cuenta: Perfil › Estado de cuenta › Pagar, y escribe el número de operación y a nombre de quién sale el pago.',
  'Revisa tus movimientos en tu propia app (Yape o banco) antes de confirmar un pago: una captura sola no basta.',
  'Tu cuenta ya quedó eliminada y tus datos personales se borraron. Gracias por usar Mesagri.',
];
type HTab = 'PEND' | 'ANS' | 'CLOSED' | 'ALL';
function HelpInbox() {
  const A = useApp();
  const w = A.w;
  const all = Object.values(w.tickets);
  const [tab, setTab] = useState<HTab>('PEND');
  const [q, setQ] = useState('');
  const pend = all.filter(t => ticketNeedsReply(w, t));
  const list = all.filter(t => (tab === 'ALL' || (tab === 'PEND' ? ticketNeedsReply(w, t) : tab === 'ANS' ? t.status === 'OPEN' && !ticketNeedsReply(w, t) : t.status === 'CLOSED')) && (!q || norm(`${t.code} ${orgName(w, t.orgId)} ${t.topic} ${t.text} ${t.replies.map(r => r.text).join(' ')}`).includes(norm(q))))
    .sort((a, b) => lastAt(b) - lastAt(a));
  const [sel, setSel] = useState<string | undefined>(A.top.p?.id ?? pend.sort((a, b) => a.at - b.at)[0]?.id ?? list[0]?.id);
  const t = sel ? w.tickets[sel] : undefined;
  return (
    <WebFrame title="Mensajes de ayuda" sub="Consultas que llegan desde la app (Perfil › Ayuda). Se responden aquí: a la persona le llega el aviso y lo lee en su consulta." right={<WSearch value={q} onInput={setQ} placeholder="Buscar consulta, cuenta o texto" />}>
      <Tabs value={tab} onChange={setTab} options={[['PEND', `Por responder (${pend.length})`], ['ANS', 'Respondidas'], ['CLOSED', 'Cerradas'], ['ALL', 'Todas']]} />
      <div className="split">
        <div className="wcard">
          <table className="wtable resp"><thead><tr><th>Consulta</th><th>Cuenta</th><th>Último mensaje</th><th>Estado</th></tr></thead>
            <tbody>{list.map(x => { const last = x.replies[x.replies.length - 1]; const needs = ticketNeedsReply(w, x); return (
              <Row key={x.id} sel={x.id === sel} onOpen={() => setSel(x.id)}>
                <td data-l="Consulta"><b>{x.code}</b> · {x.topic}{x.topic === DELETE_TOPIC && <> <Pill tone="danger">Borrar cuenta</Pill></>}</td>
                <td data-l="Cuenta">{orgName(w, x.orgId)}<div className="cap">{TYPE_LABEL[w.orgs[x.orgId]?.type ?? ''] ?? ''}</div></td>
                <td data-l="Último" style={{ maxWidth: '260px' }}><div className="ell">{(last?.text ?? x.text)}</div><div className="cap">{ago(lastAt(x), A.now)}</div></td>
                <td data-l="Estado"><Pill tone={x.status === 'CLOSED' ? 'gray' : needs ? 'warn' : 'info'}>{x.status === 'CLOSED' ? 'Cerrada' : needs ? (last ? 'Te respondió' : 'Nueva') : 'Respondida'}</Pill></td>
              </Row>
            ); })}</tbody></table>
          {list.length === 0 && <p className="wnote">{tab === 'PEND' ? 'Nada por responder. Bien.' : 'Sin consultas con ese filtro.'}</p>}
        </div>
        {t && <TicketThread t={t} key={t.id} />}
      </div>
    </WebFrame>
  );
}
const lastAt = (t: Ticket) => t.replies.length ? t.replies[t.replies.length - 1].at : t.at;

function TicketThread({ t }: { t: Ticket }) {
  const A = useApp();
  const w = A.w;
  const [txt, setTxt] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const u = w.users[t.userId];
  const o = w.orgs[t.orgId];
  const send = (close: boolean) => {
    const text = txt.trim() || (close ? 'Cerramos la consulta. Si necesitas algo más, escríbenos por aquí.' : '');
    if (!text) { A.toast('Escribe la respuesta.', 'warn'); return; }
    if (A.act('TICKET_REPLY', { ticketId: t.id, text, close }, { ok: close ? `Respuesta enviada y consulta ${t.code} cerrada.` : `Respuesta enviada: a ${orgName(w, t.orgId)} le llega el aviso.` }).ok) setTxt('');
  };
  return (
    <div className="wcard">
      <div className="row between wrap"><h2 style={{ margin: 0 }}>Consulta {t.code} · {t.topic}</h2><Pill tone={t.status === 'CLOSED' ? 'gray' : ticketNeedsReply(w, t) ? 'warn' : 'info'}>{t.status === 'CLOSED' ? 'Cerrada' : ticketNeedsReply(w, t) ? 'Por responder' : 'Respondida'}</Pill></div>
      <p className="wnote" style={{ marginTop: '4px' }}>{u?.name ?? '—'} · {orgName(w, t.orgId)} ({TYPE_LABEL[o?.type ?? ''] ?? ''}) · {dateShort(t.at)} {hhmm(t.at)}</p>
      <div className="row g8 wrap" style={{ marginBottom: '10px' }}>
        {o && o.type !== 'MESAGRI' && <Btn xs kind="sec" icon="user" onClick={() => A.go('W-05', { id: o.id })}>Ver la cuenta</Btn>}
        {t.topic === DELETE_TOPIC && o?.status !== 'DELETED' && roleOf(A) === 'GENERAL' && <Btn xs kind="secd" icon="trash" onClick={() => A.go('W-05', { id: t.orgId, del: 1 })}>Eliminar la cuenta</Btn>}
        {t.topic === DELETE_TOPIC && o?.status === 'DELETED' && <Pill tone="gray">La cuenta ya se eliminó</Pill>}
      </div>
      <div className="stack tight" style={{ maxHeight: '420px', overflowY: 'auto' }}>
        <div className="wmsg">{t.text}<small>{u?.shortName ?? 'Usuario'} · {dateShort(t.at)} {hhmm(t.at)}</small></div>
        {t.replies.map((r, i) => { const team = w.users[r.by]?.role === 'ADMIN'; return <div key={i} className="wmsg" style={team ? { background: 'var(--field)', color: '#fff', marginLeft: '2em' } : undefined}>{r.text}<small>{team ? adminName(w, r.by) : w.users[r.by]?.shortName ?? 'Usuario'} · {dateShort(r.at)} {hhmm(r.at)}</small></div>; })}
        <div ref={end} />
      </div>
      <div className="sect" style={{ marginTop: '12px' }}>Respuestas rápidas</div>
      <div className="chips">{QUICK_REPLIES.map(x => <button key={x} className="chip line" onClick={() => setTxt(x)} title={x}>{x.length > 46 ? x.slice(0, 44) + '…' : x}</button>)}</div>
      <div style={{ marginTop: '8px' }}><Inp area value={txt} onInput={setTxt} placeholder={t.status === 'CLOSED' ? 'Escribe para volver a abrirla' : 'Escribe la respuesta'} label="Respuesta" /></div>
      <div className="row g8 wrap" style={{ justifyContent: 'flex-end', marginTop: '10px' }}>
        {t.status === 'OPEN' && <Btn sm kind="sec" onClick={() => send(true)}>Responder y cerrar</Btn>}
        <Btn sm kind="dark" onClick={() => send(false)}>{t.status === 'CLOSED' ? 'Responder y reabrir' : 'Responder'}</Btn>
      </div>
      <p className="wnote">La persona lo lee en su consulta (Perfil › Ayuda) y le llega un aviso. Si responde, la consulta vuelve a «Por responder».</p>
    </div>
  );
}

/* ================= W-14 · Cuentas de Mesagri (doble aprobación) ================= */
export function MesagriAccounts() {
  const A = useApp();
  const d = mesagriData(A.w);
  const role = roleOf(A);
  const [editing, setEditing] = useState(false);
  const [accounts, setAccounts] = useState<CollectAccount[]>(d.example ? [{ kind: 'YAPE', number: '', holder: 'Mesagri S.A.C.' }, { kind: 'BANK', number: '', holder: 'Mesagri S.A.C.', bank: '', cci: '' }] : d.accounts.map(a => ({ ...a })));
  const [wa, setWa] = useState(d.whatsapp ?? '');
  const [reason, setReason] = useState('');
  const set = (i: number, patch: Partial<CollectAccount>) => setAccounts(accounts.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const pd = d.pending;
  const mine = pd?.by === A.me?.id;
  const line = (a: CollectAccount) => a.kind === 'BANK' ? `${a.bank ?? 'Banco'} · cuenta ${a.number} · CCI ${fmtCci(a.cci ?? '')} · ${a.holder}` : `${a.kind === 'PLIN' ? 'Plin' : 'Yape'} ${fmtPhone(a.number)} · ${a.holder}`;
  const propose = () => {
    const r = A.act('MESAGRI_DATA_PROPOSE', { accounts, whatsapp: wa, reason }, { quiet: true });
    if (!r.ok) { A.toast(r.error!.message, 'err'); return; }
    A.toast(r.result?.applied ? 'Listo: la gente ya ve las cuentas nuevas.' : 'Cambio propuesto: lo aprueba otra persona de administración general.');
    setEditing(false); setReason('');
  };
  return (
    <div className="split">
      <div className="stack">
        <div className="wcard">
          <h2>Dónde le pagan a Mesagri</h2>
          {d.example && <p className="wnote" style={{ color: 'var(--terra6)', fontWeight: 700 }}>Hoy son datos de ejemplo: la gente ve «(ejemplo)» y no puede pagarte de verdad. Pon la cuenta real de Mesagri.</p>}
          <table className="wtable"><tbody>{d.accounts.map((a, i) => <tr key={i}><td>{a.kind === 'BANK' ? 'Transferencia' : a.kind === 'PLIN' ? 'Plin' : 'Yape'}</td><td><b>{line(a)}</b></td></tr>)}
            <tr><td>WhatsApp de Soporte</td><td><b>{d.whatsapp ? fmtPhone(d.whatsapp) : 'Sin WhatsApp: la ayuda es solo por la app'}</b></td></tr></tbody></table>
          {d.updatedAt && <p className="wnote">Último cambio: {dateShort(d.updatedAt)} · {adminName(A.w, d.updatedBy)}.</p>}
          {role === 'GENERAL' && !pd && !editing && <Btn sm kind="dark" icon="pencil" onClick={() => setEditing(true)}>Cambiar cuentas</Btn>}
        </div>
        {pd && <div className="wcard" style={{ borderColor: 'var(--terra6)' }}>
          <h2>Cambio por aprobar</h2>
          <table className="wtable"><tbody>{pd.accounts.map((a, i) => <tr key={i}><td>{a.kind === 'BANK' ? 'Transferencia' : a.kind === 'PLIN' ? 'Plin' : 'Yape'}</td><td><b>{line(a)}</b></td></tr>)}
            <tr><td>WhatsApp</td><td><b>{pd.whatsapp ? fmtPhone(pd.whatsapp) : '—'}</b></td></tr>
            <tr><td>Propone</td><td>{adminName(A.w, pd.by)} · {dateShort(pd.at)} {hhmm(pd.at)} · «{pd.reason}»</td></tr></tbody></table>
          <p className="wnote">Cambia a dónde llega el dinero: compruébalo con el estado de cuenta o la app del banco antes de aprobar.</p>
          {role === 'GENERAL' && <div className="row g8 wrap"><Btn sm kind="dark" disabled={mine} why={mine ? 'Lo aprueba otra persona de administración general.' : undefined} onClick={() => A.act('MESAGRI_DATA_APPROVE', {}, { ok: 'Aprobado: la gente ya ve las cuentas nuevas.' })}>Aprobar</Btn><Btn sm kind="secd" onClick={() => A.act('MESAGRI_DATA_REJECT', { reason: 'Rechazado en el panel' }, { ok: 'Cambio rechazado.' })}>Rechazar</Btn></div>}
        </div>}
      </div>
      {editing && <div className="wcard">
        <h2>Cuentas nuevas</h2>
        {accounts.map((a, i) => (
          <div key={i} className="stack tight" style={{ borderBottom: '1px solid var(--line)', paddingBottom: '10px', marginBottom: '10px' }}>
            <div className="grid2">
              <label className="fld"><span className="lbl">Medio</span><Sel value={a.kind} onChange={v => set(i, { kind: v as CollectAccount['kind'] })} options={[{ v: 'YAPE', l: 'Yape' }, { v: 'PLIN', l: 'Plin' }, { v: 'BANK', l: 'Cuenta bancaria' }]} label="Medio" /></label>
              <label className="fld"><span className="lbl">Titular (como sale en la cuenta)</span><Inp value={a.holder} onInput={v => set(i, { holder: v })} label="Titular" /></label>
              <label className="fld"><span className="lbl">{a.kind === 'BANK' ? 'Número de cuenta' : 'Celular del ' + (a.kind === 'PLIN' ? 'Plin' : 'Yape')}</span><Inp value={a.number} onInput={v => set(i, { number: v.replace(/\D/g, '').slice(0, 20) })} mode="numeric" label="Número" /></label>
              {a.kind === 'BANK' && <label className="fld"><span className="lbl">Banco</span><Inp value={a.bank ?? ''} onInput={v => set(i, { bank: v })} label="Banco" /></label>}
              {a.kind === 'BANK' && <label className="fld"><span className="lbl">CCI (20 dígitos)</span><Inp value={a.cci ?? ''} onInput={v => set(i, { cci: v.replace(/\D/g, '').slice(0, 20) })} mode="numeric" label="CCI" /></label>}
            </div>
            {accounts.length > 1 && <button className="linkbtn" style={{ alignSelf: 'flex-start', color: 'var(--danger)' }} onClick={() => setAccounts(accounts.filter((_, j) => j !== i))}>Quitar esta cuenta</button>}
          </div>
        ))}
        {accounts.length < 4 && <button className="linkbtn" onClick={() => setAccounts([...accounts, { kind: 'YAPE', number: '', holder: 'Mesagri S.A.C.' }])}>+ Agregar otra cuenta</button>}
        <label className="fld" style={{ marginTop: '10px' }}><span className="lbl">WhatsApp de Soporte (opcional)</span><Inp value={wa} onInput={v => setWa(v.replace(/\D/g, '').slice(0, 9))} mode="numeric" placeholder="912345678" label="WhatsApp de Soporte" /></label>
        <label className="fld"><span className="lbl">Motivo</span><Inp value={reason} onInput={setReason} placeholder="Cuenta propia de Mesagri en el BCP" label="Motivo" /></label>
        <div className="row g8 wrap" style={{ marginTop: '10px' }}><Btn sm kind="dark" onClick={propose}>Proponer el cambio</Btn><Btn sm kind="sec" onClick={() => setEditing(false)}>Cancelar</Btn></div>
        <p className="wnote">Lo aprueba otra persona de administración general (cambia a dónde llega el dinero). Si eres la única, se aplica al instante. Queda en auditoría.</p>
      </div>}
    </div>
  );
}

/* ================= W-14 · Cruce con el extracto del banco o de Yape ================= */
export interface Pending { kind: 'STATEMENT' | 'INVOICE'; id: string; org: string; label: string; amount: number; pay: Statement['payment'] | SubInvoice['payment'] }
export function pendingPayments(w: World): Pending[] {
  const out: Pending[] = [];
  for (const s of Object.values(w.statements)) if (s.status === 'PAYMENT_REGISTERED' && s.payment) out.push({ kind: 'STATEMENT', id: s.id, org: s.orgId, label: s.code, amount: s.total, pay: s.payment });
  for (const i of Object.values(w.invoices)) if (i.status === 'PAID' && i.payment) out.push({ kind: 'INVOICE', id: i.id, org: i.orgId, label: i.concept, amount: i.amount, pay: i.payment });
  return out.sort((a, b) => (a.pay?.at ?? 0) - (b.pay?.at ?? 0));
}

type Match = 'OK' | 'AMOUNT' | 'MISSING';
/** Busca cada número de operación en el extracto pegado y compara el monto de esa línea. */
export function matchStatement(text: string, list: Pending[]): Record<string, { m: Match; line?: string; amounts?: number[] }> {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const amountsOf = (l: string): number[] => {
    const out: number[] = [];
    for (const m of l.matchAll(/(?:S\/\.?\s*)?(-?\d{1,3}(?:[.,\s]\d{3})*[.,]\d{2}|-?\d+[.,]\d{2})(?!\d)/g)) {
      const raw = m[1].replace(/\s/g, '');
      // 1.234,50 → 1234.50 · 1,234.50 → 1234.50 · 49,00 → 49.00 (los dos últimos dígitos son los céntimos)
      out.push(Math.abs(Number(raw.slice(0, -3).replace(/[^\d-]/g, '') + '.' + raw.slice(-2))));
    }
    return out;
  };
  const res: Record<string, { m: Match; line?: string; amounts?: number[] }> = {};
  for (const p of list) {
    const op = p.pay?.operation ?? '';
    if (!op || !/^\d{4,}$/.test(op)) { res[p.id] = { m: 'MISSING' }; continue; }
    const re = new RegExp(`(^|\\D)0*${op.replace(/^0+/, '') || op}(\\D|$)`);
    const hits = lines.filter(l => re.test(l));
    if (!hits.length) { res[p.id] = { m: 'MISSING' }; continue; }
    const ok = hits.find(l => amountsOf(l).some(a => Math.abs(a - p.amount) < 0.011));
    res[p.id] = ok ? { m: 'OK', line: ok } : { m: 'AMOUNT', line: hits[0], amounts: amountsOf(hits[0]) };
  }
  return res;
}

export function StatementMatch({ onPick }: { onPick: (id: string) => void }) {
  const A = useApp();
  const list = pendingPayments(A.w);
  const [text, setText] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const res = useMemo(() => (text.trim() ? matchStatement(text, list) : {}), [text, list.map(p => p.id).join()]);
  const found = list.filter(p => res[p.id]?.m === 'OK');
  const reconcileFound = async () => {
    if (!await A.confirm({ title: `¿Conciliar ${found.length} ${found.length === 1 ? 'pago' : 'pagos'}?`, text: 'Aparecen en el extracto con el mismo número de operación y el mismo monto. Se emite el comprobante de Mesagri de cada uno.', ok: 'Conciliar' })) return;
    let n = 0;
    for (const p of found) if (A.act('BILLING_RECONCILE', { kind: p.kind, id: p.id, ok: true }, { quiet: true }).ok) n++;
    A.toast(`${n} ${n === 1 ? 'pago conciliado' : 'pagos conciliados'}: se emitieron sus comprobantes.`);
  };
  const read = (f?: File | null) => { if (!f) return; const r = new FileReader(); r.onload = () => setText(String(r.result ?? '')); r.readAsText(f); };
  return (
    <div className="wcard">
      <h2>Comprobar con tu extracto</h2>
      <p className="wnote" style={{ marginTop: 0 }}>Copia los movimientos de la cuenta de Mesagri (banca por internet o tu app de Yape) y pégalos aquí, o sube el archivo CSV que descarga el banco. Se busca cada número de operación y se compara el monto. No se sube a ningún lado: se revisa en esta computadora.</p>
      <Inp area value={text} onInput={setText} placeholder={'16/11/2026  YAPE DE ROSARIO VALDIVIA  Op. 05123987   49,00\n16/11/2026  TRANSF. JULIO APAZA  0001234567  S/ 26.40'} label="Movimientos del extracto" />
      <div className="row g8 wrap" style={{ marginTop: '8px' }}>
        <Btn sm kind="sec" icon="upload" onClick={() => file.current?.click()}>Subir CSV</Btn>
        {text && <Btn sm kind="sec" onClick={() => setText('')}>Limpiar</Btn>}
        {found.length > 0 && <Btn sm kind="dark" icon="check" onClick={reconcileFound}>Conciliar los que coinciden ({found.length})</Btn>}
        <input ref={file} type="file" accept=".csv,.txt,text/csv,text/plain" className="sr" tabIndex={-1} onChange={(e: any) => { read(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
      </div>
      {text.trim() && <table className="wtable resp" style={{ marginTop: '10px' }}><thead><tr><th>Cuenta</th><th>Operación</th><th className="r">Monto</th><th>En el extracto</th></tr></thead>
        <tbody>{list.map(p => { const r = res[p.id]; return <Row key={p.id} onOpen={() => onPick(p.id)}><td data-l="Cuenta"><b>{orgName(A.w, p.org)}</b><div className="cap">{p.label}</div></td><td data-l="Operación" className="tnum">{p.pay?.operation}</td><td data-l="Monto" className="r tnum">{money(p.amount)}</td><td data-l="Extracto">{r?.m === 'OK' ? <Pill>Aparece con el monto</Pill> : r?.m === 'AMOUNT' ? <Pill tone="warn">Aparece con otro monto{r.amounts?.length ? `: ${r.amounts.map(a => money(a)).join(', ')}` : ''}</Pill> : <Pill tone="danger">No aparece</Pill>}</td></Row>; })}</tbody></table>}
      {text.trim() && list.length === 0 && <p className="wnote">No hay pagos por conciliar.</p>}
    </div>
  );
}

/* ================= W-07 · Detalle de un pedido y su pago ================= */
export function OrderDetail({ s, onClose }: { s: SubOrder; onClose: () => void }) {
  const A = useApp();
  const w = A.w;
  const role = roleOf(A);
  const [why, setWhy] = useState('');
  const [side, setSide] = useState<'BUYER' | 'SELLER'>('BUYER');
  const [asking, setAsking] = useState(false);
  const st = statusInfo(s, 'buyer');
  const [ps, tone] = payState(s, A.now);
  const can = ['PENDING_CONFIRMATION', 'CONFIRMED', 'AWAITING_HARVEST', 'PREPARING', 'READY'].includes(s.status) && (role === 'GENERAL' || role === 'SUPPORT');
  const cancel = () => { if (A.act('SUBORDER_ADMIN_CANCEL', { subOrderId: s.id, reason: why, side }, { ok: `Pedido ${s.code} cancelado. Avisamos al comprador y al agricultor.` }).ok) { setAsking(false); setWhy(''); } };
  return (
    <div className="wcard">
      <div className="row between"><h2 style={{ margin: 0 }}>Pedido {s.code}</h2><button className="linkbtn" onClick={onClose}>Cerrar</button></div>
      <p className="wnote" style={{ marginTop: '4px' }}>{dateShort(s.createdAt)} {hhmm(s.createdAt)} · <Pill tone={st.tone === 'danger' ? 'danger' : st.tone === 'terra' || st.tone === 'warn' ? 'warn' : ''}>{st.label}</Pill></p>
      <table className="wtable"><tbody>
        <tr><td>Comprador</td><td className="r"><button className="linkbtn" onClick={() => A.go('W-05', { id: s.buyerOrgId })}>{orgName(w, s.buyerOrgId)}</button></td></tr>
        <tr><td>Agricultor</td><td className="r"><button className="linkbtn" onClick={() => A.go('W-05', { id: s.sellerOrgId })}>{orgName(w, s.sellerOrgId)}</button></td></tr>
        <tr><td>Producto</td><td className="r"><b>{itemsShort(s)}</b></td></tr>
        <tr><td>Entrega</td><td className="r">{deliveryText(s)} · {districtName(s.district)} · {dateShort(s.deliveryDate)}</td></tr>
        <tr><td>Total</td><td className="r"><b>{money(s.total)}</b></td></tr>
        {s.cancelReason && <tr><td>Motivo de la cancelación</td><td className="r">{s.cancelReason}</td></tr>}
      </tbody></table>
      <div className="sect" style={{ marginTop: '12px' }}>Pago · <Pill tone={tone}>{ps}</Pill></div>
      {s.payment.operation ? <ProofTable pay={s.payment} amount={s.payment.amount ?? s.total} /> : <p className="wnote" style={{ margin: 0 }}>{s.payment.method === 'CASH' ? 'Se paga en efectivo al entregar: el agricultor lo registra con el código de entrega.' : 'Todavía no hay constancia.'}</p>}
      {s.payment.status === 'UPLOADED' && <p className="wnote">Solo el agricultor puede confirmar este pago: el dinero llega a su cuenta, no a Mesagri. Si pasan horas sin respuesta, escríbele para que revise su {s.payment.method === 'TRANSFER' ? 'banco' : PAY_LABEL[s.payment.method]}.</p>}
      {s.disputeId && w.disputes[s.disputeId] && <Btn sm kind="sec" onClick={() => A.go('W-07', { id: s.disputeId })}>Ver la disputa {w.disputes[s.disputeId].code}</Btn>}
      <div className="sect" style={{ marginTop: '12px' }}>Historial</div>
      <div className="stack tight">{s.history.slice().reverse().slice(0, 8).map((h, i) => <div key={i} className="cap">{dateShort(h.at)} {hhmm(h.at)} · {statusInfo({ ...s, status: h.status }, 'buyer').label}{h.by && w.users[h.by] ? ` · ${w.users[h.by].role === 'ADMIN' ? adminName(w, h.by) : w.users[h.by].shortName}` : ''}{h.note ? ` · ${h.note}` : ''}</div>)}</div>
      {can && !asking && <div className="row g8 wrap" style={{ marginTop: '12px' }}><Btn sm kind="secd" icon="ban" onClick={() => setAsking(true)}>Cancelar el pedido</Btn></div>}
      {can && asking && <div className="stack tight" style={{ marginTop: '12px' }}>
        <label className="fld"><span className="lbl">¿Quién lo pidió?</span><Sel value={side} onChange={v => setSide(v as 'BUYER' | 'SELLER')} options={[{ v: 'BUYER', l: 'El comprador (o las dos partes)' }, { v: 'SELLER', l: 'El agricultor' }]} label="Quién lo pidió" /></label>
        <Inp area value={why} onInput={setWhy} placeholder="Motivo (lo leen el comprador y el agricultor)" label="Motivo" />
        <div className="row g8"><Btn sm kind="danger" disabled={why.trim().length < 5} why={why.trim().length < 5 ? 'Escribe el motivo.' : undefined} onClick={cancel}>Cancelar el pedido</Btn><Btn sm kind="sec" onClick={() => setAsking(false)}>Volver</Btn></div>
        <p className="wnote" style={{ margin: 0 }}>No baja la reputación de nadie. El stock vuelve a la publicación. Si ya pagó, coordinan la devolución entre ellos (Mesagri no guarda el dinero).</p>
      </div>}
    </div>
  );
}

reg('W-21', HelpInbox);
