/*
 * «Instalar la app» en el celular (app web instalable).
 * - Android (Chrome, Edge, Samsung Internet): el navegador ofrece instalarla; se guarda ese aviso
 *   y la app lo muestra con su propio botón.
 * - iPhone (Safari): no hay aviso; se explica «Compartir → Agregar a inicio».
 */
import { useEffect, useState } from 'react';
import { LOCAL, IN_APK } from './routes';

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice?: Promise<{ outcome: string }> };
let deferred: PromptEvent | undefined;
let installed = false;
const subs = new Set<() => void>();
const notify = () => { for (const f of [...subs]) f(); };

export function captureInstall() {
  try {
    addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as PromptEvent; notify(); });
    addEventListener('appinstalled', () => { installed = true; deferred = undefined; notify(); });
  } catch { /* sin ventana */ }
}

function standalone(): boolean {
  try { return matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true; } catch { return false; }
}
function isIos(): boolean {
  try { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); } catch { return false; }
}

export interface InstallState { canPrompt: boolean; ios: boolean; show: boolean; install: () => Promise<boolean> }

export function useInstall(): InstallState {
  const [, setN] = useState(0);
  useEffect(() => { const f = () => setN(n => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  const inApp = IN_APK || standalone() || installed;
  const canPrompt = !!deferred && !inApp;
  const ios = LOCAL && !inApp && isIos();
  return {
    canPrompt,
    ios,
    show: LOCAL && !inApp && (canPrompt || ios),
    install: async () => {
      if (!deferred) return false;
      const d = deferred;
      deferred = undefined;
      notify();
      try { await d.prompt(); const c = await d.userChoice; return c?.outcome === 'accepted'; } catch { return false; }
    },
  };
}
