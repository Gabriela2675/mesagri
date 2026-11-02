/*
 * App del agricultor (1): inicio, publicaciones, publicar con la voz o con íconos, confirmar,
 * pedidos, detalle con la comisión a la vista, cobro con constancia y entrega con código.
 * A-08 a A-15.
 */
import { useEffect, useRef, useState } from 'react';
import { reg } from './registry';
import { HelperBanner } from './r2';
import { useApp, type AppCtx } from '../ctx';
import { Screen, Btn, Icon, Field, Inp, Sel, Tog, Card, Chip, ChipBtn, Seg, Kv, Av, ICirc, Empty, Note, SheetBody, Tile, Prog, Stat, Due, Timeline, Photo, PhotoPick, PhotosPick, Gallery, Spk, Qty, BarAct, Stars as Starsx, type TlStep } from '../ui/kit';
import { PRODUCTS, product, suggestedPricePerKg, UNIT_LABEL, unitKgFor, CATEGORY_LABEL, allProducts } from '@mesagri/shared/catalog';
import { commissionPreview, farmerLimit, priceDeviation, plausibility, taxDocsFor, TAXDOC_LABEL, r2 } from '@mesagri/shared/rules';
import { activeListings, reservedFreeSlots, overdueStatement, subOrdersOf, orgStats, pricePerKg } from '@mesagri/shared/queries';
import { money, moneyShort, kg as fkg, numTrim, dateShort, hhmm, relDay, ago, harvestText, pct, dayMonth, duration } from '@mesagri/shared/format';
import { interpret, harvestDate, SAMPLE_PHRASES, type VoiceResult } from '@mesagri/shared/voice';
import { DAY, HOUR, startOfDay } from '@mesagri/shared/time';
import { uid } from '@mesagri/shared/ids';
import { itemsShort, itemsText, statusInfo, deliveryText, PAY_LABEL, orgName, notifsFor, where, levelChip, qtyText, kgOf, userOfOrg, slotOf, originOf, withDistrict, permWhy } from '../helpers';
import { IN_APK } from '../routes';
import { canListen, listen } from '../media';
import { placeLabel, districtName } from '@mesagri/shared/ubigeo';
import type { SubOrder, Listing, Unit, Quality, World, Org } from '@mesagri/shared/types';
import { CodeInput } from './onboarding';

/* ---------- utilidades ---------- */
export function ratingText(w: World, orgId: string) {
  const s = orgStats(w, orgId);
  return s.count ? `★ ${String(s.rating).replace('.', ',')} (${s.count})` : 'sin calificaciones';
}
export function commissionInfo(w: World, so: SubOrder): { amount: number; free: boolean; title: string; note: string } | undefined {
  const seller = w.orgs[so.sellerOrgId];
  if (!seller) return undefined;
  const free = w.settings.commission.freeSales;
  if (so.status === 'COMPLETED') return { amount: so.commission ?? 0, free: !so.commission, title: 'Comisión de esta venta', note: so.commission ? `Venta ${so.saleNumber} · ${pct(so.commissionRate)} de ${money(so.saleAmount ?? so.subtotal)}` : `Venta ${so.saleNumber} · sin comisión${so.freeSaleBonus ? ' (cupo liberado)' : ''}` };
  if (['REJECTED', 'EXPIRED', 'CANCELLED_BY_BUYER', 'CANCELLED_BY_SELLER'].includes(so.status)) return undefined;
  if (so.status === 'PENDING_CONFIRMATION') {
    const p = commissionPreview(w.settings, seller, reservedFreeSlots(w, seller.id), so.subtotal, so.commissionRate);
    return { amount: p.amount, free: p.isFree, title: 'Tu comisión en esta venta', note: p.isFree ? `Venta ${p.freeNumber} de ${free} sin comisión · se reserva al aceptar` : `Desde la ${free + 1}.ª venta: ${pct(so.commissionRate)} de ${money(so.subtotal)}` };
  }
  return { amount: so.freeSlotReserved ? 0 : r2(so.subtotal * so.commissionRate), free: so.freeSlotReserved, title: 'Tu comisión en esta venta', note: so.freeSlotReserved ? 'Cupo sin comisión reservado al aceptar (no cambia)' : `${pct(so.commissionRate)} de ${money(so.subtotal)} · en tu estado de cuenta del mes` };
}
export function priceText(l: Listing): string {
  if (l.unit === 'kg') return `${money(l.price)} por kg`;
  return `${money(l.price)} por ${UNIT_LABEL[l.unit].one} (${money(pricePerKg(l))} por kg)`;
}
export function timelineFor(so: SubOrder, w: World): TlStep[] {
  const at = (st: SubOrder['status'][]) => so.history.find(h => st.includes(h.status))?.at;
  const dead = ['REJECTED', 'EXPIRED', 'CANCELLED_BY_BUYER', 'CANCELLED_BY_SELLER'].includes(so.status);
  const accepted = at(['CONFIRMED']);
  const paid = so.payment.status === 'CONFIRMED' ? (so.payment.confirmedAt ?? so.payment.paidAt) : undefined;
  const transit = at(['IN_TRANSIT']);
  const delivered = so.deliveredAt;
  const done = so.completedAt;
  const f = (t?: number) => (t ? `${dateShort(t)} · ${hhmm(t)}` : undefined);
  const seller = w.orgs[so.sellerOrgId]?.name.split(' ')[0] ?? 'El agricultor';
  const steps: TlStep[] = [{ t: 'Pedido enviado', s: f(so.createdAt), state: 'done' }];
  if (dead) { steps.push({ t: so.status === 'EXPIRED' ? 'Venció sin respuesta' : so.status === 'REJECTED' ? `${seller} no pudo aceptar` : 'Cancelado', s: so.rejectReason ?? so.cancelReason ?? f(so.history[so.history.length - 1]?.at), state: 'fail' }); return steps; }
  steps.push({ t: accepted ? `${seller} aceptó` : 'Esperando que acepte', s: accepted ? f(accepted) : `Responde hasta las ${hhmm(so.confirmBy)}`, state: accepted ? 'done' : 'cur' });
  steps.push({ t: so.payment.method === 'CASH' ? 'Pago en efectivo al recibir' : paid ? `Pago confirmado por ${seller}` : so.payment.status === 'UPLOADED' ? 'Pago por confirmar' : 'Pago directo al agricultor', s: paid ? f(paid) : so.payment.status === 'UPLOADED' ? `Constancia ${so.payment.operation}` : undefined, state: paid ? 'done' : accepted && so.payment.method !== 'CASH' ? 'cur' : 'pend' });
  steps.push({ t: 'En camino', s: transit ? f(transit) : `${dateShort(so.deliveryDate)} · ${so.slot}`, state: transit ? (delivered ? 'done' : 'cur') : 'pend' });
  steps.push({ t: done ? 'Recibido y conforme' : delivered ? 'Entregado · revisa en 48 h' : 'Recibido y conforme', s: done ? f(done) : delivered ? f(delivered) : 'Tienes 48 h para revisar', state: done ? 'done' : delivered ? 'cur' : 'pend' });
  if (so.status === 'DISPUTED') steps.push({ t: 'En disputa: Soporte media', s: w.disputes[so.disputeId ?? '']?.code, state: 'fail' });
  return steps;
}

