/*
 * Las tres caras de Mesagri, según la dirección:
 *   /        la app (agricultor, comprador MYPE, almacén o transportista): pantalla de inicio,
 *            ingreso con celular y código según el tipo de usuario, y la sesión se recuerda
 *   /panel   el panel web del equipo (correo, contraseña y doble factor)
 *   /demo    el escenario de la demo: varios celulares y el panel en una pantalla, con el reloj
 *            simulado, la señal de cada celular y la guía de prueba
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MEvent } from '@mesagri/shared/types';
import { Store, type Mode } from './store';
import { loadUi, saveUi } from './persist';
import { serverPhotos, localPhotos } from './photos';
import { LOCAL, modeFromLocation, appUrl } from './routes';
import { auth, setTeamKey } from './net';
import { Device } from './shell';
import type { DeviceState, AppCtx } from './ctx';
import { Icon, Av, Btn } from './ui/kit';
import { Logo, BrandRow } from './ui/brand';
import { SplashView } from './screens/onboarding';
import { PERSONAS } from '@mesagri/shared/seed';
import { homeFor } from './screens/registry';
import { hhmm, dateShort } from '@mesagri/shared/format';
import { HOUR, DAY, lima, limaTime } from '@mesagri/shared/time';
import { Guide } from './guide';
import { liveSub } from './helpers';
import { structuredCloneSafe, seedWorld } from '@mesagri/shared/engine/index';

export interface UiState {
  mode: 'phones' | 'web';
  count: number;
  active: string;
  showIds: boolean;
  devices: DeviceState[];
  guide: boolean;
}

export function modeFromPath(): Mode {
  return modeFromLocation();
}

const MODE = modeFromPath();
const UI_KEY = MODE === 'stage' ? 'mesagri.v2.ui' : MODE === 'app' ? 'mesagri.v2.app' : 'mesagri.v2.panel';

const dev = (id: string, userId: string | undefined, kind: 'phone' | 'web' = 'phone'): DeviceState => ({ id, kind, userId, stack: [], online: true, outbox: [], cart: [], flow: {} });
export function defaultUi(): UiState {
  const wide = typeof window !== 'undefined' ? window.innerWidth : 1400;
  if (MODE === 'app') return { mode: 'phones', count: 1, active: 'app', showIds: false, guide: false, devices: [{ ...dev('app', undefined), stack: [{ s: 'A-01' }] }] };
  if (MODE === 'panel') return { mode: 'web', count: 1, active: 'web', showIds: false, guide: false, devices: [{ ...dev('web', undefined, 'web'), stack: [{ s: 'W-01' }] }] };
  return {
    mode: 'phones', count: wide >= 1320 ? 3 : 2, active: 'd1', showIds: false, guide: false,
    devices: [dev('d1', 'u-wilber'), dev('d2', 'u-charo'), dev('d3', 'u-julio'), dev('web', 'u-gaby', 'web')],
  };
}

const store = new Store(MODE);
const photos = LOCAL ? localPhotos() : serverPhotos(store);
// fuera del escenario, la copia del mundo se pide con la sesión de quien usa el celular o el panel
if (MODE !== 'stage') store.viewerUserId = loadUi(defaultUi(), UI_KEY).devices[0]?.userId;
void store.start();
try { document.title = MODE === 'panel' ? 'Mesagri · Panel de administración' : MODE === 'stage' ? 'Mesagri · Demo del piloto' : 'Mesagri'; } catch { /* sin documento */ }
/** Momento en que se abrió la app: la pantalla de inicio (A-00) se ve al menos un instante. */
const OPENED = Date.now();

function useMedia(q: string) {
  const get = () => { try { return window.matchMedia(q).matches; } catch { return false; } };
  const [m, setM] = useState(get);
  useEffect(() => {
    try { const mq = window.matchMedia(q); const f = () => setM(mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); } catch { return undefined; }
  }, [q]);
  return m;
}

