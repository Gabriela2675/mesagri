/*
 * Panel web de administración (1): marco con menú por rol, ingreso con doble factor (W-01), panel del
 * piloto (W-02), bandeja y expediente de verificaciones (W-03, W-04), usuarios (W-05), moderación (W-06),
 * pedidos y disputas (W-07), Libro de Reclamaciones y consultas (W-08) y auditoría (W-12).
 * Cada decisión la toma una persona y queda en auditoría (RN-16, RN-41, RN-50).
 */
import { useMemo, useState, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';
import { reg } from './registry';
import { useApp, type AppCtx } from '../ctx';
import { Icon, Btn, Inp, Sel, Photo, Badge, Stars } from '../ui/kit';
import { Mark, BrandRow } from '../ui/brand';
import { product, PRODUCTS, suggestedPricePerKg, UNIT_LABEL } from '@mesagri/shared/catalog';
import { orgStats, pricePerKg, visibleListing } from '@mesagri/shared/queries';
import { r2, maskDni, LEVEL_NAME, TAXDOC_LABEL, CARRIER_LEVEL_NAME, WAREHOUSE_LEVEL_NAME } from '@mesagri/shared/rules';
import { money, moneyShort, kg as fkg, dateShort, hhmm, relDay, ago, pct, dateNum, numTrim, dateDM } from '@mesagri/shared/format';
import { periodOf, periodLabel, prevPeriod, periodStart, nextPeriod, startOfDay, lima, DAY, HOUR, businessDaysBetween } from '@mesagri/shared/time';
import { uid, digitsFrom } from '@mesagri/shared/ids';
import { orgName, itemsShort, statusInfo, notifsFor, NOTIF_ICON, PAY_LABEL, deliveryText } from '../helpers';
import { districtName, placeLabel, mapsLink } from '@mesagri/shared/ubigeo';
import { pinSource } from '../ui/place';
import { openExternal } from '../platform';
import { saveFile, SAVE_UNAVAILABLE } from '../platform';
import { auth, api, setTeamKey, type AdminSetup } from '../net';
import { FirstAccess } from './access';
import { IdentityReview } from './idreview';
import { appUrl, LOCAL } from '../routes';
import { docPdf } from '../pdf';
import type { World, Org, User, VerifCase, SubOrder, Dispute, Listing, AdminRole, Complaint, ReviewVerdict, ListingReview } from '@mesagri/shared/types';
import { VERDICT_LABEL } from '@mesagri/shared/review';
import { AccountTools, OrderDetail, ProofTable, payState, listingPill, listingTitle } from './admin3';
import { paymentStrikes, ticketNeedsReply } from '@mesagri/shared/queries';

/* ================= Marco del panel ================= */
type Role = AdminRole;
interface NavItem { s: string; l: string; i: string; roles: Role[]; group?: string[]; badge?: (w: World) => number; label?: Partial<Record<Role, string>>; target?: Partial<Record<Role, string>> }
const ALL: Role[] = ['GENERAL', 'VERIFIER', 'SUPPORT', 'ANALYST'];
const openCase = (k: VerifCase) => ['SUBMITTED', 'IN_REVIEW', 'APPEALED', 'NEEDS_INFO'].includes(k.status);
export const casesOf = (w: World, kinds: VerifCase['kind'][]) => Object.values(w.cases).filter(k => kinds.includes(k.kind) && openCase(k));
/** Por revisar: toda publicación nueva o cambiada (antes de verse) y las activas marcadas de agricultores de nivel 1. */
export function modQueue(w: World): Listing[] {
  const at = (l: Listing) => l.review?.queuedAt ?? l.createdAt;
  return Object.values(w.listings).filter(l => l.status === 'IN_REVIEW' || (l.status === 'ACTIVE' && (l.flags?.length ?? 0) > 0 && w.orgs[l.orgId]?.level <= 1 && !l.review?.approvedAt))
    .sort((a, b) => (a.status === 'IN_REVIEW' ? 0 : 1) - (b.status === 'IN_REVIEW' ? 0 : 1) || at(a) - at(b));
}
export const NAV: NavItem[] = [
  { s: 'W-02', l: 'Inicio', i: 'house', roles: ALL },
  { s: 'W-03', l: 'Verificaciones', i: 'shield-check', roles: ['GENERAL', 'VERIFIER'], group: ['W-03', 'W-04'], badge: w => casesOf(w, ['FARMER', 'BUYER']).filter(k => k.status !== 'NEEDS_INFO').length },
  { s: 'W-15', l: 'Almacenes', i: 'warehouse', roles: ['GENERAL', 'VERIFIER'], group: ['W-13', 'W-15'], target: { VERIFIER: 'W-13' }, badge: w => casesOf(w, ['WAREHOUSE']).length },
  { s: 'W-17', l: 'Transportistas', i: 'truck', roles: ['GENERAL', 'VERIFIER', 'SUPPORT'], group: ['W-16', 'W-17'], target: { VERIFIER: 'W-16' }, label: { SUPPORT: 'Envíos' }, badge: w => casesOf(w, ['CARRIER']).length },
  { s: 'W-05', l: 'Usuarios', i: 'users', roles: ['GENERAL', 'VERIFIER', 'SUPPORT'] },
  { s: 'W-06', l: 'Publicaciones', i: 'package', roles: ['GENERAL', 'VERIFIER', 'SUPPORT'], badge: w => modQueue(w).length },
  { s: 'W-07', l: 'Pedidos y disputas', i: 'shopping-bag', roles: ['GENERAL', 'SUPPORT'], badge: w => Object.values(w.disputes).filter(d => d.status !== 'RESOLVED').length },
  { s: 'W-21', l: 'Mensajes de ayuda', i: 'message-circle', roles: ['GENERAL', 'SUPPORT'], badge: w => Object.values(w.tickets).filter(t => ticketNeedsReply(w, t)).length },
  { s: 'W-08', l: 'Reclamos', i: 'file-text', roles: ['GENERAL', 'SUPPORT'], badge: w => Object.values(w.complaints).filter(c => c.status === 'OPEN').length },
  { s: 'W-09', l: 'Catálogo', i: 'search', roles: ['GENERAL'] },
  { s: 'W-14', l: 'Cobros', i: 'banknote', roles: ['GENERAL'], badge: w => Object.values(w.statements).filter(s => s.status === 'PAYMENT_REGISTERED' || s.claim?.status === 'OPEN').length + Object.values(w.invoices).filter(i => i.status === 'PAID').length },
  { s: 'W-10', l: 'Configuración', i: 'percent', roles: ['GENERAL'], group: ['W-10', 'W-18'], badge: w => Object.values(w.proposals).filter(p => p.status === 'PENDING').length },
  { s: 'W-11', l: 'Reportes', i: 'chart-column', roles: ['GENERAL', 'ANALYST'] },
  { s: 'W-12', l: 'Auditoría', i: 'lock', roles: ['GENERAL'] },
  { s: 'W-19', l: 'Equipo', i: 'id-card', roles: ['GENERAL'] },
  { s: 'W-20', l: 'Mi cuenta', i: 'circle-user', roles: ALL },
];
const ROLE_LABEL: Record<Role, string> = { GENERAL: 'Administración general', VERIFIER: 'Verificación', SUPPORT: 'Soporte', ANALYST: 'Analista' };
export const roleOf = (A: AppCtx): Role => (A.me?.adminRole ?? 'GENERAL') as Role;
export const allowed = (A: AppCtx, s: string) => NAV.some(n => (n.s === s || n.group?.includes(s)) && n.roles.includes(roleOf(A))) || s === 'W-02';
const initialsOf = (name?: string) => (name ?? '··').split(' ').filter(Boolean).slice(0, 2).map(x => x[0]).join('');
export const maskRuc = (ruc?: string) => (ruc ? `${ruc.slice(0, 2)}•••••••${ruc.slice(-2)}` : '—');
export const adminName = (w: World, id?: string) => { const u = id ? w.users[id] : undefined; if (!u) return id === 'system' ? 'Sistema' : '—'; if (u.role !== 'ADMIN') return u.name; const [a, b] = u.name.split(' '); return `${a} ${b ? b[0] + '.' : ''}`.trim(); };

export function WebFrame({ title, sub, right, back, children }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; back?: boolean; children: ReactNode }) {
  const A = useApp();
  const me = A.me!;
  const role = roleOf(A);
  const items = NAV.filter(n => n.roles.includes(role));
  const cur = A.top.s;
  const [bell, setBell] = useState(false);
  const notifs = notifsFor(A.w, 'ADMIN', true).slice(0, 14);
  const seen = Number(A.dev.flow.seenNotifs) || 0;
  const unread = notifs.filter(n => n.at > seen).length;
  const go = (n: NavItem) => A.reset(n.target?.[role] ?? n.s);
  const navBtn = (n: NavItem, cls: string) => {
    const on = n.s === cur || !!n.group?.includes(cur) || (n.target?.[role] === cur);
    const b = n.badge ? n.badge(A.w) : 0;
    return <button key={n.s} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined} onClick={() => go(n)}><Icon n={n.i} s={cls === 'side' ? '20' : '16'} /><span>{n.label?.[role] ?? n.l}</span>{b > 0 && <Badge n={b} />}</button>;
  };
  return (
    <div className="wapp">
      <aside className="side" aria-label="Menú del panel">
        <div className="brand"><BrandRow sub="Panel de administración" size={42} /></div>
        {items.map(n => navBtn(n, 'side'))}
        <div className="who"><span className="av" style={{ background: "#C97C3E", width: "40px", height: "40px" }}>{initialsOf(me.name)}</span><div className="grow"><b style={{ fontSize: "14px" }}>{me.name}</b><small>{ROLE_LABEL[role]}</small></div><button className="iconbtn" style={{ background: "transparent", color: "#fff", borderColor: "rgba(255,255,255,.25)" }} aria-label="Cerrar sesión" title="Cerrar sesión" onClick={() => A.logout()}><Icon n="log-out" s="16" /></button></div>
      </aside>
      <nav className="wtop" aria-label="Menú del panel">{items.map(n => navBtn(n, 'top'))}<button onClick={() => A.logout()}><Icon n="log-out" s="16" />Salir</button></nav>
      <main className="wmain">
        <div className="whead">
          {back && <button className="iconbtn" aria-label="Volver" onClick={() => A.back()} style={{ marginTop: "4px" }}><Icon n="chevron-left" s="18" /></button>}
          <div style={{ minWidth: "0", flex: "1 1 320px" }}><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
          <div className="row g8 wrap" style={{ alignItems: "center" }}>{right}
            <div style={{ position: "relative" }}>
              <button className="iconbtn" aria-label={`Avisos del equipo${unread ? ` (${unread} nuevos)` : ''}`} aria-expanded={bell ? 'true' : 'false'} onClick={() => { setBell(!bell); if (!bell) A.patch(d => { d.flow = { ...d.flow, seenNotifs: A.now }; }); }}><Icon n="bell" s="18" />{unread > 0 && <span className="dot" />}</button>
              {bell && <div className="wpop" role="dialog" aria-label="Avisos del equipo">
                <div className="row between"><b>Avisos del equipo</b><button className="linkbtn" onClick={() => setBell(false)}>Cerrar</button></div>
                {notifs.length === 0 && <p className="wnote">Sin avisos.</p>}
                {notifs.map(n => <button key={n.id} className="wpop-i" onClick={() => { setBell(false); if (n.link && allowed(A, n.link.screen)) A.go(n.link.screen, n.link.params); }}><Icon n={NOTIF_ICON[n.kind]} s="16" /><span className="grow"><b>{n.title}</b><small>{n.body}</small></span><small className="nowrap">{relDay(n.at, A.now)} {hhmm(n.at)}</small></button>)}
              </div>}
            </div>
          </div>
        </div>
        {allowed(A, cur) ? children : <div className="wcard"><h2>No tienes acceso a esta sección</h2><p className="wnote">Tu rol ({ROLE_LABEL[role].toLowerCase()}) no ve esta información. Así se protegen los datos personales (Ley 29733).</p><Btn kind="dark" onClick={() => A.reset('W-02')}>Ir al inicio</Btn></div>}
      </main>
    </div>
  );
}