/* ---------- A-08 · Inicio del agricultor ---------- */
function FarmerHome() {
  const A = useApp();
  const org = A.org!, w = A.w;
  const subs = subOrdersOf(w, s => s.sellerOrgId === org.id);
  const fresh = subs.filter(s => s.status === 'PENDING_CONFIRMATION');
  const toDeliver = subs.filter(s => ['CONFIRMED', 'PREPARING', 'READY', 'IN_TRANSIT'].includes(s.status));
  const toCollect = subs.filter(s => ['CONFIRMED', 'PREPARING', 'READY', 'IN_TRANSIT', 'DELIVERED'].includes(s.status) && s.payment.status !== 'CONFIRMED').reduce((a, s) => a + s.total, 0);
  const lists = activeListings(w, org.id).length + Object.values(w.listings).filter(l => l.orgId === org.id && l.fromLotId && l.status === 'ACTIVE').length;
  const used = Math.min(w.settings.commission.freeSales, org.counters.freeSalesUsed + reservedFreeSlots(w, org.id));
  const od = overdueStatement(w, org.id);
  const due = Object.values(w.statements).find(s => s.orgId === org.id && s.status === 'ISSUED');
  const pickups = Object.values(w.shipments).filter(sh => sh.sellerOrgId === org.id && ['ASSIGNED', 'GOING_TO_PICKUP'].includes(sh.status));
  const waitingLots = Object.values(w.lots).filter(l => l.farmerOrgId === org.id && l.status === 'WAITING_FARMER');
  const unread = notifsFor(w, org.id).filter(n => n.at > (Number(A.dev.flow.seenNotifs) || 0)).length;
  const pay = subs.filter(s => s.payment.status === 'UPLOADED');
  return (
    <Screen home hello={`Hola, ${A.me!.shortName}`} title={A.t('home.title', 'Tu chacra hoy')} right={<BarAct icon="bell" label="Avisos" onClick={() => A.go('A-29')} dot={unread > 0} />}>
      <div className="stack">
        {!A.dev.online && <OfflineCard />}
        {org.level === 0 && (
          <Card tone="warn"><div className="row top"><Icon n="shield-check" /><div className="grow stack tight"><b className="bodym">Estamos verificando tu identidad</b><span className="bodym">Respondemos en 48 h. Mientras tanto puedes explorar; publicarás cuando tengas el nivel 1 (RN-02).</span><Btn sm kind="sec" onClick={() => A.go('A-17V')}>Ver mi verificación</Btn></div></div></Card>
        )}
        {od && <Card tone="danger"><div className="row top"><Icon n="triangle-alert" /><div className="grow stack tight"><b className="bodym">Tu estado de cuenta venció: no puedes publicar</b><span className="bodym">{money(od.total)} de {od.period}. Tus pedidos en curso siguen (RN-40).</span><Btn sm kind="danger" onClick={() => A.go('A-26', { id: od.id })}>Pagar ahora</Btn></div></div></Card>}
        {!od && due && <button className="card warn" onClick={() => A.go('A-26', { id: due.id })}><div className="row"><Icon n="receipt" /><div className="grow"><b className="bodym">Estado de cuenta: {money(due.total)}</b><div className="cap" style={{ color: "inherit" }}>Vence el {dateShort(due.dueAt)}. Si no se paga hasta el día 10, no podrás publicar.</div></div><Icon n="chevron-right" s="1.1em" /></div></button>}
        <HelperBanner />
        {(() => { const sells = new Set(Object.values(w.listings).filter(l => l.orgId === org.id).map(l => l.productId)); const open = Object.values(w.requests).filter(r => r.status === 'OPEN' && A.now < r.closesAt && sells.has(r.productId) && !r.offers.some(o => o.sellerOrgId === org.id && o.status === 'SENT')); return open.length > 0 ? (
          <button className="card soft" onClick={() => A.go('A-27')}><div className="row"><ICirc n="clipboard-list" /><div className="grow"><b className="bodym">{open.length === 1 ? 'Un negocio pide' : `${open.length} negocios piden`} lo que tú vendes</b><div className="cap">{open.slice(0, 2).map(r => `${product(r.productId).name.toLowerCase()} ${fkg(r.kg)}`).join(' · ')} · ofrece tu precio</div></div><Icon n="chevron-right" s="1.1em" /></div></button>
        ) : null; })()}
        {pickups.map(sh => (
          <button key={sh.id} className="card hl" onClick={() => A.go('A-30', { id: sh.id })}><div className="row"><ICirc n="truck" tone="terra" /><div className="grow"><b className="bodym">{userOfOrg(w, sh.carrierOrgId)?.shortName ?? 'El transportista'} ({orgName(w, sh.carrierOrgId)}) recoge {relDay(sh.pickupAt, A.now)} a las {hhmm(sh.pickupAt)}</b><div className="cap">{sh.code} · {fkg(sh.weightKg)} · muéstrale tu QR</div></div><Icon n="chevron-right" s="1.1em" /></div></button>
        ))}
        {waitingLots.map(l => <button key={l.id} className="card warn" onClick={() => A.go('A-23')}><div className="row"><Icon n="scale" /><div className="grow"><b className="bodym">Revisa el peso de tu lote {l.code}</b><div className="cap" style={{ color: "inherit" }}>Declaraste {fkg(l.declaredKg)} y la balanza marcó {fkg(l.weightKg)}.</div></div></div></button>)}
        {pay.map(s => <button key={s.id} className="card hl" onClick={() => A.go('A-14', { id: s.id })}><div className="row"><ICirc n="banknote" tone="terra" /><div className="grow"><b className="bodym">{orgName(w, s.buyerOrgId)} dice que pagó {money(s.payment.amount ?? s.total)}</b><div className="cap">Revisa tu {PAY_LABEL[s.payment.method]} y confírmalo</div></div><Icon n="chevron-right" s="1.1em" /></div></button>)}
        <div className="grid2">
          <Stat n={fresh.length} l={A.t('home.new_orders', 'Pedidos nuevos')} tone="terra" onClick={() => A.go('A-12', { tab: 'new' })} />
          <Stat n={toDeliver.length} l={A.t('home.to_deliver', 'Por entregar')} tone="terra" onClick={() => A.go('A-12', { tab: 'deliver' })} />
          <Stat n={moneyShort(toCollect)} l={A.t('home.to_collect', 'Por cobrar')} onClick={() => A.go('A-12', { tab: 'deliver' })} />
          <Stat n={lists} l="Publicaciones activas" tone="terra" onClick={() => A.go('A-09')} />
        </div>
        <button className="btn big2 full" onClick={() => A.reset('A-10')} disabled={false}>
          <span className="ic"><Icon n="mic" s="1.4em" /></span>
          <span>{A.t('home.publish', 'Publicar nueva cosecha')}<small>Habla o usa el formulario</small></span>
        </button>
        <button className="card warn" onClick={() => A.go('A-25')} style={{ padding: ".75em 1em" }}><div className="row between"><span className="bodym b" style={{ color: "var(--ink)" }}>Ventas sin comisión</span><b className="warnc">{used} de {w.settings.commission.freeSales} usadas</b></div></button>
        <div className="sect">{A.t('home.new_orders', 'Pedidos nuevos')}</div>
        {fresh.length === 0 ? <Card><Empty icon="shopping-bag" title="Sin pedidos nuevos por ahora" text="Cuando un negocio te pida, te avisamos y tienes 12 horas para responder." /></Card> : fresh.map(s => <OrderCard key={s.id} s={s} side="seller" />)}
      </div>
    </Screen>
  );
}

export function OfflineCard() {
  const A = useApp();
  return (
    <div className="offline">
      <Icon n="wifi-off" s="1.6em" />
      <div className="grow stack tight">
        <b>Estás sin internet</b>
        <span className="cap">Guardamos todo en tu celular y lo enviamos solo cuando vuelva la señal.</span>
        {A.dev.outbox.length > 0 && <>
          <span className="cap b" style={{ color: "#97BC62", letterSpacing: ".08em" }}>POR ENVIAR ({A.dev.outbox.length})</span>
          {A.dev.outbox.map(e => <span key={e.id} className="cap">• {describeEvent(A, e.type, e.p)} · guardada {hhmm(e.t)}</span>)}
        </>}
      </div>
    </div>
  );
}
export function describeEvent(A: AppCtx, type: string, p: any): string {
  const so = p?.subOrderId ? A.w.subOrders[p.subOrderId] : undefined;
  switch (type) {
    case 'LISTING_PUBLISH': return `Publicación: ${product(p.productId).name.toLowerCase()} ${p.unit === 'kg' ? fkg(p.qty) : `${p.qty} ${p.unit}`}`;
    case 'SUBORDER_DELIVER': return `Entrega ${so?.code ?? ''} con foto`;
    case 'SUBORDER_ACCEPT': return `Aceptar ${so?.code ?? ''}`;
    case 'MSG_SEND': return `Mensaje a ${so ? orgName(A.w, so.buyerOrgId === A.org?.id ? so.sellerOrgId : so.buyerOrgId) : 'Soporte'}`;
    case 'PAYMENT_CONFIRM': return `Confirmar pago de ${so?.code ?? ''}`;
    default: return type.toLowerCase().replace(/_/g, ' ');
  }
}

export function OrderCard({ s, side }: { s: SubOrder; side: 'seller' | 'buyer' }) {
  const A = useApp();
  const other = A.w.orgs[side === 'seller' ? s.buyerOrgId : s.sellerOrgId];
  const st = statusInfo(s, side);
  const target = side === 'seller' ? 'A-13' : 'B-14';
  return (
    <Card>
      <div className="row between top"><div className="grow"><b className="bodym">{other?.name}</b><div className="cap">{itemsShort(s)} · {districtName(side === 'seller' ? s.district : other?.district)}</div></div><b className="price nowrap">{money(s.total)}</b></div>
      <div className="row between wrap mt">
        {s.status === 'PENDING_CONFIRMATION' && side === 'seller' ? <Due at={s.confirmBy} now={A.now} /> : <Chip tone={st.tone} icon={st.icon}>{st.label}</Chip>}
        <Btn xs kind="dark" onClick={() => A.go(target, { id: s.id })}>Ver</Btn>
      </div>
    </Card>
  );
}