export function Stage() {
  const [ui, setUiRaw] = useState<UiState>(() => {
    const u = loadUi(defaultUi(), UI_KEY);
    // los celulares que estaban sin señal vuelven en línea al recargar (y envían lo pendiente)
    u.devices = u.devices.map(d => ({ ...d, online: true, snapshot: undefined }));
    return u;
  });
  const [version, setVersion] = useState(store.version);
  const [, setTick] = useState(0);
  const [panel, setPanel] = useState<null | 'clock' | 'menu' | 'persona'>(null);
  const [pickFor, setPickFor] = useState<string>('');
  const [busy, setBusy] = useState('');
  const apis = useRef<Record<string, { toast: AppCtx['toast'] }>>({});
  const solo = useMedia('(max-width: 820px)') || MODE !== 'stage';
  // A-00: la app abre con la pantalla de inicio (logo de Mesagri) mientras conecta y recupera la sesión
  const [boot, setBoot] = useState(MODE === 'app');
  useEffect(() => { if (!boot) return; const t = setTimeout(() => setBoot(false), Math.max(0, 1300 - (Date.now() - OPENED))); return () => clearTimeout(t); }, []);
  const uiRef = useRef(ui);
  uiRef.current = ui;

  const setUi = (fn: (u: UiState) => UiState) => setUiRaw(prev => { const n = fn(prev); saveUi({ ...n, devices: n.devices.map(d => ({ ...d, snapshot: undefined })) }, UI_KEY); return n; });

  useEffect(() => store.subscribe(() => setVersion(store.version)), []);
  // reloj: refresca cuando cambia el minuto o vence un plazo
  useEffect(() => {
    let lastMin = Math.floor(store.now() / 60_000);
    const t = setInterval(() => {
      if (!store.ready) return;
      const m = Math.floor(store.now() / 60_000);
      if (m !== lastMin || store.stale()) { lastMin = m; setTick(x => x + 1); }
    }, 2000);
    return () => clearInterval(t);
  }, []);
  // rechazos del servidor (dos personas compraron lo mismo, sesión vencida...) y reinicios
  useEffect(() => {
    store.onLateReject = (e: MEvent, err) => {
      const api = (e.device ? apis.current[e.device] : undefined) ?? apis.current[uiRef.current.active];
      api?.toast(`No se pudo completar: ${err.message}`, 'err');
    };
    store.onReset = () => {
      setUi(u => ({ ...u, devices: defaultUi().devices }));
      setPanel(null);
      // los celulares se vuelven a armar con la época nueva: el aviso va al que está a la vista
      setTimeout(() => { const id = uiRef.current.active; (apis.current[id] ?? Object.values(apis.current)[0])?.toast('Listo: datos de ejemplo de nuevo.', 'info'); }, 120);
    };
  }, []);
  // fuera del escenario: al ingresar o salir cambia lo que el servidor le manda a este celular
  const soloUser = MODE !== 'stage' ? ui.devices[0]?.userId : undefined;
  useEffect(() => { if (MODE !== 'stage') store.setViewer(soloUser); }, [soloUser]);
  // fuera del escenario: si la sesión ya no existe, se vuelve al ingreso
  useEffect(() => {
    if (MODE === 'stage' || !store.ready) return;
    const d = uiRef.current.devices[0];
    if (d?.userId && !store.sessions.has(d.userId)) patchDev(d.id, x => { x.userId = undefined; x.stack = [{ s: MODE === 'panel' ? 'W-01' : 'A-01' }]; x.flow = {}; x.cart = []; });
  }, [store.ready, store.epoch]);
  // lo que quedó sin enviar de la sesión anterior (celulares simulados sin señal)
  useEffect(() => {
    if (!store.ready) return;
    for (const d of uiRef.current.devices) if (d.outbox.length) flush(d.id);
  }, [store.ready]);

  const patchDev = (id: string, fn: (d: DeviceState) => void) => setUi(u => ({ ...u, devices: u.devices.map(d => { if (d.id !== id) return d; const c: DeviceState = { ...d, stack: [...d.stack], outbox: [...d.outbox], cart: [...d.cart], flow: { ...d.flow } }; fn(c); return c; }) }));

  function flush(id: string) {
    const d = uiRef.current.devices.find(x => x.id === id);
    if (!d) return;
    let sent = 0;
    for (const e of d.outbox) {
      const r = store.commit({ ...e, t: store.now() });
      if (r.ok) sent++; else apis.current[id]?.toast(`No se pudo enviar: ${r.error?.message}`, 'err');
    }
    patchDev(id, x => { x.outbox = []; x.snapshot = undefined; x.online = true; });
    if (sent) apis.current[id]?.toast(`Volvió la señal: se envió ${sent === 1 ? '1 acción pendiente' : `${sent} acciones pendientes`}.`, 'ok');
  }
  const setOnline = (id: string, on: boolean) => {
    if (on) { flush(id); return; }
    patchDev(id, x => { x.online = false; x.snapshot = structuredCloneSafe(store.view()); });
  };

  const advance = async (ms: number) => {
    setPanel(null);
    setBusy('Adelantando el reloj…');
    try { await store.advanceClock(ms); } catch (e: any) { apis.current[ui.active]?.toast(e?.message ?? 'No se pudo adelantar el reloj.', 'err'); }
    setBusy('');
  };
  const toNextDay = (day: number) => {
    const p = lima(store.now());
    let target = limaTime(p.y, p.m, day, 8, 0);
    if (target <= store.now()) target = limaTime(p.m === 12 ? p.y + 1 : p.y, p.m === 12 ? 1 : p.m + 1, day, 8, 0);
    void advance(target - store.now());
  };

  const resetDevices = () => setUi(u => ({ ...u, devices: defaultUi().devices }));
  const resetAll = async () => {
    setPanel(null);
    setBusy('Reiniciando la demo…');
    try { await store.resetDemo(); resetDevices(); } catch (e: any) { apis.current[ui.active]?.toast(e?.message ?? 'No se pudo reiniciar.', 'err'); }
    setBusy('');
  };

  const pickPersona = (devId: string, userId?: string) => {
    patchDev(devId, d => {
      d.userId = userId;
      const u = userId ? store.view().users[userId] : undefined;
      d.stack = [{ s: u ? homeFor(u) : (d.kind === 'web' ? 'W-01' : 'A-00') }];
      d.flow = {}; d.cart = d.userId === userId ? d.cart : [];
    });
    setPanel(null);
  };

  if (store.outdated) return <Outdated o={store.outdated} />;
  if (store.needTeam && MODE === 'stage') return <TeamGate onOk={() => { void store.retryTeam(); }} />;
  if (!store.ready || boot) return MODE === 'app' ? <div className="stage solo appmode boot"><div className="sbody"><div className="ph"><div className="ph-in"><SplashView text={store.ready ? '' : (store.problem || (Date.now() - OPENED > 2500 ? (LOCAL ? 'Preparando Mesagri en tu celular…' : 'Conectando con el servidor de Mesagri…') : ''))} /></div></div></div></div> : <Connecting text={store.problem} />;

  const now = store.now();
  const w = store.view();
  const phones = ui.devices.filter(d => d.kind === 'phone');
  const web = ui.devices.find(d => d.kind === 'web');

  const deviceEl = (d: DeviceState) => (
    <Device key={d.id + ':' + store.epoch} dev={d} store={store} photos={photos} version={version} showIds={ui.showIds} onPatch={patchDev} register={(id, api) => { apis.current[id] = api; }} />
  );

  // Celular real o panel del equipo: una sola pantalla, sin los controles de la demo
  if (MODE !== 'stage') {
    const d = ui.devices[0];
    return (
      <div className={'stage solo' + (MODE === 'panel' ? ' panelmode' : ' appmode')}>
        <ServerBar />
        <div className="sbody">
          <div className={'ph' + (d.kind === 'web' ? ' web' : '')}><div className="ph-in">{deviceEl(d)}</div></div>
        </div>
      </div>
    );
  }

  const personaLabel = (d: DeviceState) => {
    const p = PERSONAS.find(x => x.userId === d.userId);
    const u = d.userId ? w.users[d.userId] : undefined;
    const o = u ? w.orgs[u.orgId] : undefined;
    const sub = p ? liveSub(w, p) : u ? ({ FARMER: 'Agricultor', BUYER: 'Comprador MYPE', CARRIER: 'Transportista', WAREHOUSE: 'Almacén aliado', ADMIN: 'Panel web' } as any)[u.role] + (o && (u.role === 'FARMER' || u.role === 'BUYER') ? ` · nivel ${o.level}` : '') : 'Registro o ingreso';
    return { title: p?.label ?? u?.name ?? 'Sin sesión', sub, org: u ? w.orgs[u.orgId] : undefined };
  };

  const phoneSlot = (d: DeviceState) => {
    const pl = personaLabel(d);
    const top = d.stack[d.stack.length - 1]?.s ?? '';
    const waiting = d.userId ? store.waiting(d.userId) : 0;
    return (
      <div className="slot" key={d.id}>
        <div className="slothead">
          <button className="pick" onClick={() => { setPickFor(d.id); setPanel('persona'); }} aria-label={`Cambiar de persona en el celular (${pl.title})`}>
            {pl.org ? <Av org={pl.org} /> : <span className="av" style={{ background: "#5B6B57" }}><Icon n="user" s="1.1em" /></span>}
            <span className="pl">{pl.title}<small>{pl.sub}</small></span>
            <Icon n="chevron-down" s="1em" />
          </button>
          <button className={'iconbtn' + (d.online ? '' : ' off')} onClick={() => setOnline(d.id, !d.online)} aria-label={d.online ? 'Quitar la señal a este celular' : 'Devolver la señal'} title={d.online ? 'Con señal (toca para simular sin señal)' : `Sin señal · ${d.outbox.length} por enviar`}><Icon n={d.online ? 'wifi' : 'wifi-off'} s="1.2em" /></button>
        </div>
        <div className="ph">
          <div className="ph-in">
            <div className="ph-status"><span>{hhmm(now)}</span><span className="isl" /><span className="sig">{d.online && store.status === 'online' ? <><Icon n="signal" s="1em" w={2.6} /><Icon n="wifi" s="1em" w={2.6} /></> : <Icon n="wifi-off" s="1em" w={2.6} />}</span></div>
            {deviceEl(d)}
          </div>
        </div>
        {(ui.showIds || waiting > 0) && <div className="slotfoot">{ui.showIds && <>Pantalla <code>{top}</code></>}{!d.online && <span>· sin señal · {d.outbox.length} por enviar</span>}{waiting > 0 && <span> · enviando {waiting}…</span>}</div>}
      </div>
    );
  };

  const shownPhones = phones.slice(0, ui.count);
  const activeDev = ui.devices.find(d => d.id === ui.active) ?? phones[0];

  const guideEl = <Guide store={store} ui={ui} onGo={(devId, userId, s, p) => {
    setUi(u => ({ ...u, active: devId, guide: solo ? false : u.guide, mode: devId === 'web' ? 'web' : 'phones', count: devId === 'd3' ? 3 : devId === 'd2' ? Math.max(u.count, 2) : u.count }));
    patchDev(devId, d => {
      const u = userId ? store.view().users[userId] : undefined;
      if (d.userId !== u?.id) { d.userId = u?.id; d.cart = []; d.flow = {}; }
      const home = u ? homeFor(u) : (d.kind === 'web' ? 'W-01' : 'A-01');
      const target = s ?? home;
      d.stack = target === home ? [{ s: home }] : [{ s: home }, { s: target, p }];
    });
  }} onClose={() => setUi(u => ({ ...u, guide: false }))} />;

  const clockBox = (
    <div className="sclock" aria-label="Reloj de la demo">
      <Icon n="clock" s="16" />
      <span className="t">{dateShort(now)} · {hhmm(now)}</span>
      <button className="sbtn" style={{ minHeight: "30px", padding: "0 10px" }} onClick={() => setPanel(panel === 'clock' ? null : 'clock')} aria-expanded={panel === 'clock' ? 'true' : 'false'}><Icon n="fast-forward" s="15" />Adelantar</button>
    </div>
  );

  return (
    <div className={'stage' + (solo ? ' solo' : '')}>
      <header className="sbar">
        <div className="sbrand"><BrandRow sub="Demo del piloto · varios celulares y el panel" size={34} /></div>
        {!solo && clockBox}
        {!solo && (
          <div className="stabs" role="tablist" aria-label="Vista">
            <button role="tab" className={ui.mode === 'phones' ? 'on' : ''} aria-selected={ui.mode === 'phones' ? 'true' : 'false'} onClick={() => setUi(u => ({ ...u, mode: 'phones' }))}><Icon n="smartphone" s="15" /> Celulares</button>
            <button role="tab" className={ui.mode === 'web' ? 'on' : ''} aria-selected={ui.mode === 'web' ? 'true' : 'false'} onClick={() => setUi(u => ({ ...u, mode: 'web' }))}><Icon n="monitor" s="15" /> Panel web</button>
          </div>
        )}
        {!solo && ui.mode === 'phones' && (
          <div className="stabs" aria-label="Cuántos celulares">
            {[1, 2, 3].map(n => <button key={n} className={ui.count === n ? 'on' : ''} onClick={() => setUi(u => ({ ...u, count: n }))} aria-label={`${n} celulares`}>{n}</button>)}
          </div>
        )}
        {solo && (
          <div className="stabs" style={{ overflowX: "auto", maxWidth: "calc(100vw - 150px)" }}>
            {[...phones, ...(web ? [web] : [])].map(d => { const pl = personaLabel(d); return <button key={d.id} className={ui.active === d.id ? 'on' : ''} onClick={() => setUi(u => ({ ...u, active: d.id }))} aria-label={pl.title}>{d.kind === 'web' ? <Icon n="monitor" s="15" /> : (pl.org?.initials ?? '··')}</button>; })}
          </div>
        )}
        <span className="sgrow" />
        <span className={'sdot ' + store.status} title={store.status === 'online' ? 'Conectado al servidor' : 'Sin conexión con el servidor'} aria-label={store.status === 'online' ? 'Conectado al servidor' : 'Sin conexión con el servidor'} />
        {!solo && <button className={'sbtn' + (ui.guide ? ' on' : '')} onClick={() => setUi(u => ({ ...u, guide: !u.guide, count: !u.guide && u.count === 3 && window.innerWidth < 1700 ? 2 : u.count }))}><Icon n="book-open" s="15" />Guía de prueba</button>}
        {!solo && <button className={'sbtn' + (ui.showIds ? ' on' : '')} onClick={() => setUi(u => ({ ...u, showIds: !u.showIds }))} title="Mostrar el identificador de cada pantalla del documento (15.6)">IDs</button>}
        {!solo && <button className="sbtn" onClick={() => setPanel('menu')} aria-label="Más opciones"><Icon n="ellipsis-vertical" s="16" /></button>}
        {solo && <button className="sbtn" onClick={() => setPanel('menu')} aria-label="Menú de la demo"><Icon n="menu" s="16" /><span className="lbl">Demo</span></button>}
      </header>

      <ServerBar />
      {busy && <div className="card soft" style={{ margin: "10px 16px 0", borderRadius: "12px" }}><div className="row"><i className="spin dark" /><span className="bodym">{busy}</span></div></div>}

      <div className="sbody">
        {solo ? (
          activeDev.kind === 'web'
            ? <div className="ph web"><div className="ph-in">{deviceEl(activeDev)}</div></div>
            : <div className="ph" key={activeDev.id}><div className="ph-in">{deviceEl(activeDev)}</div></div>
        ) : ui.mode === 'web' && web ? (
          <div className="ph web"><div className="ph-in">{deviceEl(web)}</div></div>
        ) : shownPhones.map(phoneSlot)}
        {ui.guide && (solo ? <div className="veil mid" style={{ position: "fixed", zIndex: "200", alignItems: "flex-start", paddingTop: "12px" }} onClick={(e) => { if (e.target === e.currentTarget) setUi(u => ({ ...u, guide: false })); }}>{guideEl}</div> : guideEl)}
      </div>

      {panel && <StagePanel kind={panel} onClose={() => setPanel(null)} ui={ui} solo={solo} now={now}
        clock={{ advance: (ms) => { void advance(ms); }, toNextDay }}
        persona={{ devId: pickFor, pick: pickPersona }}
        actions={{ resetAll: () => { void resetAll(); }, toggleIds: () => setUi(u => ({ ...u, showIds: !u.showIds })), setOnline: (on) => setOnline(ui.active, on), activeOnline: activeDev.online, outbox: activeDev.outbox.length, openGuide: () => { setUi(u => ({ ...u, guide: true })); setPanel(null); }, pickActive: () => { setPickFor(ui.active); setPanel('persona'); } }}
        w={w} />}
    </div>
  );
}

