/*
 * Primer uso (flujo 1): bienvenida e idioma, perfil, celular, código, consentimientos e identidad;
 * registro del negocio (MYPE), cobro y zonas del agricultor, ingreso y verificación por niveles.
 * A-00 a A-07, A-17 (nivel), B-01 a B-04.
 */
import { useEffect, useState } from 'react';
import { reg, homeFor } from './registry';
import { Logo } from '../ui/brand';
import { useApp, type AppCtx } from '../ctx';
import { Screen, Btn, Icon, Field, Inp, Sel, Tog, Card, Chip, ChipBtn, Steps, Spk, PhotoPick, Note, Seg, Kv, Av, Timeline, SheetBody, ICirc } from '../ui/kit';
import { DISTRICTS, DISTRICT_BY_CODE, CITY_DISTRICTS, placeLabel, PROVINCES } from '@mesagri/shared/ubigeo';
import { isRucValid, isDniValid, isPhoneValid, LEVEL_NAME, buyerLimit, farmerLimit, maskDni } from '@mesagri/shared/rules';
import { digitsFrom, uid } from '@mesagri/shared/ids';
import { PERSONAS, TEST_RUCS } from '@mesagri/shared/seed';
import { panelUrl, LOCAL, IN_APK } from '../routes';
import { useInstall } from '../install';
import { liveSub } from '../helpers';
import { auth, deviceAccounts } from '../net';
import { money, dateShort, hhmm } from '@mesagri/shared/format';
import { DOW_CHIP } from '@mesagri/shared/time';
import type { Role, VerifCase, Evidence, Org } from '@mesagri/shared/types';

const fmtPhone = (p: string) => p.replace(/\s/g, '').replace(/^(\d{3})(\d{3})(\d{0,3}).*/, '$1 $2 $3').trim();

export function regGet(A: AppCtx): any { return A.dev.flow.reg ?? {}; }
export function regSet(A: AppCtx, patch: any) { A.patch(d => { d.flow = { ...d.flow, reg: { ...(d.flow.reg ?? {}), ...patch } }; }); }

export const ROLE_INFO: Record<string, { title: string; sub: string; icon: string; steps: number; first: string }> = {
  FARMER: { title: 'Cuenta de agricultor', sub: 'Publica tu cosecha en minutos', icon: 'sprout', steps: 5, first: 'A-02' },
  BUYER: { title: 'Cuenta de comprador', sub: 'Restaurante, hotel, bodega o comedor', icon: 'store', steps: 4, first: 'B-02' },
  WAREHOUSE: { title: 'Cuenta de almacén aliado', sub: 'Alquila tu espacio libre por Mesagri', icon: 'warehouse', steps: 4, first: 'C-01' },
  CARRIER: { title: 'Cuenta de transportista aliado', sub: 'Lleva pedidos del campo a los negocios', icon: 'truck', steps: 5, first: 'T-01' },
};

export function RoleHead({ role, step, label, of }: { role: string; step: number; label: string; of?: number }) {
  const info = ROLE_INFO[role] ?? ROLE_INFO.FARMER;
  return (
    <div className="stack tight">
      <div className="row">
        <span className="icirc dark" style={{ width: "3em", height: "3em" }}><Icon n={info.icon} s="1.4em" /></span>
        <div className="grow"><div className="h3">{info.title}</div><div className="cap">{info.sub}</div></div>
      </div>
      <Steps n={step} of={of ?? info.steps} />
      <div className="sect" style={{ marginTop: ".2em" }}>Paso {step} de {of ?? info.steps} · {label}</div>
    </div>
  );
}

/* ---------- A-00 · Pantalla de inicio ---------- */
export function SplashView({ text }: { text?: string }) {
  return (
    <div className="splash" role="status" aria-live="polite" aria-label={text || 'Abriendo Mesagri'}>
      <Logo big />
      {text && <div className="stxt">{text}</div>}
      <span className="spinring" aria-hidden="true" />
    </div>
  );
}
function Splash() {
  const A = useApp();
  useEffect(() => { const t = setTimeout(() => A.reset(A.me ? homeFor(A.me) : 'A-01'), 1300); return () => clearTimeout(t); }, []);
  return <div className="scroll" style={{ padding: 0 }}><SplashView /></div>;
}

/* App instalable: botón «Instalar la app» (Android) o cómo agregarla en iPhone */
function InstallCard() {
  const A = useApp();
  const ins = useInstall();
  if (!ins.show) return null;
  return (
    <div className="card" style={{ background: "rgba(255,255,255,.1)", color: "#fff", boxShadow: "none" }}>
      <div className="row top g8">
        <Icon n="smartphone" />
        <div className="grow stack tight">
          <b className="bodym">Ten Mesagri como app en tu celular</b>
          {ins.canPrompt
            ? <><span className="cap" style={{ color: "#E7F0DC" }}>Queda con su ícono y se abre aunque no tengas señal.</span><div><Btn sm kind="light" icon="download" onClick={async () => { if (await ins.install()) A.toast('Listo: Mesagri quedó instalada en tu celular.'); }}>Instalar la app</Btn></div></>
            : <span className="cap" style={{ color: "#E7F0DC" }}>En iPhone: toca <b>Compartir</b> (el cuadrado con la flecha) y luego <b>Agregar a inicio</b>.</span>}
        </div>
      </div>
    </div>
  );
}

/* Versión autónoma: los datos de ejemplo viven en este celular y se pueden reiniciar */
function DemoNote() {
  const A = useApp();
  if (!LOCAL) return (
    <p className="cap center" style={{ margin: ".4em 0 0", color: "#cfe0c1" }}>
      Versión de prueba en línea: lo que hagas lo ven las demás personas según su cuenta, como en la app de verdad. Los pedidos y pagos son de prueba: para el DNI y la dirección usa datos de ejemplo.
    </p>
  );
  const reset = async () => {
    if (!(await A.confirm({ title: '¿Volver a los datos de ejemplo?', text: 'Se borra lo que hiciste en esta versión de prueba (pedidos, publicaciones, cuentas nuevas) y vuelven las personas y los pedidos de ejemplo.', ok: 'Reiniciar', danger: true }))) return;
    try { await A.store.resetDemo(); } catch { A.toast('No se pudo reiniciar. Intenta de nuevo.', 'err'); }
  };
  // APK con servidor en la nube: desde la versión de prueba se vuelve a la versión en línea
  const bridge = (window as any).MesagriAndroid;
  const cloud = IN_APK && typeof bridge?.server === 'function' ? String(bridge.server() ?? '') : '';
  return (
    <p className="cap center" style={{ margin: ".4em 0 0", color: "#cfe0c1" }}>
      Versión de prueba: las personas y los pedidos son de ejemplo y todo se guarda en este celular.{' '}
      <button className="linkbtn" style={{ color: "#E7F0DC", padding: 0, minHeight: 0, display: 'inline' }} onClick={reset}>Volver a los datos de ejemplo</button>
      {cloud && <>{' · '}<button className="linkbtn" style={{ color: "#E7F0DC", padding: 0, minHeight: 0, display: 'inline' }} onClick={() => bridge.goOnline()}>Usar la versión en línea</button></>}
    </p>
  );
}

/**
 * Pedir el código por WhatsApp: se abre WhatsApp con el mensaje listo para el número de Mesagri;
 * al enviarlo, Mesagri responde al instante con el código (sin costo para nadie).
 */
export function WhatsAppAsk({ wa, dark, demo }: { wa: { link: string; number: string }; dark?: boolean; demo?: boolean }) {
  const open = () => { try { window.open(wa.link, '_blank', 'noopener'); } catch { location.href = wa.link; } };
  return (
    <div className="card" style={dark ? { background: "rgba(255,255,255,.1)", color: "#fff", boxShadow: "none" } : undefined} role="region" aria-label="Pedir el código por WhatsApp">
      <div className="row top g8">
        <Icon n="message-circle" s="1.5em" />
        <div className="grow">
          <b>{demo ? 'Pide el código de la cuenta de prueba por WhatsApp' : 'Pide tu código por WhatsApp'}</b>
          <div className={dark ? 'cap' : 'cap'} style={dark ? { color: "#E7F0DC" } : undefined}>Toca el botón: se abre WhatsApp con el mensaje listo para Mesagri ({wa.number}). Envíalo y te respondemos al instante con el código de 6 dígitos. Luego escríbelo aquí.</div>
        </div>
      </div>
      <div className="mt"><Btn full icon="message-circle" onClick={open}>Abrir WhatsApp</Btn></div>
    </div>
  );
}