/* ---------- A-09 · Mis publicaciones ---------- */
function MyListings() {
  const A = useApp();
  const org = A.org!;
  const all = Object.values(A.w.listings).filter(l => l.orgId === org.id && l.status !== 'REMOVED').sort((a, b) => b.createdAt - a.createdAt);
  const groups: Record<string, Listing[]> = {
    act: all.filter(l => ['ACTIVE', 'IN_REVIEW'].includes(l.status) || (l.status === 'SOLD_OUT' && l.reserved > 0)),
    pau: all.filter(l => ['PAUSED', 'EXPIRED', 'REJECTED'].includes(l.status)),
    sold: all.filter(l => l.status === 'SOLD_OUT' && l.reserved <= 0),
  };
  const [tab, setTab] = useState<'act' | 'pau' | 'sold'>(A.top.p?.tab ?? 'act');
  const lim = farmerLimit(A.w.settings, org.level);
  return (
    <Screen title="Mis publicaciones" sub={lim.listings === null ? 'Sin tope de publicaciones (nivel 3)' : `Tope de tu nivel: ${lim.listings} publicaciones`} foot={<Btn full icon="plus" onClick={() => A.reset('A-10')}>Publicar cosecha</Btn>}>
      <div className="stack">
        <Seg value={tab} onChange={setTab} options={[{ v: 'act', l: `Activas ${groups.act.length}` }, { v: 'pau', l: `Pausadas ${groups.pau.length}` }, { v: 'sold', l: `Vendidas ${groups.sold.length}` }]} />
        {groups[tab].length === 0 && <Card><Empty icon="package" title={tab === 'act' ? 'No tienes publicaciones activas' : tab === 'pau' ? 'Nada pausado' : 'Todavía no vendiste todo de una publicación'} text={tab === 'act' ? 'Publica tu cosecha con la voz o con íconos.' : undefined} /></Card>}
        {groups[tab].map(l => <ListingCard key={l.id} l={l} />)}
      </div>
    </Screen>
  );
}

const LST: Record<Listing['status'], { l: string; tone: string }> = { ACTIVE: { l: 'Activa', tone: 'field' }, PAUSED: { l: 'Pausada', tone: 'warn' }, SOLD_OUT: { l: 'Vendida', tone: 'leaf' }, EXPIRED: { l: 'Vencida', tone: 'danger' }, IN_REVIEW: { l: 'En revisión', tone: 'warn' }, REJECTED: { l: 'Rechazada', tone: 'danger' }, REMOVED: { l: 'De baja', tone: 'ghost' }, QUEUED: { l: 'Por enviar', tone: 'warn' } };

function ListingCard({ l }: { l: Listing }) {
  const A = useApp();
  const p = product(l.productId);
  const st = LST[l.status];
  const progress = l.qtyTotal ? (l.sold + l.reserved) / l.qtyTotal : 0;
  const u = l.unit === 'kg' ? 'kg' : UNIT_LABEL[l.unit].many;
  return (
    <Card>
      <div className="row top">
        {l.photoIds[0] ? <div style={{ width: '3.6em', flex: 'none' }}><Photo id={l.photoIds[0]} label={undefined} /></div> : <Tile pid={l.productId} />}
        <div className="grow">
          <div className="row between"><b className="h3" style={{ fontSize: "1em" }}>{p.name}{l.variety ? ` ${l.variety}` : ''}</b><Chip tone={st.tone}>{st.l}</Chip></div>
          <div className="cap">{numTrim(l.qtyTotal)} {u} · quedan {numTrim(l.available)} {u}{l.reserved ? ` · ${numTrim(l.reserved)} en pedidos` : ''}{l.fromLotId ? ' · desde el almacén' : ''}{l.requestId ? ` · venta por solicitud ${A.w.requests[l.requestId]?.code ?? ''}` : ''}</div>
        </div>
      </div>
      <div className="mt"><Prog v={progress} /></div>
      {l.reviewReason && <div className={'cap mt ' + (l.status === 'REJECTED' ? 'bad' : 'warnc')}>{l.reviewReason}</div>}
      <div className="row between mt wrap">
        <b className="price bodym">{l.unit === 'kg' ? `${money(l.price)} por kg` : `${money(l.price)} por ${UNIT_LABEL[l.unit].one}`}</b>
        <div className="row g8">
          {['ACTIVE', 'PAUSED', 'SOLD_OUT'].includes(l.status) && <Btn xs kind="sec" icon="pencil" onClick={() => A.sheet(<EditListing id={l.id} />)}>{l.photoIds.length ? 'Editar' : 'Editar y poner fotos'}</Btn>}
          {l.status === 'ACTIVE' && <Btn xs kind="sec" onClick={() => A.act('LISTING_PAUSE', { listingId: l.id }, { ok: 'Publicación pausada: no se ve en el catálogo.' })}>Pausar</Btn>}
          {l.status === 'PAUSED' && <Btn xs kind="dark" onClick={() => A.act('LISTING_RESUME', { listingId: l.id }, { ok: 'Publicación activa otra vez.' })}>Activar</Btn>}
          {(l.status === 'EXPIRED' || l.status === 'REJECTED' || (l.status === 'SOLD_OUT' && !l.reserved)) && <Btn xs kind="dark" icon="repeat" onClick={() => { A.patch(d => { d.flow = { ...d.flow, pub: draftFrom(l) }; }); A.reset('A-10', { mode: 'form' }); }}>Publicar de nuevo</Btn>}
        </div>
      </div>
    </Card>
  );
}

function EditListing({ id }: { id: string }) {
  const A = useApp();
  const l = A.w.listings[id];
  const [price, setPrice] = useState(String(l.price).replace('.', ','));
  const [add, setAdd] = useState(0);
  const [min, setMin] = useState(l.minQty || 0);
  const [photos, setPhotos] = useState<string[]>(l.photoIds);
  const save = async (confirmPrice = false) => {
    const pv = Number(price.replace(',', '.'));
    const changedPhotos = photos.join('|') !== l.photoIds.join('|');
    const payload = { listingId: id, price: pv, addQty: add || undefined, minQty: min, confirmPrice, ...(changedPhotos ? { photoIds: photos } : {}) };
    const c = A.check('LISTING_EDIT', payload);
    if (!c.ok && c.error?.code === 'PRICE_CONFIRM' && !confirmPrice) {
      const ok = await A.confirm({ title: '¿Confirmas el precio?', text: c.error.message, ok: 'Sí, confirmo' });
      if (ok) save(true);
      return;
    }
    if (A.act('LISTING_EDIT', payload, { ok: 'Guardamos los cambios.' }).ok) A.sheet(null);
  };
  const unit = l.unit === 'kg' ? 'kg' : UNIT_LABEL[l.unit].many;
  return (
    <SheetBody title={`Editar ${product(l.productId).name.toLowerCase()}`} sub={`Quedan ${numTrim(l.available)} ${unit}${l.reserved ? `; ${numTrim(l.reserved)} están en pedidos y no se tocan` : ''}.`}>
      <Field label={`Precio por ${l.unit === 'kg' ? 'kilo' : UNIT_LABEL[l.unit].one}`} help={`Sugerido: ${money(suggestedPricePerKg(l.productId) * l.unitKg)}${l.unit === 'kg' ? '' : ` (${money(suggestedPricePerKg(l.productId))} por kg)`}`}><Inp value={price} onInput={setPrice} mode="decimal" prefix="S/" label="Precio" /></Field>
      {!l.fromLotId && <Field label={`Agregar o quitar (${unit})`}><Qty value={add} onChange={setAdd} step={l.unit === 'kg' ? 10 : 1} min={-l.available} unit={unit} /></Field>}
      <Field label={`Mínimo por pedido (${unit})`} help="0 = sin mínimo"><Qty value={min} onChange={setMin} step={l.unit === 'kg' ? 5 : 1} unit={unit} /></Field>
      <Field label="Fotos de tu cosecha" help="La primera es la portada en el catálogo."><PhotosPick value={photos} onChange={setPhotos} max={3} label="Foto de la cosecha" kind="producto" sample={{ color: product(l.productId).color }} /></Field>
      <Btn full kind="dark" onClick={() => save()}>Guardar cambios</Btn>
      {l.reserved <= 0 && <Btn full kind="secd" onClick={async () => { if (await A.confirm({ title: '¿Dar de baja esta publicación?', text: 'Deja de verse en el catálogo. Puedes publicar de nuevo cuando quieras.', ok: 'Dar de baja', danger: true })) { A.act('LISTING_REMOVE', { listingId: id }, { ok: 'Publicación dada de baja.' }); } }}>Dar de baja</Btn>}
    </SheetBody>
  );
}

/* ---------- A-10 · Publicar (voz o íconos) ---------- */
export interface PubDraft { productId?: string; variety?: string; qty: number; unit: Unit; unitKg: number; pricePerKg?: number; harvestDays: number; quality: Quality; farmId?: string; photoIds?: string[]; /** borradores de antes (una sola foto) */ photoId?: string; minQty?: number; voice?: string; fromLotId?: string; notes?: string[] }
/** Fotos del borrador (la primera es la portada). */
const draftPhotos = (d: PubDraft): string[] => d.photoIds ?? (d.photoId ? [d.photoId] : []);
/** «Cosechado hoy» (RN-22): foto tomada con la app (no de la galería) y cosecha de hoy. */
const sealOf = (d: PubDraft) => draftPhotos(d).some(id => !id.startsWith('ph-gal-')) && d.harvestDays === 0;
const emptyDraft = (): PubDraft => ({ qty: 50, unit: 'kg', unitKg: 1, harvestDays: 0, quality: 'PRIMERA' });
function draftFrom(l: Listing): PubDraft { return { productId: l.productId, variety: l.variety, qty: l.qtyTotal, unit: l.unit, unitKg: l.unitKg, pricePerKg: r2(pricePerKg(l)), harvestDays: 0, quality: l.quality, farmId: l.farmId, minQty: l.minQty, photoIds: l.photoIds.slice(0, 3) }; }
function getDraft(A: AppCtx): PubDraft { return { ...emptyDraft(), ...(A.dev.flow.pub ?? {}) }; }
function setDraft(A: AppCtx, d: Partial<PubDraft>) { A.patch(x => { x.flow = { ...x.flow, pub: { ...emptyDraft(), ...(x.flow.pub ?? {}), ...d } }; }); }