/** El escenario de varios celulares es del equipo: en la nube pide la clave del equipo una vez. */
function TeamGate({ onOk }: { onOk: () => void }) {
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!key.trim()) { setErr('Escribe la clave del equipo.'); return; }
    setBusy(true); setErr('');
    try {
      await auth.team(key.trim());
      setTeamKey(key.trim());
      onOk();
    } catch (e: any) {
      setErr(e?.code === 'TEAM_KEY' ? 'Esa no es la clave del equipo. Revísala en la configuración del servidor (TEAM_KEY).' : (e?.message ?? 'No pudimos comprobar la clave.'));
    } finally { setBusy(false); }
  };
  return (
    <div className="connecting" role="dialog" aria-label="Clave del equipo">
      <form className="stack" style={{ alignItems: 'stretch', gap: '14px', maxWidth: '420px', width: '100%' }} onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <div style={{ alignSelf: 'center' }}><Logo big /></div>
        <h1 className="h2" style={{ margin: 0, textAlign: 'center' }}>Escenario de la demo</h1>
        <p className="bodym" style={{ margin: 0, textAlign: 'center' }}>Aquí se ven varios celulares y el panel a la vez, con los datos de todas las cuentas. Es solo para el equipo que presenta Mesagri.</p>
        <label className="fld"><span className="lbl">Clave del equipo</span><input className="inp" type="password" autoComplete="current-password" value={key} onChange={(e) => { setKey(e.currentTarget.value); setErr(''); }} /></label>
        {err && <div className="errt" role="alert"><Icon n="circle-alert" s="16" />{err}</div>}
        <Btn full kind="dark" type="submit" disabled={busy}>{busy ? <i className="spin" /> : null}Entrar al escenario</Btn>
        <a className="linkbtn" href={appUrl()} style={{ alignSelf: 'center' }}>¿Quieres probar la app? Ábrela aquí</a>
      </form>
    </div>
  );
}

