/*
 * Contexto de cada celular de la demo: quién inició sesión, en qué pantalla está, su señal,
 * sus acciones pendientes (sin señal) y las funciones para navegar y actuar.
 */
import { createContext, ReactNode } from 'react';
import { useContext } from 'react';
import type { World, User, Org, MEvent } from '@mesagri/shared/types';
import type { Fmt } from '@mesagri/shared/format';
import type { ActResult, Store } from './store';
import type { PhotoStore } from './photos';

export interface Route { s: string; p?: Record<string, any> }

export interface CartLine { listingId: string; qty: number }
export interface DeviceState {
  id: string;
  kind: 'phone' | 'web';
  userId?: string;
  stack: Route[];
  online: boolean;
  outbox: MEvent[];
  snapshot?: World;
  cart: CartLine[];
  /** datos temporales de flujos de varios pasos (registro, publicar, checkout) */
  flow: Record<string, any>;
  /** idioma y preferencias elegidos antes de tener cuenta (A-01) */
  pre?: { lang?: string; audioGuide?: boolean; bilingual?: boolean };
}

export interface ToastMsg { id: number; text: string; tone?: 'ok' | 'err' | 'warn' | 'info'; action?: { label: string; run: () => void }; at?: number }

export interface AppCtx {
  store: Store;
  photos: PhotoStore;
  dev: DeviceState;
  w: World;
  now: number;
  me?: User;
  org?: Org;
  fmt: Fmt;
  top: Route;
  go(s: string, p?: Record<string, any>): void;
  replace(s: string, p?: Record<string, any>): void;
  back(): void;
  reset(s: string, p?: Record<string, any>): void;
  /** envía una acción al motor (o a la cola si no hay señal); muestra el error si falla */
  act(type: string, p: any, opt?: { quiet?: boolean; ok?: string; as?: string }): ActResult;
  /** prueba una acción sin enviarla */
  check(type: string, p: any): ActResult;
  patch(fn: (d: DeviceState) => void): void;
  toast(text: string, tone?: ToastMsg['tone'], action?: ToastMsg['action']): void;
  sheet(node: ReactNode | null, mid?: boolean): void;
  confirm(o: { title: string; text?: string; ok?: string; cancel?: string; danger?: boolean }): Promise<boolean>;
  login(userId: string): void;
  logout(): void;
  t(key: string, es: string): string;
  say(text: string): void;
  web: boolean;
}

export const Ctx = createContext<AppCtx | null>(null);
export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('Sin contexto de la app');
  return c;
}

export function Provide({ value, children }: { value: AppCtx; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
