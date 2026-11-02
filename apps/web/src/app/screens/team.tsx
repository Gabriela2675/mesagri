/*
 * Panel web · equipo de Mesagri.
 * W-19 Equipo: la administración general crea las cuentas del panel, decide el rol de cada persona
 *   (qué secciones ve y qué decisiones toma), pausa o reactiva su acceso y le da una clave temporal.
 * W-20 Mi cuenta: cada persona personaliza sus datos y hace suya su cuenta (contraseña y doble
 *   factor que solo ella conoce).
 * Primer ingreso (W-01): con la clave temporal, la persona crea su contraseña y activa su doble factor.
 */
import { useEffect, useState } from 'react';
import { reg } from './registry';
import { useApp } from '../ctx';
import { Btn } from '../ui/kit';
import { ADMIN_ROLE_INFO } from '@mesagri/shared/engine/r2';
import { isPhoneValid } from '@mesagri/shared/rules';
import { dateShort, hhmm, relDay } from '@mesagri/shared/format';
import { api, type TotpSetup } from '../net';
import { openExternal } from '../platform';
import { WebFrame, Pill, Row, NAV, roleOf } from './admin';
import { Fld, TextIn, Err, NewPassword, pwIssue, TotpStep, copyText, fullPanelUrl, tokenOf, roleLabel, first, ROLES } from './access';
import type { AdminRole, User } from '@mesagri/shared/types';


/* ================= W-19 · Equipo de Mesagri ================= */

interface AccessInfo { userId: string; demo: boolean; pending: boolean; expired: boolean; lastLoginAt: number | null }
interface Access { userId: string; name?: string; email?: string; password: string; expiresAt: number }

function RolePick({ value, onChange }: { value: AdminRole; onChange: (r: AdminRole) => void }) {
  return (
    <div className="stack tight" role="radiogroup" aria-label="Rol en el panel">
      {ROLES.map(r => (
        <label key={r} className={'rolepick' + (value === r ? ' on' : '')}>
          <input type="radio" name="rol-equipo" checked={value === r} onChange={() => onChange(r)} />
          <span><b>{ADMIN_ROLE_INFO[r].label}</b><small>{ADMIN_ROLE_INFO[r].can}</small></span>
        </label>
      ))}
    </div>
  );
}

function accessState(u: User, info?: AccessInfo): [string, '' | 'warn' | 'danger' | 'gray' | 'info'] {
  if (u.status !== 'ACTIVE') return ['Pausada', 'danger'];
  if (info?.expired) return ['Clave temporal vencida', 'danger'];
  if (info?.pending) return ['Aún no entra', 'warn'];
  if (info?.demo) return ['Cuenta de prueba', 'gray'];
  return ['Activa', ''];
}

/** Lo que la administración general le pasa a la persona (una sola vez). */
function AccessCard({ a, u, onClose }: { a: Access; u?: User; onClose: () => void }) {
  const A = useApp();
  const link = fullPanelUrl(a.email);
  const until = `${dateShort(a.expiresAt)} a las ${hhmm(a.expiresAt)}`;
  const msg = `Hola ${first(a.name)}: ya tienes cuenta en el panel de Mesagri (${roleLabel(u?.adminRole).toLowerCase()}).\n1. Entra a ${link}\n2. Correo: ${a.email}\n3. Clave temporal: ${a.password} (vence el ${until})\nAl entrar vas a crear tu propia contraseña y activar el doble factor con Google Authenticator o Microsoft Authenticator.`;
  return (
    <div className="wcard" role="region" aria-label={`Acceso de ${a.name ?? 'la persona'}`}>
      <h2>Acceso de {a.name}</h2>
      <p className="wnote" style={{ marginTop: 0 }}>Pásale estos datos a {first(a.name)} en persona, por llamada o por WhatsApp. La clave temporal sirve <b>una sola vez</b> y vence el {until}. Al entrar, crea su contraseña y activa su doble factor: tú ya no los vas a conocer.</p>
      <div className="stack tight">
        <div className="row between wrap"><span className="cap">Correo</span><b>{a.email}</b></div>
        <span className="cap">Clave temporal</span>
        <div className="tempkey" aria-label="Clave temporal">{a.password}</div>
        <div className="row between wrap"><span className="cap">Panel</span><a href={link} target="_blank" rel="noopener" style={{ overflowWrap: 'anywhere' }}>{link}</a></div>
      </div>
      <div className="row g8 wrap" style={{ marginTop: 14 }}>
        <Btn sm kind="sec" icon="copy" onClick={async () => A.toast((await copyText(msg)) ? 'Copiamos el mensaje con su acceso.' : 'No pudimos copiar: selecciona la clave y cópiala a mano.', 'info')}>Copiar mensaje</Btn>
        {u?.phone && <Btn sm kind="sec" icon="message-circle" onClick={() => openExternal(`https://wa.me/51${u.phone}?text=${encodeURIComponent(msg)}`)}>Enviar por WhatsApp</Btn>}
        <Btn sm kind="dark" onClick={onClose}>Listo</Btn>
      </div>
    </div>
  );
}