/* ---------- A-01 · Bienvenida e idioma ---------- */
const LANGS = [
  { v: 'es', name: 'Castellano', sub: 'Español' },
  { v: 'qu', name: 'Runasimi', sub: 'Quechua' },
  { v: 'ay', name: 'Aymar aru', sub: 'Aimara' },
];
function Welcome() {
  const A = useApp();
  const pre = A.dev.pre ?? {};
  const lang = pre.lang ?? 'es';
  const enabled = A.w.settings.languages.enabled;
  const set = (p: any) => A.patch(d => { d.pre = { ...(d.pre ?? {}), ...p }; });
  return (
    <Screen bar={false} cls="dark-screen">
      <div className="stack" style={{ paddingTop: "1.2em" }}>
        <Logo />
        <h2 className="h3 center" style={{ marginTop: ".6em", fontSize: "1.25em" }}>{A.t('welcome.choose_language', 'Elige tu idioma')}</h2>
        {LANGS.map(l => (
          <div key={l.v} className={'lang' + (lang === l.v ? ' on' : '')} role="radio" aria-checked={lang === l.v ? 'true' : 'false'} tabIndex={0} onClick={() => set({ lang: l.v })} onKeyDown={(e: any) => { if (e.key === 'Enter' || e.key === ' ') set({ lang: l.v }); }} style={{ cursor: "pointer" }}>
            <div className="grow"><b>{l.name}</b><small>{l.sub}{l.v !== 'es' && !enabled.includes(l.v) ? ' · en revisión con hablantes' : ''}</small></div>
            <Spk text={l.v === 'es' ? 'Castellano' : l.v === 'qu' ? 'Runasimi. Quechua.' : 'Aymar aru. Aimara.'} label={`Escuchar ${l.name}`} />
          </div>
        ))}
        {lang !== 'es' && !enabled.includes(lang) && (
          <div className="card" style={{ background: "rgba(255,255,255,.1)", color: "#fff", boxShadow: "none" }}>
            <div className="row top g8"><Icon n="languages" /><div className="bodym">{lang === 'qu' ? 'Runasimi' : 'Aymar aru'} se activa cuando hablantes del Colca aprueben todas las pantallas (RN-32). Mientras tanto te mostramos castellano con la guía de audio.</div></div>
          </div>
        )}
        <div style={{ color: "#fff" }}>
          <div className="togrow" style={{ borderColor: "rgba(255,255,255,.15)" }}><div className="grow b">{A.t('welcome.audio_guide', 'Guía de audio')}</div><button className={'tog' + ((pre.audioGuide ?? true) ? ' on' : '')} role="switch" aria-checked={(pre.audioGuide ?? true) ? 'true' : 'false'} aria-label="Guía de audio" onClick={() => set({ audioGuide: !(pre.audioGuide ?? true) })} /></div>
          <div className="togrow" style={{ borderColor: "rgba(255,255,255,.15)" }}><div className="grow b">Mostrar también en castellano</div><button className={'tog' + (pre.bilingual ? ' on' : '')} role="switch" aria-checked={pre.bilingual ? 'true' : 'false'} aria-label="Mostrar también en castellano" onClick={() => set({ bilingual: !pre.bilingual })} /></div>
        </div>
        <Btn full cls="" onClick={() => { A.say('Elige cómo vas a usar Mesagri: agricultor, comprador, almacén o transportista.'); A.go('A-01P'); }}>{A.t('welcome.continue', 'Continuar')}</Btn>
        <button className="linkbtn" style={{ color: "#E7F0DC" }} onClick={() => A.go('LOGIN')}>Ya tengo cuenta · Iniciar sesión</button>
        <InstallCard />
        <DemoNote />
      </div>
    </Screen>
  );
}

/* ---------- A-01 · Elegir perfil ---------- */
function ChooseRole() {
  const A = useApp();
  const pick = (role: Role) => {
    A.patch(d => { d.flow = { ...d.flow, reg: { role } }; d.stack = [...d.stack, { s: ROLE_INFO[role].first }]; });
  };
  const opt = (role: Role, title: string, sub: string, icon: string, tone: string) => (
    <button className="card" onClick={() => pick(role)} aria-label={title}>
      <div className="row">
        <span className={'icirc ' + tone} style={{ width: "3em", height: "3em" }}><Icon n={icon} s="1.4em" /></span>
        <div className="grow"><div className="h3">{title}</div><div className="cap">{sub}</div></div>
        <span className="icirc" style={{ width: "2.2em", height: "2.2em" }}><Icon n="chevron-right" s="1.1em" /></span>
      </div>
    </button>
  );
  return (
    <Screen bar={false}>
      <div className="stack" style={{ paddingTop: ".6em" }}>
        <div className="center"><Logo light /></div>
        <h1 className="h2 center" style={{ marginTop: ".2em" }}>¿Cómo vas a usar Mesagri?</h1>
        <p className="cap center" style={{ margin: "-.4em 0 .4em" }}>Puedes cambiarlo después en tu perfil</p>
        {opt('FARMER', A.t('profile.farmer', 'Soy agricultor'), A.t('profile.farmer_sub', 'Publico y vendo mi cosecha'), 'sprout', 'dark')}
        {opt('BUYER', 'Soy comprador (MYPE)', 'Restaurante, hotel, bodega o comedor', 'store', 'terra')}
        {opt('WAREHOUSE', 'Soy almacén aliado', 'Molino, centro de acopio o almacén con espacio libre', 'warehouse', '')}
        {opt('CARRIER', 'Soy transportista aliado', 'Llevo pedidos con mi moto, camioneta o camión', 'truck', 'terra')}
        <div className="center cap" style={{ marginTop: ".4em" }}>¿Eres del equipo de Mesagri?</div>
        <button className="linkbtn" style={{ alignSelf: "center", marginTop: "-.6em" }} onClick={() => openPanel(A)}>Ingresa en el panel web</button>
        <button className="linkbtn" style={{ alignSelf: "center", marginTop: "-.6em" }} onClick={() => A.go('LOGIN')}>Ya tengo cuenta · Iniciar sesión</button>
      </div>
    </Screen>
  );
}

/* ---------- Iniciar sesión según el tipo de usuario ---------- */
export const LOGIN_TYPES: { role: string; title: string; sub: string; icon: string; tone: string }[] = [
  { role: 'FARMER', title: 'Agricultor', sub: 'Publico y vendo mi cosecha', icon: 'sprout', tone: 'dark' },
  { role: 'BUYER', title: 'Comprador (MYPE)', sub: 'Restaurante, hotel, bodega o comedor', icon: 'store', tone: 'terra' },
  { role: 'WAREHOUSE', title: 'Almacén aliado', sub: 'Guardo cosechas en mi almacén', icon: 'warehouse', tone: '' },
  { role: 'CARRIER', title: 'Transportista aliado', sub: 'Llevo pedidos con mi vehículo', icon: 'truck', tone: 'terra' },
  { role: 'ADMIN', title: 'Equipo de Mesagri', sub: 'Administración en el panel web', icon: 'shield-check', tone: 'ghost' },
];
const typeOf = (role?: string) => LOGIN_TYPES.find(x => x.role === role) ?? LOGIN_TYPES[0];

/** El panel del equipo es web: desde la app se abre su dirección (con el correo, si se conoce). */
export function openPanel(A: AppCtx, email?: string) {
  const url = panelUrl(email);
  try {
    if (A.store.mode === 'stage') window.open(url, '_blank', 'noopener');
    else window.location.assign(url);
  } catch { /* sin ventana */ }
}

function DarkBack() {
  const A = useApp();
  if (A.dev.stack.length < 2) return null;
  return <div className="row"><button className="back" style={{ color: "#fff", background: "transparent", border: "0", width: "3em", height: "3em" }} aria-label="Volver" onClick={() => A.back()}><Icon n="chevron-left" s="1.6em" /></button></div>;
}

function TypeCard({ t, onClick }: { t: typeof LOGIN_TYPES[number]; onClick: () => void }) {
  return (
    <button className="card typecard" onClick={onClick} aria-label={t.title}>
      <div className="row">
        <span className={'icirc ' + t.tone} style={{ width: "2.8em", height: "2.8em" }}><Icon n={t.icon} s="1.35em" /></span>
        <div className="grow"><div className="h3">{t.title}</div><div className="cap">{t.sub}</div></div>
        <Icon n="chevron-right" s="1.2em" />
      </div>
    </button>
  );
}

/* LOGIN · ¿cómo usas Mesagri? */
function LoginType() {
  const A = useApp();
  return (
    <Screen bar={false} cls="dark-screen">
      <div className="stack" style={{ paddingTop: ".2em" }}>
        <DarkBack />
        <Logo />
        <h1 className="h2 center" style={{ marginTop: ".2em" }}>Iniciar sesión</h1>
        <p className="cap center" style={{ margin: "-.5em 0 .2em" }}>¿Cómo usas Mesagri?</p>
        {LOGIN_TYPES.map(t => <TypeCard key={t.role} t={t} onClick={() => A.go('LOGIN-F', { role: t.role })} />)}
        <div className="center cap" style={{ marginTop: ".3em" }}>¿Todavía no tienes cuenta?</div>
        <button className="linkbtn" style={{ color: "#fff", alignSelf: "center", marginTop: "-.7em" }} onClick={() => A.replace('A-01P')}>Regístrate gratis</button>
      </div>
    </Screen>
  );
}

/* LOGIN-F · ingreso con celular y código (o, si es del equipo, al panel web) */
function LoginForm() {
  const A = useApp();
  const role = String(A.top.p?.role ?? 'FARMER');
  return role === 'ADMIN' ? <TeamLogin /> : <PhoneLogin role={role} />;
}