export function Pill({ tone, children }: { tone?: 'warn' | 'danger' | 'info' | 'gray' | ''; children: ReactNode }) { return <span className={'pill' + (tone ? ' ' + tone : '')}>{children}</span>; }
export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return <div className="wtabs" role="tablist">{options.map(([v, l]) => <button key={v} role="tab" aria-selected={value === v ? 'true' : 'false'} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}</div>;
}
export function Kpi({ l, n, s, tone, onClick }: { l: string; n: ReactNode; s?: ReactNode; tone?: string; onClick?: () => void }) {
  const inner = <><div className="l">{l}</div><div className="n" style={tone === 'ok' ? { color: "var(--field)" } : tone === 'terra' ? { color: "var(--terra6)" } : undefined}>{n}</div>{s && <div className="s">{s}</div>}</>;
  return onClick ? <button className="kpi" style={{ textAlign: "left", border: "0", cursor: "pointer" }} onClick={onClick}>{inner}</button> : <div className="kpi">{inner}</div>;
}
export function WSearch({ value, onInput, placeholder }: { value: string; onInput: (v: string) => void; placeholder: string }) {
  return <div className="inpwrap wsearch"><span className="pre"><Icon n="search" s="16" /></span><input className="inp" type="search" value={value} onChange={(e: any) => onInput(e.currentTarget.value)} placeholder={placeholder} aria-label={placeholder} /></div>;
}
/** Fila de tabla que se abre con clic o con Enter. */
export function Row({ sel, onOpen, children }: { sel?: boolean; onOpen?: () => void; children: ReactNode }) {
  return <tr className={(onOpen ? 'click' : '') + (sel ? ' sel' : '')} tabIndex={onOpen ? 0 : undefined} onClick={onOpen} onKeyDown={(e: any) => { if (onOpen && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(); } }}>{children}</tr>;
}
export const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export async function downloadCsv(A: AppCtx, filename: string, rows: (string | number)[][]) {
  const csv = '﻿' + rows.map(r => r.map(c => { const s = String(c ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(';')).join('\r\n');
  const r = await saveFile(filename, new Blob([csv], { type: 'text/csv' }));
  if (r === 'error' || r === 'unavailable') A.toast(r === 'unavailable' ? SAVE_UNAVAILABLE : 'No pudimos descargar el archivo.', 'err');
}

/* ---------- Gráfico de columnas (una serie) con descripción emergente y tabla ---------- */
export function Columns({ data, fmt, color = 'var(--field)', caption, current }: { data: { k: string; label: string; v: number }[]; fmt: (n: number) => string; color?: string; caption: string; current?: string }) {
  const [tip, setTip] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...data.map(d => d.v));
  const step = niceStep(max / 3);
  const top = Math.max(step * 3, step * Math.ceil(max / step));
  const ticks = [0, top / 2, top];
  const lastIdx = data.length - 1;
  return (
    <div>
      <div className="cols" role="group" aria-label={caption}>
        <div className="cols-grid" aria-hidden="true">{ticks.slice().reverse().map(t => <div key={t}><span>{moneyShort(t).replace('S/ ', 'S/ ')}</span></div>)}</div>
        <div className="cols-plot">
          {data.map((d, i) => (
            <button key={d.k} className={'col' + (tip === i ? ' on' : '')} aria-label={`${d.label}: ${fmt(d.v)}`} onPointerEnter={() => setTip(i)} onPointerLeave={() => setTip(null)} onFocus={() => setTip(i)} onBlur={() => setTip(null)}>
              <span className="col-bar" style={{ height: `${(d.v / top) * 100}%`, background: d.k === current ? `repeating-linear-gradient(135deg, ${color} 0 5px, color-mix(in srgb, ${color} 72%, #fff) 5px 8px)` : color }} />
              {(i === lastIdx || tip === i) && <span className="col-val" style={{ bottom: `calc(${(d.v / top) * 100}% + 6px)` }}>{tip === i ? '' : fmt(d.v)}</span>}
              {tip === i && <span className="col-tip" style={{ bottom: `calc(${(d.v / top) * 100}% + 8px)` }}><b>{fmt(d.v)}</b><small>{d.label}{d.k === current ? ' · en curso' : ''}</small></span>}
              <span className="col-x">{d.label.split(' ')[0].slice(0, 3)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="row between wrap" style={{ marginTop: "8px" }}><p className="wnote" style={{ margin: "0" }}>{caption}{current && data.some(d => d.k === current) ? ' La barra rayada es el mes en curso.' : ''}</p><button className="linkbtn" aria-expanded={table ? 'true' : 'false'} onClick={() => setTable(!table)}>{table ? 'Ocultar tabla' : 'Ver tabla'}</button></div>
      {table && <table className="wtable" style={{ marginTop: "6px" }}><thead><tr><th>Mes</th><th className="r">Valor</th></tr></thead><tbody>{data.map(d => <tr key={d.k}><td>{d.label}</td><td className="r tnum">{fmt(d.v)}</td></tr>)}</tbody></table>}
    </div>
  );
}
function niceStep(x: number) { const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, x)))); const n = x / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
export function Meter({ label, value, max, fmt }: { label: string; value: number; max: number; fmt: (n: number) => string }) {
  return <div className="meter"><div className="row between"><span>{label}</span><b className="tnum">{fmt(value)}</b></div><div className="meter-t" role="img" aria-label={`${label}: ${fmt(value)}`}><i style={{ width: `${max ? Math.max(1.5, (value / max) * 100) : 0}%` }} /></div></div>;
}

/* ================= W-01 · Ingreso ================= */
type TeamMember = { userId: string; name: string; email: string; adminRole: string; password: string; code: string; validFor: number };
function Login() {
  const A = useApp();
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [email, setEmail] = useState(() => { try { return new URLSearchParams(location.search).get('email') ?? ''; } catch { return ''; } });
  const [pass, setPass] = useState('');
  const [code, setCode] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // en la nube, las cuentas de prueba del equipo se ven con la clave del equipo
  const [needKey, setNeedKey] = useState(false);
  const [key, setKey] = useState('');
  const [keyErr, setKeyErr] = useState('');
  // primer ingreso con la clave temporal que dio la administración general
  const [setup, setSetup] = useState<AdminSetup | null>(null);
  const loadTeam = (k?: string) => auth.team(k).then(list => { setTeam(list); setNeedKey(false); if (k) setTeamKey(k); }).catch((e: any) => {
    setTeam([]);
    if (e?.code === 'TEAM_KEY') { setNeedKey(true); if (k) setKeyErr('Esa no es la clave del equipo.'); }
  });
  useEffect(() => { void loadTeam(); }, []);
  const enter = async () => {
    if (!email.includes('@')) { setErr('Escribe tu correo del equipo.'); return; }
    if (pass.length < 8) { setErr('La contraseña tiene al menos 8 caracteres.'); return; }
    if (code && code.length !== 6) { setErr('El código de tu app de autenticación tiene 6 dígitos.'); return; }
    setBusy(true);
    try {
      const r = await auth.admin(email.trim(), pass, code);
      if (r.setup) { setSetup(r.setup); return; }
      enterWith(r.userId, r.session!);
    } catch (e: any) {
      setErr(e?.code === 'BAD_LOGIN' && !code ? 'Revisa tu correo y tu contraseña, y escribe el código de 6 dígitos de tu app de autenticación (con la clave temporal no hace falta).' : e.message);
    } finally { setBusy(false); }
  };
  const enterWith = (userId: string, session: Parameters<typeof A.store.sessions.set>[0]) => {
    A.store.sessions.set(session);
    A.act('AUDIT_VIEW', { entity: 'panel', detail: 'Ingresó al panel con doble factor' }, { as: userId, quiet: true });
    A.login(userId);
  };
  // cuentas del equipo (demo): el servidor da el código vigente del doble factor
  const fill = async (x: TeamMember) => {
    let m = x;
    try { m = (await auth.team()).find(y => y.userId === x.userId) ?? x; } catch { /* sin señal */ }
    setEmail(m.email); setPass(m.password); setCode(m.code); setErr('');
  };
  const admins = team.length ? team : [];
  if (setup) return (
    <div className="wlogin">
      <div className="wlogin-l">
        <div className="wbrand"><Mark size={92} /><div><b>Mesagri</b><span>Panel de administración</span></div></div>
        <h2>Tu cuenta del equipo es solo tuya.</h2>
        <ul>
          <li><Icon n="key-round" s="18" />Tu contraseña: nadie más la conoce, ni la administración general</li>
          <li><Icon n="smartphone" s="18" />El doble factor vive en tu celular: sin él no se entra</li>
          <li><Icon n="lock" s="18" />Cada decisión que tomes queda en la auditoría con tu nombre</li>
        </ul>
      </div>
      <FirstAccess setup={setup} temp={pass} onDone={r => { setSetup(null); setPass(''); enterWith(r.userId, r.session); }} onCancel={why => { setSetup(null); setPass(''); setCode(''); if (why) setErr(why); }} />
    </div>
  );
  return (
    <div className="wlogin">
      <div className="wlogin-l">
        <div className="wbrand"><Mark size={92} /><div><b>Mesagri</b><span>Panel de administración</span></div></div>
        <h2>Cada decisión la toma una persona y queda registrada.</h2>
        <ul>
          <li><Icon n="shield-check" s="18" />Verificadores: expedientes de agricultores, MYPE, almacenes y transportistas</li>
          <li><Icon n="shopping-bag" s="18" />Soporte: pedidos, disputas, envíos y Libro de Reclamaciones</li>
          <li><Icon n="percent" s="18" />Administración: planes, comisiones, límites y cobros</li>
          <li><Icon n="chart-column" s="18" />Analistas: indicadores sin datos personales</li>
        </ul>
      </div>
      <form className="wlogin-card" onSubmit={(e: any) => { e.preventDefault(); enter(); }}>
        <h1>Ingresar</h1>
        <label className="fld"><span className="lbl">Correo del equipo</span><input className="inp" type="email" autoComplete="username" value={email} onChange={(e: any) => { setEmail(e.currentTarget.value); setErr(''); }} placeholder="nombre@mesagri.pe" /></label>
        <label className="fld"><span className="lbl">Contraseña</span><span className="inpwrap"><input className="inp" type={show ? 'text' : 'password'} autoComplete="current-password" value={pass} onChange={(e: any) => { setPass(e.currentTarget.value); setErr(''); }} /><button type="button" className="suf" style={{ pointerEvents: "auto", border: "0", background: "transparent", cursor: "pointer" }} aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setShow(!show)}><Icon n={show ? 'eye-off' : 'eye'} s="18" /></button></span></label>
        <label className="fld"><span className="lbl">Código de tu app de autenticación <span className="cap" style={{ fontWeight: 600 }}>(la primera vez, con tu clave temporal, déjalo vacío)</span></span><input className="inp tnum" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e: any) => { setCode(e.currentTarget.value.replace(/\D/g, '').slice(0, 6)); setErr(''); }} placeholder="6 dígitos" style={{ letterSpacing: ".3em", fontWeight: "900" }} /></label>
        {err && <div className="errt" role="alert"><Icon n="circle-alert" s="16" />{err}</div>}
        <Btn full kind="dark" type="submit" disabled={busy}>{busy ? <i className="spin" /> : null}Ingresar</Btn>
        <p className="wnote" style={{ margin: "0" }}>Doble factor obligatorio. La sesión se cierra a los 30 minutos sin uso. Los accesos quedan en auditoría (W-12).</p>
        {admins.length > 0 && <div className="wdemo"><b>Cuentas de prueba del equipo</b><span>Llenan el correo, la clave de prueba y el código vigente del doble factor (cambia cada 30 segundos).</span>
          <div className="chips">{admins.map(x => <button type="button" key={x.userId} className="chip line" onClick={() => fill(x)}>{(x.name ?? x.email).split(' ')[0]} · {ROLE_LABEL[(x.adminRole ?? 'GENERAL') as Role].toLowerCase()}</button>)}</div>
        </div>}
        {needKey && <div className="wdemo"><b>¿Presentas Mesagri?</b><span>Con la clave del equipo aparecen las cuentas de prueba del panel, con su contraseña y el código vigente del doble factor.</span>
          <div className="row g8"><input className="inp grow" type="password" aria-label="Clave del equipo" placeholder="Clave del equipo" value={key} onChange={(e: any) => { setKey(e.currentTarget.value); setKeyErr(''); }} onKeyDown={(e: any) => { if (e.key === 'Enter') { e.preventDefault(); if (key.trim()) void loadTeam(key.trim()); } }} /><Btn kind="sec" onClick={() => { if (key.trim()) void loadTeam(key.trim()); }}>Ver cuentas</Btn></div>
          {keyErr && <div className="errt" role="alert"><Icon n="circle-alert" s="16" />{keyErr}</div>}
        </div>}
        {A.store.mode === 'panel' && <a className="linkbtn" href={appUrl()} style={{ alignSelf: "center", fontSize: "14px" }}>¿Eres agricultor, comprador, almacén o transportista? Abre la app</a>}
      </form>
    </div>
  );
}