function AddCard({ onAdded, onCancel }: { onAdded: (a: Access) => void; onCancel: () => void }) {
  const A = useApp();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<AdminRole>('SUPPORT');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const n = name.trim().replace(/\s+/g, ' ');
    if (n.length < 5 || !n.includes(' ')) { setErr('Escribe el nombre y el apellido.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email.trim())) { setErr('Ese correo no parece correcto.'); return; }
    const ph = phone.replace(/\D/g, '');
    if (!isPhoneValid(ph)) { setErr('El celular tiene 9 dígitos y empieza con 9.'); return; }
    setBusy(true);
    try {
      const r = await api<{ access: Access }>('/admin/team', { token: await tokenOf(A), body: { name: n, email: email.trim(), phone: ph, adminRole: role } });
      onAdded(r.access);
    } catch (e: any) { setErr(e?.message ?? 'No pudimos crear la cuenta.'); } finally { setBusy(false); }
  };
  return (
    <form className="wcard" aria-label="Agregar persona al equipo" onSubmit={(e: any) => { e.preventDefault(); void save(); }}>
      <h2>Agregar persona al equipo</h2>
      <div className="stack">
        <Fld label="Nombre y apellido"><TextIn value={name} onChange={v => { setName(v); setErr(''); }} auto="name" placeholder="Rosa Quispe" /></Fld>
        <Fld label="Correo (con él entra al panel)"><TextIn value={email} onChange={v => { setEmail(v); setErr(''); }} type="email" mode="email" auto="email" placeholder="nombre@mesagri.pe" /></Fld>
        <Fld label="Celular"><TextIn value={phone} onChange={v => { setPhone(v.replace(/\D/g, '').slice(0, 9)); setErr(''); }} type="tel" mode="tel" auto="tel" placeholder="9 dígitos" /></Fld>
        <div className="fld"><span className="lbl">Rol: qué puede ver y hacer</span><RolePick value={role} onChange={setRole} /></div>
        <Err text={err} />
        <div className="row g8 wrap"><Btn kind="dark" type="submit" disabled={busy}>{busy ? <i className="spin" /> : null}Crear cuenta y clave temporal</Btn><Btn kind="sec" onClick={onCancel}>Cancelar</Btn></div>
      </div>
    </form>
  );
}

function MemberCard({ u, info, onAccess, reload }: { u: User; info?: AccessInfo; onAccess: (a: Access) => void; reload: () => void }) {
  const A = useApp();
  const me = A.me!.id === u.id;
  const [role, setRole] = useState<AdminRole>((u.adminRole ?? 'GENERAL') as AdminRole);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setRole((u.adminRole ?? 'GENERAL') as AdminRole); setEditing(false); }, [u.id, u.adminRole]);
  const call = async (path: string, body: object, ok: string) => {
    setBusy(true);
    try {
      const r = await api<{ access?: Access }>(`/admin/team/${encodeURIComponent(u.id)}/${path}`, { token: await tokenOf(A), body });
      A.toast(ok, 'ok');
      if (r.access) onAccess(r.access);
      reload();
      return true;
    } catch (e: any) { A.toast(e?.message ?? 'No pudimos guardar el cambio.', 'err'); return false; } finally { setBusy(false); }
  };
  const [state, tone] = accessState(u, info);
  return (
    <div className="wcard" role="region" aria-label={`Ficha de ${u.name}`}>
      <div className="row" style={{ gap: 12, marginBottom: 10 }}>
        <span className="av" style={{ background: '#C97C3E', width: 48, height: 48, fontSize: 16 }}>{u.name.split(' ').slice(0, 2).map(x => x[0]).join('')}</span>
        <div className="grow"><b style={{ fontSize: 18 }}>{u.name}{me ? ' (tú)' : ''}</b><div className="wnote" style={{ margin: '2px 0 0' }}>{roleLabel(u.adminRole)}</div></div>
        <Pill tone={tone}>{state}</Pill>
      </div>
      <table className="wtable"><tbody>
        <tr><td>Correo</td><td className="r"><b>{u.email ?? '—'}</b></td></tr>
        <tr><td>Celular</td><td className="r"><b>{u.phone}</b></td></tr>
        <tr><td>Último ingreso</td><td className="r">{info?.lastLoginAt ? `${relDay(info.lastLoginAt, Date.now())} ${hhmm(info.lastLoginAt)}` : '—'}</td></tr>
      </tbody></table>
      {info?.demo && <p className="wnote">Cuenta de prueba: entra con la clave de la demo (la ve quien tiene la clave del equipo). {first(u.name)} la hace suya en «Mi cuenta».</p>}
      {info?.pending && <p className="wnote">{info.expired ? 'Su clave temporal venció: dale un acceso nuevo.' : `Todavía no entra por primera vez con su clave temporal.`}</p>}
      {editing ? (
        <div className="stack tight" style={{ marginTop: 12 }}>
          <RolePick value={role} onChange={setRole} />
          <div className="row g8 wrap">
            <Btn sm kind="dark" disabled={busy || role === u.adminRole} onClick={async () => { if (await call('role', { adminRole: role }, `${first(u.name)} ahora es de ${roleLabel(role).toLowerCase()}.`)) setEditing(false); }}>Guardar rol</Btn>
            <Btn sm kind="sec" onClick={() => { setEditing(false); setRole((u.adminRole ?? 'GENERAL') as AdminRole); }}>Cancelar</Btn>
          </div>
        </div>
      ) : (
        <div className="row g8 wrap" style={{ marginTop: 14 }}>
          <Btn sm kind="sec" icon="pencil" onClick={() => setEditing(true)}>Cambiar rol</Btn>
          {!me && (u.status === 'ACTIVE'
            ? <Btn sm kind="secd" disabled={busy} onClick={async () => { if (await A.confirm({ title: `¿Pausar el acceso de ${u.name}?`, text: 'No podrá entrar al panel y se cierran sus sesiones. Puedes reactivarlo cuando quieras. Queda en la auditoría.', ok: 'Pausar acceso', danger: true })) void call('status', { active: false }, `Pausamos el acceso de ${first(u.name)}.`); }}>Pausar acceso</Btn>
            : <Btn sm kind="dark" disabled={busy} onClick={() => void call('status', { active: true }, `${first(u.name)} ya puede entrar otra vez.`)}>Reactivar</Btn>)}
          {!me && <Btn sm kind="sec" icon="key-round" disabled={busy} onClick={async () => { if (await A.confirm({ title: `¿Dar un acceso nuevo a ${u.name}?`, text: 'Le damos una clave temporal nueva: al entrar crea otra contraseña y activa otra vez su doble factor (por ejemplo, si la olvidó o perdió el celular). Se cierran sus sesiones abiertas.', ok: 'Dar acceso nuevo' })) void call('access', {}, 'Clave temporal lista: pásasela.'); }}>Dar acceso nuevo</Btn>}
        </div>
      )}
    </div>
  );
}