function blockReason(A: AppCtx): string | undefined {
  const org = A.org!;
  if (org.level < 1) return 'Primero verificamos tu identidad (nivel 1). Mientras tanto puedes explorar.';
  if (org.status === 'SUSPENDED') return 'Tu cuenta está suspendida. Escríbele a Soporte.';
  const od = overdueStatement(A.w, org.id);
  if (od) return `Tu estado de cuenta de ${od.period} venció: págalo para volver a publicar (RN-40).`;
  return undefined;
}

function Publish() {
  const A = useApp();
  const [mode, setMode] = useState<'voz' | 'form'>(A.top.p?.mode ?? (A.dev.flow.pub?.productId ? 'form' : 'voz'));
  const block = blockReason(A);
  return (
    <Screen title={A.t('publish.title', 'Publicar cosecha')} sub={mode === 'voz' ? 'Con tu voz, en tu idioma' : 'Sin voz: elige con íconos'} back={false}>
      <div className="stack">
        <Seg value={mode} onChange={setMode} options={[{ v: 'voz', l: 'Con tu voz' }, { v: 'form', l: 'Con íconos' }]} />
        {block && <Note icon="lock" tone="warn">{block}</Note>}
        {mode === 'voz' ? <VoicePublish onForm={() => setMode('form')} /> : <FormPublish />}
      </div>
    </Screen>
  );
}

function VoicePublish({ onForm }: { onForm: () => void }) {
  const A = useApp();
  const [rec, setRec] = useState(false);
  const [partial, setPartial] = useState('');
  const [text, setText] = useState('');
  const [res, setRes] = useState<VoiceResult | null>(null);
  const [err, setErr] = useState('');
  const stopRef = useRef<() => void>(() => {});
  const crops = Object.values(A.w.farms).filter(f => f.orgId === A.org!.id).flatMap(f => f.crops);
  const run = (t: string) => {
    const r = interpret(t, { now: A.now, crops });
    setRes(r);
    setErr('');
    if (r.complete) {
      // D-04: si entendimos producto y cantidad, pasamos solos a confirmar
      const price = r.pricePerKg ?? suggestedPricePerKg(r.productId!);
      setDraft(A, { productId: r.productId, variety: r.variety, qty: r.qty!, unit: r.unit!, unitKg: r.unitKg ?? 1, pricePerKg: price, harvestDays: Math.max(0, r.harvestDaysAgo ?? 0), quality: r.quality ?? 'PRIMERA', voice: t, notes: r.notes, farmId: Object.values(A.w.farms).find(f => f.orgId === A.org!.id && f.crops.includes(r.productId!))?.id ?? Object.values(A.w.farms).find(f => f.orgId === A.org!.id)?.id });
      A.go('A-11', { voice: 1 });
    } else A.say('No entendí todo. Revisa lo que falta o usa el formulario con íconos.');
  };
  const start = () => {
    if (!canListen()) { setErr('Este navegador no reconoce la voz aquí. Escribe la frase o toca una de ejemplo.'); return; }
    setRec(true); setPartial(''); setErr('');
    const l = listen(setPartial);
    stopRef.current = l.stop;
    l.done.then(t => { setRec(false); setText(t); run(t); }).catch((e: Error) => { setRec(false); setErr(e.message); });
  };
  const stop = () => { stopRef.current(); };
  const sug = res?.productId ? suggestedPricePerKg(res.productId) : undefined;
  return (
    <div className="stack">
      <div className="center">
        <button className={'mic' + (rec ? ' rec' : '')} aria-label={rec ? (IN_APK ? 'Escuchando' : 'Escuchando: suelta para terminar') : IN_APK ? 'Toca y habla' : 'Mantén presionado y habla'} onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); start(); }} onPointerUp={stop} onKeyDown={(e: any) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); rec ? stop() : start(); } }}><Icon n="mic" s="2.6em" /></button>
        <div className="h3" style={{ marginTop: "-.6em" }}>{rec ? 'Te escucho...' : IN_APK ? 'Toca y habla' : 'Mantén presionado y habla'}</div>
        {rec && partial && <div className="cap mt">«{partial}»</div>}
      </div>
      {err && <Note icon="info" tone="warn">{err}</Note>}
      <div className="row g8">
        <div className="grow"><Inp value={text} onInput={setText} placeholder="O escribe lo que dirías" label="Frase" /></div>
        <Btn kind="dark" onClick={() => run(text)} disabled={!text.trim()}>Listo</Btn>
      </div>
      <div className="chips">{SAMPLE_PHRASES.map(p => <button key={p} className="chip line" style={{ whiteSpace: "normal", textAlign: "left" }} onClick={() => { setText(p); run(p); }}>«{p}»</button>)}</div>
      {res && !res.complete && (
        <>
          <div className="sect">Esto entendí</div>
          <Card>
            <Kv rows={[['Producto', res.productId ? product(res.productId).name : <span className="bad">No entendí</span>], ['Cantidad', res.qty !== undefined ? qtyText(res.qty, res.unit!, res.unitKg ?? 1) : <span className="bad">No entendí</span>], ['Precio', res.pricePerKg ? `${money(res.pricePerKg)} por kg` : 'Te sugerimos uno'], ['Cosecha', res.harvestDaysAgo !== undefined ? harvestText(A.now - res.harvestDaysAgo * DAY, A.now) : 'Hoy']]} />
          </Card>
          {res.notes.map((n, i) => <div key={i} className="cap">• {n}</div>)}
          {sug && <Card tone="soft"><div className="center b bodym">Precio sugerido: {money(sug)} por kg</div></Card>}
          <Btn full kind="sec" onClick={() => { setDraft(A, { productId: res.productId, qty: res.qty ?? 50, unit: res.unit ?? 'kg', unitKg: res.unitKg ?? 1, pricePerKg: res.pricePerKg, harvestDays: Math.max(0, res.harvestDaysAgo ?? 0) }); onForm(); }}>Completar con íconos</Btn>
        </>
      )}
      <button className="btn sec full" onClick={() => A.go('A-21')}>Guardar en almacén cercano</button>
    </div>
  );
}