/* ================= W-02 · Panel del piloto ================= */
function revenue(w: World, period: string) {
  const inv = Object.values(w.invoices).filter(i => i.period === period && i.status !== 'VOID');
  const st = (k: 'FARMER' | 'WAREHOUSE' | 'CARRIER') => Object.values(w.statements).filter(s => s.kind === k && s.period === period && s.status !== 'VOID');
  const sum = <T,>(a: T[], f: (x: T) => number) => r2(a.reduce((x, y) => x + f(y), 0));
  const rows = [
    { l: 'Membresías MYPE', v: sum(inv, i => i.amount) },
    { l: `Comisión de agricultores (${pct(w.settings.commission.rate)})`, v: sum(st('FARMER'), s => s.total) },
    { l: `Comisión de almacenes (${pct(w.settings.storage.commission)})`, v: sum(st('WAREHOUSE'), s => s.total) },
    { l: `Comisión de transportistas (${pct(w.settings.carrier.commission)})`, v: sum(st('CARRIER'), s => s.total) },
  ];
  const total = r2(rows.reduce((a, r) => a + r.v, 0));
  return { rows, total, net: r2(total / 1.18) };
}
export function pilotIndicators(w: World, now: number) {
  const farmers = Object.values(w.orgs).filter(o => o.type === 'FARMER');
  const onTime = farmers.reduce((a, o) => a + o.counters.onTime, 0), deliveries = farmers.reduce((a, o) => a + o.counters.deliveries, 0);
  const subs = Object.values(w.subOrders);
  const delivered = subs.filter(s => ['DELIVERED', 'COMPLETED', 'DISPUTED'].includes(s.status)).length;
  const disputes = Object.values(w.disputes).filter(d => d.kind !== 'PAGO_NO_RECIBIDO').length;
  const decided = Object.values(w.cases).filter(k => k.decision && k.decision.at - k.submittedAt > 10 * 60_000);
  const hours = decided.length ? decided.reduce((a, k) => a + (k.decision!.at - k.submittedAt) / HOUR, 0) / decided.length : NaN;
  const since = now - 30 * DAY;
  const buyers = new Map<string, number>();
  for (const s of subs) if (s.createdAt >= since && !['REJECTED', 'EXPIRED'].includes(s.status)) buyers.set(s.buyerOrgId, (buyers.get(s.buyerOrgId) ?? 0) + 1);
  const repeat = buyers.size ? [...buyers.values()].filter(n => n >= 2).length / buyers.size : 0;
  const active = farmers.filter(o => o.level >= 1);
  const two = active.length ? active.filter(o => o.counters.completedSales >= 2).length / active.length : 0;
  return [
    { l: 'Pedidos entregados a tiempo', goal: '90 % o más', v: deliveries ? onTime / deliveries : 0, ok: deliveries ? onTime / deliveries >= 0.9 : false, fmt: pct },
    { l: 'Pedidos con disputa', goal: 'menos de 3 %', v: delivered ? disputes / delivered : 0, ok: delivered ? disputes / delivered < 0.03 : true, fmt: pct },
    { l: 'Tiempo para verificar un expediente', goal: 'menos de 48 h', v: hours, ok: isNaN(hours) || hours < 48, fmt: (n: number) => isNaN(n) ? 'sin datos aún' : `${Math.round(n)} h` },
    { l: 'MYPE que vuelven a comprar en el mes', goal: '70 % o más', v: repeat, ok: repeat >= 0.7, fmt: pct },
    { l: 'Agricultores con 2 ventas o más', goal: '60 % o más', v: two, ok: two >= 0.6, fmt: pct },
  ];
}
function Dashboard() {
  const A = useApp();
  const w = A.w, role = roleOf(A);
  const P = periodOf(A.now), Pprev = prevPeriod(P);
  const buyers = Object.values(w.orgs).filter(o => o.type === 'BUYER' && o.subscription && o.subscription.status !== 'INACTIVE');
  const byPlan = (p: string) => buyers.filter(o => o.subscription!.plan === p).length;
  const farmers = Object.values(w.orgs).filter(o => o.type === 'FARMER' && o.level >= 1 && o.status === 'ACTIVE');
  const newFarmers = Object.values(w.orgs).filter(o => o.type === 'FARMER' && periodOf(o.createdAt) === P).length;
  const whs = Object.values(w.orgs).filter(o => o.warehouse && (o.warehouse.level === 'A2' || o.warehouse.level === 'A3'));
  const sacks = Object.values(w.lots).filter(l => ['IN_DEPOSIT', 'FOR_SALE', 'DISPUTE'].includes(l.status)).reduce((a, l) => a + l.balanceSacks, 0);
  const carriers = Object.values(w.orgs).filter(o => o.carrier && (o.carrier.level === 'T2' || o.carrier.level === 'T3'));
  const shipsMonth = Object.values(w.shipments).filter(s => s.delivery && periodOf(s.delivery.at) === P).length;
  const gmv = w.monthlyGmv[P] ?? 0;
  const rev = revenue(w, Pprev);
  const months = Object.keys(w.monthlyGmv).sort().slice(-7);
  const pend: [string, string, ReactNode, string, Role[]][] = [
    ['shield-check', 'Verificaciones', pendPill(casesOf(w, ['FARMER', 'BUYER']), A.now), 'W-03', ['GENERAL', 'VERIFIER']],
    ['warehouse', 'Almacenes', pendPill(casesOf(w, ['WAREHOUSE']), A.now, Object.values(w.orgs).filter(o => o.warehouse?.visitScheduled && startOfDay(o.warehouse.visitScheduled) === startOfDay(A.now)).length ? 'visita hoy' : undefined), 'W-13', ['GENERAL', 'VERIFIER']],
    ['truck', 'Transportistas', pendPill(casesOf(w, ['CARRIER']), A.now), 'W-16', ['GENERAL', 'VERIFIER']],
    ['shopping-bag', 'Disputas abiertas', countPill(Object.values(w.disputes).filter(d => d.status !== 'RESOLVED').length), 'W-07', ['GENERAL', 'SUPPORT']],
    ['message-circle', 'Mensajes de ayuda por responder', countPill(Object.values(w.tickets).filter(t => ticketNeedsReply(w, t)).length), 'W-21', ['GENERAL', 'SUPPORT']],
    ['file-text', 'Reclamos', complaintPill(w, A.now), 'W-08', ['GENERAL', 'SUPPORT']],
    ['receipt', 'Pagos a Mesagri por conciliar', countPill(Object.values(w.statements).filter(s => s.status === 'PAYMENT_REGISTERED').length + Object.values(w.invoices).filter(i => i.status === 'PAID').length), 'W-14', ['GENERAL']],
    ['banknote', 'Pagos de pedidos sin confirmar (24 h)', countPill(Object.values(w.subOrders).filter(s => s.payment.status === 'UPLOADED' && A.now - (s.payment.uploadedAt ?? A.now) > 24 * HOUR).length), 'W-07', ['GENERAL', 'SUPPORT']],
    ['banknote', 'Cuentas vencidas', countPill(Object.values(w.statements).filter(s => s.status === 'OVERDUE').length), 'W-14', ['GENERAL']],
    ['scan-search', 'Publicaciones por revisar', countPill(modQueue(w).length), 'W-06', ['GENERAL', 'VERIFIER', 'SUPPORT']],
    ['truck', 'Reclamos de envíos', countPill(Object.values(w.shipments).filter(s => s.claim && s.claim.status !== 'RESOLVED').length), 'W-17', ['GENERAL', 'SUPPORT']],
  ];
  const ind = pilotIndicators(w, A.now);
  const analyst = role === 'ANALYST';
  return (
    <WebFrame title={role === 'VERIFIER' ? 'Tu día de verificación' : role === 'SUPPORT' ? 'Tu día en Soporte' : 'Panel del piloto'} sub={`${periodLabel(P).replace(/^./, c => c.toUpperCase())} · datos de la base${analyst ? ', sin datos personales' : ''}`}
      right={role === 'GENERAL' || analyst ? <Btn kind="sec" sm icon="download" onClick={() => downloadCsv(A, `panel-${P}.csv`, [['Indicador', 'Meta', periodLabel(P), 'Estado'], ...ind.map(i => [i.l, i.goal, i.fmt(i.v), i.ok ? 'Cumple' : 'Por debajo'])])}>Exportar</Btn> : undefined}>
      <div className="kpis">
        <Kpi l="MYPE con membresía" n={buyers.length} s={`Básico ${byPlan('BASICO')} · Pro ${byPlan('PRO')} · Empresa ${byPlan('EMPRESA')}`} />
        <Kpi l="Agricultores activos" n={farmers.length} s={`${newFarmers} ${newFarmers === 1 ? 'nuevo' : 'nuevos'} este mes`} />
        <Kpi l={`Ventas de ${periodLabel(P).split(' ')[0]}`} n={moneyShort(gmv)} s="Pagadas directo al agricultor" />
        <Kpi l="Almacenes aliados" n={whs.length} s={`${sacks} sacos guardados`} />
        <Kpi l="Transportistas aliados" n={carriers.length} s={`${shipsMonth} envíos este mes`} />
      </div>
      {(role === 'GENERAL' || analyst) && (
        <div className="wgrid3">
          <div className="wcard">
            <h2>Ingresos de {periodLabel(Pprev).split(' ')[0]}</h2>
            <div className="stack tight">{rev.rows.map(r => <Meter key={r.l} label={r.l} value={r.v} max={Math.max(...rev.rows.map(x => x.v))} fmt={money} />)}</div>
            <table className="wtable" style={{ marginTop: "10px" }}><tbody>
              <tr><td>Total facturado (con IGV)</td><td className="r"><b>{money(rev.total)}</b></td></tr>
              <tr><td>Ingreso neto sin IGV</td><td className="r"><b>{money(rev.net)}</b></td></tr>
            </tbody></table>
            <p className="wnote">Mesagri solo factura su membresía y sus comisiones: el dinero de los pedidos, alquileres y fletes va directo entre las partes.</p>
          </div>
          <div className="wcard">
            <h2>Ventas por mes</h2>
            {months.length ? <Columns data={months.map(k => ({ k, label: periodLabel(k), v: w.monthlyGmv[k] }))} fmt={money} caption="Ventas conformes (GMV) por mes de conformidad." current={P} /> : <p className="wnote">Sin ventas todavía.</p>}
          </div>
          <PendingCard rows={pend.filter(p => p[4].includes(role))} />
        </div>
      )}
      {(role === 'VERIFIER' || role === 'SUPPORT') && (
        <div className="split">
          {role === 'VERIFIER' ? <OldestCases /> : <SupportQueue />}
          <PendingCard rows={pend.filter(p => p[4].includes(role))} />
        </div>
      )}
      {(role === 'GENERAL' || analyst) && (
        <div className="wcard" style={{ marginTop: "16px" }}>
          <h2>Indicadores del piloto</h2>
          <table className="wtable resp"><thead><tr><th>Indicador del piloto</th><th>Meta</th><th>{periodLabel(P).split(' ')[0]}</th><th>Estado</th></tr></thead>
            <tbody>{ind.map(i => <tr key={i.l}><td data-l="Indicador">{i.l}</td><td data-l="Meta">{i.goal}</td><td data-l="Valor" className="tnum">{i.fmt(i.v)}</td><td data-l="Estado"><Pill tone={i.ok ? '' : 'warn'}>{i.ok ? 'Cumple' : 'Por debajo'}</Pill></td></tr>)}</tbody></table>
          <p className="wnote">Se calculan con los datos de la demo: con pocos pedidos, un caso mueve mucho el porcentaje.</p>
        </div>
      )}
    </WebFrame>
  );
}
function pendPill(cases: VerifCase[], now: number, extra?: string) {
  const due = cases.filter(k => now - k.submittedAt >= 24 * HOUR).length;
  return cases.length ? <Pill tone={due ? 'warn' : ''}>{cases.length}{due ? ` · ${due} ${due === 1 ? 'vence' : 'vencen'} pronto` : ''}{extra ? ` · ${extra}` : ''}</Pill> : <Pill tone="gray">0</Pill>;
}
const countPill = (n: number) => <Pill tone={n ? 'warn' : 'gray'}>{n}</Pill>;
function complaintPill(w: World, now: number) {
  const open = Object.values(w.complaints).filter(c => c.status === 'OPEN');
  if (!open.length) return <Pill tone="gray">0</Pill>;
  const left = Math.min(...open.map(c => businessDaysBetween(now, c.dueAt)));
  return <Pill tone={left <= 5 ? 'danger' : 'warn'}>{open.length} · plazo: {left} {left === 1 ? 'día' : 'días'}</Pill>;
}
function PendingCard({ rows }: { rows: [string, string, ReactNode, string, Role[]][] }) {
  const A = useApp();
  return (
    <div className="wcard">
      <h2>Pendientes de hoy</h2>
      <div className="wlist">{rows.map(([i, l, p, s]) => <button key={l} className="wli" onClick={() => A.reset(s)}><Icon n={i} s="18" /><span className="grow">{l}</span>{p}</button>)}</div>
    </div>
  );
}
function OldestCases() {
  const A = useApp();
  const list = casesOf(A.w, ['FARMER', 'BUYER', 'WAREHOUSE', 'CARRIER']).filter(k => k.status !== 'NEEDS_INFO').sort((a, b) => a.submittedAt - b.submittedAt).slice(0, 6);
  return (
    <div className="wcard"><h2>Lo más antiguo primero</h2>
      <table className="wtable resp"><thead><tr><th>Antigüedad</th><th>Solicitante</th><th>Pide</th><th>Asignado</th></tr></thead>
        <tbody>{list.map(k => <Row key={k.id} onOpen={() => A.go(k.kind === 'WAREHOUSE' ? 'W-13' : k.kind === 'CARRIER' ? 'W-16' : 'W-04', { id: k.kind === 'WAREHOUSE' || k.kind === 'CARRIER' ? k.orgId : k.id })}><td data-l="Antigüedad"><AgePill t={k.submittedAt} /></td><td data-l="Solicitante"><b>{orgName(A.w, k.orgId)}</b></td><td data-l="Pide">{levelAsked(A.w, k)}</td><td data-l="Asignado">{k.assignedTo ? adminName(A.w, k.assignedTo) : 'Sin asignar'}</td></Row>)}</tbody></table>
      {list.length === 0 && <p className="wnote">No hay expedientes pendientes.</p>}
    </div>
  );
}
function SupportQueue() {
  const A = useApp();
  const ds = Object.values(A.w.disputes).filter(d => d.status !== 'RESOLVED').sort((a, b) => a.openedAt - b.openedAt);
  const cs = Object.values(A.w.complaints).filter(c => c.status === 'OPEN').sort((a, b) => a.dueAt - b.dueAt);
  return (
    <div className="wcard"><h2>Casos abiertos</h2>
      <table className="wtable resp"><thead><tr><th>Caso</th><th>Quién</th><th>Desde</th><th>Estado</th></tr></thead>
        <tbody>
          {ds.map(d => <Row key={d.id} onOpen={() => A.go('W-07', { id: d.id })}><td data-l="Caso"><b>{d.code}</b> · disputa</td><td data-l="Quién">{orgName(A.w, A.w.subOrders[d.subOrderId]?.buyerOrgId)} ↔ {orgName(A.w, A.w.subOrders[d.subOrderId]?.sellerOrgId)}</td><td data-l="Desde">{ago(d.openedAt, A.now)}</td><td data-l="Estado"><Pill tone={d.status === 'PROPOSED' ? 'info' : 'warn'}>{d.status === 'PROPOSED' ? 'Propuesta enviada' : 'Abierta'}</Pill></td></Row>)}
          {cs.map(c => <Row key={c.id} onOpen={() => A.go('W-08', { id: c.id })}><td data-l="Caso"><b>Hoja {c.number}</b> · {c.type.toLowerCase()}</td><td data-l="Quién">{orgName(A.w, c.orgId)}</td><td data-l="Desde">{ago(c.at, A.now)}</td><td data-l="Estado"><Pill tone="warn">Quedan {businessDaysBetween(A.now, c.dueAt)} días</Pill></td></Row>)}
        </tbody></table>
      {ds.length + cs.length === 0 && <p className="wnote">Nada pendiente. Bien.</p>}
    </div>
  );
}

/* ================= W-03 · Bandeja de verificaciones ================= */
export function AgePill({ t }: { t: number }) {
  const A = useApp();
  const h = Math.max(0, Math.floor((A.now - t) / HOUR));
  return <Pill tone={h >= 40 ? 'danger' : h >= 24 ? 'warn' : ''}>{h >= 72 ? `${Math.floor(h / 24)} d` : `${h} h`}</Pill>;
}
export function levelAsked(w: World, k: VerifCase) {
  const o = w.orgs[k.orgId];
  return o?.type === 'CARRIER' ? `T${k.targetLevel}` : o?.type === 'WAREHOUSE' ? `A${k.targetLevel}` : `Nivel ${k.targetLevel}`;
}
function Inbox() {
  const A = useApp();
  const w = A.w;
  const [tab, setTab] = useState<'F' | 'B' | 'O' | 'R'>('F');
  const [q, setQ] = useState('');
  const open = (kind: VerifCase['kind']) => Object.values(w.cases).filter(k => k.kind === kind && ['SUBMITTED', 'IN_REVIEW', 'APPEALED'].includes(k.status));
  const obs = Object.values(w.cases).filter(k => ['FARMER', 'BUYER'].includes(k.kind) && k.status === 'NEEDS_INFO');
  const today = Object.values(w.cases).filter(k => ['FARMER', 'BUYER'].includes(k.kind) && k.decision && startOfDay(k.decision.at) === startOfDay(A.now) && ['APPROVED', 'REJECTED'].includes(k.status));
  const base = tab === 'F' ? open('FARMER') : tab === 'B' ? open('BUYER') : tab === 'O' ? obs : today;
  const list = base.filter(k => { if (!q) return true; const o = w.orgs[k.orgId]; const us = Object.values(w.users).filter(u => u.orgId === k.orgId); return [o?.name ?? '', o?.ruc ?? '', ...us.map(u => `${u.name} ${u.dni ?? ''} ${u.phone}`)].some(s => norm(s).includes(norm(q))); }).sort((a, b) => a.submittedAt - b.submittedAt);
  const unassigned = [...open('FARMER'), ...open('BUYER')].filter(k => !k.assignedTo).sort((a, b) => a.submittedAt - b.submittedAt);
  const take = (k: VerifCase, thenOpen = true) => { const r = A.act('VERIF_TAKE', { caseId: k.id }, { quiet: true }); if (!r.ok) { A.toast(r.error!.message, 'err'); return; } if (thenOpen) A.go('W-04', { id: k.id }); };
  return (
    <WebFrame title="Bandeja de verificaciones" sub="Primero lo más antiguo · cada caso toma unos 15 minutos"
      right={<><WSearch value={q} onInput={setQ} placeholder="Buscar DNI, RUC o nombre" />{unassigned.length > 0 && <Btn kind="dark" sm onClick={() => { unassigned.slice(0, 3).forEach(k => take(k, false)); A.toast(`Te asignaste ${Math.min(3, unassigned.length)} expedientes.`); }}>Asignarme {Math.min(3, unassigned.length)}</Btn>}</>}>
      <Tabs value={tab} onChange={setTab} options={[['F', `Agricultores (${open('FARMER').length})`], ['B', `Compradores MYPE (${open('BUYER').length})`], ['O', `Observados (${obs.length})`], ['R', `Resueltos hoy (${today.length})`]]} />
      <div className="wcard">
        <table className="wtable resp">
          <thead><tr><th>Antigüedad</th><th>Solicitante</th><th>Distrito</th><th>Pide</th><th>Evidencias</th><th>Alertas</th><th>Asignado</th><th /></tr></thead>
          <tbody>{list.map(k => {
            const o = w.orgs[k.orgId];
            const mine = k.assignedTo === A.me!.id;
            return (
              <Row key={k.id} onOpen={() => A.go('W-04', { id: k.id })}>
                <td data-l="Antigüedad"><AgePill t={k.submittedAt} /></td>
                <td data-l="Solicitante"><b>{o?.legalName && o.type === 'BUYER' ? o.legalName : o?.name}</b></td>
                <td data-l="Distrito">{districtName(o?.district)}</td>
                <td data-l="Pide">{levelAsked(w, k)}</td>
                <td data-l="Evidencias" style={{ maxWidth: "300px" }}>{(() => { const l = [...new Set(k.evidence.filter(e => e.key !== 'dni2').map(e => e.key.startsWith('rostro') ? 'Rostro (3 ángulos)' : e.label.split(' · ')[0]))]; return l.slice(0, 3).join(', ') + (l.length > 3 ? '…' : ''); })()}</td>
                <td data-l="Alertas">{k.alerts.length ? k.alerts.map(a => <Pill key={a} tone={/RUC|TEL|DNI/.test(a) ? 'danger' : 'warn'}>{a}</Pill>) : <Pill>Ninguna</Pill>}</td>
                <td data-l="Asignado">{k.assignedTo ? adminName(w, k.assignedTo) : 'Sin asignar'}</td>
                <td data-l="">{['APPROVED', 'REJECTED'].includes(k.status) ? <Pill tone={k.status === 'APPROVED' ? '' : 'danger'}>{k.status === 'APPROVED' ? 'Aprobado' : 'Rechazado'}</Pill> : k.assignedTo ? <Btn sm kind={mine ? 'dark' : 'sec'} onClick={(e: any) => { e.stopPropagation(); A.go('W-04', { id: k.id }); }}>Abrir</Btn> : <Btn sm kind="sec" onClick={(e: any) => { e.stopPropagation(); take(k); }}>Tomar</Btn>}</td>
              </Row>
            );
          })}</tbody>
        </table>
        {list.length === 0 && <p className="wnote">No hay expedientes en esta bandeja.</p>}
      </div>
      <p className="wnote">Plazo de respuesta: 48 h. Las alertas salen de reglas antifraude (teléfono o cuenta repetidos, RUC no habido, selfie borrosa); nunca rechazan solas: decide una persona (RN-16). Los almacenes y transportistas se revisan en sus secciones.</p>
    </WebFrame>
  );
}