function PhoneLogin({ role }: { role: string }) {
  const A = useApp();
  const t = typeOf(role);
  const [phone, setPhone] = useState<string>(A.top.p?.phone ?? '');
  const [code, setCode] = useState<string>(A.top.p?.code ?? '');
  const [err, setErr] = useState<{ text: string; role?: string; email?: string; panel?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState(false);
  const [wa, setWa] = useState<{ link: string; number: string; demo?: boolean } | undefined>();
  const p = phone.replace(/\s/g, '');
  const ask = async (ph: string) => {
    if (!isPhoneValid(ph)) { setErr({ text: 'Ese número no parece correcto: son 9 dígitos y empieza con 9.' }); return; }
    setErr(null); setBusy(true); setWa(undefined);
    try {
      const r = await auth.otp(ph, 'LOGIN');
      // cuenta de una persona real y este no es su celular: sin proveedor de mensajes, el código no se muestra aquí
      if (r.deviceOnly) { setErr({ text: 'Por seguridad, en esta versión de prueba el código solo aparece en el celular donde se creó esta cuenta. Si cambiaste de celular, pide al equipo de Mesagri que restablezca tu acceso (o crea una cuenta nueva).' }); return; }
      // se pide escribiendo a Mesagri por WhatsApp: la respuesta trae el código
      if (r.channel === 'WHATSAPP_IN' && r.wa) { setWa({ ...r.wa, demo: r.demoAccount }); setCode(''); return; }
      // Como en un celular que lee el mensaje solo: el código se completa. En la versión de prueba, se muestra aquí.
      if (r.demoCode) setCode(r.demoCode);
      A.toast(r.demoCode
        ? (r.notice ? `${r.notice} Por ser versión de prueba, tu código es ${r.demoCode}.` : r.demoAccount ? `Cuenta de prueba: tu código es ${r.demoCode}. Con una cuenta real llega por WhatsApp.` : `Versión de prueba: tu código es ${r.demoCode}.`)
        : r.channel === 'WHATSAPP' ? `Te enviamos un código por WhatsApp al ${r.to ?? 'celular'}.` : 'Te enviamos un código.', 'info');
    } catch (e: any) { setErr({ text: e.message }); } finally { setBusy(false); }
  };
  const enter = async (as?: string) => {
    if (!isPhoneValid(p)) { setErr({ text: 'Ese número no parece correcto: son 9 dígitos y empieza con 9.' }); return; }
    if (code.trim().length !== 6) { setErr({ text: 'Escribe el código de 6 dígitos. Toca «Pedir código» para recibirlo.' }); return; }
    setBusy(true); setErr(null);
    try {
      const r = await auth.login(p, code.trim(), A.dev.id, as ?? role);
      A.store.sessions.set(r.session);
      A.login(r.userId);
      A.toast(`Hola, ${A.w.users[r.userId]?.shortName ?? ''}`, 'ok');
    } catch (e: any) {
      if (e?.code === 'ROLE_MISMATCH') setErr({ text: e.message, role: e.data?.role });
      else if (e?.code === 'USE_PANEL') setErr({ text: e.message, email: e.data?.email, panel: true });
      else setErr({ text: e?.message ?? 'No pudimos iniciar tu sesión.' });
    } finally { setBusy(false); }
  };
  // cuentas de prueba de este tipo: las personas del piloto y las que se crearon en este celular
  // (en la versión en línea, solo las que ingresaron desde aquí: las de otras personas no se listan)
  const mine = LOCAL
    ? Object.values(A.w.users).filter(u => u.role === role && !PERSONAS.some(x => x.userId === u.id) && !u.id.startsWith('u-seed')).slice(-6).reverse().map(u => ({ id: u.id, phone: u.phone }))
    : deviceAccounts().filter(a => a.userId && A.w.users[a.userId]?.role === role && !PERSONAS.some(x => x.userId === a.userId)).slice(0, 6).map(a => ({ id: a.userId!, phone: a.phone }));
  const sample = [
    ...PERSONAS.filter(x => x.role === role && A.w.users[x.userId]).map(x => ({ id: x.userId, title: x.label, sub: liveSub(A.w, x), phone: A.w.users[x.userId].phone })),
    ...mine.filter(x => A.w.users[x.id]).map(x => ({ id: x.id, title: A.w.users[x.id].name, sub: (A.w.orgs[A.w.users[x.id].orgId]?.name ?? '') + (LOCAL ? '' : ' · en este celular'), phone: x.phone })),
  ];
  return (
    <Screen bar={false} cls="dark-screen">
      <div className="stack" style={{ paddingTop: ".2em" }}>
        <DarkBack />
        <div className="row" style={{ gap: ".8em" }}>
          <span className={'icirc ' + t.tone} style={{ width: "3em", height: "3em" }}><Icon n={t.icon} s="1.45em" /></span>
          <div className="grow"><div className="cap" style={{ fontWeight: 800 }}>Ingreso de</div><h1 className="h2" style={{ margin: 0 }}>{t.title}</h1></div>
        </div>
        <p className="bodym" style={{ margin: ".2em 0 0", color: "#E7F0DC" }}>Ingresa con tu número de celular. Te mandamos un código de 6 dígitos.</p>
        <Inp value={phone} onInput={(v) => { setPhone(v); setErr(null); }} mode="tel" prefix="+51" placeholder="987 654 321" label="Número de celular" autoFocus />
        <Inp value={code} onInput={(v) => { setCode(v.replace(/\D/g, '').slice(0, 6)); setErr(null); }} mode="numeric" placeholder="Código de 6 dígitos" label="Código de acceso" max={6} suffix={<span style={{ pointerEvents: "auto" }}><button className="linkbtn" style={{ color: "var(--field)", padding: "0", minHeight: "0" }} onClick={() => ask(p)} disabled={busy}>{code || wa ? 'Reenviar' : 'Pedir código'}</button></span>} />
        {wa && <WhatsAppAsk wa={wa} dark demo={wa.demo} />}
        {err && (
          <div className="card danger" role="alert">
            <div className="bodym">{err.text}</div>
            {err.role && <div className="mt"><Btn sm kind="dark" onClick={() => { A.replace('LOGIN-F', { role: err.role, phone: p, code }); }}>Ingresar como {typeOf(err.role).title.toLowerCase()}</Btn></div>}
            {err.panel && <div className="mt"><Btn sm kind="dark" icon="external-link" onClick={() => openPanel(A, err.email)}>Ir al panel web</Btn></div>}
          </div>
        )}
        <Btn full onClick={() => enter()} disabled={busy}>{busy ? <i className="spin" /> : null}Ingresar</Btn>
        <div className="center cap">¿No tienes cuenta?</div>
        <button className="linkbtn" style={{ color: "#fff", alignSelf: "center", marginTop: "-.7em" }} onClick={() => A.patch(d => { d.flow = { ...d.flow, reg: { role } }; d.stack = [...d.stack.slice(0, -1), { s: 'A-01P' }, { s: ROLE_INFO[role]?.first ?? 'A-02' }]; })}>Crear mi cuenta de {t.title.toLowerCase()}</button>
        {sample.length > 0 && (
          <>
            <hr className="hr" style={{ background: "rgba(255,255,255,.2)" }} />
            <button className="linkbtn" style={{ color: "#E7F0DC", alignSelf: "center" }} aria-expanded={list ? 'true' : 'false'} onClick={() => setList(!list)}>{list ? 'Ocultar' : 'Ver'} cuentas de prueba</button>
            {list && (
              <div className="stack tight">
                {sample.map(x => {
                  const u = A.w.users[x.id];
                  return (
                    <button key={x.id} className="card" style={{ background: "rgba(255,255,255,.1)", color: "#fff", boxShadow: "none" }} onClick={() => { setPhone(x.phone); setCode(''); void ask(x.phone); }}>
                      <div className="row"><Av org={A.w.orgs[u.orgId]} /><div className="grow"><div className="b">{x.title}</div><div className="cap">{x.sub} · {fmtPhone(x.phone)}</div></div></div>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </Screen>
  );
}

/* Equipo de Mesagri: el trabajo del equipo está en el panel web */
function TeamLogin() {
  const A = useApp();
  return (
    <Screen bar={false} cls="dark-screen">
      <div className="stack" style={{ paddingTop: ".2em" }}>
        <DarkBack />
        <Logo tagline={false} />
        <h1 className="h2 center" style={{ marginTop: ".2em" }}>Equipo de Mesagri</h1>
        <p className="bodym center" style={{ margin: "-.3em 0 .2em", color: "#E7F0DC" }}>El equipo trabaja en el panel web: verificaciones, pedidos y disputas, reclamos, cobros, configuración y reportes.</p>
        <div className="card" style={{ background: "rgba(255,255,255,.1)", color: "#fff", boxShadow: "none" }}>
          <div className="row top g8"><Icon n="lock" /><div className="bodym">Se ingresa con el correo del equipo, la contraseña y el código de la app de autenticación (doble factor). Cada acceso queda en la auditoría.</div></div>
        </div>
        <Btn full icon="external-link" onClick={() => openPanel(A)}>Abrir el panel web</Btn>
        <p className="cap center" style={{ margin: 0 }}>En el celular también abre, pero se trabaja mejor en una computadora.</p>
      </div>
    </Screen>
  );
}

/* ---------- A-02 · Registro con celular ---------- */
const FREE_TEXT: Record<string, string[]> = {
  FARMER: ['Registrarte es gratis', 'Tus primeras 5 ventas no pagan comisión. Desde la 6.ª, solo 3 % de lo que vendes.', 'Si no vendes, no pagas nada. El pago de tu comprador llega directo a ti.'],
  BUYER: ['Tu primer mes es gratis', 'Luego, Básico S/ 49 al mes (compras hasta S/ 2 500). Si compras más, Pro S/ 99.', 'Pagas directo a cada agricultor; Mesagri no guarda tu dinero.'],
  WAREHOUSE: ['Registrarte es gratis', 'Mesagri cobra 10 % del alquiler que recibas, una vez al mes.', 'El agricultor te paga directo el alquiler.'],
  CARRIER: ['Registrarte y verificarte es gratis', 'Mesagri cobra 10 % de cada flete que hagas por la app, una vez al mes.', 'El negocio te paga el flete directo cuando recibe.'],
};
function Phone() {
  const A = useApp();
  const R = regGet(A);
  const role = R.role ?? 'FARMER';
  const [phone, setPhone] = useState(R.phone ?? '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const p = phone.replace(/\s/g, '');
  const step = role === 'FARMER' ? 1 : role === 'BUYER' ? 2 : 1;
  const send = async () => {
    if (!isPhoneValid(p)) { setErr('Ese número no parece correcto: son 9 dígitos y empieza con 9.'); return; }
    if (Object.values(A.w.users).some(u => u.phone === p)) { setErr('Ese celular ya tiene una cuenta. Ingresa con «Ya tengo cuenta».'); return; }
    setBusy(true);
    try {
      const r = await auth.otp(p, 'REGISTER');
      const wa = r.channel === 'WHATSAPP_IN' ? r.wa : undefined;
      regSet(A, { phone: p, otpAt: Date.now(), demoCode: r.demoCode, wa });
      if (!wa) A.toast(r.demoCode ? (r.notice ? `${r.notice} Por ser versión de prueba, tu código es ${r.demoCode}.` : `Versión de prueba: tu código es ${r.demoCode}.`) : `Te enviamos un código por WhatsApp${r.to ? ` al ${r.to}` : ''}.`, 'info');
      A.go('A-03');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const t = FREE_TEXT[role];
  return (
    <Screen title="Crear cuenta" foot={<><Btn full onClick={send} disabled={busy}>{busy ? <i className="spin" /> : null}{A.t('register.send_code', 'Enviar código')}</Btn><button className="linkbtn" style={{ alignSelf: "center" }} onClick={() => A.go('LOGIN-F', { role })}>¿Ya tienes cuenta? Inicia sesión</button></>}>
      <div className="stack">
        <RoleHead role={role} step={step} label="Tu celular" />
        <Field label={A.t('register.phone', 'Número de celular')} help="Te enviaremos un código de 6 dígitos por WhatsApp o SMS" error={err}>
          <Inp value={phone} onInput={(v) => { setPhone(v); setErr(''); }} mode="tel" prefix="+51" placeholder="9__ ___ ___" err={!!err} suffix={<Icon n="smartphone" />} label="Número de celular" autoFocus />
        </Field>
        <Card tone="soft">
          <div className="row top">
            <span className="icirc dark" style={{ width: "1.9em", height: "1.9em" }}><Icon n="check" s="1em" w={3} /></span>
            <div className="stack tight grow"><b>{role === 'FARMER' ? A.t('register.free', t[0]) : t[0]}</b><span className="bodym">{t[1]}</span><span className="cap">{t[2]}</span></div>
          </div>
        </Card>
      </div>
    </Screen>
  );
}

/* ---------- A-03 · Código de verificación ---------- */
export function CodeInput({ value, onChange, n, err, autoFocus }: { value: string; onChange: (v: string) => void; n: number; err?: boolean; autoFocus?: boolean }) {
  const ids = Array.from({ length: n }, (_, i) => i);
  const id = (i: number) => `ci-${n}-${i}`;
  const scope = (useState(() => uid())[0]);
  useEffect(() => { if (autoFocus) (document.getElementById(scope + id(0)) as HTMLInputElement | null)?.focus(); }, []);
  const set = (i: number, ch: string) => {
    const digits = ch.replace(/\D/g, '');
    if (digits.length > 1) { onChange((value.slice(0, i) + digits).slice(0, n)); const nx = Math.min(n - 1, i + digits.length); (document.getElementById(scope + id(nx)) as HTMLInputElement | null)?.focus(); return; }
    const arr = value.padEnd(n, ' ').split('');
    arr[i] = digits || ' ';
    onChange(arr.join('').replace(/\s+$/, ''));
    if (digits && i < n - 1) (document.getElementById(scope + id(i + 1)) as HTMLInputElement | null)?.focus();
  };
  return (
    <div className={'codein' + (err ? ' err' : '')} style={{ justifyContent: "center" }}>
      {ids.map(i => <input key={i} id={scope + id(i)} inputMode="numeric" aria-label={`Dígito ${i + 1}`} value={(value[i] ?? '').trim()} maxLength={n}
        onChange={(e: any) => set(i, e.currentTarget.value)}
        onKeyDown={(e: any) => { if (e.key === 'Backspace' && !(value[i] ?? '').trim() && i > 0) { (document.getElementById(scope + id(i - 1)) as HTMLInputElement | null)?.focus(); } }} />)}
    </div>
  );
}

function Otp() {
  const A = useApp();
  const R = regGet(A);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [left, setLeft] = useState(60);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const t = setInterval(() => setLeft(l => Math.max(0, l - 1)), 1000); return () => clearInterval(t); }, []);
  const verify = async () => {
    setBusy(true);
    try {
      const r = await auth.verify(R.phone ?? '', code);
      A.store.tickets.set(String(R.phone ?? ''), r.ticket);
      regSet(A, { otpOk: true });
      A.go('A-04');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const resend = async () => {
    setLeft(60);
    try {
      const r = await auth.otp(R.phone ?? '', 'REGISTER');
      regSet(A, { demoCode: r.demoCode, wa: r.channel === 'WHATSAPP_IN' ? r.wa : undefined });
      if (r.channel === 'WHATSAPP_IN' && r.wa) { try { window.open(r.wa.link, '_blank', 'noopener'); } catch { /* sin ventana */ } return; }
      A.toast(r.demoCode ? `Tu código es ${r.demoCode} (versión de prueba).` : 'Te enviamos otro código.', 'info');
    } catch (e: any) { setErr(e.message); }
  };
  return (
    <Screen title={A.t('otp.title', 'Verifica tu número')} foot={<Btn full onClick={verify} disabled={code.length < 6 || busy}>{busy ? <i className="spin" /> : null}{A.t('otp.verify', 'Verificar')}</Btn>}>
      <div className="stack">
        <div><div className="cap">{R.wa ? 'Tu celular' : 'Enviamos un código a'}</div><div className="h3">+51 {fmtPhone(R.phone ?? '')}</div></div>
        {R.wa && <WhatsAppAsk wa={R.wa} />}
        <CodeInput value={code} onChange={(v) => { setCode(v); setErr(''); }} n={6} err={!!err} autoFocus={!R.wa} />
        {err && <div className="errt"><Icon n="circle-alert" s="1.2em" />{err}</div>}
        <div className="row between cap"><span>{left > 0 ? 'Puedes reenviar el código en' : '¿No te llegó?'}</span>{left > 0 ? <b className="price">00:{String(left).padStart(2, '0')}</b> : <button className="linkbtn" onClick={resend}>Reenviar código</button>}</div>
        {R.demoCode && <button className="linkbtn" style={{ alignSelf: "flex-start", fontSize: ".85em" }} onClick={() => setCode(R.demoCode)}>Usar el código del mensaje (demo)</button>}
      </div>
    </Screen>
  );
}

/* ---------- A-04 · Términos y consentimientos ---------- */
const CONSENT_TEXT = 'Resumen de tus permisos. Mostramos tu distrito a los compradores, nunca la ubicación exacta de tu chacra. Guardamos la foto de tu DNI solo para verificarte; la ve el equipo de verificación. Puedes recibir avisos por WhatsApp. Puedes dejar que usemos tus ventas, sin tu nombre, para calcular precios de referencia. Puedes retirar un permiso cuando quieras desde tu perfil.';
function Consents() {
  const A = useApp();
  const R = regGet(A);
  const role = R.role ?? 'FARMER';
  const [c, setC] = useState<Record<string, boolean>>(R.consents ?? { distrito: true, dni: true, whatsapp: true, precios: false });
  const [err, setErr] = useState('');
  const step = role === 'FARMER' ? 2 : role === 'BUYER' ? 3 : 1;
  const next = () => {
    if (!c.distrito || !c.dni) { setErr(`Para continuar necesitamos mostrar tu ${role === 'FARMER' ? 'distrito' : 'distrito y RUC'} y guardar la foto de tu DNI: así los demás confían en ti. Lo demás es opcional.`); return; }
    regSet(A, { consents: c });
    if (role === 'FARMER') A.go('A-05');
    else if (role === 'BUYER') { if (createBuyer(A)) A.reset('B-04'); }
    else if (role === 'WAREHOUSE') A.go('C-02');
    else A.go('T-02');
  };
  const items: [string, string, string, boolean][] = [
    ['distrito', role === 'FARMER' ? 'Mostrar mi distrito' : 'Mostrar mi distrito y mi RUC', role === 'FARMER' ? 'Nunca tu chacra exacta · obligatorio' : 'Para que te encuentren y confíen · obligatorio', true],
    ['dni', 'Guardar la foto de mi DNI', 'Solo para verificarte · obligatorio', true],
    ['whatsapp', 'Avisos por WhatsApp', 'Pedidos y pagos · opcional', false],
    ['precios', 'Usar mis ventas sin mi nombre', 'Para precios de referencia · opcional', false],
  ];
  return (
    <Screen title={A.t('consent.title', 'Antes de empezar')} sub={`Paso ${step} de ${ROLE_INFO[role].steps} · tus permisos`} foot={<><Btn full onClick={next}>{A.t('consent.accept', 'Acepto y continúo')}</Btn><button className="linkbtn" style={{ alignSelf: "center" }} onClick={() => A.sheet(<SheetBody title="Términos y privacidad (resumen)"><p className="bodym">{CONSENT_TEXT}</p><p className="bodym">Mesagri S.A.C. trata tus datos según la Ley 29733 y su reglamento (D. S. 016-2024-JUS). Puedes pedir acceso, rectificación, cancelación u oposición (ARCO) desde Perfil › Privacidad.</p><p className="cap">El texto completo está en castellano; esta demo usa datos de ejemplo.</p><Btn full kind="dark" onClick={() => A.sheet(null)}>Entendido</Btn></SheetBody>)}>Leer términos completos</button></>}>
      <div className="stack">
        <Steps n={step} of={ROLE_INFO[role].steps} />
        <Card tone="dark">
          <div className="row">
            <Spk text={CONSENT_TEXT} label="Escuchar el resumen" />
            <div className="grow"><div className="b">Escucha el resumen</div><div className="cap">1:20 · en castellano</div></div>
          </div>
        </Card>
        <div className="sect">Tus permisos</div>
        <Card>
          {items.map(([k, l, s, must]) => <Tog key={k} on={!!c[k]} onChange={(v) => { setC({ ...c, [k]: v }); setErr(''); }} label={l} sub={s} disabled={false} />)}
        </Card>
        {err && <Note icon="info" tone="warn">{err}</Note>}
        <p className="cap" style={{ margin: "0" }}>El texto completo está en castellano. Puedes retirar un permiso cuando quieras desde tu perfil (Ley 29733).</p>
      </div>
    </Screen>
  );
}

/* ---------- A-05 · Tu identidad (agricultor) ---------- */
function districtOptions(filter?: (d: typeof DISTRICTS[number]) => boolean) {
  return DISTRICTS.filter(d => !filter || filter(d)).map(d => ({ v: d.code, l: `${d.name} · ${PROVINCES[d.province].name}` }));
}
function Identity() {
  const A = useApp();
  const R = regGet(A);
  const [name, setName] = useState(R.name ?? '');
  const [dni, setDni] = useState(R.dni ?? '');
  const [district, setDistrict] = useState(R.district ?? '040519');
  const [ph, setPh] = useState<Record<string, string | undefined>>(R.photos ?? {});
  const [err, setErr] = useState<Record<string, string>>({});
  const go = (withDocs: boolean) => {
    const e: Record<string, string> = {};
    if (name.trim().length < 3) e.name = 'Escribe tu nombre completo, como en tu DNI.';
    if (!isDniValid(dni)) e.dni = 'El DNI tiene 8 números.';
    setErr(e);
    if (Object.keys(e).length) return;
    const userId = 'u-' + uid(), orgId = 'org-' + uid();
    const r = A.act('USER_REGISTER', { userId, orgId, role: 'FARMER', phone: R.phone, name: name.trim(), dni, lang: A.dev.pre?.lang ?? 'es', org: { district, name: name.trim() } }, { as: userId });
    if (!r.ok) { if (r.error?.code === 'DNI_TAKEN') setErr({ dni: r.error.message }); return; }
    A.act('CONSENTS_ACCEPT', { version: '1.0', items: R.consents ?? { distrito: true, dni: true } }, { as: userId, quiet: true });
    A.act('PREFS_SET', { prefs: { lang: A.dev.pre?.lang ?? 'es', audioGuide: A.dev.pre?.audioGuide ?? true, bilingual: !!A.dev.pre?.bilingual } }, { as: userId, quiet: true });
    if (withDocs && (ph.front || ph.selfie)) {
      const ev: Evidence[] = [{ key: 'dni', label: 'DNI (ambas caras)', photoId: ph.front, detail: `DNI ${maskDni(dni)}` }, { key: 'selfie', label: 'Selfie', photoId: ph.selfie }];
      if (ph.back) ev.push({ key: 'dni2', label: 'DNI · reverso', photoId: ph.back });
      A.act('VERIF_SUBMIT', { caseId: 'case-' + uid(), orgId, targetLevel: 1, evidence: ev }, { as: userId, quiet: true });
    }
    A.patch(d => { d.userId = userId; d.flow = { ...d.flow, reg: { ...(d.flow.reg ?? {}), name, dni, district, photos: ph, userId, orgId } }; d.stack = [{ s: 'A-06', p: { onboarding: 1 } }]; });
  };
  return (
    <Screen title={A.t('identity.title', 'Verifica tu identidad')} sub={name || 'Paso 3 de 5'} foot={<><Btn full onClick={() => go(true)}>Continuar</Btn><button className="linkbtn" style={{ alignSelf: "center", fontSize: ".85em" }} onClick={() => go(false)}>Puedes hacerlo después: mientras tanto explora la app</button></>}>
      <div className="stack">
        <Steps n={3} of={5} />
        <div className="sect">Paso 3 de 5 · Tu DNI</div>
        {!LOCAL && <Note icon="info">Versión de prueba abierta al público: usa un DNI y fotos de ejemplo, no los tuyos.</Note>}
        <Field label="Tu nombre completo" error={err.name}><Inp value={name} onInput={setName} placeholder="Como figura en tu DNI" err={!!err.name} label="Nombre completo" /></Field>
        <Field label="Número de DNI" error={err.dni}><Inp value={dni} onInput={(v) => setDni(v.replace(/\D/g, '').slice(0, 8))} mode="numeric" placeholder="8 números" err={!!err.dni} label="DNI" /></Field>
        <Field label="¿En qué distrito está tu chacra?" help="Los compradores solo ven tu distrito (RN-17)."><Sel value={district} onChange={setDistrict} options={districtOptions(d => !d.city || d.code === '040101')} label="Distrito" /></Field>
        <div className="grid2">
          <PhotoPick value={ph.front} onChange={(v) => setPh({ ...ph, front: v })} label="DNI · frente" kind="dni" />
          <PhotoPick value={ph.back} onChange={(v) => setPh({ ...ph, back: v })} label="DNI · reverso" kind="dni" />
        </div>
        <Card>
          <div className="row top">
            <span className="icirc terra" style={{ width: "3.2em", height: "3.2em" }}><Icon n="circle-user" s="1.6em" /></span>
            <div className="grow stack tight"><b>Selfie</b><span className="cap">Mira a la cámara, sin lentes ni gorra. La app te guía con la voz.</span>
              <PhotoPick value={ph.selfie} onChange={(v) => setPh({ ...ph, selfie: v })} label="Selfie" kind="selfie" />
            </div>
          </div>
        </Card>
        <Note icon="lock">Lo vemos solo el equipo de verificación. Sirve para que los compradores confíen en ti.</Note>
      </div>
    </Screen>
  );
}

/* ---------- A-06 · ¿Cómo te pagan? ---------- */
function Payout() {
  const A = useApp();
  const org = A.org!;
  const onboarding = !!A.top.p?.onboarding;
  const cur = org.payout[0];
  const initKind = !org.payout.length ? (org.acceptsCash ? 'CASH' : 'YAPE') : cur.relation !== 'PROPIA' ? 'THIRD' : cur.kind === 'BANK' ? 'BANK' : 'YAPE';
  const [kind, setKind] = useState<'YAPE' | 'BANK' | 'THIRD' | 'CASH'>(initKind as any);
  const [num, setNum] = useState(cur?.number ?? A.me!.phone);
  const [plin, setPlin] = useState(cur?.kind === 'PLIN');
  const [holder, setHolder] = useState(cur?.holder ?? A.me!.name);
  const [relation, setRelation] = useState<'FAMILIAR' | 'ASOCIACION'>((cur?.relation as any) === 'ASOCIACION' ? 'ASOCIACION' : 'FAMILIAR');
  const [auth, setAuth] = useState<string | undefined>(undefined);
  const [cash, setCash] = useState(org.acceptsCash || !org.payout.length);
  const save = () => {
    const accounts: any[] = [];
    if (kind === 'YAPE') accounts.push({ id: 'pa-' + uid(), kind: plin ? 'PLIN' : 'YAPE', number: num.replace(/\s/g, ''), holder: A.me!.name, relation: 'PROPIA', verified: org.level >= 1 });
    if (kind === 'BANK') accounts.push({ id: 'pa-' + uid(), kind: 'BANK', number: num.replace(/\s/g, ''), holder: A.me!.name, relation: 'PROPIA', verified: org.level >= 1 });
    if (kind === 'THIRD') accounts.push({ id: 'pa-' + uid(), kind: 'YAPE', number: num.replace(/\s/g, ''), holder, relation, authorization: auth ? `Autorización firmada (foto ${auth})` : '', verified: false });
    const r = A.act('PAYOUT_SET', { orgId: org.id, accounts, acceptsCash: kind === 'CASH' ? true : cash });
    if (!r.ok) return;
    if (onboarding) A.replace('A-07', { onboarding: 1 }); else { A.toast('Guardamos tu cuenta de cobro.'); A.back(); }
  };
  const opt = (k: typeof kind, icon: string, title: string, sub: string) => (
    <div className={'card ' + (kind === k ? 'sel' : 'line')} role="radio" aria-checked={kind === k ? 'true' : 'false'} tabIndex={0} onClick={() => { setKind(k); if (k === 'BANK') setNum(''); if (k === 'YAPE' || k === 'THIRD') setNum(cur?.kind !== 'BANK' && cur?.number ? cur.number : A.me!.phone); }} style={{ cursor: "pointer" }}>
      <div className="row"><ICirc n={icon} /><div className="grow"><b className="bodym">{title}</b><div className="cap">{sub}</div></div>{kind === k ? <span className="icirc dark" style={{ width: "1.7em", height: "1.7em" }}><Icon n="check" s=".95em" w={3} /></span> : <span style={{ width: "1.4em", height: "1.4em", borderRadius: "99px", border: "2px solid var(--line)" }} />}</div>
      {kind === k && k !== 'CASH' && (
        <div className="stack tight mt" onClick={(e) => e.stopPropagation()}>
          {k === 'YAPE' && <Seg value={plin ? 'PLIN' : 'YAPE'} options={[{ v: 'YAPE', l: 'Yape' }, { v: 'PLIN', l: 'Plin' }]} onChange={(v) => setPlin(v === 'PLIN')} />}
          {k === 'THIRD' && <><Seg value={relation} options={[{ v: 'FAMILIAR', l: 'De un familiar' }, { v: 'ASOCIACION', l: 'De mi asociación' }]} onChange={setRelation} /><Inp value={holder} onInput={setHolder} placeholder="Nombre del titular" label="Titular" /></>}
          <Inp value={num} onInput={setNum} mode="numeric" placeholder={k === 'BANK' ? 'CCI de 20 dígitos' : 'Número de celular'} label="Número" />
          {k === 'THIRD' && <PhotoPick value={auth} onChange={setAuth} label="Autorización firmada del titular" kind="dni" />}
        </div>
      )}
    </div>
  );
  return (
    <Screen title={A.t('payout.title', '¿Cómo te pagan?')} sub={org.name} foot={<Btn full onClick={save}>{onboarding ? 'Continuar' : 'Guardar'}</Btn>}>
      <div className="stack">
        {onboarding && <><Steps n={4} of={5} /><div className="sect">Paso 4 de 5 · Tu cobro</div></>}
        {opt('YAPE', 'smartphone', 'Yape o Plin a mi número', 'Lo más rápido')}
        {opt('BANK', 'landmark', 'Cuenta bancaria', 'Con tu CCI de 20 dígitos')}
        {opt('THIRD', 'users', 'Cuenta de un familiar o de mi asociación', 'Con una autorización firmada')}
        {opt('CASH', 'banknote', 'Solo efectivo al entregar', `Pedidos de menos de ${money(A.w.settings.cashThreshold)}`)}
        {kind !== 'CASH' && <Card><Tog on={cash} onChange={setCash} label="También acepto efectivo al entregar" sub={`Solo pedidos de menos de ${money(A.w.settings.cashThreshold)}, con el envío incluido (RN-04).`} /></Card>}
        <p className="cap" style={{ margin: "0" }}>El titular debe ser tú o la persona que autorizaste (regla RN-28). Mesagri nunca recibe tu dinero.</p>
      </div>
    </Screen>
  );
}

/* ---------- A-07 · Zonas de entrega ---------- */
function Zones() {
  const A = useApp();
  const org = A.org!;
  const onboarding = !!A.top.p?.onboarding;
  const prov = org.province;
  const near = DISTRICTS.filter(d => d.province === prov && !d.city);
  const city = CITY_DISTRICTS.filter(d => ['040101', '040126', '040103', '040112', '040129', '040104'].includes(d.code));
  const init: Record<string, number | undefined> = {};
  for (const a of org.serviceAreas) init[a.district] = a.fee;
  if (onboarding && !org.serviceAreas.length) init[org.district] = 0;
  const [areas, setAreas] = useState<Record<string, number | undefined>>(init);
  const [days, setDays] = useState<number[]>(org.deliveryDays.length ? org.deliveryDays : [2, 4, 6]);
  const [pickup, setPickup] = useState<boolean>(!!org.pickupPoint || onboarding);
  const [point, setPoint] = useState(org.pickupPoint ?? `Chacra en ${placeLabel(org.district)}`);
  const toggle = (code: string) => { const n = { ...areas }; if (n[code] === undefined) n[code] = DISTRICT_BY_CODE[code].province === prov ? 0 : 10; else delete n[code]; setAreas(n); };
  const save = () => {
    const list = Object.entries(areas).filter(([, f]) => f !== undefined).map(([district, fee]) => ({ district, fee: fee ?? 0 }));
    const r = A.act('ZONES_SET', { orgId: org.id, areas: list, days, pickupPoint: pickup ? point : '' });
    if (!r.ok) return;
    if (onboarding) { A.reset('A-08'); A.toast('¡Listo! Mientras verificamos tu identidad (48 h) puedes explorar la app.', 'ok'); A.say('Listo. Mientras verificamos tu identidad puedes explorar la app.'); }
    else { A.toast('Guardamos tus zonas de entrega.'); A.back(); }
  };
  const row = (code: string, sub?: string) => {
    const on = areas[code] !== undefined;
    return (
      <div key={code} className="togrow" style={{ flexWrap: "wrap" }}>
        <div className="grow"><div className="b" style={{ fontSize: ".92em" }}>{DISTRICT_BY_CODE[code].name}</div><div className="cap">{sub ?? (on ? (areas[code] ? `Envío ${money(areas[code]!)} por pedido` : 'Envío incluido') : 'No entregas aquí')}</div></div>
        {on && <div style={{ width: "6.5em" }}><Inp value={String(areas[code] ?? 0)} onInput={(v) => setAreas({ ...areas, [code]: Math.max(0, Number(v.replace(',', '.')) || 0) })} mode="decimal" prefix="S/" label={`Costo de envío a ${DISTRICT_BY_CODE[code].name}`} /></div>}
        <button className={'tog' + (on ? ' on' : '')} role="switch" aria-checked={on ? 'true' : 'false'} aria-label={DISTRICT_BY_CODE[code].name} onClick={() => toggle(code)} />
      </div>
    );
  };
  return (
    <Screen title={A.t('zones.title', '¿Dónde entregas?')} sub={org.name} foot={<Btn full onClick={save}>Guardar zonas</Btn>}>
      <div className="stack">
        {onboarding && <><Steps n={5} of={5} /><div className="sect">Paso 5 de 5 · Tus zonas</div></>}
        <Card>
          <Tog on={pickup} onChange={setPickup} label="Recojo en mi chacra o punto de recojo" sub="El comprador o su transportista llega a recoger" />
          {pickup && <div className="mt"><Inp value={point} onInput={setPoint} placeholder="Punto de recojo" label="Punto de recojo" /></div>}
        </Card>
        <div className="sect">Cerca de tu chacra · {PROVINCES[prov as 'AREQUIPA'].name}</div>
        <Card>{near.map(d => row(d.code))}</Card>
        <div className="sect">Arequipa ciudad</div>
        <Card>{city.map(d => row(d.code))}</Card>
        <div className="lbl">Días en que entregas</div>
        <div className="chips">{[1, 2, 3, 4, 5, 6, 7].map(d => <ChipBtn key={d} on={days.includes(d)} onClick={() => setDays(days.includes(d) ? days.filter(x => x !== d) : [...days, d].sort())}>{DOW_CHIP[d]}</ChipBtn>)}</div>
        <Note icon="info">Solo recibes pedidos de las zonas que marques (RN-27). Si no repartes, el comprador puede recoger o pedir un transportista aliado.</Note>
      </div>
    </Screen>
  );
}

/* ---------- B-02 · Registro del negocio ---------- */
export function RucLookup({ ruc, setRuc, onFound }: { ruc: string; setRuc: (v: string) => void; onFound?: (name: string) => void }) {
  const A = useApp();
  const valid = ruc.length === 11 && isRucValid(ruc);
  const pad = valid ? A.w.padron[ruc] : undefined;
  const taken = valid && Object.values(A.w.orgs).some(o => o.ruc === ruc);
  useEffect(() => { if (pad && onFound) onFound(pad.name); }, [ruc]);
  return (
    <div className="stack tight">
      <Field label="RUC (11 dígitos)" error={ruc.length === 11 && !valid ? 'Ese RUC no es válido: revisa los 11 dígitos.' : taken ? 'Ese RUC ya tiene una cuenta en Mesagri (RN-18).' : false}>
        <Inp value={ruc} onInput={(v) => setRuc(v.replace(/\D/g, '').slice(0, 11))} mode="numeric" placeholder="20601xxxxxx" label="RUC" />
      </Field>
      {valid && !taken && pad && (pad.condicion === 'HABIDO' && pad.estado === 'ACTIVO'
        ? <Card tone="soft"><div className="row"><span className="icirc dark" style={{ width: "1.9em", height: "1.9em" }}><Icon n="check" s="1em" w={3} /></span><div><b className="bodym">{pad.name}</b><div className="cap">Activo y habido · SUNAT</div></div></div></Card>
        : <Card tone="danger"><div className="row top"><Icon n="triangle-alert" /><div><b className="bodym">{pad.name}</b><div className="bodym">La SUNAT lo muestra como no habido. Regulariza tu domicilio fiscal en la SUNAT y vuelve a intentarlo (RN-19).</div></div></div></Card>)}
      {valid && !taken && !pad && <Note icon="info" tone="warn">No está en el padrón de prueba de la demo. Escribe la razón social y lo validamos al verificarte.</Note>}
      {!valid && <div className="chips">{TEST_RUCS.map(t => <button key={t.ruc} className="chip line" onClick={() => setRuc(t.ruc)} title={t.note}>Prueba: {t.ruc}</button>)}</div>}
    </div>
  );
}

const BIZ = [{ v: 'RESTAURANTE', l: 'Restaurante' }, { v: 'HOTEL', l: 'Hotel' }, { v: 'BODEGA', l: 'Bodega' }, { v: 'COMEDOR', l: 'Comedor' }];
function BuyerBusiness() {
  const A = useApp();
  const R = regGet(A);
  const [ruc, setRuc] = useState<string>(R.ruc ?? '');
  const [legal, setLegal] = useState<string>(R.legalName ?? '');
  const [name, setName] = useState<string>(R.bizName ?? '');
  const [biz, setBiz] = useState<string>(R.businessType ?? 'RESTAURANTE');
  const [district, setDistrict] = useState<string>(R.district ?? '040103');
  const [address, setAddress] = useState<string>(R.address ?? '');
  const [rep, setRep] = useState<string>(R.name ?? '');
  const [err, setErr] = useState('');
  const next = () => {
    if (!(ruc.length === 11 && isRucValid(ruc))) { setErr('Escribe un RUC válido de 11 dígitos.'); return; }
    const pad = A.w.padron[ruc];
    if (pad && pad.condicion !== 'HABIDO') { setErr('Con el RUC no habido no se puede crear la cuenta (RN-19).'); return; }
    if (Object.values(A.w.orgs).some(o => o.ruc === ruc)) { setErr('Ese RUC ya tiene una cuenta en Mesagri.'); return; }
    if ((name || legal).trim().length < 3) { setErr('Escribe el nombre de tu negocio.'); return; }
    if (address.trim().length < 5) { setErr('Escribe la dirección donde recibes los pedidos.'); return; }
    if (rep.trim().length < 3) { setErr('Escribe tu nombre (representante).'); return; }
    regSet(A, { ruc, legalName: pad?.name ?? legal, bizName: name || legal, businessType: biz, district, address, name: rep });
    A.go('A-02');
  };
  return (
    <Screen title="Crear cuenta" foot={<Btn full onClick={next}>Continuar</Btn>}>
      <div className="stack">
        <RoleHead role="BUYER" step={1} label="Tu negocio" />
        <RucLookup ruc={ruc} setRuc={(v) => { setRuc(v); setErr(''); }} onFound={(n) => { setLegal(n); if (!name) setName(n.replace(/\s(E\.I\.R\.L\.|S\.A\.C\.|S\.R\.L\.)$/i, '').replace(/\b\w+/g, s => s[0] + s.slice(1).toLowerCase())); }} />
        {ruc.length === 11 && !A.w.padron[ruc] && <Field label="Razón social"><Inp value={legal} onInput={setLegal} label="Razón social" /></Field>}
        <Field label="Nombre comercial"><Inp value={name} onInput={setName} placeholder="Como te conocen tus clientes" label="Nombre comercial" /></Field>
        <div className="lbl">Tipo de negocio</div>
        <div className="chips">{BIZ.map(b => <ChipBtn key={b.v} on={biz === b.v} onClick={() => setBiz(b.v)}>{b.l}</ChipBtn>)}</div>
        <Field label="Distrito del local"><Sel value={district} onChange={setDistrict} options={CITY_DISTRICTS.map(d => ({ v: d.code, l: d.name }))} label="Distrito" /></Field>
        <Field label="Dirección donde recibes"><Inp value={address} onInput={setAddress} placeholder="Av. Ejército 512" label="Dirección" /></Field>
        <Field label="Tu nombre (representante)"><Inp value={rep} onInput={setRep} placeholder="Como figura en tu DNI" label="Representante" /></Field>
        {err && <Note icon="circle-alert" tone="danger">{err}</Note>}
        <Card tone="warn">
          <div className="row top"><Icon n="receipt" /><div className="stack tight"><b className="bodym">Para comprar necesitas una membresía</b><span className="bodym">El primer mes es gratis. Luego, Básico {money(A.w.settings.plans.BASICO.price)} al mes (compras hasta {money(A.w.settings.plans.BASICO.purchaseCap!)}). Si compras más o usas más de un usuario o local, Pro {money(A.w.settings.plans.PRO.price)}.</span></div></div>
        </Card>
      </div>
    </Screen>
  );
}

function createBuyer(A: AppCtx): boolean {
  const R = regGet(A);
  const userId = 'u-' + uid(), orgId = 'org-' + uid();
  const r = A.act('USER_REGISTER', { userId, orgId, role: 'BUYER', phone: R.phone, name: R.name, lang: A.dev.pre?.lang ?? 'es', org: { ruc: R.ruc, legalName: R.legalName, name: R.bizName, district: R.district, address: R.address, receiver: R.name, businessType: R.businessType } }, { as: userId });
  if (!r.ok) return false;
  A.act('CONSENTS_ACCEPT', { version: '1.0', items: R.consents ?? { distrito: true, dni: true } }, { as: userId, quiet: true });
  A.patch(d => { d.userId = userId; d.flow = { ...d.flow, reg: { ...(d.flow.reg ?? {}), userId, orgId } }; });
  A.toast('¡Cuenta creada! Tu primer mes es gratis. Verifica tu negocio para hacer pedidos.', 'ok');
  return true;
}

/* ---------- A-17 (nivel) y B-04 · Verificación por niveles ---------- */
interface VItem { key: string; level: number; title: string; sub: string; auto?: (o: Org) => boolean; kind?: string; optional?: boolean }
const FARMER_ITEMS: VItem[] = [
  { key: 'dni', level: 1, title: 'Identidad', sub: 'DNI y selfie', kind: 'dni' },
  { key: 'cobro', level: 1, title: 'Cobro y zonas', sub: 'Cuenta propia o autorizada y zonas de entrega', auto: (o) => (o.payout.length > 0 || o.acceptsCash) && o.serviceAreas.length > 0 },
  { key: 'padron', level: 2, title: 'Prueba de producción', sub: 'Padrón de Productores Agrarios o constancia de tu comunidad', kind: 'dni' },
  { key: 'chacra', level: 2, title: 'Chacra con fotos', sub: '3 fotos tomadas en la app, en la chacra', kind: 'chacra' },
  { key: 'ruc', level: 3, title: 'RUC activo', sub: 'Nuevo RUS especial o régimen especial: lo validamos con la SUNAT', kind: 'dni' },
  { key: 'cert', level: 3, title: 'Certificaciones', sub: 'Opcional: orgánico o buenas prácticas agrícolas', optional: true, kind: 'dni' },
];
const BUYER_ITEMS: VItem[] = [
  { key: 'ruc', level: 1, title: 'RUC activo y habido', sub: 'Validado con la SUNAT al registrarte', auto: (o) => !!o.ruc },
  { key: 'dni', level: 1, title: 'Representante', sub: 'DNI y selfie del representante', kind: 'dni' },
  { key: 'licencia', level: 2, title: 'Licencia de funcionamiento', sub: 'Foto o PDF de la licencia municipal', kind: 'dni' },
  { key: 'local', level: 2, title: 'Foto del local con ubicación', sub: 'Tómala en la puerta del local con la app', kind: 'local' },
  { key: 'ficha', level: 2, title: 'Ficha RUC', sub: 'Con actividad compatible (restaurante, hotel...)', kind: 'dni' },
  { key: 'pagos', level: 3, title: 'Pagos puntuales', sub: 'Historial sin atrasos y método de pago validado', auto: (o) => o.counters.completedPurchases >= 20 },
];

export function caseFor(A: AppCtx, orgId: string, level: number): VerifCase | undefined {
  return Object.values(A.w.cases).filter(k => k.orgId === orgId && k.targetLevel === level).sort((a, b) => b.submittedAt - a.submittedAt)[0];
}
const CASE_LABEL: Record<VerifCase['status'], { l: string; tone: string }> = { SUBMITTED: { l: 'En revisión', tone: 'warn' }, IN_REVIEW: { l: 'En revisión', tone: 'warn' }, NEEDS_INFO: { l: 'Observado', tone: 'danger' }, APPROVED: { l: 'Aprobado', tone: 'leaf' }, REJECTED: { l: 'Rechazado', tone: 'danger' }, APPEALED: { l: 'Apelado', tone: 'warn' } };

function Verification() {
  const A = useApp();
  const org = A.org!;
  const isBuyer = org.type === 'BUYER';
  const items = isBuyer ? BUYER_ITEMS : FARMER_ITEMS;
  const lim = isBuyer ? buyerLimit(A.w.settings, org.level) : farmerLimit(A.w.settings, org.level);
  const nextLim = isBuyer ? buyerLimit(A.w.settings, Math.min(3, org.level + 1)) : farmerLimit(A.w.settings, Math.min(3, org.level + 1));
  const today = isBuyer
    ? (org.level === 0 ? 'Hoy (nivel 0): puedes ver el catálogo, pero no hacer pedidos.' : `Hoy (nivel ${org.level}): hasta ${money(lim.perOrder)} por pedido${lim.monthly ? ` y ${money(lim.monthly)} al mes` : ''}${lim.prepay ? ', pagando antes de la entrega' : ''}.${org.level < 3 ? ` Nivel ${org.level + 1}: ${money(nextLim.perOrder)} por pedido${nextLim.cash ? ' y puedes pagar al recibir' : ''}.` : ''}`)
    : (org.level === 0 ? 'Hoy (nivel 0): puedes explorar, pero no publicar todavía.' : `Hoy (nivel ${org.level} · ${LEVEL_NAME[org.level]}): hasta ${lim.listings ?? 'sin tope de'} publicaciones${lim.monthly ? ` y ${money(lim.monthly)} al mes` : ''}, con tope de ${money(lim.perOrder)} por pedido.`);
  const submit = (level: number) => A.sheet(<SubmitLevel level={level} items={items.filter(i => i.level === level && !i.auto && !i.optional)} orgId={org.id} />);
  return (
    <Screen title={isBuyer ? 'Verifica tu negocio' : 'Tu verificación'} sub={org.name}>
      <div className="stack">
        <Card tone="dark">
          <div className="row between cap" style={{ fontWeight: "900", letterSpacing: ".08em" }}>{[0, 1, 2, 3].map(l => <span key={l} style={{ color: l <= org.level ? '#97BC62' : '#cfe0c1', opacity: l <= org.level ? 1 : .7 }}>NIVEL {l}</span>)}</div>
          <div className="prog leaf mt" style={{ background: "rgba(255,255,255,.15)" }}><i style={{ width: `${(org.level / 3) * 100}%` }} /></div>
          <p className="bodym" style={{ margin: ".6em 0 0" }}>{today}</p>
        </Card>
        <Card>
          <div className="list">
            {items.map(it => {
              const k = caseFor(A, org.id, it.level);
              const has = k?.evidence.some(e => e.key === it.key);
              const done = org.level >= it.level || (it.auto && it.auto(org));
              const st = !done && has && k ? CASE_LABEL[k.status] : undefined;
              return (
                <div key={it.key} className="row top" style={{ padding: ".6em 0" }}>
                  <span className={'icirc ' + (done ? 'dark' : st?.tone === 'danger' ? 'danger' : st ? 'warn' : '')} style={{ width: "1.9em", height: "1.9em" }}>{done ? <Icon n="check" s="1em" w={3} /> : st ? <Icon n={st.tone === 'danger' ? 'triangle-alert' : 'clock'} s="1em" /> : null}</span>
                  <div className="grow"><b className="bodym">{it.title} · nivel {it.level}</b><div className="cap">{it.sub}</div>{st && k?.decision?.reason && k.status !== 'APPROVED' && <div className="cap bad">{k.decision.reason}</div>}</div>
                  {!done && (st ? <Chip tone={st.tone}>{st.l}</Chip> : it.optional ? <Chip tone="terra">Opcional</Chip> : it.auto ? <Chip tone="ghost">Automático</Chip> : <button className="chip terra" style={{ minHeight: "2.4em" }} onClick={() => submit(it.level)}>Subir</button>)}
                </div>
              );
            })}
          </div>
        </Card>
        {[1, 2, 3].map(l => {
          const k = caseFor(A, org.id, l);
          if (!k) return null;
          return (
            <Card key={l} tone={k.status === 'REJECTED' || k.status === 'NEEDS_INFO' ? 'danger' : k.status === 'APPROVED' ? 'soft' : 'warn'}>
              <div className="row between"><b className="bodym">Expediente del nivel {l}</b><Chip tone={CASE_LABEL[k.status].tone}>{CASE_LABEL[k.status].l}</Chip></div>
              <div className="cap mt">Enviado el {dateShort(k.submittedAt)} {hhmm(k.submittedAt)}{k.decision ? ` · ${k.decision.reason || 'sin observaciones'}` : ''}</div>
              {k.status === 'REJECTED' && !k.appealed && <div className="mt"><Btn sm kind="sec" onClick={() => { const r = A.act('VERIF_APPEAL', { caseId: k.id, text: 'Pido que otra persona revise mi expediente.' }, { ok: 'Apelación enviada: la revisa otra persona.' }); void r; }}>Apelar una vez</Btn></div>}
              {k.status === 'NEEDS_INFO' && <div className="mt"><Btn sm kind="dark" onClick={() => A.sheet(<SubmitLevel level={l} items={items.filter(i => i.level === l && !i.auto && !i.optional)} orgId={org.id} respond={k.id} />)}>Enviar lo que falta</Btn></div>}
            </Card>
          );
        })}
        <p className="cap" style={{ margin: "0" }}>{isBuyer ? 'Revisamos cada documento en 48 h. Tu membresía no cambia con el nivel: el nivel solo sube tus topes de compra.' : 'Una persona del equipo revisa cada documento y responde en 48 h. Si algo falta, te avisamos por WhatsApp.'}</p>
      </div>
    </Screen>
  );
}

function SubmitLevel({ level, items, orgId, respond }: { level: number; items: VItem[]; orgId: string; respond?: string }) {
  const A = useApp();
  const [ph, setPh] = useState<Record<string, string | undefined>>({});
  const [doc, setDoc] = useState('');
  const ready = items.every(i => ph[i.key]);
  const send = () => {
    const evidence: Evidence[] = items.map(i => ({ key: i.key, label: i.title, detail: i.key === 'padron' && doc ? `N.º ${doc}` : i.sub, photoId: ph[i.key] }));
    const r = respond
      ? A.act('VERIF_RESPOND', { caseId: respond, evidence, text: 'Envié lo que faltaba' }, { ok: 'Enviado. Lo revisamos en 48 h.' })
      : A.act('VERIF_SUBMIT', { caseId: 'case-' + uid(), orgId, targetLevel: level, evidence }, { ok: 'Recibimos tus documentos. Una persona los revisa en 48 h.' });
    if (r.ok) A.sheet(null);
  };
  return (
    <SheetBody title={`Documentos para el nivel ${level}`} sub="Toma las fotos con la app. Solo las ve el equipo de verificación.">
      {items.map(i => (
        <div key={i.key} className="stack tight">
          <div className="lbl">{i.title}</div>
          {i.key === 'padron' && <Inp value={doc} onInput={setDoc} placeholder="N.º de constancia (opcional)" label="Número de constancia" />}
          <PhotoPick value={ph[i.key]} onChange={(v) => setPh({ ...ph, [i.key]: v })} label={i.title} kind={i.kind ?? 'dni'} />
        </div>
      ))}
      <Btn full kind="dark" disabled={!ready} why="Agrega una foto de cada documento" onClick={send}>Enviar a verificación</Btn>
    </SheetBody>
  );
}

reg('A-00', Splash);
reg('A-01', Welcome);
reg('A-01P', ChooseRole);
reg('LOGIN', LoginType);
reg('LOGIN-F', LoginForm);
reg('A-02', Phone);
reg('A-03', Otp);
reg('A-04', Consents);
reg('A-05', Identity);
reg('A-06', Payout);
reg('A-07', Zones);
reg('B-02', BuyerBusiness);
reg('B-04', Verification, { nav: true, tab: 'B-20' });
reg('A-17V', Verification, { nav: true, tab: 'A-20' });

export { Verification, fmtPhone, districtOptions };
void Kv; void Timeline; void PROVINCES;
