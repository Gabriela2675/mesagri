/*
 * Dónde corre la app y cómo se llega a cada parte.
 * - Con servidor (la laptop o un servidor): la app en «/», el panel en «/panel», la demo en «/demo».
 * - Autónoma (APK de Android y app web instalable): todo corre en el celular; como se publica en
 *   cualquier carpeta, cada parte se abre con «?modo=panel» o «?modo=demo».
 */
export const LOCAL = import.meta.env.VITE_LOCAL === '1';

export type Mode = 'stage' | 'app' | 'panel';

/** ¿Corre dentro del APK de Mesagri (WebView)? */
export const IN_APK = typeof navigator !== 'undefined' && /MesagriApp\//.test(navigator.userAgent);

export function modeFromLocation(): Mode {
  if (typeof location === 'undefined') return 'app';
  if (LOCAL) {
    const m = new URLSearchParams(location.search).get('modo');
    return m === 'demo' ? 'stage' : m === 'panel' ? 'panel' : 'app';
  }
  const p = location.pathname.replace(/\/+$/, '').toLowerCase();
  return p === '/demo' ? 'stage' : p === '/panel' ? 'panel' : 'app';
}

const here = () => (typeof location !== 'undefined' ? location.pathname : '/');

/** Dirección del panel web (con el correo, si se conoce). */
export function panelUrl(email?: string): string {
  const q = email ? `email=${encodeURIComponent(email)}` : '';
  return LOCAL ? `${here()}?modo=panel${q ? '&' + q : ''}` : `/panel${q ? '?' + q : ''}`;
}
/** Dirección de la app (pantalla de inicio). */
export const appUrl = (): string => (LOCAL ? here() : '/');
/** Dirección del escenario de la demo. */
export const demoUrl = (): string => (LOCAL ? `${here()}?modo=demo` : '/demo');