/* ================= W-04 · Expediente ================= */
const CHECKS: Record<string, Record<number, string[]>> = {
  FARMER: { 1: ['DNI y selfie coinciden (RENIEC)', 'Cuenta de cobro propia o autorizada', 'Sin teléfonos ni DNI repetidos'], 2: ['Padrón de Productores Agrarios coincide', 'Fotos tomadas en la app y en la chacra', 'Sin cuentas ni teléfonos repetidos', 'Producto declarado coherente con la zona', 'Documento de tenencia (opcional con Padrón)'], 3: ['RUC activo y habido', 'Régimen tributario que emite factura', 'Representante con vigencia de poder'] },
  BUYER: { 1: ['RUC activo y habido', 'DNI y selfie del representante', 'Sin RUC ni teléfonos repetidos'], 2: ['Licencia de funcionamiento', 'Foto del local con ubicación', 'Ficha RUC con actividad compatible'], 3: ['Pagos puntuales en 3 meses', 'Método de pago validado'] },
};
function CaseFile() {
  const A = useApp();
  const w = A.w;
  const k = w.cases[A.top.p?.id as string];
  const [result, setResult] = useState<'APPROVE' | 'NEEDS_INFO' | 'REJECT'>('APPROVE');
  const [reason, setReason] = useState('');
  const viewed = useRef(false);
  useEffect(() => { if (k && !viewed.current) { viewed.current = true; A.act('AUDIT_VIEW', { entity: k.orgId, detail: `Abrió el expediente ${levelAsked(w, k)} de ${orgName(w, k.orgId)} (documentos personales)` }, { quiet: true }); } }, [k?.id]);
  if (!k) return <WebFrame title="Expediente" back><div className="wcard"><p>No encontramos el expediente.</p></div></WebFrame>;
  const o = w.orgs[k.orgId];
  const u = Object.values(w.users).find(x => x.orgId === o.id);
  const queue = Object.values(w.cases).filter(x => x.kind === k.kind && ['SUBMITTED', 'IN_REVIEW', 'APPEALED'].includes(x.status)).sort((a, b) => a.submittedAt - b.submittedAt);
  const idx = queue.findIndex(x => x.id === k.id);
  const pad = o.ruc ? w.padron[o.ruc] : undefined;
  const farm = Object.values(w.farms).filter(f => f.orgId === o.id);
  const dupPhone = u ? Object.values(w.users).some(x => x.id !== u.id && x.phone === u.phone) : false;
  const acct = o.payout[0];
  const contrast: [string, string, string, ReactNode][] = [
    k.identity
      ? ['Nombre y DNI', `${k.identity.name} · ${maskDni(k.identity.dni)}`, k.identity.registry ? (k.identity.registry.source === 'PROVEEDOR' ? `RENIEC (${k.identity.registry.provider ?? 'proveedor'})` : k.identity.registry.source === 'PADRON_PRUEBA' ? 'Padrón de prueba (demo)' : 'Sin consulta') : 'Consultando...', <Pill tone={k.identity.registry?.status === 'MATCH' ? '' : k.identity.registry?.status === 'PARTIAL' || !k.identity.registry || k.identity.registry.status === 'UNAVAILABLE' || k.identity.registry.status === 'NOT_FOUND' ? 'warn' : 'danger'}>{({ MATCH: 'Coincide', PARTIAL: 'En parte', NAME_MISMATCH: 'No coincide', NOT_FOUND: 'No figura', DECEASED: 'Fallecido', UNAVAILABLE: 'Sin respuesta' } as Record<string, string>)[k.identity.registry?.status ?? ''] ?? '—'}</Pill>]
      : ['Nombre y DNI', `${u?.name ?? o.name} · ${maskDni(u?.dni)}`, 'Consulta a RENIEC (simulada)', <Pill>Coincide</Pill>],
    ...(o.ruc ? [['RUC', `${maskRuc(o.ruc)} · ${o.legalName ?? o.name}`, 'Padrón de la SUNAT (de prueba)', pad ? <Pill tone={pad.estado === 'ACTIVO' && pad.condicion === 'HABIDO' ? '' : 'danger'}>{pad.estado} · {pad.condicion}</Pill> : <Pill tone="gray">Sin datos</Pill>] as [string, string, string, ReactNode]] : []),
    ...(farm.length ? [['Chacra', `${farm.map(f => `${String(f.areaHa).replace('.', ',')} ha · ${districtName(f.district)}`).join(' · ')}`, 'GPS de las fotos (app)', <Pill tone={farm.some(f => f.gps === 'APP') ? '' : 'warn'}>{farm.some(f => f.gps === 'APP') ? 'Dentro del área' : 'Ubicación manual'}</Pill>] as [string, string, string, ReactNode]] : []),
    ...(() => {
      const f = farm.find(x => x.place && x.place.source !== 'DISTRITO');
      const pin = o.location && o.location.source !== 'DISTRITO' ? o.location : f?.place ?? o.location;
      if (!pin) return [] as [string, string, string, ReactNode][];
      const where = pin === o.location ? o.district : f?.district ?? o.district;
      return [['Ubicación de la chacra', `${pin.label} · ${placeLabel(where)}${pin.ref ? ` · «${pin.ref}»` : ''}`, pinSource(pin), <button className="linkbtn" onClick={() => openExternal(mapsLink(pin.lat, pin.lng))}><Icon n="external-link" s="1em" /> Ver en Google Maps</button>]] as [string, string, string, ReactNode][];
    })(),
    ['Celular', u?.phone ? `${u.phone.slice(0, 3)} ••• ${u.phone.slice(-3)}` : '—', 'Otras cuentas de Mesagri', <Pill tone={dupPhone ? 'danger' : ''}>{dupPhone ? 'Repetido' : 'Único'}</Pill>],
    ...(acct ? [['Cuenta de cobro', `${acct.kind === 'BANK' ? 'Cuenta' : acct.kind === 'PLIN' ? 'Plin' : 'Yape'} ${acct.relation === 'PROPIA' ? 'propio' : `de ${acct.holder}`}`, acct.relation === 'PROPIA' ? 'A su nombre' : 'Autorización firmada (RN-28)', <Pill tone={acct.relation === 'PROPIA' ? '' : 'warn'}>{acct.relation === 'PROPIA' ? 'Vigente' : 'De tercero'}</Pill>] as [string, string, string, ReactNode]] : []),
  ];
  const checks = CHECKS[k.kind]?.[k.targetLevel] ?? [];
  const decided = !['SUBMITTED', 'IN_REVIEW', 'APPEALED'].includes(k.status);
  const decide = (r: typeof result) => {
    const res = A.act('VERIF_DECIDE', { caseId: k.id, result: r, reason }, { quiet: true });
    if (!res.ok) { A.toast(res.error!.message, 'err'); return; }
    A.toast(r === 'APPROVE' ? `Aprobado: ${o.name} ya tiene ${levelAsked(w, k).toLowerCase()}.` : r === 'REJECT' ? 'Rechazo guardado. Puede apelar una vez.' : 'Pedimos más datos al usuario.');
    const next = queue[idx + 1] ?? queue[idx - 1];
    if (next && next.id !== k.id) A.replace('W-04', { id: next.id }); else A.reset('W-03');
  };
  return (
    <WebFrame back title={<>Expediente · {u?.name ?? o.name}</>} sub={`${o.type === 'FARMER' ? 'Agricultor' : 'Comprador MYPE'} · ${placeLabel(o.district)} · pide ${levelAsked(w, k).toLowerCase()} · abierto ${ago(k.submittedAt, A.now)}`}
      right={<><Btn kind="sec" sm disabled={idx <= 0} onClick={() => A.replace('W-04', { id: queue[idx - 1].id })}>Anterior</Btn><Btn kind="sec" sm disabled={idx < 0 || idx >= queue.length - 1} onClick={() => A.replace('W-04', { id: queue[idx + 1].id })}>Siguiente</Btn></>}>
      <div className="split">
        <div className="stack">
          <div className="wcard">
            <div className="row between"><h2>Evidencias</h2><Pill>{k.evidence.length} archivos</Pill></div>
            <div className="wphotos">{k.evidence.map(e => <figure key={e.key + e.label}><div className="photo">{e.photoId ? <Photo id={e.photoId} /> : <Icon n={/foto|chacra|local|selfie/i.test(e.label) ? 'camera' : 'file-text'} s="32" w={1.6} />}</div><figcaption>{e.label}{e.detail ? ` · ${e.detail}` : ''}</figcaption></figure>)}</div>
          </div>
          {k.identity && <IdentityReview k={k} />}
          <div className="wcard">
            <h2>Contraste de datos</h2>
            <table className="wtable resp"><thead><tr><th>Dato</th><th>Declarado</th><th>Fuente</th><th>Resultado</th></tr></thead>
              <tbody>{contrast.map(([a, b, c, d]) => <tr key={a}><td data-l="Dato">{a}</td><td data-l="Declarado">{b}</td><td data-l="Fuente">{c}</td><td data-l="Resultado">{d}</td></tr>)}</tbody></table>
            <p className="wnote">{k.identity?.registry?.source === 'PROVEEDOR' ? 'El DNI se consultó en RENIEC por el proveedor configurado; la SUNAT es de prueba.' : 'Las consultas a RENIEC y a la SUNAT son de prueba en la demo.'} Ver un documento personal queda en auditoría (Ley 29733).</p>
          </div>
        </div>
        <div className="stack">
          <div className="wcard">
            <h2>Checklist del {levelAsked(w, k).toLowerCase()}</h2>
            <div className="stack tight">{checks.map((c, i) => { const warn = (c.includes('opcional') && !k.evidence.some(e => /tenencia/i.test(e.label))) || (c.includes('repetidos') && (k.alerts.length > 0)); return <div key={c} className="row g8"><span className={'icirc ' + (warn ? 'warn' : 'dark')} style={{ width: "24px", height: "24px" }}>{warn ? <Icon n="triangle-alert" s="13" /> : <Icon n="check" s="13" w={3} />}</span><span style={{ fontSize: "14.5px", fontWeight: "700" }}>{c}</span></div>; })}</div>
            {k.alerts.length > 0 && <div className="wnote" style={{ color: "var(--danger)", fontWeight: "700" }}>Alertas: {k.alerts.join(' · ')}. Si apruebas, anota por qué.</div>}
          </div>
          <div className="wcard">
            <h2>Decisión</h2>
            {decided ? <p className="bodym">Decidido por {adminName(w, k.decision?.by)} · {k.status === 'APPROVED' ? 'aprobado' : k.status === 'REJECTED' ? 'rechazado' : 'observado'}{k.decision?.reason ? `: ${k.decision.reason}` : ''}.</p> : <>
              {!k.assignedTo && <Btn sm kind="sec" onClick={() => A.act('VERIF_TAKE', { caseId: k.id }, { ok: 'Te asignaste el expediente.' })}>Tomar el expediente</Btn>}
              <div className="wtabs" style={{ margin: "10px 0" }}>{([['APPROVE', `Aprobar ${levelAsked(w, k).toLowerCase()}`], ['NEEDS_INFO', 'Observar'], ['REJECT', 'Rechazar']] as const).map(([v, l]) => <button key={v} className={result === v ? 'on' : ''} onClick={() => setResult(v)}>{l}</button>)}</div>
              <Inp area value={reason} onInput={setReason} placeholder={result === 'APPROVE' ? 'Padrón y chacra verificados. Sin alertas.' : 'Motivo: el usuario lo va a leer (RN-16)'} label="Motivo" />
              <div className="row g8 wrap" style={{ justifyContent: "flex-end", marginTop: "10px" }}><Btn kind="sec" sm onClick={() => decide('NEEDS_INFO')}>Pedir más datos</Btn><Btn kind={result === 'REJECT' ? 'danger' : 'dark'} sm onClick={() => decide(result)}>Guardar decisión</Btn></div>
            </>}
          </div>
          <div className="wcard"><h2>Historial</h2><div className="stack tight">{k.history.map((h, i) => <div key={i} className="row between" style={{ fontSize: "14px" }}><span>{h.text}{h.by ? ` · ${adminName(w, h.by)}` : ''}</span><span className="cap nowrap">{dateDM(h.at)}</span></div>)}</div></div>
        </div>
      </div>
    </WebFrame>
  );
}

