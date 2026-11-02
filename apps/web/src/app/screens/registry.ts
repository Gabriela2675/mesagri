/* Registro de pantallas (identificadores de 15.6) y menús inferiores de cada rol (15.2). */
import type { FunctionComponent } from 'react';
import type { User, World } from '@mesagri/shared/types';
import type { DeviceState } from '../ctx';

export interface ScreenDef { c: FunctionComponent; nav?: boolean; tab?: string; title?: string }
export const SCREENS: Record<string, ScreenDef> = {};
export function reg(id: string, c: FunctionComponent, opt: { nav?: boolean; tab?: string; title?: string } = {}) { SCREENS[id] = { c, ...opt }; }

export interface Tab { s: string; l: string; i: string; k?: string; badge?: (w: World, orgId: string, dev?: DeviceState) => number }

const pendingFor = (w: World, orgId: string) => Object.values(w.subOrders).filter(s => s.sellerOrgId === orgId && s.status === 'PENDING_CONFIRMATION').length;

export const TABS: Record<'FARMER' | 'BUYER' | 'CARRIER' | 'WAREHOUSE', Tab[]> = {
  FARMER: [
    { s: 'A-08', l: 'Inicio', i: 'house', k: 'nav.home' },
    { s: 'A-12', l: 'Pedidos', i: 'shopping-bag', k: 'nav.orders', badge: pendingFor },
    { s: 'A-10', l: 'Publicar', i: 'plus', k: 'nav.publish' },
    { s: 'A-23', l: 'Almacén', i: 'warehouse', k: 'nav.storage' },
    { s: 'A-20', l: 'Perfil', i: 'user', k: 'nav.profile' },
  ],
  BUYER: [
    { s: 'B-05', l: 'Inicio', i: 'house' },
    { s: 'B-13', l: 'Pedidos', i: 'shopping-bag', badge: (w, o) => Object.values(w.subOrders).filter(s => s.buyerOrgId === o && (s.status === 'DELIVERED' || (s.status === 'CONFIRMED' && s.payment.status === 'NONE' && s.payment.method !== 'CASH' && s.prepay))).length },
    { s: 'B-09', l: 'Carrito', i: 'shopping-cart' },
    { s: 'B-21', l: 'Reportes', i: 'chart-column' },
    { s: 'B-20', l: 'Perfil', i: 'user' },
  ],
  CARRIER: [
    { s: 'T-08', l: 'Inicio', i: 'house' },
    { s: 'T-10', l: 'Envíos', i: 'truck', badge: (w, o) => Object.values(w.shipments).filter(sh => sh.status === 'OFFERING' && sh.offers[sh.offers.length - 1]?.carrierOrgId === o && !sh.offers[sh.offers.length - 1]?.response).length },
    { s: 'T-11', l: 'Ruta', i: 'route' },
    { s: 'T-16', l: 'Cobros', i: 'banknote' },
    { s: 'T-PERFIL', l: 'Perfil', i: 'user' },
  ],
  WAREHOUSE: [
    { s: 'C-06', l: 'Inicio', i: 'house' },
    { s: 'C-07', l: 'Reservas', i: 'calendar', badge: (w, o) => Object.values(w.bookings).filter(b => b.facilityOrgId === o && b.status === 'PENDING').length },
    { s: 'C-10', l: 'Lotes', i: 'package' },
    { s: 'C-13', l: 'Cobros', i: 'banknote' },
    { s: 'C-14', l: 'Almacén', i: 'warehouse' },
  ],
};

export function homeFor(u: User): string {
  switch (u.role) {
    case 'FARMER': return 'A-08';
    case 'BUYER': return 'B-05';
    case 'CARRIER': return 'T-08';
    case 'WAREHOUSE': return 'C-06';
    default: return 'W-02';
  }
}
