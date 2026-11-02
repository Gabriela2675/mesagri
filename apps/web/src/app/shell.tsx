/*
 * Un celular (o el panel web) de la demo: arma el contexto, muestra la pantalla actual,
 * el menú inferior del rol, las hojas inferiores y los avisos emergentes.
 */
import { Component, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { World, MEvent } from '@mesagri/shared/types';
import { makeFmt } from '@mesagri/shared/format';
import { Provide, type AppCtx, type DeviceState, type ToastMsg, type Route } from './ctx';
import type { Store, ActResult } from './store';
import { offlineView } from './store';
import type { PhotoStore } from './photos';
import { auth } from './net';
import { IN_APK } from './routes';
import { canAskPermissions, permissionStates } from './platform';
import { PermsSheet, permsFor } from './screens/common';
import { Icon, Badge, Btn } from './ui/kit';
import { SCREENS, TABS, homeFor } from './screens/registry';
import { speak } from './media';
import { CRITICAL_BY_KEY } from '@mesagri/shared/i18n-keys';
import { notifsFor } from './helpers';
import { OfflineCard } from './screens/farmer';

export interface DeviceProps {
  dev: DeviceState;
  store: Store;
  photos: PhotoStore;
  version: number;
  showIds: boolean;
  onPatch: (id: string, fn: (d: DeviceState) => void) => void;
  register?: (id: string, api: { toast: AppCtx['toast'] }) => void;
}

const offlineCache = new Map<string, { key: string; world: World }>();

export function Device(props: DeviceProps) {
  const { dev, store, photos, showIds, onPatch } = props;
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [sheet, setSheet] = useState<{ node: ReactNode; mid?: boolean } | null>(null);
  const confirmRef = useRef<((v: boolean) => void) | null>(null);
  const tid = useRef(0);
  const now = store.now();

  // Mundo que ve este celular: el común, o el suyo propio si está sin señal
  let w: World;
  if (!dev.online && dev.snapshot) {
    const key = `${dev.outbox.length}:${dev.outbox[dev.outbox.length - 1]?.id ?? ''}:${Math.floor(now / 60000)}`;
    const c = offlineCache.get(dev.id);
    if (c && c.key === key) w = c.world;
    else { w = offlineView(dev.snapshot, dev.outbox, now); offlineCache.set(dev.id, { key, world: w }); }
  } else w = store.view();

  const me = dev.userId ? w.users[dev.userId] : undefined;
  const org = me ? w.orgs[me.orgId] : undefined;
  const fmt = useMemo(() => makeFmt(me?.prefs.numFmt ?? 'coma'), [me?.prefs.numFmt]);
  const top: Route = dev.stack[dev.stack.length - 1] ?? { s: me ? homeFor(me) : 'A-00' };
  const isWeb = dev.kind === 'web';

  const toast: AppCtx['toast'] = (text, tone = 'ok', action) => {
    const id = ++tid.current;
    setToasts(t => [...t.filter(x => x.tone === 'err' && tone !== 'err' && Date.now() - (x.at ?? 0) < 1500), { id, text, tone, action, at: Date.now() }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), tone === 'err' ? 6500 : action ? 5200 : 4200);
  };
  useEffect(() => { props.register?.(dev.id, { toast }); }, [dev.id]);
  // Un aviso con acción («Ver carrito») sobra cuando la persona ya cambió de pantalla por su cuenta
  const routeKey = (dev.stack[dev.stack.length - 1]?.s ?? '') + ':' + dev.stack.length;
  useEffect(() => { setToasts(t => t.some(x => x.action && Date.now() - (x.at ?? 0) > 700) ? t.filter(x => !(x.action && Date.now() - (x.at ?? 0) > 700)) : t); }, [routeKey]);

  const patch = (fn: (d: DeviceState) => void) => onPatch(dev.id, fn);
  const nav = (fn: (stack: Route[]) => Route[]) => { setSheet(null); patch(d => { d.stack = fn(d.stack.length ? d.stack : [top]); }); };

  const act = (type: string, p: any, opt?: { quiet?: boolean; ok?: string; as?: string }): ActResult => {
    const actor = opt?.as ?? dev.userId ?? p?.userId ?? 'system';
    const e: MEvent = store.makeEvent(type, p, actor, dev.id);
    let r: ActResult;
    if (!dev.online && dev.snapshot) {
      // sin señal: se valida con lo que hay en el celular y se guarda para enviarlo después (RNF-05)
      r = store.dry(e, w);
      if (r.ok) patch(d => { d.outbox = [...d.outbox, e]; });
    } else r = store.commit(e);
    if (!r.ok && !opt?.quiet) toast(r.error!.message, 'err');
    if (r.ok && opt?.ok) toast(!dev.online ? `${opt.ok} Se enviará cuando vuelva la señal.` : opt.ok, 'ok');
    return r;
  };
  const check = (type: string, p: any): ActResult => store.dry(store.makeEvent(type, p, dev.userId ?? 'system', dev.id), w);

  const ctx: AppCtx = {
    store, photos, dev, w, now, me, org, fmt, top, web: isWeb,
    go: (s, p) => nav(st => [...st, { s, p }]),
    replace: (s, p) => nav(st => [...st.slice(0, -1), { s, p }]),
    back: () => nav(st => (st.length > 1 ? st.slice(0, -1) : st)),
    reset: (s, p) => nav(() => [{ s, p }]),
    act, check, patch, toast,
    sheet: (node, mid) => setSheet(node ? { node, mid } : null),
    confirm: (o) => new Promise<boolean>(res => {
      confirmRef.current = res;
      setSheet({ mid: true, node: (
        <div className="stack">
          <h2 className="h2">{o.title}</h2>
          {o.text && <p className="bodym" style={{ margin: "0" }}>{o.text}</p>}
          <div className="btnrow">
            <Btn kind="sec" onClick={() => { setSheet(null); res(false); }}>{o.cancel ?? 'Cancelar'}</Btn>
            <Btn kind={o.danger ? 'danger' : 'dark'} onClick={() => { setSheet(null); res(true); }}>{o.ok ?? 'Confirmar'}</Btn>
          </div>
        </div>
      ) });
    }),
    login: (userId) => { const u = w.users[userId]; patch(d => { d.userId = userId; d.stack = [{ s: u ? homeFor(u) : 'A-00' }]; d.flow = {}; }); },
    logout: () => {
      // fuera del escenario de la demo, salir cierra la sesión en el servidor
      if (store.mode !== 'stage' && dev.userId) {
        const s = store.sessions.peek(dev.userId);
        if (s) void auth.logout(s.refreshToken);
        store.sessions.drop(dev.userId);
      }
      patch(d => { d.userId = undefined; d.stack = [{ s: d.kind === 'web' ? 'W-01' : 'A-01' }]; d.flow = {}; d.cart = []; });
    },
    t: (key, es) => {
      const lang = me?.prefs.lang ?? dev.pre?.lang ?? 'es';
      if (lang === 'es' || !CRITICAL_BY_KEY[key]) return es;
      if (!w.settings.languages.enabled.includes(lang)) return es;
      const tr = w.translations[key]?.[lang as 'qu'];
      if (tr?.status !== 'APPROVED' || !tr.text) return es;
      return (me?.prefs.bilingual ?? dev.pre?.bilingual) ? `${tr.text} · ${es}` : tr.text;
    },
    say: (text) => { if ((me?.prefs.audioGuide ?? dev.pre?.audioGuide ?? true)) speak(text); },
  };

  // APK: la primera vez que la persona entra, se piden juntos los permisos que usa su perfil
  useEffect(() => {
    if (!IN_APK || store.mode !== 'app' || !me || me.role === 'ADMIN' || !canAskPermissions()) return;
    const key = 'mesagri.permisos.' + me.id;
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch { return; }
    const st = permissionStates();
    if (!permsFor(me.role).some(n => st[n] !== 'granted')) return;
    const t = setTimeout(() => ctx.sheet(<PermsSheet first />), 700);
    return () => clearTimeout(t);
  }, [me?.id]);

  // Botón «atrás» del celular (APK y app instalada): cierra la hoja abierta o vuelve una pantalla
  const backRef = useRef<() => boolean>(() => false);
  backRef.current = () => {
    if (sheet) { setSheet(null); confirmRef.current?.(false); confirmRef.current = null; return true; }
    if (dev.stack.length > 1) { ctx.back(); return true; }
    return false;
  };
  useEffect(() => {
    if (store.mode === 'stage') return;
    const w = window as any;
    w.__mesagriBack = () => backRef.current();
    if (IN_APK) return () => { delete w.__mesagriBack; };
    // navegador: el gesto o botón «atrás» se queda en la app mientras haya a dónde volver
    try { history.pushState({ mesagri: 1 }, ''); } catch { /* sin historial */ }
    const onPop = () => { if (backRef.current()) { try { history.pushState({ mesagri: 1 }, ''); } catch { /* sin historial */ } } else { try { history.back(); } catch { /* sin historial */ } } };
    addEventListener('popstate', onPop);
    return () => { removeEventListener('popstate', onPop); delete w.__mesagriBack; };
  }, []);

  const entry = SCREENS[top.s];
  const Comp = entry?.c ?? NotFound;
  const role = isWeb ? 'ADMIN' : me?.role;
  const tabs = role && role !== 'ADMIN' ? TABS[role] : undefined;
  const showNav = !!tabs && !!entry?.nav && !!me;
  const scale = me?.prefs.textScale ?? 1;

  return (
    <Provide value={ctx}>
      <div className="app" style={{ '--s': String(scale) } as any} data-screen={top.s} data-device={dev.id}>
        {/* Sin señal: aviso en todas las pantallas (los inicios ya muestran la tarjeta completa) (RNF-05) */}
        {!isWeb && !dev.online && me && top.s !== 'A-08' && top.s !== 'B-05' && (
          <button className="offstrip" onClick={() => ctx.sheet(<div className="stack"><OfflineCard /><Btn full kind="sec" onClick={() => setSheet(null)}>Entendido</Btn></div>)} aria-label={`Sin señal${dev.outbox.length ? `: ${dev.outbox.length} por enviar` : ''}. Ver detalle`}>
            <Icon n="wifi-off" s="1.15em" /><span className="grow">Sin señal</span>
            {dev.outbox.length > 0 && <span className="nowrap">{dev.outbox.length} por enviar</span>}
          </button>
        )}
        <ScreenGuard key={top.s + ':' + JSON.stringify(top.p ?? {})} screen={top.s} canBack={dev.stack.length > 1} onBack={ctx.back} onHome={top.s === (me ? homeFor(me) : '') ? undefined : () => ctx.reset(me ? homeFor(me) : isWeb ? 'W-01' : 'A-01')} onLogout={me ? ctx.logout : undefined}>
          <Comp />
        </ScreenGuard>
        {showNav && (
          <nav className="nav" aria-label="Menú principal">
            {tabs!.map(t => {
              const on = (entry?.tab ?? top.s) === t.s;
              const badge = t.badge ? t.badge(w, org!.id, dev) : 0;
              return (
                <button key={t.s} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined} onClick={() => ctx.reset(t.s)}>
                  <Icon n={t.i} s="1.5em" w={on ? 2.4 : 2} />
                  <span>{t.k ? ctx.t(t.k, t.l) : t.l}</span>
                  {badge > 0 && <Badge n={badge} />}
                </button>
              );
            })}
          </nav>
        )}
        {showIds && !isWeb && <span className={'sid' + (showNav ? '' : ' nonav')}>{top.s}</span>}
        {toasts.length > 0 && (
          <div className="toasts" role="status" aria-live="polite">
            {toasts.map(t => (
              <div key={t.id} className={'toast ' + (t.tone === 'err' ? 'err' : t.tone === 'warn' ? 'warn' : t.tone === 'info' ? 'info' : '')}>
                <Icon n={t.tone === 'err' ? 'circle-alert' : t.tone === 'warn' ? 'triangle-alert' : t.tone === 'info' ? 'info' : 'circle-check'} s="1.3em" />
                <span>{t.text}</span>
                {t.action && <button onClick={() => { t.action!.run(); setToasts(x => x.filter(y => y.id !== t.id)); }}>{t.action.label}</button>}
              </div>
            ))}
          </div>
        )}
        {sheet && (
          <div className={'veil' + (sheet.mid ? ' mid' : '')} onClick={(e) => { if (e.target === e.currentTarget) { setSheet(null); confirmRef.current?.(false); confirmRef.current = null; } }} onKeyDown={(e: any) => { if (e.key === 'Escape') { setSheet(null); } }}>
            <div className="sheet" role="dialog" aria-modal="true">
              {!sheet.mid && <div className="grab" />}
              <ScreenGuard screen="hoja" canBack onBack={() => setSheet(null)} onHome={() => setSheet(null)}>{sheet.node}</ScreenGuard>
            </div>
          </div>
        )}
      </div>
    </Provide>
  );
}