/* ================= W-05 · Usuarios y organizaciones ================= */
/** Último uso por organización: lo que hicieron sus usuarios en la demo y en la historia sembrada. */
function lastSeenMap(A: AppCtx): Map<string, number> {
  const w = A.w;
  const m = new Map<string, number>();
  const bump = (orgId: string | undefined, t: number | undefined) => { if (orgId && t && t <= A.now && (m.get(orgId) ?? 0) < t) m.set(orgId, t); };
  const orgOf = (userId?: string) => (userId ? w.users[userId]?.orgId : undefined);
  for (const e of A.store.events) bump(orgOf(e.actor), e.t);
  for (const s of Object.values(w.subOrders)) for (const h of s.history) bump(orgOf(h.by), h.at);
  for (const l of Object.values(w.listings)) bump(l.orgId, l.createdAt);
  for (const conv of Object.values(w.messages)) for (const msg of conv) bump(orgOf(msg.from), msg.at);
  for (const k of Object.values(w.cases)) bump(k.orgId, k.submittedAt);
  for (const st of Object.values(w.statements)) bump(st.orgId, st.payment?.at);
  for (const sh of Object.values(w.shipments)) for (const ev of sh.events) bump(orgOf(ev.by), ev.at);
  return m;
}
function Users() {
  const A = useApp();
  const w = A.w;
  const [tab, setTab] = useState<'ALL' | 'FARMER' | 'BUYER' | 'WAREHOUSE' | 'CARRIER' | 'BLOCKED' | 'DELETED'>(A.top.p?.id && A.w.orgs[A.top.p.id]?.status === 'DELETED' ? 'DELETED' : 'ALL');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string>(A.top.p?.id ?? 'org-geranios');
  const seen = useMemo(() => lastSeenMap(A), [A.store.version]);
  const orgs = Object.values(w.orgs).filter(o => o.type !== 'MESAGRI');
  const blocked = (o: Org) => o.status === 'SUSPENDED' || paymentStrikes(w, o.id) > 0 || Object.values(w.statements).some(s => s.orgId === o.id && s.status === 'OVERDUE') || o.subscription?.status === 'INACTIVE';
  const live = orgs.filter(o => o.status !== 'DELETED');
  const list = orgs.filter(o => (tab === 'DELETED' ? o.status === 'DELETED' : o.status !== 'DELETED' && (tab === 'ALL' || (tab === 'BLOCKED' ? blocked(o) : o.type === tab))) && (!q || [o.name, o.legalName ?? '', o.ruc ?? '', ...Object.values(w.users).filter(u => u.orgId === o.id).map(u => `${u.name} ${u.dni ?? ''} ${u.phone}`)].some(s => norm(s).includes(norm(q))))).sort((a, b) => (seen.get(b.id) ?? 0) - (seen.get(a.id) ?? 0));
  const o = w.orgs[sel];
  const TYPE: Record<string, string> = { FARMER: 'Agricultor', BUYER: 'MYPE', WAREHOUSE: 'Almacén', CARRIER: 'Transportista' };
  const level = (x: Org) => x.carrier ? x.carrier.level : x.warehouse ? x.warehouse.level : String(x.level);
  const plan = (x: Org) => x.subscription ? `${A.w.settings.plans[x.subscription.plan].name} · ${money(A.w.settings.plans[x.subscription.plan].price).replace(',00', '')}` : x.type === 'FARMER' ? `Comisión ${pct(w.settings.commission.rate)}` : x.type === 'WAREHOUSE' ? `${pct(w.settings.storage.commission)} del alquiler` : `${pct(w.settings.carrier.commission)} del flete`;
  const state = (x: Org): [string, 'warn' | 'danger' | ''] => {
    if (x.status === 'DELETED') return ['Eliminada', 'danger'];
    if (x.status === 'SUSPENDED') return ['Suspendida', 'danger'];
    if (paymentStrikes(w, x.id) > 0) return [`${paymentStrikes(w, x.id)} ${paymentStrikes(w, x.id) === 1 ? 'pago no llegó' : 'pagos no llegaron'}`, 'danger'];
    const od = Object.values(w.statements).find(s => s.orgId === x.id && s.status === 'OVERDUE');
    if (od) return [`No ${x.type === 'FARMER' ? 'publica' : x.type === 'CARRIER' ? 'recibe ofertas' : 'recibe reservas'}: deuda ${money(od.total)}`, 'danger'];
    if (x.subscription?.status === 'GRACE') return ['Pago pendiente', 'warn'];
    if (x.subscription?.status === 'INACTIVE') return ['Sin membresía', 'danger'];
    if (x.level === 0 && (x.type === 'FARMER' || x.type === 'BUYER')) return ['Por verificar', 'warn'];
    return ['Activa', ''];
  };
  return (
    <WebFrame title="Usuarios y organizaciones" sub={`${live.length} cuentas · ${Object.values(w.users).filter(u => u.role !== 'ADMIN' && u.status !== 'DELETED').length} personas · corrige datos, suspende o elimina desde la ficha`} right={<WSearch value={q} onInput={setQ} placeholder="Buscar nombre, DNI, RUC o celular" />}>
      <div className="split">
        <div>
          <Tabs value={tab} onChange={setTab} options={[['ALL', 'Todas'], ['FARMER', 'Agricultores'], ['BUYER', 'MYPE'], ['WAREHOUSE', 'Almacenes'], ['CARRIER', 'Transportistas'], ['BLOCKED', `Con alertas (${live.filter(blocked).length})`], ['DELETED', `Eliminadas (${orgs.length - live.length})`]]} />
          <div className="wcard"><table className="wtable resp">
            <thead><tr><th>Organización</th><th>Tipo</th><th>Nivel</th><th>Plan o cargo</th><th>Estado</th><th>Último uso</th></tr></thead>
            <tbody>{list.map(x => { const [st, tone] = state(x); return (
              <Row key={x.id} sel={x.id === sel} onOpen={() => setSel(x.id)}>
                <td data-l="Organización"><b>{x.legalName && x.type !== 'FARMER' ? x.legalName : x.name}</b></td><td data-l="Tipo">{TYPE[x.type]}</td><td data-l="Nivel">{level(x)}</td><td data-l="Plan o cargo">{plan(x)}</td><td data-l="Estado"><Pill tone={tone}>{st}</Pill></td><td data-l="Último uso">{seen.get(x.id) ? `${relDay(seen.get(x.id)!, A.now)} ${hhmm(seen.get(x.id)!)}` : '—'}</td>
              </Row>
            ); })}</tbody>
          </table>
          {list.length === 0 && <p className="wnote">{tab === 'DELETED' ? 'Ninguna cuenta eliminada.' : 'Sin cuentas con ese filtro.'}</p>}</div>
        </div>
        {o && <OrgCard o={o} key={o.id} />}
      </div>
    </WebFrame>
  );
}
function OrgCard({ o }: { o: Org }) {
  const A = useApp();
  const w = A.w;
  const [why, setWhy] = useState('');
  const [asking, setAsking] = useState(false);
  const members = Object.values(w.users).filter(u => u.orgId === o.id);
  const stats = orgStats(w, o.id);
  const pad = o.ruc ? w.padron[o.ruc] : undefined;
  const role = roleOf(A);
  const P = periodOf(A.now);
  const subs = Object.values(w.subOrders).filter(s => s.buyerOrgId === o.id || s.sellerOrgId === o.id);
  const monthAmt = r2(subs.filter(s => periodOf(s.createdAt) === P && !['REJECTED', 'EXPIRED', 'CANCELLED_BY_BUYER', 'CANCELLED_BY_SELLER'].includes(s.status)).reduce((a, s) => a + s.subtotal, 0));
  const rows: [string, string][] = [
    ...(o.subscription ? [['Membresía', `${w.settings.plans[o.subscription.plan].name} · ${o.subscription.status === 'TRIAL' ? `mes gratis hasta el ${dateNum(o.subscription.trialEndsOn)}` : o.subscription.status === 'ACTIVE' ? `pagada hasta el ${dateNum(o.subscription.paidUntil)}` : o.subscription.status === 'GRACE' ? 'en días de gracia' : 'inactiva'}`] as [string, string]] : []),
    [o.type === 'BUYER' ? `Compras de ${periodLabel(P).split(' ')[0]}` : `Pedidos de ${periodLabel(P).split(' ')[0]}`, `${money(monthAmt)}${o.subscription && w.settings.plans[o.subscription.plan].purchaseCap ? ` de ${moneyShort(w.settings.plans[o.subscription.plan].purchaseCap!)}` : ''}`],
    ['Usuarios', `${members.length}${o.subscription ? ` de ${w.settings.plans[o.subscription.plan].users ?? '∞'}` : ''}`],
    ['Nivel', `${o.carrier ? `${o.carrier.level} · ${CARRIER_LEVEL_NAME[o.carrier.level]}` : o.warehouse ? `${o.warehouse.level} · ${WAREHOUSE_LEVEL_NAME[o.warehouse.level]}` : `${o.level} · ${LEVEL_NAME[o.level]}`}${Object.values(w.cases).some(k => k.orgId === o.id && openCase(k)) ? ' · pide subir' : ''}`],
    ['Pedidos', `${subs.length} · ${stats.disputesLost} disputas perdidas`],
    ['Reputación', stats.rating ? `${String(stats.rating).replace('.', ',')} estrellas · ${stats.count} opiniones` : 'Sin calificaciones'],
  ];
  return (
    <div className="wcard">
      <h2>Ficha</h2>
      <div className="row" style={{ gap: "12px", marginBottom: "10px" }}><span className="av" style={{ background: o.color, width: '52px', height: '52px', fontSize: '17px' }}>{o.initials}</span><div><b style={{ fontSize: "18px" }}>{o.legalName && o.type !== 'FARMER' ? o.legalName : o.name}</b><div className="wnote" style={{ margin: "2px 0 0" }}>{o.ruc ? `RUC ${maskRuc(o.ruc)}${pad ? ` · ${pad.estado.toLowerCase()} y ${pad.condicion.toLowerCase()}` : ''}` : 'Sin RUC'} · {districtName(o.district)}</div></div></div>
      <table className="wtable"><tbody>{rows.map(([a, b]) => <tr key={a}><td>{a}</td><td className="r"><b>{b}</b></td></tr>)}</tbody></table>
      {o.status === 'SUSPENDED' && <p className="wnote" style={{ color: "var(--danger)", fontWeight: "700" }}>Suspendida: {o.suspendedReason}</p>}
      <AccountTools o={o} />
      {asking && <div className="stack tight" style={{ marginTop: "10px" }}><Inp area value={why} onInput={setWhy} placeholder="Motivo de la suspensión (el usuario lo lee)" label="Motivo" /><div className="row g8"><Btn sm kind="danger" onClick={() => { if (A.act('ORG_SUSPEND', { orgId: o.id, reason: why }, { ok: 'Cuenta suspendida. Sus pedidos en curso continúan.' }).ok) { setAsking(false); setWhy(''); } }}>Confirmar suspensión</Btn><Btn sm kind="sec" onClick={() => setAsking(false)}>Cancelar</Btn></div></div>}
      {o.status !== 'DELETED' && <div className="row g8 wrap" style={{ marginTop: "14px" }}>
        {role === 'GENERAL' && <Btn sm kind="sec" onClick={() => A.go('W-12', { q: o.name })}>Ver auditoría</Btn>}
        {role !== 'VERIFIER' && role !== 'ANALYST' && <Btn sm kind="sec" onClick={async () => {
          if (!await A.confirm({ title: `¿Cerrar las sesiones de ${o.name}?`, text: 'Tendrán que volver a entrar con su celular y el código. Queda en la auditoría.', ok: 'Cerrar sesiones' })) return;
          try {
            const token = await A.store.sessions.token(A.me!.id);
            const r = await api<any>(`/admin/organizations/${encodeURIComponent(o.id)}/reset-access`, { token, body: { reason: 'Restablecido desde el panel' } });
            A.toast(`Cerramos ${r.sessionsClosed ?? 0} ${r.sessionsClosed === 1 ? 'sesión' : 'sesiones'} de ${o.name}. Le avisamos para que vuelva a entrar.`);
          } catch (e: any) { A.toast(e?.message ?? 'No pudimos restablecer el acceso.', 'err'); }
        }}>Restablecer acceso</Btn>}
        {(role === 'GENERAL' || role === 'SUPPORT') && (o.status === 'SUSPENDED' ? <Btn sm kind="dark" onClick={() => A.act('ORG_REACTIVATE', { orgId: o.id }, { ok: 'Cuenta reactivada.' })}>Reactivar</Btn> : !asking && <Btn sm kind="secd" onClick={() => setAsking(true)}>Suspender</Btn>)}
      </div>}
      {o.status === 'DELETED' && role === 'GENERAL' && <div className="row g8 wrap" style={{ marginTop: "14px" }}><Btn sm kind="sec" onClick={() => A.go('W-12', { q: 'Cuenta eliminada' })}>Ver auditoría</Btn></div>}
    </div>
  );
}