/** Aviso de conexión con el servidor (el trabajo sigue: lo pendiente se envía al volver). */
function ServerBar() {
  const [, setV] = useState(0);
  useEffect(() => store.subscribe(() => setV(x => x + 1)), []);
  if (store.status !== 'offline') return null;
  const n = store.waiting();
  return (
    <div className="card warn" role="status" style={{ margin: "10px 16px 0", borderRadius: "12px" }}>
      <div className="row"><Icon n="wifi-off" /><span className="bodym grow">Sin conexión con el servidor de Mesagri. {n ? `${n} ${n === 1 ? 'acción espera' : 'acciones esperan'} y se enviarán solas al volver.` : 'Lo que hagas se guarda y se envía al volver.'}</span></div>
    </div>
  );
}

/* El servidor que respondió es de otra versión que esta app: en vez de pantallas que fallan, qué hacer. */
function Outdated({ o }: { o: { server: number; client: number } }) {
  const serverOld = o.server < o.client;
  return (
    <div className="connecting" role="alert">
      <div className="stack" style={{ alignItems: 'center', gap: '16px', maxWidth: '440px' }}>
        <Logo big />
        <h1 className="h2" style={{ margin: 0 }}>{serverOld ? 'Falta reiniciar Mesagri' : 'Hay una versión nueva de Mesagri'}</h1>
        {serverOld ? (
          <>
            <p className="bodym" style={{ margin: 0 }}>Instalaste la versión nueva, pero sigue abierto el servidor de la versión anterior. Ciérralo y ábrelo otra vez:</p>
            <ol className="bodym" style={{ textAlign: 'left', margin: 0, paddingLeft: '1.3em', lineHeight: 1.6 }}>
              <li>Doble clic en <b>«Mesagri (detener)»</b> en el escritorio (o <b>DETENER.cmd</b> en la carpeta de Mesagri).</li>
              <li>Doble clic en <b>«Mesagri (iniciar)»</b> (o <b>INICIAR.cmd</b>).</li>
              <li>Vuelve a esta página y toca «Volver a intentar».</li>
            </ol>
          </>
        ) : <p className="bodym" style={{ margin: 0 }}>El servidor ya se actualizó. Vuelve a cargar la página para usar la versión nueva.</p>}
        <Btn kind="primary" icon="refresh-cw" onClick={() => { try { window.location.reload(); } catch { /* sin ventana */ } }}>{serverOld ? 'Volver a intentar' : 'Volver a cargar'}</Btn>
        <small style={{ opacity: .7 }}>Versión de la app {o.client} · versión del servidor {o.server}</small>
      </div>
    </div>
  );
}