function FormPublish() {
  const A = useApp();
  const d = getDraft(A);
  const org = A.org!;
  const farms = Object.values(A.w.farms).filter(f => f.orgId === org.id);
  const crops = [...new Set(farms.flatMap(f => f.crops))];
  const quick = [...new Set([...crops, 'papa_amarilla', 'cebolla_roja', 'arroz_pilado', 'frejol_canario', 'maiz_choclo', 'haba_verde'])].slice(0, 9);
  const [all, setAll] = useState(false);
  const [err, setErr] = useState('');
  const p = d.productId ? product(d.productId) : undefined;
  const sug = d.productId ? suggestedPricePerKg(d.productId) : undefined;
  const [priceTxt, setPriceTxt] = useState(d.pricePerKg !== undefined ? String(d.pricePerKg).replace('.', ',') : '');
  const last = Object.values(A.w.listings).filter(l => l.orgId === org.id && !l.fromLotId).sort((a, b) => b.createdAt - a.createdAt)[0];
  const block = blockReason(A);
  const pick = (pid: string) => { const pr = product(pid); setDraft(A, { productId: pid, variety: undefined, unit: pr.units.includes(d.unit) ? d.unit : 'kg', unitKg: pr.units.includes(d.unit) ? unitKgFor(pid, d.unit) : 1, farmId: farms.find(f => f.crops.includes(pid))?.id ?? d.farmId ?? farms[0]?.id }); setPriceTxt(String(suggestedPricePerKg(pid)).replace('.', ',')); setAll(false); };
  const review = () => {
    const price = Number(priceTxt.replace(',', '.'));
    if (!d.productId) { setErr('Elige el producto.'); return; }
    if (!(d.qty > 0)) { setErr('Escribe la cantidad.'); return; }
    if (!(price > 0)) { setErr('Escribe el precio por kilo.'); return; }
    setDraft(A, { pricePerKg: price });
    A.go('A-11');
  };
  const units = p ? p.units.filter(u => u !== 'atado') : ['kg' as Unit];
  return (
    <div className="stack">
      {last && !d.productId && <button className="chip line" style={{ alignSelf: "flex-start" }} onClick={() => { setDraft(A, draftFrom(last)); setPriceTxt(String(r2(pricePerKg(last))).replace('.', ',')); }}><Icon n="repeat" s="1.1em" />Repetir: {product(last.productId).name.toLowerCase()} {last.unit === 'kg' ? fkg(last.qtyTotal) : `${last.qtyTotal} ${UNIT_LABEL[last.unit].many}`}</button>}
      <div className="grid3">
        {(all ? allProducts().map(x => x.id) : quick).map(pid => (
          <button key={pid} className={'card ' + (d.productId === pid ? 'sel' : '')} style={{ padding: ".6em .3em", textAlign: "center" }} onClick={() => pick(pid)} aria-pressed={d.productId === pid ? 'true' : 'false'}>
            <div className="stack tight" style={{ alignItems: "center" }}><Tile pid={pid} size="sm" /><span className="cap b" style={{ color: "var(--ink)" }}>{product(pid).short}</span></div>
          </button>
        ))}
      </div>
      <button className="linkbtn" style={{ alignSelf: "flex-start" }} onClick={() => setAll(!all)}>{all ? 'Ver menos' : `Ver los ${PRODUCTS.length} productos`}</button>
      {p && <>
        <div className="grid2">
          <Field label="Variedad">{p.varieties?.length ? <Sel value={d.variety ?? ''} onChange={(v) => setDraft(A, { variety: v || undefined })} options={[{ v: '', l: 'Sin variedad' }, ...p.varieties.map(v => ({ v, l: v }))]} label="Variedad" /> : <Inp value={d.variety ?? ''} onInput={(v) => setDraft(A, { variety: v })} placeholder="Opcional" label="Variedad" />}</Field>
          <Field label={A.t('publish.quantity', 'Cantidad')}><Inp value={String(d.qty)} onInput={(v) => setDraft(A, { qty: Number(v.replace(',', '.')) || 0 })} mode="decimal" suffix={d.unit === 'kg' ? 'kg' : UNIT_LABEL[d.unit].many} label="Cantidad" /></Field>
        </div>
        <Seg value={d.unit} onChange={(u) => setDraft(A, { unit: u, unitKg: unitKgFor(p.id, u), qty: u === 'kg' ? d.qty : Math.max(1, Math.round(d.qty)) })} options={units.map(u => ({ v: u, l: u === 'kg' ? 'kg' : u === 'saco' ? `saco de ${p.sackKg} kg` : u === 'arroba' ? 'arroba' : `jaba de ${p.jabaKg ?? 25} kg` }))} />
        <Field label={A.t('publish.price', 'Precio por kilo')} help={sug ? `Sugerido: ${money(sug)}, la mitad entre chacra (${money(p.ref.chacra)}) y mayorista (${money(p.ref.mayorista)}), según ${p.ref.source.startsWith('Midagri') ? 'el Midagri' : 'la referencia de la demo'}.` : undefined}>
          <Inp value={priceTxt} onInput={setPriceTxt} mode="decimal" prefix="S/" placeholder={sug ? String(sug).replace('.', ',') : ''} label="Precio por kilo" />
        </Field>
        <div className="lbl">Cosecha</div>
        <div className="chips">{[[0, 'Hoy'], [1, 'Ayer'], [2, 'Anteayer'], [7, 'Hace una semana']].map(([n, l]) => <ChipBtn key={n} on={d.harvestDays === n} onClick={() => setDraft(A, { harvestDays: Number(n) })}>{l as string}</ChipBtn>)}</div>
        <div className="lbl">Calidad</div>
        <Seg value={d.quality} onChange={(q) => setDraft(A, { quality: q })} options={[{ v: 'PRIMERA', l: 'Primera' }, { v: 'SEGUNDA', l: 'Segunda' }, { v: 'TERCERA', l: 'Tercera' }]} />
        {farms.length > 0 && <Field label="Chacra de origen"><Sel value={d.farmId ?? farms[0].id} onChange={(v) => setDraft(A, { farmId: v })} options={farms.map(f => ({ v: f.id, l: `${f.name} · ${placeLabel(f.district)} · ${String(f.areaHa).replace('.', ',')} ha` }))} label="Chacra" /></Field>}
        <Field label="Fotos de tu cosecha" help="La primera es la portada: es lo que ven los compradores. Si la tomas hoy con la app, ganas el sello «Cosechado hoy» (RN-22).">
          <PhotosPick value={draftPhotos(d)} onChange={(ids) => setDraft(A, { photoIds: ids, photoId: undefined })} label="Foto de la cosecha" kind="producto" sample={{ color: p.color, stamp: `Tomada en la app · ${hhmm(A.now)} · GPS en la chacra` }} />
        </Field>
      </>}
      {err && <Note icon="circle-alert" tone="danger">{err}</Note>}
      <Btn full onClick={review} disabled={!!block} why={block}>{A.t('publish.review', 'Revisar')}</Btn>
    </div>
  );
}

/* ---------- A-11 · Revisa y publica ---------- */
function ConfirmPublish() {
  const A = useApp();
  const d = getDraft(A);
  const org = A.org!;
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (A.top.p?.voice && d.productId) A.say(`Vas a publicar ${qtyText(d.qty, d.unit, d.unitKg)} de ${product(d.productId).name} a ${money(d.pricePerKg ?? 0)} el kilo. ¿Confirmas?`); }, []);
  if (!d.productId) return <Screen title="Revisa y publica"><Empty title="Primero elige qué vas a publicar" /><Btn full onClick={() => A.replace('A-10')}>Publicar</Btn></Screen>;
  const p = product(d.productId);
  const price = d.pricePerKg ?? suggestedPricePerKg(d.productId);
  const unitPrice = r2(price * (d.unit === 'kg' ? 1 : d.unitKg));
  const totalKg = d.qty * (d.unit === 'kg' ? 1 : d.unitKg);
  const farm = d.farmId ? A.w.farms[d.farmId] : undefined;
  const harvestAt = harvestDate(A.now, d.harvestDays);
  const photos = draftPhotos(d);
  const seal = sealOf(d);
  const left = Math.max(0, A.w.settings.commission.freeSales - org.counters.freeSalesUsed - reservedFreeSlots(A.w, org.id));
  const zones = org.serviceAreas.map(a => districtName(a.district));
  const dev = priceDeviation(price, suggestedPricePerKg(d.productId), A.w.settings.priceDeviation);
  const pl = farm ? plausibility(totalKg, farm.areaHa, p.yieldHigh, A.w.settings.plausibilityFactor) : undefined;
  const block = blockReason(A);
  const payload = (confirmPrice: boolean) => ({ orgId: org.id, listingId: 'l-' + uid(), productId: d.productId, variety: d.variety, unit: d.unit, unitKg: d.unit === 'kg' ? 1 : d.unitKg, qty: d.qty, price: unitPrice, harvestDate: harvestAt, quality: d.quality, farmId: d.farmId, photoIds: photos, harvestSeal: seal, confirmPrice, minQty: d.minQty, fromLotId: d.fromLotId });
  const publish = async () => {
    setBusy(true);
    let confirm = false;
    const c = A.check('LISTING_PUBLISH', payload(false));
    if (!c.ok && c.error?.code === 'PRICE_CONFIRM') {
      confirm = await A.confirm({ title: '¿Confirmas el precio?', text: c.error.message, ok: 'Sí, confirmo', cancel: 'Cambiar el precio' });
      if (!confirm) { setBusy(false); A.back(); return; }
    }
    const r = A.act('LISTING_PUBLISH', payload(confirm));
    setBusy(false);
    if (!r.ok) return;
    A.patch(x => { x.flow = { ...x.flow, pub: undefined }; x.stack = [{ s: 'A-08' }, { s: 'A-09' }]; });
    A.toast(r.result.status === 'IN_REVIEW' ? 'Tu publicación está en revisión: la cantidad es alta para tu chacra (RN-23).' : !A.dev.online ? 'Guardamos tu publicación: se envía sola cuando vuelva la señal.' : '¡Publicado! Ya lo ven los compradores.', r.result.status === 'IN_REVIEW' ? 'warn' : 'ok');
  };
  const edit = () => A.replace('A-10', { mode: 'form' });
  return (
    <Screen title="Revisa y publica" sub="Así la verán los compradores" foot={<><Btn full onClick={publish} loading={busy} disabled={!!block || !photos.length} why={block ?? (!photos.length ? 'Agrega al menos una foto de tu cosecha.' : undefined)}>{A.t('publish.confirm', 'Publicar')}</Btn><Btn full kind="sec" onClick={() => A.go('A-21')}>Guardar en un almacén aliado</Btn></>}>
      <div className="stack">
        {d.voice && <Card tone="soft"><div className="row top g8"><Icon n="audio-lines" /><div className="grow"><div className="cap">Dijiste</div><div className="bodym">«{d.voice}»</div></div><Spk text={`Vas a publicar ${qtyText(d.qty, d.unit, d.unitKg)} de ${p.name} a ${money(price)} el kilo. ¿Confirmas?`} /></div></Card>}
        <Card>
          {photos.length > 0 && <div style={{ marginBottom: '.8em' }}><Gallery ids={photos} label={p.name} /></div>}
          <div className="row top">
            {!photos.length && <Tile pid={d.productId} size="lg" />}
            <div className="grow">
              <div className="h3">{p.name}{d.variety ? ` ${d.variety}` : ''} · {qtyText(d.qty, d.unit, d.unitKg)}</div>
              <div className="price" style={{ fontSize: "1.1em" }}>{money(price)} por kg</div>
              <div className="cap">{moneyShort(r2(price * totalKg))} si vendes todo{d.unit !== 'kg' ? ` · ${money(unitPrice)} por ${UNIT_LABEL[d.unit].one}` : ''}</div>
            </div>
            <button className="iconbtn" onClick={edit} aria-label="Editar"><Icon n="pencil" s="1.1em" /></button>
          </div>
          <div className="mt"><Kv rows={[['Chacra', farm ? `${farm.name} · ${placeLabel(farm.district)}` : '—'], ['Cosecha', `${harvestText(harvestAt, A.now)}, ${dayMonth(harvestAt)}`], ['Entrega', zones.length ? zones.slice(0, 3).join(', ') + (zones.length > 3 ? ` y ${zones.length - 3} más` : '') : 'Sin zonas: marca dónde entregas'], ['Calidad', d.quality === 'PRIMERA' ? 'Primera' : d.quality === 'SEGUNDA' ? 'Segunda' : 'Tercera']]} /></div>
          <div className="chips mt">{seal && <Chip tone="leaf" icon="sparkles">Cosechado hoy</Chip>}<Chip icon="shield-check">Nivel {org.level}</Chip>{photos.length > 0 && <Chip tone="line" icon="camera">{photos.length === 1 ? 'Con foto' : `${photos.length} fotos`}</Chip>}</div>
        </Card>
        {photos.length > 0 && photos.length < 3 && <PhotosPick value={photos} onChange={(ids) => setDraft(A, { photoIds: ids, photoId: undefined })} label="Foto de la cosecha" kind="producto" sample={{ color: p.color, stamp: `Tomada en la app · ${hhmm(A.now)} · GPS en la chacra` }} />}
        {!photos.length && <Card tone="warn"><div className="stack tight">
          <b className="bodym">Agrega una foto de tu cosecha</b>
          <div className="cap">Los compradores compran con lo que ven: la foto es lo primero que miran. Tómala ahora o elígela de tu galería.</div>
          <PhotosPick value={photos} onChange={(ids) => setDraft(A, { photoIds: ids, photoId: undefined })} label="Foto de la cosecha" kind="producto" sample={{ color: p.color, stamp: `Tomada en la app · ${hhmm(A.now)} · GPS en la chacra` }} />
        </div></Card>}
        {(d.notes ?? []).map((n, i) => <div key={i} className="cap">• {n}</div>)}
        {dev.ask && <Note icon="triangle-alert" tone="warn">Tu precio se aleja {Math.round(Math.abs(dev.dev) * 100)} % del sugerido ({money(suggestedPricePerKg(d.productId))} por kg). Te pediremos confirmarlo (RN-29).</Note>}
        {pl && !pl.ok && <Note icon="triangle-alert" tone="warn">{fkg(totalKg)} pasa lo que rinden {String(farm!.areaHa).replace('.', ',')} ha de {p.name.toLowerCase()}: la publicación queda en revisión antes de verse (RN-23).</Note>}
        <Card tone="warn"><div className="row top g8"><Icon n="percent" /><div className="bodym">{left > 0 ? <><b>Tus primeras {A.w.settings.commission.freeSales} ventas no pagan comisión.</b> Te quedan {left}. Después, solo {pct(A.w.settings.commission.rate)} de lo que vendas.</> : <>Pagas {pct(A.w.settings.commission.rate)} de cada venta conforme, una vez al mes. Si no vendes, no pagas.</>}</div></div></Card>
      </div>
    </Screen>
  );
}

