/*
 * Tareas programadas (14.7) como temporizadores deterministas: se procesan en el orden de su hora,
 * cada una a su propia hora, hasta llegar al tiempo pedido. Así todos los celulares llegan al
 * mismo resultado sin importar cada cuánto se revisan.
 */
import type { World } from '../types';
import { notify, setStatus } from './core';
import { releaseStock, completeSub } from './orders';
import { shippingDeadlines } from './shipping';
import { storageDeadlines } from './storage';
import { billingDeadlines } from './billing';
import { r2Deadlines } from './r2';
import { HOUR, DAY } from '../time';
import { money } from '../format';
import { product } from '../catalog';

type Deadline = { at: number; run: (t: number) => void };

function orderDeadlines(w: World): Deadline[] {
  const out: Deadline[] = [];
  for (const id in w.subOrders) {
    const s = w.subOrders[id];
    if (s.status === 'PENDING_CONFIRMATION') out.push({ at: s.confirmBy, run: (t) => {
      setStatus(s, 'EXPIRED', t, 'system', 'Sin respuesta en el plazo');
      releaseStock(w, s, t, `expire:${s.id}`);
      const seller = w.orgs[s.sellerOrgId];
      if (seller) seller.counters.expiredOrders++;
      const sh = s.shipmentId ? w.shipments[s.shipmentId] : undefined;
      if (sh && sh.status === 'WAITING_FARMER') { sh.status = 'CANCELLED'; sh.cancelReason = 'El pedido venció'; sh.events.push({ kind: 'CANCELLED', at: t, text: 'El pedido venció sin respuesta del agricultor' }); }
      notify({ w, t }, s.buyerOrgId, 'ORDER', 'Pedido vencido', `${seller?.name ?? 'El agricultor'} no respondió a tiempo (${s.code}). No pagas nada y el stock se liberó.`, { screen: 'B-14', params: { id: s.id } });
      notify({ w, t }, s.sellerOrgId, 'ORDER', 'Se venció un pedido', `${s.code}: pasaron ${w.settings.orderResponseHours} h sin respuesta. Baja tu indicador de respuesta (RN-08).`);
    } });
    if (s.status === 'DELIVERED' && s.deliveredAt) out.push({ at: s.deliveredAt + w.settings.autoCompleteHours * HOUR, run: (t) => {
      completeSub({ w, t }, s, s.subtotal, 'system', `Conforme automático: pasaron ${w.settings.autoCompleteHours} h (RN-11)`);
    } });
  }
  for (const id in w.reviews) {
    const r = w.reviews[id];
    if (!r.published) out.push({ at: r.at + w.settings.reviewPublishDays * DAY, run: (t) => {
      r.published = true;
      notify({ w, t }, r.toOrg, 'REVIEW', `Te calificaron con ${r.stars} estrellas`, `${w.orgs[r.fromOrg]?.name ?? ''}${r.comment ? `: «${r.comment}»` : ''}`);
    } });
  }
  for (const id in w.listings) {
    const l = w.listings[id];
    if ((l.status === 'ACTIVE' || l.status === 'PAUSED' || l.status === 'SOLD_OUT') && l.reserved <= 0) out.push({ at: l.expiresAt, run: (t) => {
      if (l.status === 'SOLD_OUT' && l.available <= 0) { l.status = 'SOLD_OUT'; l.expiresAt = Infinity; return; }
      l.status = 'EXPIRED';
      notify({ w, t }, l.orgId, 'SYSTEM', 'Tu publicación venció', `${product(l.productId).name}: renuévala desde Mis publicaciones (${money(l.price)} por ${l.unit === 'kg' ? 'kg' : l.unit}).`, { screen: 'A-09' });
    } });
  }
  return out;
}

export function tick(w: World, t: number) {
  let guard = 0;
  while (guard++ < 5000) {
    const all = [...orderDeadlines(w), ...billingDeadlines(w), ...shippingDeadlines(w), ...storageDeadlines(w), ...r2Deadlines(w)];
    let next: Deadline | undefined;
    for (const d of all) if (d.at <= t && (!next || d.at < next.at)) next = d;
    if (!next) break;
    const at = Math.max(next.at, w.now);
    next.run(at);
    w.now = at;
  }
  if (t > w.now) w.now = t;
}

/** ¿Hay algo programado antes de `t`? (para saber si la vista necesita procesar el reloj) */
export function hasDue(w: World, t: number): boolean {
  const all = [...orderDeadlines(w), ...billingDeadlines(w), ...shippingDeadlines(w), ...storageDeadlines(w), ...r2Deadlines(w)];
  return all.some(d => d.at <= t);
}

export function nextDeadline(w: World): number {
  const all = [...orderDeadlines(w), ...billingDeadlines(w), ...shippingDeadlines(w), ...storageDeadlines(w), ...r2Deadlines(w)];
  let m = Infinity;
  for (const d of all) if (d.at < m) m = d.at;
  return m;
}