/** Qué ve cada rol: sale del mismo menú del panel (así nunca se desactualiza). */
function RolesCard() {
  const rows = NAV.filter(n => n.s !== 'W-20');
  return (
    <div className="wcard" role="region" aria-label="Qué puede hacer cada rol">
      <h2>Qué puede hacer cada rol</h2>
      <ul className="stack tight" style={{ margin: '0 0 12px', paddingLeft: '1.1em', fontSize: 14 }}>
        {ROLES.map(r => <li key={r}><b>{ADMIN_ROLE_INFO[r].label}:</b> {ADMIN_ROLE_INFO[r].can}</li>)}
      </ul>
      <table className="wtable permtable">
        <thead><tr><th>Sección del panel</th>{ROLES.map(r => <th key={r} className="c">{ADMIN_ROLE_INFO[r].label}</th>)}</tr></thead>
        <tbody>{rows.map(n => <tr key={n.s}><td>{n.l}</td>{ROLES.map(r => <td key={r} className="c" aria-label={`${ADMIN_ROLE_INFO[r].label}: ${n.roles.includes(r) ? 'sí' : 'no'}`}>{n.roles.includes(r) ? <b>✓</b> : <span className="cap">—</span>}</td>)}</tr>)}</tbody>
      </table>
      <p className="wnote">Cada decisión queda en la auditoría (W-12) con el nombre de quien la tomó. El servidor revisa el rol en cada acción, no solo el menú.</p>
    </div>
  );
}