/* ---------- A-12 · Pedidos ---------- */
function FarmerOrders() {
  const A = useApp();
  const subs = subOrdersOf(A.w, s => s.sellerOrgId === A.org!.id);
  const g = {
    new: subs.filter(s => s.status === 'PENDING_CONFIRMATION'),
    deliver: subs.filter(s => ['CONFIRMED', 'AWAITING_HARVEST', 'PREPARING', 'READY', 'IN_TRANSIT'].includes(s.status)),
    done: subs.filter(s => ['DELIVERED', 'COMPLETED', 'DISPUTED'].includes(s.status)),
    dead: subs.filter(s => ['REJECTED', 'EXPIRED', 'CANCELLED_BY_BUYER', 'CANCELLED_BY_SELLER'].includes(s.status)),
  };
  const [tab, setTab] = useState<keyof typeof g>(A.top.p?.tab ?? (g.new.length ? 'new' : 'deliver'));
  return (
    <Screen title="Pedidos" right={<button className="act" aria-label="Mensajes" onClick={() => A.go('A-18')}><Icon n="message-circle" s="1.3em" /></button>}>
      <div className="stack">
        <Seg value={tab} onChange={setTab} options={[{ v: 'new', l: `Nuevos ${g.new.length}` }, { v: 'deliver', l: `Por entregar ${g.deliver.length}` }, { v: 'done', l: 'Entregados' }, { v: 'dead', l: 'Otros' }]} />
        {(() => { const open = Object.values(A.w.requests).filter(r => r.status === 'OPEN' && A.now < r.closesAt).length; return <div className="row g8 wrap"><ChipBtn icon="clipboard-list" onClick={() => A.go('A-27')}>Solicitudes de compra{open ? ` · ${open} abiertas` : ''}</ChipBtn></div>; })()}
        {g[tab].length === 0 && <Card><Empty icon="shopping-bag" title="Nada por aquí" text={tab === 'new' ? 'Cuando un negocio te pida, aparece aquí con su plazo.' : undefined} /></Card>}
        {g[tab].slice(0, 25).map(s => <OrderCard key={s.id} s={s} side="seller" />)}
        {tab === 'new' && <><div className="sect">Si no respondes a tiempo</div><p className="cap" style={{ margin: "0" }}>El pedido vence, el stock vuelve a tu publicación y baja tu indicador de respuesta (RN-08).</p></>}
      </div>
    </Screen>
  );
}

/* ---------- A-13 · Detalle del pedido ---------- */
const REJECT_REASONS = ['No tengo esa cantidad', 'No llego a esa fecha', 'Ya lo vendí a otra persona', 'No reparto en esa zona'];