/* ================= W-06 · Revisión y moderación de publicaciones ================= */
const VERDICT_TONE: Record<ReviewVerdict, '' | 'warn' | 'danger'> = { OK: '', OBSERVAR: 'warn', RECHAZAR: 'danger' };
const CAUSE_LABEL: Record<ListingReview['cause'], string> = { NUEVA: 'Nueva', CAMBIO: 'Cambió fotos o precio', CORRECCION: 'Corregida' };
function reasonOf(w: World, l: Listing): [string, 'warn' | 'danger' | 'gray' | ''] {
  if (l.status === 'IN_REVIEW' && l.review) return [`${VERDICT_LABEL[l.review.auto.verdict]}${l.review.ai === 'PENDIENTE' ? ' · IA mirando' : l.review.ai === 'LISTA' ? ' · IA' : ''}`, (VERDICT_TONE[l.review.auto.verdict] || '') as any];
  if (l.reviewReason) return [/RN-23|rinde/.test(l.reviewReason) ? 'Cantidad poco creíble' : l.reviewReason, 'warn'];
  const f: string[] = l.flags ?? [];
  const price = f.find(x => x.startsWith('Precio'));
  if (price) return [price.replace(' del sugerido', ' frente al sugerido'), 'warn'];
  if (f.length) return [f[0], 'gray'];
  return ['Revisión', 'gray'];
}
/** ¿Está activa la IA en el servidor? (en la versión sin internet, no hay) */
function useAiInfo(A: AppCtx): { ai: boolean; model?: string | null; today?: number; dailyMax?: number } | undefined {
  const [info, setInfo] = useState<{ ai: boolean; model?: string | null; today?: number; dailyMax?: number }>();
  useEffect(() => {
    let on = true;
    if (LOCAL) { setInfo({ ai: false }); return; }
    (async () => {
      try { const token = await A.store.sessions.token(A.me!.id); const r = await api<any>('/review/info', { token, timeoutMs: 8000 }); if (on) setInfo(r); } catch { /* sin datos */ }
    })();
    return () => { on = false; };
  }, []);
  return info;
}
function AutoReviewCard({ l, onUseMessage }: { l: Listing; onUseMessage: (m: string) => void }) {
  const A = useApp();
  const r = l.review!;
  const a = r.auto;
  const head = r.ai === 'PENDIENTE' ? 'La IA está mirando las fotos…' : r.ai === 'LISTA' ? `Revisión de la IA${a.model ? ` (${a.model})` : ''}` : r.ai === 'ERROR' ? 'Revisión por reglas (la IA no respondió)' : 'Revisión automática por reglas';
  return (
    <div className="wcard">
      <div className="row between wrap g8"><h2 style={{ margin: 0 }}><Icon n={r.ai === 'LISTA' ? 'bot' : 'list-checks'} s="1em" /> {head}</h2><span className="row g8"><Pill tone={VERDICT_TONE[a.verdict]}>{VERDICT_LABEL[a.verdict]}</Pill><Pill tone="gray">{a.score}/100</Pill></span></div>
      {r.ai === 'ERROR' && r.aiNote && <p className="wnote">{r.aiNote}</p>}
      {!r.ai && <p className="wnote">Sin IA en este servidor (o en la versión sin internet): las reglas miran precio, cantidad, de dónde salen las fotos y el historial, pero no qué muestran las fotos. Míralas tú.</p>}
      <table className="wtable" style={{ marginTop: '8px' }}><tbody>{a.checks.map((c, i) => (
        <tr key={c.key + i}><td style={{ width: '1.6em' }}><span style={{ color: c.ok === true ? 'var(--forest)' : c.ok === false ? 'var(--danger)' : '#9A6B00' }}><Icon n={c.ok === true ? 'circle-check' : c.ok === false ? 'circle-x' : 'triangle-alert'} s="1.1em" /></span></td><td><b>{c.label}</b><div className="cap">{c.detail}</div></td></tr>
      ))}</tbody></table>
      <p className="wnote" style={{ marginBottom: 0 }}><b>Resumen:</b> {a.summary}</p>
      {a.farmerMessage && <p className="wnote" style={{ marginBottom: 0 }}><b>Sugerencia para el agricultor:</b> {a.farmerMessage} <button className="linkbtn" style={{ padding: 0, minHeight: 0 }} onClick={() => onUseMessage(a.farmerMessage!)}>Usar este mensaje</button></p>}
      <p className="wnote" style={{ marginBottom: 0 }}>{CAUSE_LABEL[r.cause]} · en revisión desde {ago(r.queuedAt, A.now)}{r.approvedAt ? ` · la aprobó ${A.w.users[r.approvedBy ?? '']?.name ?? 'el equipo'} ${ago(r.approvedAt, A.now)}` : ''}. La revisión automática ayuda; la decisión es del equipo.</p>
    </div>
  );
}
function Moderation() {
  const A = useApp();
  const w = A.w;
  const queue = modQueue(w);
  const ai = useAiInfo(A);
  const [tab, setTab] = useState<'Q' | 'ALL'>(A.top.p?.all ? 'ALL' : 'Q');
  const [q, setQ] = useState<string>(A.top.p?.q ?? '');
  const [showGone, setShowGone] = useState(false);
  const [sel, setSel] = useState<string | undefined>(A.top.p?.id ?? queue[0]?.id);
  const [msg, setMsg] = useState('');
  const base = tab === 'Q' ? queue : Object.values(w.listings).filter(l => showGone || l.status !== 'REMOVED').sort((a, b) => b.createdAt - a.createdAt);
  const list = base.filter(l => !q || norm(`${product(l.productId).name} ${l.variety ?? ''} ${orgName(w, l.orgId)}`).includes(norm(q)));
  const l = sel ? w.listings[sel] : undefined;
  const act = async (decision: 'APPROVE' | 'REJECT' | 'PAUSE' | 'REMOVE') => {
    if (!l) return;
    if (decision === 'REMOVE' && !await A.confirm({ title: '¿Eliminar esta publicación?', text: 'Sale del catálogo y se borran sus fotos. No vuelve (el agricultor puede publicar otra). Sus pedidos en curso siguen.', ok: 'Eliminar', danger: true })) return;
    if (decision === 'APPROVE' && l.status === 'IN_REVIEW' && l.review?.auto.verdict === 'RECHAZAR' && !await A.confirm({ title: '¿Publicarla igual?', text: `La revisión automática dice «${VERDICT_LABEL.RECHAZAR.toLowerCase()}»: ${l.review.auto.summary}`, ok: 'Sí, publicar' })) return;
    const was = l.status;
    const r = A.act('LISTING_MODERATE', { listingId: l.id, decision, reason: decision === 'APPROVE' ? '' : msg }, { quiet: true });
    if (!r.ok) { A.toast(r.error!.message, 'err'); return; }
    A.toast(decision === 'APPROVE' ? (was === 'IN_REVIEW' ? 'Aprobada y publicada: ya se ve en el catálogo.' : 'Aprobada: ya se ve en el catálogo.') : decision === 'PAUSE' ? 'Le pedimos los cambios al agricultor (con audio). Cuando corrija, vuelve a esta cola.' : decision === 'REMOVE' ? 'Publicación eliminada y sus fotos borradas.' : was === 'IN_REVIEW' ? 'Rechazada: no se publica.' : 'Publicación ocultada del catálogo.');
    setMsg(''); if (tab === 'Q') setSel(queue.find(x => x.id !== l.id)?.id);
  };
  const s = l ? w.orgs[l.orgId] : undefined;
  const sug = l ? suggestedPricePerKg(l.productId) : 0;
  const diff = l ? pricePerKg(l) / sug - 1 : 0;
  const prev = l ? Object.values(w.listings).filter(x => x.orgId === l.orgId && x.id !== l.id).length : 0;
  // La nota y la pregunta al agricultor siguen al motivo: precio muy bajo, muy alto u otra regla
  const why = diff <= -0.3 ? 'low' : diff >= 0.5 ? 'high' : 'other';
  const ask = why === 'low' ? '¿El precio es por kilo o por arroba?' : why === 'high' ? '¿El precio es por kilo o por saco?' : '¿La cantidad y el precio son correctos?';
  const inReview = l?.status === 'IN_REVIEW';
  const flagged = l ? queue.some(x => x.id === l.id) : false;
  const farm = l?.farmId ? w.farms[l.farmId] : undefined;
  const aiLine = LOCAL ? 'Versión sin internet: revisión por reglas y luego el equipo.' : ai === undefined ? 'Primero la revisión automática y luego el equipo: recién ahí se publica.' : ai.ai ? `IA activa (${ai.model}) · ${ai.today ?? 0} de ${ai.dailyMax} revisiones hoy · luego decide el equipo` : 'IA no configurada (ANTHROPIC_API_KEY en Render): revisión por reglas y luego el equipo.';
  return (
    <WebFrame title="Publicaciones" sub={aiLine} right={<WSearch value={q} onInput={setQ} placeholder="Buscar producto o agricultor" />}>
      <Tabs value={tab} onChange={(t) => { setTab(t); setSel(t === 'Q' ? queue[0]?.id : undefined); }} options={[['Q', `Por revisar (${queue.length})`], ['ALL', 'Todas las publicaciones']]} />
      <div className="split">
        <div className="wcard">
          <div className="row between wrap"><h2 style={{ margin: 0 }}>{tab === 'Q' ? `Cola (${list.length})` : `Publicaciones (${list.length})`}</h2>{tab === 'ALL' && <label className="cap row g8" style={{ alignItems: 'center' }}><input type="checkbox" checked={showGone} onChange={(e: any) => setShowGone(e.currentTarget.checked)} /> Ver también las eliminadas</label>}</div>
          <table className="wtable resp"><thead><tr><th>Publicación</th><th>Agricultor</th><th>{tab === 'Q' ? 'Revisión' : 'Estado'}</th><th>Desde</th></tr></thead>
            <tbody>{list.slice(0, 150).map(x => { const [m, tone] = reasonOf(w, x); return <Row key={x.id} sel={x.id === sel} onOpen={() => { setSel(x.id); setMsg(''); }}><td data-l="Publicación"><b>{product(x.productId).name}{x.variety ? ` ${x.variety}` : ''} · {x.unit === 'kg' ? fkg(x.qtyTotal ?? x.available) : `${numTrim(x.qtyTotal ?? x.available)} ${UNIT_LABEL[x.unit].many}`}</b><div className="cap">{money(x.price)} por {x.unit === 'kg' ? 'kg' : UNIT_LABEL[x.unit].one}{x.status === 'IN_REVIEW' && x.review ? ` · ${CAUSE_LABEL[x.review.cause].toLowerCase()}` : ''}</div></td><td data-l="Agricultor">{orgName(w, x.orgId)}</td><td data-l={tab === 'Q' ? 'Revisión' : 'Estado'}>{tab === 'Q' ? <Pill tone={tone}>{m}</Pill> : listingPill(x)}</td><td data-l="Desde">{ago(x.review?.queuedAt ?? x.createdAt, A.now).replace('hace ', '')}</td></Row>; })}</tbody></table>
          {list.length === 0 && <p className="wnote">{tab === 'Q' ? 'No hay publicaciones por revisar.' : 'No hay publicaciones con esa búsqueda.'}</p>}
          {list.length > 150 && <p className="wnote">Mostramos 150: busca por producto o agricultor.</p>}
        </div>
        {l && s && (
          <div className="stack">
            <div className="wcard">
              <div className="row between"><h2 style={{ margin: 0 }}>Detalle</h2>{listingPill(l)}</div>
              <div className="row" style={{ gap: "14px", marginTop: '8px' }}><span className="tile lg" style={{ background: product(l.productId).color, width: '76px', height: '76px', fontSize: '34px' }}>{product(l.productId).letter}</span><div><b style={{ fontSize: "19px" }}>{listingTitle(l)}</b><div className="price" style={{ fontSize: "18px" }}>{money(pricePerKg(l))} por kg</div><div className="wnote" style={{ margin: "2px 0 0" }}><button className="linkbtn" style={{ padding: 0, minHeight: 0 }} onClick={() => A.go('W-05', { id: s.id })}>{s.name}</button> · {districtName(s.district)} · nivel {s.level}</div></div></div>
              {l.photoIds.length > 0 ? <div className="wphotos" style={{ marginTop: '10px' }}>{l.photoIds.map((p, i) => <figure key={p}><div className="photo"><Photo id={p} /></div><figcaption>{i === 0 ? 'Portada' : `Foto ${i + 1}`}{p.startsWith('ph-gal-') ? ' · de la galería' : ' · tomada en la app'}{l.harvestSeal && i === 0 ? ' · cosechado hoy' : ''}</figcaption></figure>)}</div> : <p className="wnote">Sin fotos.</p>}
              <table className="wtable" style={{ marginTop: "10px" }}><tbody>
                <tr><td>Precio sugerido hoy</td><td className="r"><b>{money(sug)} por kg</b></td></tr>
                <tr><td>Diferencia</td><td className="r"><b>{diff >= 0 ? '+' : '−'}{pct(Math.abs(diff))}</b></td></tr>
                <tr><td>Disponible · reservado · vendido</td><td className="r"><b>{numTrim(l.available)} · {numTrim(l.reserved)} · {numTrim(l.sold)} {l.unit === 'kg' ? 'kg' : UNIT_LABEL[l.unit].many}</b></td></tr>
                {farm && <tr><td>Chacra</td><td className="r"><b>{farm.name} · {String(farm.areaHa).replace('.', ',')} ha · {placeLabel(farm.district)}</b>{farm.place && <div><button className="linkbtn" style={{ padding: 0, minHeight: 0 }} onClick={() => openExternal(mapsLink(farm.place!.lat, farm.place!.lng))}>{farm.place.label} · ver en Google Maps</button></div>}</td></tr>}
                <tr><td>Publicada</td><td className="r"><b>{dateShort(l.createdAt)} · vence {Number.isFinite(l.expiresAt) ? dateShort(l.expiresAt) : '—'}</b></td></tr>
                <tr><td>Otras publicaciones suyas</td><td className="r"><b>{prev}</b></td></tr>
                {l.reviewReason && <tr><td>{l.status === 'PAUSED' ? 'Cambios pedidos' : 'Motivo'}</td><td className="r"><b>{l.reviewReason}</b></td></tr>}
              </tbody></table>
            </div>
            {l.review && (inReview || l.review.ai === 'LISTA') && <AutoReviewCard l={l} onUseMessage={setMsg} />}
            {l.status !== 'REMOVED' ? <div className="wcard">
              <h2>{inReview ? 'Tu decisión' : 'Acción'}</h2>
              <Inp area value={msg} onInput={setMsg} placeholder={inReview ? 'Qué debe corregir (lo lee y lo escucha el agricultor): foto que no es del producto, precio por saco puesto por kilo…' : flagged ? ask : 'Motivo (el agricultor lo lee): foto que no es del producto, precio engañoso, producto prohibido…'} label="Mensaje al agricultor" />
              <div className="row g8 wrap" style={{ marginTop: "10px" }}>
                {inReview && <Btn sm kind="dark" icon="circle-check" onClick={() => act('APPROVE')}>Aprobar y publicar</Btn>}
                {!inReview && l.status !== 'ACTIVE' && l.status !== 'SOLD_OUT' && <Btn sm kind="dark" onClick={() => act('APPROVE')}>Volver a mostrar</Btn>}
                {!inReview && flagged && l.status === 'ACTIVE' && <Btn sm kind="dark" onClick={() => act('APPROVE')}>Aprobar</Btn>}
                {l.status !== 'PAUSED' && <Btn sm kind="sec" onClick={() => { if (!msg.trim()) { if (l.review?.auto.farmerMessage) setMsg(l.review.auto.farmerMessage); else if (flagged) setMsg(`${ask} Corrígelo y vuelve a enviarla.`); else A.toast('Escribe qué debe corregir: el agricultor lo va a leer.', 'warn'); } else act('PAUSE'); }}>{inReview ? 'Pedir cambios' : 'Pausar y pedir corrección'}</Btn>}
                {l.status !== 'REJECTED' && <Btn sm kind="secd" onClick={() => { if (!msg.trim()) { A.toast('Escribe el motivo: el agricultor lo va a leer.', 'warn'); return; } act('REJECT'); }}>{inReview ? 'Rechazar' : 'Ocultar'}</Btn>}
                <Btn sm kind="danger" icon="trash" onClick={() => { if (!msg.trim()) { A.toast('Escribe el motivo: el agricultor lo va a leer.', 'warn'); return; } void act('REMOVE'); }}>Eliminar</Btn>
              </div>
              <p className="wnote">{inReview ? 'Aprobar: se publica y la ven los compradores. Pedir cambios: el agricultor la corrige y vuelve a esta cola. Rechazar: no se publica y no la puede reactivar. Eliminar: además se borran sus fotos.' : 'Pausar: el agricultor la corrige y la envía otra vez a revisión. Ocultar: deja de verse y no la puede reactivar. Eliminar: además se borran sus fotos.'} Los pedidos en curso siguen. El mensaje le llega con audio y queda en auditoría.</p>
            </div> : <div className="wcard"><p className="wnote" style={{ margin: 0 }}>Publicación eliminada{l.reviewReason ? `: ${l.reviewReason}` : ''}. No vuelve al catálogo.</p></div>}
          </div>
        )}
      </div>
    </WebFrame>
  );
}