function NotFound() {
  return <div className="scroll"><div className="empty"><b>Pantalla no disponible</b></div></div>;
}

/* Si una pantalla falla al dibujarse, el resto del celular sigue funcionando y se puede volver. */
class ScreenGuard extends Component<{ screen: string; canBack: boolean; onBack: () => void; onHome?: () => void; onLogout?: () => void; children: ReactNode }, { err?: Error }> {
  state: { err?: Error } = {};
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) { console.error(`[Mesagri] La pantalla ${this.props.screen} no se pudo mostrar:`, err); }
  render() {
    const err = this.state.err;
    if (!err) return this.props.children;
    const reload = () => { try { window.location.reload(); } catch { /* sin ventana */ } };
    return (
      <div className="scroll">
        <div className="empty">
          <Icon n="triangle-alert" s="2.2em" />
          <b>Esta pantalla no se pudo mostrar</b>
          <span>Puede que el dato ya no exista o haya cambiado en otro celular. Vuelve a cargar; si sigue igual, cierra la sesión y entra de nuevo.</span>
          <div className="stack tight" style={{ marginTop: 12, width: '100%', maxWidth: '18em' }}>
            {this.props.canBack && <Btn full kind="sec" icon="chevron-left" onClick={this.props.onBack}>Volver</Btn>}
            {this.props.onHome && <Btn full kind="sec" icon="house" onClick={this.props.onHome}>Ir al inicio</Btn>}
            <Btn full kind="dark" icon="refresh-cw" onClick={reload}>Volver a cargar</Btn>
            {this.props.onLogout && <Btn full kind="secd" icon="log-out" onClick={this.props.onLogout}>Cerrar sesión</Btn>}
          </div>
          <small style={{ opacity: .6, marginTop: 8, wordBreak: 'break-word' }}>Pantalla {this.props.screen} · {String(err.message || err).slice(0, 140)}</small>
        </div>
      </div>
    );
  }
}