function FarmerOrder() {
  const A = useApp();
  const s = A.w.subOrders[A.top.p?.id as string];
  if (!s) return <Screen title="Pedido"><Empty title="No encontramos el pedido" /></Screen>;
  const w = A.w;
  const buyer = w.orgs[s.buyerOrgId];
  const st = statusInfo(s, 'seller');
  const com = commissionInfo(w, s);
  const sh = s.shipmentId ? w.shipments[s.shipmentId] : undefined;
  const pending = s.status === 'PENDING_CONFIRMATION';
  const prepayWait = s.prepay && s.payment.status !== 'CONFIRMED' && s.payment.method !== 'CASH';
  const rel = Object.values(w.releases).find(r => r.subOrderId === s.id && r.status !== 'EXPIRED');
  const accept = () => {
    const r = A.act('SUBORDER_ACCEPT', { subOrderId: s.id });
    if (r.ok) A.toast(`Aceptaste el pedido. ${com?.free ? 'Es una venta sin comisión.' : `Comisión: ${money(com?.amount ?? 0)}.`}${sh ? ' Buscamos un transportista aliado.' : ''}`);
  };
  const reject = () => A.sheet(<RejectSheet id={s.id} />);
  const actions = () => {
    if (pending) return <><div className="btnrow"><Btn kind="sec" onClick={reject}>{A.t('order.reject', 'Rechazar')}</Btn><Btn kind="dark" onClick={accept}>{A.t('order.accept', 'Aceptar pedido')}</Btn></div><div className="why"><Icon n="clock" s="1em" /> Responde antes de las {hhmm(s.confirmBy)} ({duration(Math.max(0, s.confirmBy - A.now))})</div></>;
    if (s.payment.status === 'UPLOADED') return <Btn full kind="dark" icon="banknote" onClick={() => A.go('A-14', { id: s.id })}>{A.t('payment.title', 'Confirma el pago')}</Btn>;
    if (s.fromLot && ['CONFIRMED', 'PREPARING'].includes(s.status) && !rel) return <Btn full kind="dark" icon="warehouse" disabled={prepayWait} why={prepayWait ? 'Este comprador paga antes de la entrega: espera su constancia.' : undefined} onClick={() => { const lot = Object.values(w.lots).find(l => l.listingId && s.items.some(i => i.listingId === l.listingId)); if (lot) A.go('A-24', { lot: lot.id, sub: s.id }); }}>Crear la orden de salida del almacén</Btn>;
    if (s.status === 'CONFIRMED') return <Btn full kind="dark" icon="package" disabled={prepayWait} why={prepayWait ? 'Con su nivel, este comprador paga antes de que prepares (RN-24).' : undefined} onClick={() => A.act('SUBORDER_PREPARE', { subOrderId: s.id }, { ok: 'Pedido en preparación.' })}>Empezar a preparar</Btn>;
    if (s.status === 'PREPARING') return <Btn full kind="dark" icon="check" onClick={() => A.act('SUBORDER_READY', { subOrderId: s.id }, { ok: s.deliveryMode === 'PICKUP' ? 'Listo: avisamos al comprador que puede recoger.' : 'Pedido listo.' })}>Marcar listo</Btn>;
    if (s.status === 'READY' && s.deliveryMode === 'FARMER') return <Btn full kind="dark" icon="truck" onClick={() => { if (A.act('SUBORDER_DISPATCH', { subOrderId: s.id }).ok) A.go('A-15', { id: s.id }); }}>Salir a entregar</Btn>;
    if (s.status === 'READY' && s.deliveryMode === 'PICKUP') return <Btn full kind="dark" icon="hand-coins" onClick={() => A.go('A-15', { id: s.id })}>Entregar al comprador</Btn>;
    if (['READY', 'PREPARING'].includes(s.status) && s.deliveryMode === 'CARRIER' && sh) return <Btn full kind="dark" icon="truck" onClick={() => A.go('A-30', { id: sh.id })}>Entrega al transportista</Btn>;
    if (s.status === 'IN_TRANSIT' && s.deliveryMode === 'FARMER') return <Btn full kind="dark" icon="clipboard-check" onClick={() => A.go('A-15', { id: s.id })}>{A.t('delivery.title', 'Registrar la entrega')}</Btn>;
    if (s.status === 'COMPLETED' && !s.reviewSeller) return <Btn full kind="dark" icon="star" onClick={() => A.sheet(<ReviewSheet id={s.id} side="SELLER" />)}>Califica al comprador</Btn>;
    return null;
  };
  return (
    <Screen title={`Pedido ${s.code}`} sub={`${st.label} · ${ago(s.createdAt, A.now)}`} foot={actions()}>
      <div className="stack">
        <Card>
          <div className="row"><Av org={buyer} /><div className="grow"><b className="bodym">{buyer?.name}</b><div className="cap">{districtName(buyer?.district)} · nivel {buyer?.level} · {ratingText(w, s.buyerOrgId)}</div></div><button className="iconbtn" aria-label="Mensaje" onClick={() => A.go('CHAT', { id: s.id })}><Icon n="message-circle" s="1.15em" /></button></div>
        </Card>
        {(() => { const o = originOf(w, s); return o ? <Card tone="soft"><div className="row"><Icon n={o.kind === 'REQUEST' ? 'clipboard-list' : 'repeat'} /><div className="grow bodym">{o.kind === 'REQUEST' ? <>Venta por solicitud <b>{o.code}</b>: {buyer?.name ?? 'el negocio'} aceptó tu oferta.</> : <>Pedido programado <b>{o.code}</b>: {buyer?.name ?? 'el negocio'} lo pide cada cierto tiempo.</>}</div></div></Card> : null; })()}
        <Card>
          <Kv total rows={[
            ...s.items.map(i => [product(i.productId).name + (i.name.includes(' ') && i.name !== product(i.productId).name ? '' : ''), `${i.unit === 'kg' ? fkg(i.qty) : qtyText(i.qty, i.unit, i.unitKg)} × ${money(i.price)}`] as [string, string]),
            ['Entrega', `${dateShort(s.deliveryDate)} · ${slotOf(w, s)}`],
            ['Cómo', deliveryText(s) + (s.deliveryFee ? ` · ${money(s.deliveryFee)}` : '')],
            ['Lugar', pending ? `${districtName(s.district)} (dirección al aceptar)` : withDistrict(s.address, districtName(s.district))],
            ['Comprobante', TAXDOC_LABEL[s.taxDoc] + (s.taxDocNumber ? ` ${s.taxDocNumber}` : '')],
            ['Pago', s.payment.method === 'CASH' ? 'Efectivo al entregar' : `${PAY_LABEL[s.payment.method]} ${s.payment.status === 'CONFIRMED' ? '· confirmado' : s.payment.status === 'UPLOADED' ? '· por confirmar' : s.prepay ? '· antes de preparar' : 'al confirmar'}`],
            ['Total', money(s.total)],
          ]} />
        </Card>
        {com && <Card tone="warn"><div className="row between"><b className="bodym" style={{ color: "var(--ink)" }}>{com.title}</b><b style={{ color: "var(--ink)" }}>{money(com.amount)}</b></div><div className="cap" style={{ color: "#6b5110" }}>{com.note}</div></Card>}
        {s.taxDoc === 'LIQUIDACION' && !pending && <Note icon="file-text">No tienes RUC: el comprador emite la liquidación de compra en la SUNAT (RN-34). Te llegará su número.</Note>}
        {s.taxDoc !== 'LIQUIDACION' && ['DELIVERED', 'COMPLETED', 'IN_TRANSIT', 'READY'].includes(s.status) && !s.taxDocNumber && <TaxDocCard id={s.id} label={TAXDOC_LABEL[s.taxDoc]} />}
        {sh && <Card><div className="row"><ICirc n="truck" tone="terra" /><div className="grow"><b className="bodym">{sh.code} · transportista aliado</b><div className="cap">{sh.carrierOrgId ? `${orgName(w, sh.carrierOrgId)} · recoge ${relDay(sh.pickupAt, A.now)} ${hhmm(sh.pickupAt)}` : sh.status === 'OFFERING' ? 'Buscando transportista' : sh.status === 'WAITING_FARMER' ? 'Se busca transportista cuando aceptes' : sh.status === 'NO_CARRIER' ? 'Nadie aceptó: el comprador elige otra opción' : 'Envío cancelado'}</div></div>{sh.carrierOrgId && <Btn xs kind="sec" onClick={() => A.go('A-30', { id: sh.id })}>Ver</Btn>}</div></Card>}
        {rel && <Card tone="soft"><div className="row"><Icon n="qr-code" /><div className="grow"><b className="bodym">Orden de salida {rel.code}</b><div className="cap">{rel.status === 'WAITING_RENT' ? 'Se activa cuando el almacén confirme el alquiler' : rel.status === 'ACTIVE' ? `Activa hasta el ${dateShort(rel.expiresAt!)}` : 'Usada'}</div></div></div></Card>}
        {s.status === 'DISPUTED' && s.disputeId && <Note icon="triangle-alert" tone="danger">Disputa {w.disputes[s.disputeId]?.code}: {w.disputes[s.disputeId]?.description}. Soporte media y propone una solución; Mesagri no retiene dinero (RN-15).</Note>}
        <div className="sect">Seguimiento</div>
        <Card><Timeline steps={timelineFor(s, w)} /></Card>
        {['CONFIRMED', 'PREPARING', 'READY'].includes(s.status) && <button className="linkbtn" style={{ alignSelf: "center", color: "var(--danger)" }} onClick={() => A.sheet(<SellerCancelSheet id={s.id} />)}>No puedo cumplir este pedido</button>}
      </div>
    </Screen>
  );
}

function TaxDocCard({ id, label }: { id: string; label: string }) {
  const A = useApp();
  const [n, setN] = useState('');
  return (
    <Card tone="soft">
      <b className="bodym">Registra tu {label.toLowerCase()}</b>
      <div className="cap">Emítela en la SUNAT y escribe su serie y número (RF-PAY-04).</div>
      <div className="row g8 mt"><div className="grow"><Inp value={n} onInput={setN} placeholder="E001-245" label="Serie y número" /></div><Btn sm kind="dark" onClick={() => A.act('TAXDOC_REGISTER', { subOrderId: id, number: n }, { ok: `${label} registrada.` })}>Guardar</Btn></div>
    </Card>
  );
}

function RejectSheet({ id }: { id: string }) {
  const A = useApp();
  const [reason, setReason] = useState(REJECT_REASONS[0]);
  const [other, setOther] = useState('');
  return (
    <SheetBody title="¿Por qué no puedes aceptar?" sub="El comprador ve el motivo. El stock vuelve a tu publicación.">
      <div className="chips">{[...REJECT_REASONS, 'Otro'].map(r => <ChipBtn key={r} on={reason === r} onClick={() => setReason(r)}>{r}</ChipBtn>)}</div>
      {reason === 'Otro' && <Inp value={other} onInput={setOther} placeholder="Escribe el motivo" label="Motivo" />}
      <Btn full kind="danger" onClick={() => { if (A.act('SUBORDER_REJECT', { subOrderId: id, reason: reason === 'Otro' ? other : reason }, { ok: 'Rechazaste el pedido. Avisamos al comprador.' }).ok) A.sheet(null); }}>Rechazar pedido</Btn>
    </SheetBody>
  );
}

function SellerCancelSheet({ id }: { id: string }) {
  const A = useApp();
  const [reason, setReason] = useState('');
  return (
    <SheetBody title="Cancelar un pedido aceptado" sub="Se anota en tu reputación (RN-10). Si ya te pagaron, coordinen la devolución.">
      <Inp area value={reason} onInput={setReason} placeholder="Cuéntale al comprador qué pasó" label="Motivo" />
      <Btn full kind="danger" onClick={() => { if (A.act('SUBORDER_SELLER_CANCEL', { subOrderId: id, reason }, { ok: 'Pedido cancelado.' }).ok) A.sheet(null); }}>Cancelar pedido</Btn>
    </SheetBody>
  );
}