function Connecting({ text }: { text: string }) {
  return (
    <div className="connecting" role="status" aria-live="polite">
      <div className="stack" style={{ alignItems: "center", gap: "18px" }}>
        <Logo big />
        <i className="spin" style={{ width: "2em", height: "2em", border: "3px solid rgba(151,188,98,.35)", borderTopColor: "#97BC62", borderRadius: "99px", display: "block", animation: "spin .9s linear infinite" }} />
        <span className="bodym">{text || 'Conectando con el servidor…'}</span>
      </div>
    </div>
  );
}

function StagePanel(p: {
  kind: 'clock' | 'menu' | 'persona'; onClose: () => void; ui: UiState; solo: boolean; now: number; w: any;
  clock: { advance: (ms: number) => void; toNextDay: (d: number) => void };
  persona: { devId: string; pick: (devId: string, userId?: string) => void };
  actions: { resetAll: () => void; toggleIds: () => void; setOnline: (on: boolean) => void; activeOnline: boolean; outbox: number; openGuide: () => void; pickActive: () => void };
}) {
  const [sure, setSure] = useState(false);
  const groups = useMemo(() => {
    const g: Record<string, typeof PERSONAS> = {};
    for (const x of PERSONAS) (g[x.group] ??= []).push(x);
    return g;
  }, []);
  const devKind = p.ui.devices.find(d => d.id === p.persona.devId)?.kind;
  const box = (title: string, body: any) => (
    <div className="veil mid" style={{ position: "fixed" }} onClick={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: "460px", fontSize: "15px" }}>
        <div className="row between" style={{ marginBottom: ".6em" }}><h2 className="h2" style={{ fontSize: "1.3em" }}>{title}</h2><button className="iconbtn" onClick={p.onClose} aria-label="Cerrar"><Icon n="x" s="1.1em" /></button></div>
        {body}
      </div>
    </div>
  );
  if (p.kind === 'clock') return box('Adelantar el reloj', (
    <div className="stack">
      <p className="bodym muted" style={{ margin: "0" }}>Ahora: {dateShort(p.now)} · {hhmm(p.now)} (hora de Lima). El reloj de la demo lo lleva el servidor y es el mismo para todos; adelántalo para ver vencer los plazos de las reglas.</p>
      <div className="grid2">
        {[[HOUR, '+1 hora'], [3 * HOUR, '+3 horas'], [12 * HOUR, '+12 horas', 'Vence un pedido sin respuesta (RN-08)'], [DAY, '+1 día', 'Vence una reserva sin respuesta (RN-43)'], [2 * DAY, '+48 horas', 'Conformidad automática (RN-11)'], [7 * DAY, '+1 semana', 'Se publican las calificaciones (RN-12)']].map(([ms, l, s]) => (
          <button key={String(l)} className="card line" onClick={() => p.clock.advance(Number(ms))} style={{ cursor: "pointer" }}><b>{l}</b>{s && <div className="cap">{s}</div>}</button>
        ))}
      </div>
      <div className="grid2">
        <button className="card soft" onClick={() => p.clock.toNextDay(1)}><b>Ir al día 1, 8:00</b><div className="cap">Cierre del mes: estados de cuenta (RN-40)</div></button>
        <button className="card soft" onClick={() => p.clock.toNextDay(11)}><b>Ir al día 11, 8:00</b><div className="cap">Cuentas vencidas: no publican (RN-40)</div></button>
      </div>
    </div>
  ));
  if (p.kind === 'persona') return box(devKind === 'web' ? '¿Quién entra al panel web?' : '¿Quién usa este celular?', (
    <div className="stack" style={{ maxHeight: "70vh", overflow: "auto" }}>
      {Object.entries(groups).filter(([g]) => devKind === 'web' ? g === 'Equipo Mesagri' : g !== 'Equipo Mesagri').map(([g, list]) => (
        <div key={g} className="stack tight">
          <div className="sect">{g}</div>
          {list.map(x => { const u = p.w.users[x.userId]; return u ? (
            <button key={x.userId} className="card" onClick={() => p.persona.pick(p.persona.devId, x.userId)}>
              <div className="row"><Av org={p.w.orgs[u.orgId]} /><div className="grow"><b className="bodym">{x.label}</b><div className="cap">{liveSub(p.w, x)}</div></div><Icon n="chevron-right" s="1.1em" /></div>
            </button>
          ) : null; })}
        </div>
      ))}
      {devKind !== 'web' && <>
        <div className="sect">Cuentas creadas en la demo</div>
        {Object.values(p.w.users as Record<string, any>).filter((u: any) => !seedWorld().users[u.id] && u.role !== 'ADMIN').slice(-8).reverse().map((u: any) => (
          <button key={u.id} className="card" onClick={() => p.persona.pick(p.persona.devId, u.id)}><div className="row"><Av org={p.w.orgs[u.orgId]} /><div className="grow"><b className="bodym">{u.name}</b><div className="cap">{p.w.orgs[u.orgId]?.name}</div></div></div></button>
        ))}
        <button className="card soft" onClick={() => p.persona.pick(p.persona.devId, undefined)}><div className="row"><span className="icirc dark"><Icon n="plus" /></span><div className="grow"><b className="bodym">Celular nuevo (registro)</b><div className="cap">Empieza desde la bienvenida: idioma, perfil, celular y código</div></div></div></button>
      </>}
      {devKind === 'web' && <button className="card soft" onClick={() => p.persona.pick(p.persona.devId, undefined)}><b className="bodym">Cerrar sesión del panel (W-01 · ingreso con doble factor)</b></button>}
    </div>
  ));
  // menú
  return box('Demo de Mesagri', (
    <div className="stack">
      {p.solo && <>
        <div className="card soft"><div className="row between"><b className="bodym">{dateShort(p.now)} · {hhmm(p.now)}</b><span className="cap">reloj de la demo</span></div>
          <div className="chips mt">{[[HOUR, '+1 h'], [12 * HOUR, '+12 h'], [DAY, '+1 día'], [2 * DAY, '+48 h']].map(([ms, l]) => <button key={String(l)} className="chip line" onClick={() => p.clock.advance(Number(ms))}>{l}</button>)}<button className="chip line" onClick={() => p.clock.toNextDay(1)}>Día 1</button><button className="chip line" onClick={() => p.clock.toNextDay(11)}>Día 11</button></div>
        </div>
        <button className="card soft" onClick={p.actions.openGuide}><div className="row"><span className="icirc dark"><Icon n="book-open" /></span><div className="grow"><b className="bodym">Guía de prueba</b><div className="cap">Recorridos paso a paso: compra, envío, almacén, verificación y reglas</div></div></div></button>
        <button className="card line" onClick={p.actions.pickActive}><div className="row"><span className="icirc"><Icon n="users" /></span><div className="grow"><b className="bodym">Cambiar de persona</b><div className="cap">Agricultor, MYPE, almacén, transportista o equipo</div></div></div></button>
        <button className="card line" onClick={() => p.actions.setOnline(!p.actions.activeOnline)}><div className="row"><span className={'icirc ' + (p.actions.activeOnline ? '' : 'danger')}><Icon n={p.actions.activeOnline ? 'wifi' : 'wifi-off'} /></span><div className="grow"><b className="bodym">{p.actions.activeOnline ? 'Simular sin señal' : `Devolver la señal (${p.actions.outbox} por enviar)`}</b><div className="cap">Lo que hagas sin señal se guarda y se envía solo (RNF-05)</div></div></div></button>
        <button className="card line" onClick={p.actions.toggleIds}><div className="row"><span className="icirc"><Icon n="tag" /></span><div className="grow"><b className="bodym">{p.ui.showIds ? 'Ocultar' : 'Mostrar'} los IDs de pantalla</b><div className="cap">Los de la sección 15.6 del documento</div></div></div></button>
      </>}
      <div className="card line">
        <div className="row"><span className="icirc"><Icon n="smartphone" /></span><div className="grow"><b className="bodym">La app y el panel por separado</b><div className="cap">En la misma red Wi-Fi abre la dirección de esta laptop: sola es la app de un celular (pantalla de inicio e ingreso con código) y con <b>/panel</b> es el panel del equipo. Todo se ve en vivo.</div></div></div>
      </div>
      <div className="card line">
        <b className="bodym">Reiniciar la demo</b>
        <p className="cap" style={{ margin: ".3em 0 .6em" }}>Vuelve al martes 3 de noviembre de 2026, 8:30, con los datos de ejemplo. Se borra en la base de datos lo que se hizo en la demo, para todos los que la usan.</p>
        {sure ? <div className="btnrow"><button className="btn sec sm" onClick={() => setSure(false)}>Cancelar</button><button className="btn danger sm" onClick={p.actions.resetAll}>Sí, reiniciar</button></div> : <button className="btn secd sm" onClick={() => setSure(true)}>Reiniciar</button>}
      </div>
      <p className="cap" style={{ margin: "0" }}>MVP construido con el documento de diseño v5: app web en React, API en NestJS y base de datos MySQL (secciones 13 y 14). Personas, negocios y montos son de ejemplo. Mesagri no mueve dinero: los pagos son directos entre las partes.</p>
    </div>
  ));
}

export { store as stageStore };