function Team() {
  const A = useApp();
  const w = A.w;
  const team = Object.values(w.users).filter(u => u.role === 'ADMIN').sort((a, b) => ROLES.indexOf((a.adminRole ?? 'GENERAL') as AdminRole) - ROLES.indexOf((b.adminRole ?? 'GENERAL') as AdminRole) || a.name.localeCompare(b.name));
  const [sel, setSel] = useState<string>(A.top.p?.id ?? A.me!.id);
  const [mode, setMode] = useState<'view' | 'add'>('view');
  const [access, setAccess] = useState<Access | null>(null);
  const [info, setInfo] = useState<Record<string, AccessInfo>>({});
  const load = async () => {
    try {
      const list = await api<AccessInfo[]>('/admin/team', { token: await tokenOf(A) });
      setInfo(Object.fromEntries(list.map(x => [x.userId, x])));
    } catch { /* sin señal: se ve lo que está en el mundo */ }
  };
  useEffect(() => { void load(); }, [team.length]);
  const u = w.users[sel];
  const generals = team.filter(x => x.adminRole === 'GENERAL' && x.status === 'ACTIVE').length;
  const side = access ? <AccessCard a={access} u={w.users[access.userId]} onClose={() => { setAccess(null); setMode('view'); }} />
    : mode === 'add' ? <AddCard onCancel={() => setMode('view')} onAdded={a => { setAccess(a); setSel(a.userId); setMode('view'); void load(); }} />
    : u && u.role === 'ADMIN' ? <MemberCard u={u} info={info[u.id]} onAccess={a => setAccess(a)} reload={() => void load()} /> : null;
  return (
    <WebFrame title="Equipo de Mesagri" sub={`${team.length} personas · ${generals} en administración general`} right={<Btn kind="dark" icon="plus" onClick={() => { setAccess(null); setMode('add'); }}>Agregar persona</Btn>}>
      <div className="split">
        <div className="stack">
          <div className="wcard"><table className="wtable resp">
            <thead><tr><th>Persona</th><th>Rol</th><th>Acceso</th></tr></thead>
            <tbody>{team.map(x => { const [st, tone] = accessState(x, info[x.id]); return (
              <Row key={x.id} sel={x.id === sel && mode === 'view' && !access} onOpen={() => { setSel(x.id); setMode('view'); setAccess(null); }}>
                <td data-l="Persona"><b>{x.name}{x.id === A.me!.id ? ' (tú)' : ''}</b><div className="cap">{x.email}</div></td>
                <td data-l="Rol">{roleLabel(x.adminRole)}</td>
                <td data-l="Acceso"><Pill tone={tone}>{st}</Pill></td>
              </Row>
            ); })}</tbody>
          </table></div>
          <RolesCard />
        </div>
        {side}
      </div>
    </WebFrame>
  );
}