const TAGS = { SELLER: ['Pago puntual', 'Buen trato', 'Recibió a tiempo', 'Claro en lo que pide'], BUYER: ['Puntual', 'Peso exacto', 'Buena calidad', 'Bien empacado', 'Buen trato'] };
export function ReviewSheet({ id, side }: { id: string; side: 'SELLER' | 'BUYER' }) {
  const A = useApp();
  const s = A.w.subOrders[id];
  const [stars, setStars] = useState(5);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const other = A.w.orgs[side === 'BUYER' ? s.sellerOrgId : s.buyerOrgId];
  return (
    <SheetBody title={`¿Cómo te fue con ${other?.name}?`} sub="Se publica junto con la del otro, o a los 7 días (RN-12).">
      <div className="center"><Starsx v={stars} onChange={setStars} /></div>
      <div className="lbl">¿Qué destacas?</div>
      <div className="chips">{TAGS[side].map(t => <ChipBtn key={t} on={tags.includes(t)} onClick={() => setTags(tags.includes(t) ? tags.filter(x => x !== t) : [...tags, t])}>{t}</ChipBtn>)}</div>
      <Inp area value={comment} onInput={setComment} placeholder="Comentario (opcional)" label="Comentario" />
      <Btn full onClick={() => { if (A.act('REVIEW_SUBMIT', { reviewId: 'rv-' + uid(), subOrderId: id, side, stars, tags, comment }, { ok: 'Gracias por calificar.' }).ok) A.sheet(null); }}>Enviar calificación</Btn>
    </SheetBody>
  );
}

/* ---------- A-14 · Cobro y constancia ---------- */
function ConfirmPayment() {
  const A = useApp();
  const s = A.w.subOrders[A.top.p?.id as string];
  if (!s) return <Screen title="Pago"><Empty title="No encontramos el pedido" /></Screen>;
  const buyer = A.w.orgs[s.buyerOrgId];
  const acct = A.org!.payout.find(a => (s.payment.method === 'TRANSFER' ? a.kind === 'BANK' : a.kind === s.payment.method)) ?? A.org!.payout[0];
  const done = s.payment.status !== 'UPLOADED';
  return (
    <Screen title={A.t('payment.title', 'Confirma el pago')} sub="El comprador dice que ya pagó" foot={done ? undefined : permWhy(A.w, A.me, 'PAYMENT_CONFIRM') ? <Note icon="lock" tone="warn">{permWhy(A.w, A.me, 'PAYMENT_CONFIRM')}</Note> : <div className="btnrow"><Btn kind="sec" onClick={async () => { if (await A.confirm({ title: '¿No te llegó el pago?', text: 'Soporte revisa la constancia del comprador y tu movimiento. Mientras, el pedido queda en pausa.', ok: 'No me llegó', danger: true })) { A.act('PAYMENT_NOT_RECEIVED', { subOrderId: s.id, disputeId: 'dsp-' + uid() }, { ok: 'Avisamos a Soporte. Revisan ambas versiones.' }); A.back(); } }}>{A.t('payment.no', 'No me llegó')}</Btn><Btn kind="dark" onClick={() => { if (A.act('PAYMENT_CONFIRM', { subOrderId: s.id }, { ok: 'Pago confirmado. ¡Ya puedes preparar el pedido!' }).ok) A.back(); }}>{A.t('payment.yes', 'Sí, me llegó')}</Btn></div>}>
      <div className="stack">
        <Card>
          <div className="row between"><b className="bodym">{buyer?.name}</b><Chip tone={s.payment.status === 'CONFIRMED' ? 'leaf' : s.payment.status === 'NOT_RECEIVED' ? 'danger' : 'warn'}>{s.payment.status === 'CONFIRMED' ? 'Confirmado' : s.payment.status === 'NOT_RECEIVED' ? 'No recibido' : 'Por confirmar'}</Chip></div>
          <div className="cap">Pedido {s.code} · {itemsShort(s).toLowerCase()}</div>
          <div className="big mt">{money(s.payment.amount ?? s.total)}</div>
          {s.payment.amount !== undefined && Math.abs(s.payment.amount - s.total) > 0.01 && <div className="cap bad">El pedido es de {money(s.total)}</div>}
        </Card>
        <Card>
          {s.payment.photoId ? <Photo id={s.payment.photoId} label="Captura que subió el comprador" /> : <div className="photo"><div className="stack tight" style={{ alignItems: "center" }}><Icon n="receipt" s="2em" /><span className="cap">Sin captura: solo el número de operación</span></div></div>}
          <div className="mt"><Kv rows={[['Medio', PAY_LABEL[s.payment.method]], ['N.º de operación', s.payment.operation ?? '—'], ['Fecha y hora', s.payment.paidAt ? `${dateShort(s.payment.paidAt)} · ${hhmm(s.payment.paidAt)}` : '—'], ['A tu cuenta', acct ? `${acct.kind === 'BANK' ? 'Cuenta' : acct.kind === 'PLIN' ? 'Plin' : 'Yape'} ···· ${acct.number.slice(-3)}` : '—']]} /></div>
        </Card>
        <Note icon="info">Revisa en tu {PAY_LABEL[s.payment.method]} que el dinero llegó antes de confirmar. Si no llegó, toca «No me llegó» y Soporte lo revisa.</Note>
      </div>
    </Screen>
  );
}

/* ---------- A-15 · Entrega ---------- */
function Delivery() {
  const A = useApp();
  const s = A.w.subOrders[A.top.p?.id as string];
  const [code, setCode] = useState('');
  const [photo, setPhoto] = useState<string | undefined>();
  const [weight, setWeight] = useState(s ? String(Math.round(kgOf(s) * 10) / 10).replace('.', ',') : '');
  const [cash, setCash] = useState(false);
  const [err, setErr] = useState('');
  if (!s) return <Screen title="Entrega"><Empty title="No encontramos el pedido" /></Screen>;
  const isCash = s.payment.method === 'CASH' && s.payment.status !== 'CONFIRMED';
  const confirm = () => {
    if (code.length < 4) { setErr('Escribe los 4 dígitos que te dicta el comprador.'); return; }
    if (isCash && !cash) { setErr(`Confirma que cobraste ${money(s.total)} en efectivo.`); return; }
    const r = A.act('SUBORDER_DELIVER', { subOrderId: s.id, code, photoId: photo, cashCollected: cash, kg: Number(weight.replace(',', '.')) || undefined }, { quiet: true });
    if (!r.ok) { setErr(r.error!.message); setCode(''); return; }
    A.toast(!A.dev.online ? 'Entrega guardada: se envía sola cuando vuelva la señal.' : '¡Entregado! El comprador tiene 48 h para dar su conformidad.');
    A.reset('A-08');
  };
  return (
    <Screen title={A.t('delivery.title', 'Entrega del pedido')} sub={`${dateShort(s.deliveryDate)} · ${s.slot}`} foot={<Btn full kind="dark" onClick={confirm}>{A.t('delivery.confirm', 'Confirmar entrega')}</Btn>}>
      <div className="stack">
        <Card><Kv rows={[['Pedido', s.code], ['Comprador', orgName(A.w, s.buyerOrgId)], ['Producto', itemsShort(s)], [s.deliveryMode === 'PICKUP' ? 'Recojo en' : 'Dirección', s.deliveryMode === 'PICKUP' ? (A.org!.pickupPoint ?? 'tu chacra') : withDistrict(s.address, districtName(s.district))]]} /></Card>
        <div className="lbl">Foto de la entrega</div>
        <div className="grid2">
          <PhotoPick value={photo} onChange={setPhoto} label="Producto entregado" kind="sacos" sample={{ stamp: `Entrega ${s.code} · ${hhmm(A.now)}` }} />
          <div className="card soft stack tight" style={{ justifyContent: "center" }}><Icon n="scale" s="1.6em" /><span className="cap">Peso en balanza</span><Inp value={weight} onInput={setWeight} mode="decimal" suffix="kg" label="Peso en balanza" /></div>
        </div>
        <Field label={s.deliveryMode === 'PICKUP' ? 'Código de recojo que te dicta el comprador' : A.t('delivery.code', 'Código de entrega que te dicta el comprador')} error={err}>
          <CodeInput value={code} onChange={(v) => { setCode(v); setErr(''); }} n={4} err={!!err} />
        </Field>
        {isCash && <Card><Tog on={cash} onChange={setCash} label={`Cobré ${money(s.total)} en efectivo`} sub="Solo pedidos de menos de S/ 2 000 con el envío incluido (RN-04)" /></Card>}
        <Note icon="wifi-off">Sin señal también funciona: la entrega queda guardada y se envía sola.</Note>
        <p className="cap center" style={{ margin: "0" }}>Sin código no hay entrega: es la prueba de que el comprador recibió (RN-58).</p>
      </div>
    </Screen>
  );
}

reg('A-08', FarmerHome, { nav: true, tab: 'A-08' });
reg('A-09', MyListings, { nav: true, tab: 'A-10' });
reg('A-10', Publish, { nav: true, tab: 'A-10' });
reg('A-11', ConfirmPublish);
reg('A-12', FarmerOrders, { nav: true, tab: 'A-12' });
reg('A-13', FarmerOrder);
reg('A-14', ConfirmPayment);
reg('A-15', Delivery);

void Tog; void Chip; void Prog; void CATEGORY_LABEL; void taxDocsFor; void where; void levelChip; void itemsText; void startOfDay; void HOUR; void Field;