/* ================= W-07 · Pedidos y disputas ================= */
function Disputes() {
  const A = useApp();
  const w = A.w;
  const ds = Object.values(w.disputes).sort((a, b) => (a.status === 'RESOLVED' ? 1 : 0) - (b.status === 'RESOLVED' ? 1 : 0) || a.openedAt - b.openedAt);
  const expired = Object.values(w.subOrders).filter(s => s.status === 'EXPIRED').sort((a, b) => b.confirmBy - a.confirmBy);
  const unpaid = Object.values(w.subOrders).filter(s => s.payment.status === 'UPLOADED' || s.payment.status === 'NOT_RECEIVED').sort((a, b) => (a.payment.uploadedAt ?? 0) - (b.payment.uploadedAt ?? 0));
  const [tab, setTab] = useState<'D' | 'E' | 'P' | 'T'>(A.top.p?.order ? 'T' : 'D');
  const [sel, setSel] = useState<string | undefined>(A.top.p?.id ?? ds.find(d => d.status !== 'RESOLVED')?.id ?? ds[0]?.id);
  const [order, setOrder] = useState<string | undefined>(A.top.p?.order);
  const [q, setQ] = useState('');
  const d = sel ? w.disputes[sel] : undefined;
  const all = Object.values(w.subOrders).filter(s => !q || norm(`${s.code} ${orgName(w, s.buyerOrgId)} ${orgName(w, s.sellerOrgId)} ${s.payment.operation ?? ''}`).includes(norm(q))).sort((a, b) => b.createdAt - a.createdAt).slice(0, 60);
  const so = order ? w.subOrders[order] : undefined;
  const withDetail = (list: SubOrder[], title: ReactNode, foot?: ReactNode) => (
    <div className={so ? 'split' : ''}>
      <div className="wcard">{title}<OrdersTable list={list} sel={order} onOpen={setOrder} />{list.length === 0 && <p className="wnote">No hay pedidos aquí.</p>}{foot}</div>
      {so && <OrderDetail s={so} key={so.id} onClose={() => setOrder(undefined)} />}
    </div>
  );
  return (
    <WebFrame title={tab === 'D' && d ? `Disputa ${d.code}` : 'Pedidos y disputas'} sub={tab === 'D' && d ? `Pedido ${w.subOrders[d.subOrderId]?.code} · ${orgName(w, w.subOrders[d.subOrderId]?.buyerOrgId)} compró ${itemsShort(w.subOrders[d.subOrderId]).toLowerCase()} a ${orgName(w, w.subOrders[d.subOrderId]?.sellerOrgId)}` : 'Soporte media; Mesagri no retiene dinero (RN-15)'}
      right={<>{tab === 'T' && <WSearch value={q} onInput={setQ} placeholder="Buscar pedido, cuenta u operación" />}<Tabs value={tab} onChange={(t) => { setTab(t); setOrder(undefined); }} options={[['D', `Disputas (${ds.filter(x => x.status !== 'RESOLVED').length})`], ['P', `Pagos sin confirmar (${unpaid.length})`], ['E', `Pedidos vencidos (${expired.length})`], ['T', 'Todos']]} /></>}>
      {tab === 'D' && (
        <>
          {ds.length > 1 && <div className="chips" style={{ marginBottom: "12px" }}>{ds.map(x => <button key={x.id} className={'chip ' + (x.id === sel ? 'forest' : 'line')} onClick={() => setSel(x.id)}>{x.code} · {x.status === 'RESOLVED' ? 'resuelta' : x.status === 'PROPOSED' ? 'propuesta' : 'abierta'}</button>)}</div>}
          {d ? <DisputeView d={d} key={d.id} /> : <div className="wcard"><p className="wnote">No hay disputas.</p></div>}
        </>
      )}
      {tab === 'P' && withDetail(unpaid, <h2>Constancias que el agricultor todavía no confirma</h2>, <p className="wnote">El dinero va directo a la cuenta del agricultor: solo él puede ver si llegó. Si pasan más de 24 h, escríbele para que revise su Yape o su banco. Si dice que no le llegó, se abre una disputa de pago.</p>)}
      {tab === 'E' && withDetail(expired, <h2>Pedidos que vencieron sin respuesta (RN-08)</h2>, <p className="wnote">El agricultor tenía {w.settings.orderResponseHours} h para aceptar. Vencido, el comprador no paga nada y se cuenta en la reputación del agricultor.</p>)}
      {tab === 'T' && withDetail(all, <h2>Últimos pedidos</h2>, <p className="wnote">Toca un pedido para ver su pago (constancia, titular y código) o cancelarlo si todavía no sale.</p>)}
    </WebFrame>
  );
}
function OrdersTable({ list, sel, onOpen }: { list: SubOrder[]; sel?: string; onOpen?: (id: string) => void }) {
  const A = useApp();
  return (
    <table className="wtable resp"><thead><tr><th>Pedido</th><th>Comprador</th><th>Agricultor</th><th>Producto</th><th className="r">Total</th><th>Estado</th><th>Pago</th></tr></thead>
      <tbody>{list.map(s => { const st = statusInfo(s, 'buyer'); const [ps, ptone] = payState(s, A.now); return <Row key={s.id} sel={s.id === sel} onOpen={onOpen ? () => onOpen(s.id) : undefined}><td data-l="Pedido"><b>{s.code}</b><div className="cap">{dateShort(s.createdAt)} {hhmm(s.createdAt)}</div></td><td data-l="Comprador">{orgName(A.w, s.buyerOrgId)}</td><td data-l="Agricultor">{orgName(A.w, s.sellerOrgId)}</td><td data-l="Producto">{itemsShort(s)}<div className="cap">{deliveryText(s)}</div></td><td data-l="Total" className="r tnum">{money(s.total)}</td><td data-l="Estado"><Pill tone={st.tone === 'danger' ? 'danger' : st.tone === 'terra' || st.tone === 'warn' ? 'warn' : ''}>{s.status === 'DELIVERED' ? 'Por conformidad' : st.label}</Pill></td><td data-l="Pago"><Pill tone={ptone}>{ps}</Pill></td></Row>; })}</tbody></table>
  );
}
function DisputeView({ d }: { d: Dispute }) {
  const A = useApp();
  const w = A.w;
  const s = w.subOrders[d.subOrderId];
  const lines = s.items.map(i => ({ i, missing: r2(Math.max(0, i.qty - (i.acceptedQty ?? i.qty))) }));
  const diffAmt = r2(lines.reduce((a, x) => a + x.missing * x.i.price, 0));
  const [refund, setRefund] = useState(String(d.proposal?.refund ?? diffAmt).replace('.', ','));
  const [note, setNote] = useState(d.proposal?.note ?? (diffAmt ? `Faltaron ${lines.filter(x => x.missing).map(x => `${numTrim(x.missing)} ${x.i.unit === 'kg' ? 'kg' : UNIT_LABEL[x.i.unit].many}`).join(', ')}: ${orgName(w, s.sellerOrgId).split(' ')[0]} devuelve ${money(diffAmt)} por Yape.` : ''));
  const ref = Number(refund.replace(',', '.')) || 0;
  const msgs = (w.messages[s.id] ?? []).slice(-4);
  const photos = (d.kind === 'PAGO_NO_RECIBIDO' ? [s.payment.photoId, ...d.photoIds] : [s.deliveryPhotoId, ...(s.receiptPhotoIds ?? []), ...d.photoIds]).filter(Boolean) as string[];
  const sale = r2(s.subtotal - ref);
  const resolve = (outcome: 'FAVOR_COMPRADOR' | 'FAVOR_AGRICULTOR' | 'ACUERDO', amount: number) => {
    const r = A.act('DISPUTE_RESOLVE', { disputeId: d.id, outcome, refund: amount, note: note || (outcome === 'FAVOR_AGRICULTOR' ? 'Las pruebas muestran que se entregó lo pedido.' : 'Acuerdo entre las partes.') }, { quiet: true });
    if (!r.ok) { A.toast(r.error!.message, 'err'); return; }
    A.toast(`${d.code} resuelta y registrada en auditoría.`);
  };
  const payDispute = d.kind === 'PAGO_NO_RECIBIDO';
  const tl = [
    { t: `Pedido: ${itemsShort(s).toLowerCase()} = ${money(s.subtotal)}`, s: `${dateShort(s.createdAt)} · pago por ${PAY_LABEL[s.payment.method]}${s.payment.status === 'CONFIRMED' ? ' confirmado' : ''}`, done: true },
    ...(s.deliveredAt ? [{ t: 'Entregado con foto y código', s: `${dateShort(s.deliveredAt)} · ${hhmm(s.deliveredAt)}`, done: true }] : []),
    { t: payDispute ? 'El agricultor dice que no le llegó el pago' : `El comprador reporta: ${d.description}`, s: `${dateShort(d.openedAt)} · ${hhmm(d.openedAt)}${d.photoIds.length ? ' · con foto' : ''}`, done: false, cur: true },
    { t: d.status === 'RESOLVED' ? `Resuelta: ${d.resolution?.note}` : d.status === 'PROPOSED' ? `Propuesta enviada: ${d.proposal?.note || money(d.proposal?.refund ?? 0)}` : 'Resolución', s: d.status === 'RESOLVED' ? `${dateShort(d.resolution!.at)} · ${adminName(w, d.resolution!.by)}` : 'Plazo de Soporte: 72 h', done: d.status === 'RESOLVED' },
  ];
  return (
    <div className="split">
      <div className="stack">
        <div className="wcard"><h2>Línea de tiempo</h2>
          <div className="tl">{tl.map((x, i) => <div key={i} className={'st ' + (x.done ? 'done' : (x as any).cur ? 'cur' : 'pend')}><span className="dotc">{x.done ? <Icon n="check" s="1.1em" w={3} /> : (x as any).cur ? <Icon n="clock" s="1.1em" w={2.5} /> : null}</span><div><b>{x.t}</b><span>{x.s}</span></div></div>)}</div>
        </div>
        <div className="wcard"><h2>Evidencias</h2>
          {photos.length ? <div className="wphotos">{photos.map((p, i) => <figure key={p}><div className="photo"><Photo id={p} /></div><figcaption>{p === s.payment.photoId ? 'Constancia que subió el comprador' : p === s.deliveryPhotoId ? 'Entrega · foto del agricultor' : i <= (s.receiptPhotoIds?.length ?? 0) ? 'Recepción · foto del comprador' : 'Foto del reporte'}</figcaption></figure>)}</div>
            : <div className="wphotos">{['Entrega · foto del agricultor', 'Recepción · balanza del comprador', 'Sacos al llegar'].map(l => <figure key={l}><div className="photo"><Icon n="camera" s="32" w={1.6} /></div><figcaption>{l} · sin foto en la demo</figcaption></figure>)}</div>}
          {lines.some(x => x.missing) && <p className="wnote">Pedido: {lines.map(x => `${numTrim(x.i.qty)} ${x.i.unit}`).join(', ')} · aceptado por el comprador: {lines.map(x => `${numTrim(x.i.acceptedQty ?? x.i.qty)} ${x.i.unit}`).join(', ')}.</p>}
        </div>
      </div>
      <div className="stack">
        <div className="wcard"><h2>Chat del pedido (extracto)</h2>
          {msgs.length ? <div className="stack tight">{msgs.map(m => { const fromBuyer = w.users[m.from]?.orgId === s.buyerOrgId; return <div key={m.id} className="wmsg" style={fromBuyer ? undefined : { background: "var(--field)", color: "#fff", marginLeft: "2em" }}>{m.text}<small>{w.users[m.from]?.shortName} · {hhmm(m.at)}</small></div>; })}</div> : <p className="wnote">Sin mensajes en este pedido.</p>}
        </div>
        <div className="wcard"><h2>{d.status === 'RESOLVED' ? 'Resolución' : 'Resolución sugerida'}</h2>
          {d.status === 'RESOLVED' ? <table className="wtable"><tbody><tr><td>Resultado</td><td className="r"><b>{({ FAVOR_COMPRADOR: 'A favor del comprador', FAVOR_AGRICULTOR: 'A favor del agricultor', ACUERDO: 'Acuerdo' } as any)[d.resolution!.outcome]}</b></td></tr><tr><td>Devolución</td><td className="r"><b>{money(d.resolution!.refund)}</b></td></tr><tr><td>Nota</td><td className="r">{d.resolution!.note}</td></tr></tbody></table> : payDispute ? <>
            <p className="bodym">Pide al agricultor una captura de los movimientos de su {PAY_LABEL[s.payment.method]} de ese día y al comprador el correo o mensaje de confirmación de su banco. Compara monto, hora, titular{s.payment.method === 'YAPE' ? ' y el código de seguridad de 3 dígitos (debe ser el mismo en los dos)' : ''}.</p>
            {s.payment.operation && <ProofTable pay={s.payment} amount={s.payment.amount ?? s.total} />}
            <Inp area value={note} onInput={setNote} placeholder="Qué se verificó" label="Nota" />
            <div className="row g8 wrap" style={{ marginTop: "10px" }}><Btn sm kind="dark" onClick={() => resolve('FAVOR_COMPRADOR', 0)}>El pago sí llegó</Btn><Btn sm kind="sec" onClick={() => resolve('FAVOR_AGRICULTOR', 0)}>El pago no llegó</Btn></div>
          </> : <>
            <table className="wtable"><tbody>
              <tr><td>Diferencia</td><td className="r"><b>{lines.filter(x => x.missing).map(x => `${numTrim(x.missing)} ${x.i.unit} × ${money(x.i.price)}`).join(' + ') || '—'}{diffAmt ? ` = ${money(diffAmt)}` : ''}</b></td></tr>
              <tr><td>Comisión de Mesagri</td><td className="r"><b>{s.freeSlotReserved ? `sobre ${money(sale)} (venta sin comisión: S/ 0)` : `${pct(s.commissionRate)} de ${money(sale)} = ${money(r2(sale * s.commissionRate))}`}</b></td></tr>
              <tr><td>Reputación</td><td className="r"><b>sin penalidad si acepta en 24 h</b></td></tr>
            </tbody></table>
            <div className="grid2" style={{ marginTop: "10px" }}><label className="fld"><span className="lbl">Devolución propuesta</span><Inp value={refund} onInput={setRefund} mode="decimal" prefix="S/" label="Devolución" /></label><span /></div>
            <Inp area value={note} onInput={setNote} placeholder="Propuesta para ambos" label="Propuesta" />
            <div className="row g8 wrap" style={{ marginTop: "10px" }}>
              <Btn sm kind="dark" onClick={() => A.act('DISPUTE_PROPOSE', { disputeId: d.id, refund: ref, note }, { ok: 'Propuesta enviada al comprador y al agricultor.' })}>Proponer a ambos</Btn>
              <Btn sm kind="sec" onClick={() => resolve('ACUERDO', ref)}>Cerrar con acuerdo</Btn>
              <Btn sm kind="sec" onClick={() => resolve('FAVOR_AGRICULTOR', 0)}>A favor del agricultor</Btn>
              <Btn sm kind="secd" onClick={() => resolve('FAVOR_COMPRADOR', ref)}>A favor del comprador</Btn>
            </div>
          </>}
        </div>
        <p className="wnote">Mesagri no retiene dinero: propone, registra el acuerdo y ajusta comisión y reputación (RN-15). Cerrar exige una nota y queda en auditoría.</p>
      </div>
    </div>
  );
}