/* ================= W-20 · Mi cuenta ================= */

function MyData() {
  const A = useApp();
  const me = A.me!;
  const [name, setName] = useState(me.name);
  const [short, setShort] = useState(me.shortName);
  const [email, setEmail] = useState(me.email ?? '');
  const [phone, setPhone] = useState(me.phone);
  const [err, setErr] = useState('');
  useEffect(() => { setName(me.name); setShort(me.shortName); setEmail(me.email ?? ''); setPhone(me.phone); }, [me.id]);
  const save = () => {
    const p: Record<string, string> = {};
    if (name.trim() !== me.name) p.name = name;
    if (short.trim() !== me.shortName) p.shortName = short;
    if (email.trim().toLowerCase() !== (me.email ?? '')) p.email = email;
    if (phone !== me.phone) p.phone = phone;
    if (!Object.keys(p).length) { setErr('No hay cambios que guardar.'); return; }
    const r = A.act('PROFILE_SET', p, { quiet: true, ok: 'Guardamos tus datos.' });
    if (!r.ok) setErr(r.error?.message ?? 'No pudimos guardar tus datos.');
    else if (p.email) A.toast(`Desde ahora entras al panel con ${p.email.trim().toLowerCase()}.`, 'info');
  };
  return (
    <form className="wcard" aria-label="Tus datos" onSubmit={(e: any) => { e.preventDefault(); save(); }}>
      <h2>Tus datos</h2>
      <div className="stack">
        <Fld label="Tu nombre (así te ve el equipo y aparece en la auditoría)"><TextIn value={name} onChange={v => { setName(v); setErr(''); }} auto="name" /></Fld>
        <Fld label="¿Cómo te llamamos?"><TextIn value={short} onChange={v => { setShort(v); setErr(''); }} auto="nickname" /></Fld>
        <Fld label="Correo (con él entras al panel)"><TextIn value={email} onChange={v => { setEmail(v); setErr(''); }} type="email" mode="email" auto="email" /></Fld>
        <Fld label="Celular"><TextIn value={phone} onChange={v => { setPhone(v.replace(/\D/g, '').slice(0, 9)); setErr(''); }} type="tel" mode="tel" auto="tel" /></Fld>
        <Err text={err} />
        <div><Btn kind="dark" type="submit">Guardar mis datos</Btn></div>
      </div>
    </form>
  );
}

function MyAccess() {
  const A = useApp();
  const [demo, setDemo] = useState<boolean | null>(null);
  const [flow, setFlow] = useState<null | 'own' | 'password' | 'move'>(null);
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [step, setStep] = useState<{ token: string; totp: TotpSetup; needPassword: boolean } | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => { try { setDemo((await api<{ demo: boolean }>('/auth/admin/me', { token: await tokenOf(A) })).demo); } catch { setDemo(null); } };
  useEffect(() => { void load(); }, [A.me!.id]);
  const reset = () => { setFlow(null); setCurrent(''); setPw(''); setAgain(''); setStep(null); setCode(''); setErr(''); };
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn(); } catch (e: any) { setErr(e?.message ?? 'No pudimos guardar el cambio.'); } finally { setBusy(false); } };
  const start = (cur?: string) => run(async () => {
    const r = await api<{ token: string; totp: TotpSetup; needPassword: boolean }>('/auth/admin/2fa/start', { token: await tokenOf(A), body: cur === undefined ? {} : { current: cur } });
    setStep(r);
  });
  const finish = () => run(async () => {
    if (step!.needPassword) { const p = pwIssue(pw, again); if (p) throw new Error(p); }
    if (code.length !== 6) throw new Error('Escribe el código de 6 dígitos de tu app de autenticación.');
    await api('/auth/admin/2fa/finish', { token: await tokenOf(A), body: { token: step!.token, code, ...(step!.needPassword ? { password: pw } : {}) } });
    A.toast(step!.needPassword ? 'Listo: la cuenta ya es tuya. Entra con tu contraseña y el código de tu app.' : 'Listo: tu doble factor está en tu celular nuevo.', 'ok');
    reset(); void load();
  });
  const changePassword = () => run(async () => {
    const p = pwIssue(pw, again); if (p) throw new Error(p);
    await api('/auth/admin/password', { token: await tokenOf(A), body: { current, next: pw } });
    A.toast('Cambiamos tu contraseña.', 'ok'); reset();
  });
  return (
    <div className="wcard" role="region" aria-label="Tu acceso">
      <h2>Tu acceso al panel</h2>
      {demo === null && <p className="wnote">Revisando…</p>}
      {demo === true && !flow && <>
        <p className="wnote" style={{ marginTop: 0 }}><b>Esta cuenta todavía es de prueba:</b> entra con la clave de la demo, que ve todo el equipo que presenta Mesagri. Hazla tuya: crea tu contraseña y activa el doble factor en tu celular. Desde ese momento solo tú puedes entrar con ella.</p>
        <Btn kind="dark" icon="key-round" disabled={busy} onClick={() => { setFlow('own'); void start(); }}>Hacer mía esta cuenta</Btn>
      </>}
      {demo === false && !flow && <>
        <p className="wnote" style={{ marginTop: 0 }}>Entras con tu contraseña y el código de tu app de autenticación. Nadie más los conoce.</p>
        <div className="row g8 wrap"><Btn kind="sec" icon="lock" onClick={() => setFlow('password')}>Cambiar contraseña</Btn><Btn kind="sec" icon="smartphone" onClick={() => setFlow('move')}>Pasar el doble factor a otro celular</Btn></div>
      </>}
      {flow && <form className="stack" onSubmit={(e: any) => { e.preventDefault(); if (flow === 'password') void changePassword(); else if (step) void finish(); else void start(current); }}>
        {(flow === 'password' || (flow === 'move' && !step)) && <Fld label="Tu contraseña actual"><input className="inp" type="password" autoComplete="current-password" value={current} onChange={(e: any) => { setCurrent(e.currentTarget.value); setErr(''); }} /></Fld>}
        {(flow === 'password' || (step?.needPassword)) && <NewPassword pw={pw} setPw={v => { setPw(v); setErr(''); }} again={again} setAgain={v => { setAgain(v); setErr(''); }} />}
        {step && <TotpStep totp={step.totp} code={code} setCode={v => { setCode(v); setErr(''); }} />}
        <Err text={err} />
        <div className="row g8 wrap">
          <Btn kind="dark" type="submit" disabled={busy}>{busy ? <i className="spin" /> : null}{flow === 'password' ? 'Cambiar contraseña' : step ? 'Guardar' : 'Continuar'}</Btn>
          <Btn kind="sec" onClick={reset}>Cancelar</Btn>
        </div>
      </form>}
    </div>
  );
}

function MyAccount() {
  const A = useApp();
  return (
    <WebFrame title="Mi cuenta" sub={`${A.me!.name} · ${roleLabel(roleOf(A))}`}>
      <div className="split">
        <MyData />
        <MyAccess />
      </div>
    </WebFrame>
  );
}

reg('W-19', Team);
reg('W-20', MyAccount);