/* ================= W-08 · Libro de Reclamaciones y consultas ================= */
function Complaints() {
  const A = useApp();
  const w = A.w;
  const list = Object.values(w.complaints).sort((a, b) => b.at - a.at);
  const tickets = Object.values(w.tickets).sort((a, b) => b.at - a.at);
  const [tab, setTab] = useState<'H' | 'C'>('H');
  const helpPending = tickets.filter(t => ticketNeedsReply(w, t)).length;
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | undefined>(A.top.p?.id ?? list.find(c => c.status === 'OPEN')?.id ?? list[0]?.id);
  const [tsel, setTsel] = useState<string | undefined>(tickets.find(t => t.status === 'OPEN')?.id ?? tickets[0]?.id);
  const fl = list.filter(c => !q || norm(`${c.number} ${orgName(w, c.orgId)} ${c.detail}`).includes(norm(q)));
  const c = sel ? w.complaints[sel] : undefined;
  const exportIndecopi = () => downloadCsv(A, `libro-de-reclamaciones-${periodOf(A.now)}.csv`, [['Hoja', 'Fecha', 'Tipo', 'Consumidor', 'Bien o servicio', 'Monto', 'Detalle', 'Pedido del consumidor', 'Estado', 'Fecha de respuesta', 'Respuesta'], ...list.map(x => [x.number, dateNum(x.at), x.type, orgName(w, x.orgId), x.related, x.amount ? x.amount.toFixed(2) : '', x.detail, x.request, x.status === 'ANSWERED' ? 'Respondido' : 'En trámite', x.answeredAt ? dateNum(x.answeredAt) : '', x.answer ?? ''])]);
  return (
    <WebFrame title={tab === 'H' ? 'Libro de Reclamaciones' : 'Consultas de ayuda'} sub={tab === 'H' ? 'Plazo legal de respuesta: 15 días hábiles' : 'Consultas desde la app (A-19)'} right={<><WSearch value={q} onInput={setQ} placeholder="Buscar hoja o usuario" /><Btn sm kind="sec" icon="download" onClick={exportIndecopi}>Exportar para Indecopi</Btn></>}>
      <div className="wcard" style={{ marginBottom: '12px' }}><div className="row between wrap"><span className="bodym"><Icon n="message-circle" s="16" /> Los mensajes de ayuda (consultas desde la app) se responden en <b>Mensajes de ayuda</b>{helpPending ? ` · ${helpPending} por responder` : ''}.</span><Btn sm kind={helpPending ? 'dark' : 'sec'} onClick={() => A.reset('W-21')}>Ir a Mensajes de ayuda</Btn></div></div>
      <Tabs value={tab} onChange={setTab} options={[['H', `Hojas (${list.filter(x => x.status === 'OPEN').length} abiertas)`], ['C', `Consultas (${tickets.filter(t => t.status === 'OPEN').length})`]]} />
      {tab === 'H' ? (
        <div className="split">
          <div className="wcard"><h2>Hojas</h2>
            <table className="wtable resp"><thead><tr><th>Hoja</th><th>Fecha</th><th>Usuario</th><th>Tipo</th><th>Plazo</th><th>Estado</th></tr></thead>
              <tbody>{fl.map(x => { const left = businessDaysBetween(A.now, x.dueAt); return <Row key={x.id} sel={x.id === sel} onOpen={() => setSel(x.id)}><td data-l="Hoja"><b>{x.number}</b></td><td data-l="Fecha">{dateNum(x.at)}</td><td data-l="Usuario">{orgName(w, x.orgId)}</td><td data-l="Tipo">{x.type === 'RECLAMO' ? 'Reclamo' : 'Queja'}</td><td data-l="Plazo">{x.status === 'OPEN' ? <Pill tone={left <= 5 ? 'danger' : 'warn'}>Quedan {left} días</Pill> : '—'}</td><td data-l="Estado"><Pill tone={x.status === 'OPEN' ? (x.id === sel ? 'warn' : 'danger') : ''}>{x.status === 'OPEN' ? 'Nuevo' : 'Respondido'}</Pill></td></Row>; })}</tbody></table>
            {fl.length === 0 && <p className="wnote">No hay hojas.</p>}
          </div>
          {c && <ComplaintCard c={c} key={c.id} />}
        </div>
      ) : (
        <div className="split">
          <div className="wcard"><h2>Consultas</h2>
            <table className="wtable resp"><thead><tr><th>N.º</th><th>Usuario</th><th>Tema</th><th>Desde</th><th>Estado</th></tr></thead>
              <tbody>{tickets.map(t => <Row key={t.id} sel={t.id === tsel} onOpen={() => setTsel(t.id)}><td data-l="N.º"><b>{t.code}</b></td><td data-l="Usuario">{orgName(w, t.orgId)}</td><td data-l="Tema">{t.topic}</td><td data-l="Desde">{ago(t.at, A.now)}</td><td data-l="Estado"><Pill tone={t.status === 'OPEN' ? (t.replies.length ? 'info' : 'warn') : 'gray'}>{t.status === 'OPEN' ? (t.replies.length ? 'Respondida' : 'Nueva') : 'Cerrada'}</Pill></td></Row>)}</tbody></table>
            {tickets.length === 0 && <p className="wnote">Sin consultas.</p>}
          </div>
          {tsel && w.tickets[tsel] && <TicketCard id={tsel} key={tsel} />}
        </div>
      )}
    </WebFrame>
  );
}
function ComplaintCard({ c }: { c: Complaint }) {
  const A = useApp();
  const w = A.w;
  const [ans, setAns] = useState<string>((A.dev.flow.drafts ?? {})[c.id] ?? '');
  const u = w.users[c.userId];
  return (
    <div className="wcard">
      <h2>Hoja {c.number}</h2>
      <table className="wtable"><tbody>
        <tr><td>Hoja</td><td className="r"><b>{c.number} · {c.type === 'RECLAMO' ? 'reclamo' : 'queja'}</b></td></tr>
        <tr><td>Usuario</td><td className="r"><b>{u?.name ?? orgName(w, c.orgId)} · {({ FARMER: 'agricultor', BUYER: 'comprador MYPE', CARRIER: 'transportista', WAREHOUSE: 'almacén' } as any)[u?.role ?? 'BUYER']}</b></td></tr>
        <tr><td>Bien o servicio</td><td className="r"><b>{c.related || '—'}</b></td></tr>
        <tr><td>Monto reclamado</td><td className="r"><b>{c.amount ? money(c.amount) : '—'}</b></td></tr>
        <tr><td>Plazo</td><td className="r"><b>hasta el {dateNum(c.dueAt)}</b></td></tr>
      </tbody></table>
      <div className="sect" style={{ marginTop: "12px" }}>Detalle</div><p className="bodym" style={{ margin: "4px 0" }}>{c.detail}</p>
      <div className="sect">Pide</div><p className="bodym" style={{ margin: "4px 0" }}>{c.request}</p>
      {c.status === 'ANSWERED' ? <><div className="sect">Respuesta · {c.answeredAt ? dateNum(c.answeredAt) : ''} · {adminName(w, c.answeredBy)}</div><p className="bodym" style={{ margin: "4px 0" }}>{c.answer}</p></> : <>
        <div className="sect" style={{ marginTop: "10px" }}>Respuesta (se envía por WhatsApp y correo)</div>
        <Inp area value={ans} onInput={setAns} placeholder="Tiene razón. Anulamos el cargo y emitimos una nota de crédito." label="Respuesta" />
        <div className="row g8 wrap" style={{ justifyContent: "flex-end", marginTop: "10px" }}><Btn sm kind="sec" onClick={() => { A.patch(d => { d.flow = { ...d.flow, drafts: { ...(d.flow.drafts ?? {}), [c.id]: ans } }; }); A.toast('Borrador guardado en este navegador.', 'info'); }}>Guardar borrador</Btn><Btn sm kind="dark" onClick={() => A.act('COMPLAINT_ANSWER', { complaintId: c.id, answer: ans }, { ok: `Respuesta enviada: hoja ${c.number}.` })}>Responder</Btn></div>
        <p className="wnote">Si el reclamo es por un cargo de Mesagri, anúlalo en Cobros (W-14): exige motivo y emite nota de crédito (RN-41).</p>
      </>}
    </div>
  );
}
function TicketCard({ id }: { id: string }) {
  const A = useApp();
  const t = A.w.tickets[id];
  const [txt, setTxt] = useState('');
  return (
    <div className="wcard">
      <h2>Consulta {t.code} · {t.topic}</h2>
      <p className="wnote" style={{ marginTop: "0" }}>{orgName(A.w, t.orgId)} · {dateShort(t.at)} {hhmm(t.at)}</p>
      <div className="stack tight"><div className="wmsg">{t.text}<small>{A.w.users[t.userId]?.shortName}</small></div>{t.replies.map((r, i) => <div key={i} className="wmsg" style={A.w.users[r.by]?.role === 'ADMIN' ? { background: "var(--field)", color: "#fff", marginLeft: "2em" } : undefined}>{r.text}<small>{adminName(A.w, r.by)} · {hhmm(r.at)}</small></div>)}</div>
      {t.status === 'OPEN' && <><div style={{ marginTop: "10px" }}><Inp area value={txt} onInput={setTxt} placeholder="Escribe la respuesta" label="Respuesta" /></div>
        <div className="row g8 wrap" style={{ justifyContent: "flex-end", marginTop: "10px" }}><Btn sm kind="sec" onClick={() => { if (A.act('TICKET_REPLY', { ticketId: id, text: txt || 'Gracias por escribirnos. Cerramos la consulta.', close: true }, { ok: 'Consulta cerrada.' }).ok) setTxt(''); }}>Responder y cerrar</Btn><Btn sm kind="dark" onClick={() => { if (A.act('TICKET_REPLY', { ticketId: id, text: txt }, { ok: 'Respuesta enviada.' }).ok) setTxt(''); }}>Responder</Btn></div></>}
    </div>
  );
}

/* ================= W-12 · Auditoría ================= */
function Audit() {
  const A = useApp();
  const w = A.w;
  const [q, setQ] = useState<string>(A.top.p?.q ?? '');
  const [kind, setKind] = useState<'ALL' | 'DATA' | 'DECISION' | 'CONFIG' | 'SYSTEM'>('ALL');
  const objName = (id: string): string => w.orgs[id]?.name ?? w.users[id]?.name
    ?? (w.listings[id] ? `${product(w.listings[id].productId).name} de ${orgName(w, w.listings[id].orgId)}` : undefined)
    ?? w.disputes[id]?.code ?? w.statements[id]?.code ?? (w.complaints[id] ? `Hoja ${w.complaints[id].number}` : id);
  const cat = (a: string) => /ACCESO/.test(a) ? 'DATA' : /PROPUESTA|APROBACIÓN|CAMBIO|IDIOMA/.test(a) ? 'CONFIG' : a === 'SISTEMA' ? 'SYSTEM' : 'DECISION';
  const rows = w.audit.slice().reverse().filter(a => (kind === 'ALL' || cat(a.action) === kind) && (!q || norm(`${adminName(w, a.actor)} ${a.action} ${a.detail} ${objName(a.entity)}`).includes(norm(q)))).slice(0, 120);
  const who = (id: string) => { const u = w.users[id]; if (!u) return 'Sistema'; return u.role === 'ADMIN' ? `${u.name} · ${({ GENERAL: 'administración', VERIFIER: 'verificación', SUPPORT: 'soporte', ANALYST: 'analista' } as any)[u.adminRole ?? 'GENERAL']}` : `${u.name} · usuario`; };
  return (
    <WebFrame title="Registro de auditoría" sub="Inmutable: nadie puede editar ni borrar estas filas" right={<WSearch value={q} onInput={setQ} placeholder="Buscar por persona u objeto" />}>
      <Tabs value={kind} onChange={setKind} options={[['ALL', 'Todo'], ['DATA', 'Accesos a datos'], ['DECISION', 'Decisiones'], ['CONFIG', 'Configuración'], ['SYSTEM', 'Automático']]} />
      <div className="wcard">
        <h2>Últimos movimientos</h2>
        <table className="wtable resp"><thead><tr><th>Fecha y hora</th><th>Quién</th><th>Acción</th><th>Detalle</th><th>Antes → después</th></tr></thead>
          <tbody>{rows.map(a => <tr key={a.id}><td data-l="Fecha" className="nowrap">{dateDM(a.at)} {hhmm(a.at)}</td><td data-l="Quién">{who(a.actor)}</td><td data-l="Acción">{a.action.charAt(0) + a.action.slice(1).toLowerCase()}</td><td data-l="Detalle" style={{ maxWidth: "420px" }}>{a.detail}</td><td data-l="Antes → después">{a.before || a.after ? `${a.before ?? '—'} → ${a.after ?? '—'}` : '—'}</td></tr>)}</tbody></table>
        {rows.length === 0 && <p className="wnote">Sin movimientos con ese filtro.</p>}
      </div>
      <p className="wnote">Se guardan accesos a datos personales (Ley 29733), decisiones, cambios de configuración y acciones automáticas. Mostramos los 120 más recientes.</p>
    </WebFrame>
  );
}

reg('W-01', Login);
reg('W-02', Dashboard);
reg('W-03', Inbox);
reg('W-04', CaseFile);
reg('W-05', Users);
reg('W-06', Moderation);
reg('W-07', Disputes);
reg('W-08', Complaints);
reg('W-12', Audit);

void visibleListing; void PRODUCTS; void Sel; void Stars; void TAXDOC_LABEL; void periodStart; void nextPeriod; void lima; void uid; void docPdf; void placeLabel;
