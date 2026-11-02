/*
 * App del comprador MYPE (1): catálogo con filtros de confianza, detalle, perfil del agricultor,
 * carrito con el uso del plan, entrega y comprobante, recojo o envío, pago directo con constancia,
 * pedidos, seguimiento con código, conformidad y calificación. B-05 a B-16, B-28 a B-30.
 */
import { useEffect, useMemo, useState } from 'react';
import { reg } from './registry';
import { useApp, type AppCtx, type CartLine } from '../ctx';
import { Screen, Btn, Icon, Field, Inp, Sel, Card, Chip, ChipBtn, Seg, Kv, Av, ICirc, Empty, Note, SheetBody, Tile, Prog, Stat, Stars, Photo, PhotoPick, Qty, BarAct, Timeline, QR, Tog } from '../ui/kit';
import { PRODUCTS, product, UNIT_LABEL, suggestedPricePerKg } from '@mesagri/shared/catalog';
import { visibleListing, catalogListing, pricePerKg, orgStats, monthPurchases, farmerServes, farmerFee, sellerProvince, routeDays, eligibleCarriers, carrierStats } from '@mesagri/shared/queries';
import { taxDocsFor, TAXDOC_LABEL, cashCheck, digitalMethods, buyerLimit, freightFor, routeFor, r2, LEVEL_NAME, prepayRequired } from '@mesagri/shared/rules';
import { money, moneyShort, kg as fkg, numTrim, dateShort, hhmm, relDay, ago, harvestText, pct, dayMonth, duration } from '@mesagri/shared/format';
import { DAY, HOUR, startOfDay, lima, DOW_LONG, periodOf, periodLabel } from '@mesagri/shared/time';
import { uid } from '@mesagri/shared/ids';
import { orgName, userOfOrg, itemsShort, statusInfo, deliveryText, PAY_LABEL, notifsFor, qtyText, kgOf, slotOf, originOf, permWhy } from '../helpers';
import { districtName, placeLabel, provinceOf, CITY_DISTRICTS } from '@mesagri/shared/ubigeo';
import { kmBetween } from './storage';
import { ratingText, timelineFor, OrderCard, ReviewSheet, OfflineCard } from './farmer';
import { ReviewCard } from './farmer2';
import type { Listing, Org, SubOrder, World, DeliveryMode, TaxDocType, PayMethod } from '@mesagri/shared/types';
import { MapSketch } from '../ui/map';
import { CodeInput } from './onboarding';
import { HelperBanner } from './r2';
import { localOf, isPro } from '@mesagri/shared/engine/r2';

/* ---------- carrito y entrega ---------- */
export interface SellerPlan { mode: DeliveryMode; date: number; slot: string; taxDoc: TaxDocType; pay: PayMethod; carrier?: string; pickupBy?: string; pickupDni?: string; plate?: string }
function cartOf(A: AppCtx): CartLine[] { return A.dev.cart; }
export function addToCart(A: AppCtx, listingId: string, qty: number) {
  A.patch(d => { const i = d.cart.findIndex(c => c.listingId === listingId); if (i >= 0) d.cart[i] = { listingId, qty: r2(d.cart[i].qty + qty) }; else d.cart.push({ listingId, qty }); });
}
function setQty(A: AppCtx, listingId: string, qty: number) { A.patch(d => { d.cart = qty > 0 ? d.cart.map(c => c.listingId === listingId ? { ...c, qty } : c) : d.cart.filter(c => c.listingId !== listingId); }); }
function groups(w: World, cart: CartLine[]) {
  const g = new Map<string, { seller: Org; lines: { l: Listing; qty: number; ok: boolean; why?: string }[] }>();
  for (const c of cart) {
    const l = w.listings[c.listingId];
    if (!l) continue;
    const seller = w.orgs[l.orgId];
    const vis = catalogListing(w, l, w.now);
    const ok = vis && c.qty <= l.available + 1e-9 && (!l.minQty || c.qty >= l.minQty);
    const why = !vis ? 'Ya no está disponible' : c.qty > l.available ? `Solo quedan ${numTrim(l.available)} ${l.unit === 'kg' ? 'kg' : UNIT_LABEL[l.unit].many}` : l.minQty && c.qty < l.minQty ? `Mínimo ${l.minQty} ${l.unit}` : undefined;
    if (!g.has(seller.id)) g.set(seller.id, { seller, lines: [] });
    g.get(seller.id)!.lines.push({ l, qty: c.qty, ok, why });
  }
  return [...g.values()];
}
const lineTotal = (l: Listing, qty: number) => r2(qty * l.price);
export const defaultQty = (l: Listing) => Math.min(l.available, Math.max(l.minQty || 0, l.unit === 'kg' ? Math.min(20, l.available) : 1));

function nextDays(now: number, days: number[], n = 3, from = 1): number[] {
  const out: number[] = [];
  for (let i = from; out.length < n && i < 21; i++) { const t = startOfDay(now) + i * DAY; if (!days.length || days.includes(lima(t).dow)) out.push(t); }
  return out;
}
export function defaultPlan(A: AppCtx, seller: Org, subtotal: number): SellerPlan {
  const buyer = A.org!;
  const district = buyer.district;
  const serves = farmerServes(seller, district);
  const route = routeFor(A.w.settings, sellerProvince(A.w, seller.id), provinceOf(district) ?? 'AREQUIPA');
  const mode: DeliveryMode = serves ? 'FARMER' : route ? 'CARRIER' : 'PICKUP';
  const days = mode === 'FARMER' ? seller.deliveryDays : mode === 'CARRIER' && route ? routeDays(A.w, route.id, A.now) : [];
  const date = nextDays(A.now, days, 1)[0] ?? startOfDay(A.now) + DAY;
  const docs = taxDocsFor(seller);
  const taxDoc: TaxDocType = docs.includes('FACTURA') && buyer.businessType === 'HOTEL' ? 'FACTURA' : docs.includes('BOLETA') ? 'BOLETA' : docs[0];
  const methods = digitalMethods(seller);
  const pay: PayMethod = methods.includes('YAPE') ? 'YAPE' : methods[0] ?? 'CASH';
  void subtotal;
  return { mode, date, slot: mode === 'CARRIER' ? '18:00 a 19:30' : mode === 'PICKUP' ? '8:00 a 12:00' : '7:00 a 9:00', taxDoc, pay };
}
function plans(A: AppCtx): Record<string, SellerPlan> { return A.dev.flow.plans ?? {}; }
function setPlan(A: AppCtx, sellerId: string, p: Partial<SellerPlan>) { A.patch(d => { const cur = d.flow.plans ?? {}; d.flow = { ...d.flow, plans: { ...cur, [sellerId]: { ...(cur[sellerId] ?? {}), ...p } } }; }); }
function planFor(A: AppCtx, seller: Org, subtotal: number): SellerPlan { return { ...defaultPlan(A, seller, subtotal), ...(plans(A)[seller.id] ?? {}) }; }

function deliveryCost(A: AppCtx, seller: Org, p: SellerPlan, kgTotal: number) {
  const district = A.org!.district;
  if (p.mode === 'FARMER') return { fee: farmerFee(seller, district), freight: 0 };
  if (p.mode === 'CARRIER') { const route = routeFor(A.w.settings, sellerProvince(A.w, seller.id), provinceOf(district) ?? 'AREQUIPA'); return { fee: 0, freight: route ? freightFor(route, kgTotal).freight : 0, route }; }
  return { fee: 0, freight: 0 };
}

/* ---------- tarjeta de producto ---------- */
export function ListingCard({ l, compact }: { l: Listing; compact?: boolean }) {
  const A = useApp();
  const seller = A.w.orgs[l.orgId];
  const st = orgStats(A.w, seller.id);
  const docs = taxDocsFor(seller);
  const p = product(l.productId);
  const add = () => { addToCart(A, l.id, defaultQty(l)); A.toast(`Agregaste ${product(l.productId).name.toLowerCase()} al carrito.`, 'ok', { label: 'Ver carrito', run: () => A.reset('B-09') }); };
  return (
    <Card>
      <div className="row top" onClick={() => A.go('B-07', { id: l.id })} style={{ cursor: "pointer" }} role="button" tabIndex={0} aria-label={`${p.name}, ${money(pricePerKg(l))} por kilo, de ${seller.name}`} onKeyDown={(e: any) => { if (e.key === 'Enter') A.go('B-07', { id: l.id }); }}>
        {l.photoIds[0] && !compact ? <div style={{ width: "5.6em", flex: "none" }}><Photo id={l.photoIds[0]} /></div> : <Tile pid={l.productId} size="lg" />}
        <div className="grow">
          <b className="h3" style={{ fontSize: "1.02em" }}>{p.name}{l.variety ? ` ${l.variety}` : ''}</b>
          <div className="price">{money(pricePerKg(l))} por kg{l.unit !== 'kg' ? <span className="cap" style={{ fontWeight: "700" }}> · {money(l.price)} el {UNIT_LABEL[l.unit].one}</span> : null}</div>
          <div className="cap">{seller.name.split(' ').slice(0, 2).join(' ')} · {placeLabel(seller.district)}{l.fromLotId ? ' · en almacén' : ''}</div>
          <div className="chips mt">
            <Chip tone={seller.level >= 2 ? 'leaf' : ''} icon="star">{st.rating ? String(st.rating).replace('.', ',') : 'nuevo'} · {seller.level >= 3 ? 'Formal' : seller.level >= 2 ? 'Verificado' : 'Nivel 1'}</Chip>
            {l.harvestSeal && startOfDay(l.harvestDate) === startOfDay(A.now) && <Chip tone="terra" icon="sparkles">Cosechado hoy</Chip>}
            {l.fromLotId && <Chip tone="field" icon="shield-check">Lote verificado</Chip>}
            <Chip tone="line">{docs.includes('FACTURA') ? 'Factura' : docs.includes('BOLETA') ? 'Boleta' : 'Liquidación'}</Chip>
          </div>
        </div>
      </div>
      {!compact && <div className="mt"><Btn full kind="dark" onClick={add}>Agregar al carrito</Btn></div>}
    </Card>
  );
}

/* ---------- B-05 · Inicio y catálogo ---------- */
function BuyerHome() {
  const A = useApp();
  const org = A.org!, w = A.w;
  const [q, setQ] = useState('');
  const [f, setF] = useState<Record<string, boolean>>({});
  const unread = notifsFor(w, org.id).filter(n => n.at > (Number(A.dev.flow.seenNotifs) || 0)).length;
  const all = Object.values(w.listings).filter(l => catalogListing(w, l, A.now));
  const filtered = all.filter(l => {
    const s = w.orgs[l.orgId];
    if (f.ver && s.level < 2) return false;
    if (f.fac && !taxDocsFor(s).includes('FACTURA')) return false;
    if (f.near && !(farmerServes(s, org.district) || kmBetween(s.district, org.district) < 60)) return false;
    if (f.alm && !l.fromLotId) return false;
    return true;
  }).sort((a, b) => (Number(b.harvestSeal) - Number(a.harvestSeal)) || (orgStats(w, b.orgId).rating - orgStats(w, a.orgId).rating) || b.createdAt - a.createdAt);
  const lastDone = Object.values(w.subOrders).filter(s => s.buyerOrgId === org.id && s.status === 'COMPLETED').sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)).slice(0, 2);
  const sub = org.subscription;
  const cartN = A.dev.cart.length;
  return (
    <Screen bar={
      <header className="bar home" style={{ flexDirection: "column", alignItems: "stretch", gap: ".6em" }}>
        <div className="row between"><h1 style={{ margin: "0", fontSize: "1.45em", fontWeight: "800" }}>Mesagri</h1><div className="row g4"><BarAct icon="shopping-cart" label="Carrito" onClick={() => A.reset('B-09')} dot={cartN > 0} /><BarAct icon="bell" label="Avisos" onClick={() => A.go('A-29')} dot={unread > 0} /></div></div>
        <form className="inpwrap" style={{ color: "var(--ink)" }} role="search" onSubmit={(e: any) => { e.preventDefault(); A.go('B-06', { q: q.trim() }); }}><span className="pre"><Icon n="search" s="1.1em" /></span><input className="inp" type="search" enterKeyHint="search" style={{ minHeight: "2.8em" }} placeholder="Buscar papa, cebolla..." value={q} onChange={(e: any) => setQ(e.currentTarget.value)} aria-label="Buscar productos" /></form>
      </header>
    }>
      <div className="stack">
        {!A.dev.online && <OfflineCard />}
        <div className="chips">
          <ChipBtn on={!!f.ver} onClick={() => setF({ ...f, ver: !f.ver })}>Verificados</ChipBtn>
          <ChipBtn on={!!f.fac} onClick={() => setF({ ...f, fac: !f.fac })}>Emite factura</ChipBtn>
          <ChipBtn on={!!f.near} onClick={() => setF({ ...f, near: !f.near })}>Cerca de ti</ChipBtn>
          <ChipBtn on={!!f.alm} onClick={() => setF({ ...f, alm: !f.alm })}>En almacén</ChipBtn>
        </div>
        {org.level === 0 && <button className="card warn" onClick={() => A.go('B-04')}><div className="row"><Icon n="shield-check" /><div className="grow"><b className="bodym">Verifica tu negocio para hacer pedidos</b><div className="cap" style={{ color: "inherit" }}>RUC activo y habido y el DNI del representante (nivel 1).</div></div><Icon n="chevron-right" s="1.1em" /></div></button>}
        {sub && (sub.status === 'GRACE' || sub.status === 'INACTIVE') && <button className="card danger" onClick={() => A.go('B-26')}><div className="row"><Icon n="credit-card" /><div className="grow"><b className="bodym">{sub.status === 'GRACE' ? 'Tu membresía venció: estás en días de gracia' : 'Estás sin membresía'}</b><div className="cap" style={{ color: "inherit" }}>{sub.status === 'GRACE' ? `Paga antes del ${dateShort(sub.graceUntil!)} para seguir comprando.` : 'Puedes ver el catálogo, pero no confirmar pedidos (RN-35).'}</div></div></div></button>}
        {sub?.status === 'TRIAL' && sub.trialEndsOn - A.now < 7 * DAY && <button className="card warn" onClick={() => A.go('B-26')}><div className="row"><Icon n="credit-card" /><div className="grow"><b className="bodym">Tu mes gratis termina el {dateShort(sub.trialEndsOn)}</b><div className="cap" style={{ color: "inherit" }}>Luego, {sub.plan === 'PRO' ? 'Pro' : 'Básico'} {money(w.settings.plans[sub.plan].price)} al mes.</div></div></div></button>}
        <HelperBanner />
        {Object.values(w.schedules).filter(x => x.buyerOrgId === org.id && x.draft?.status === 'PENDING').map(x => (
          <button key={x.id} className="card hl" onClick={() => A.go('B-22', { id: x.id })}><div className="row"><ICirc n="repeat" tone="terra" /><div className="grow"><b className="bodym">Pedido programado por aprobar</b><div className="cap">{x.name} · entrega {dateShort(x.draft!.deliveryDate)} · {money(x.draft!.total)} aprox.</div></div><Icon n="chevron-right" s="1.1em" /></div></button>
        ))}
        {(() => { const open = Object.values(w.requests).filter(r => r.buyerOrgId === org.id && r.status === 'OPEN'); const n = open.reduce((a, r) => a + r.offers.filter(o => o.status === 'SENT').length, 0); return n > 0 ? (
          <button className="card soft" onClick={() => A.go('B-17', open.length === 1 ? { id: open[0].id } : {})}><div className="row"><ICirc n="hand-coins" /><div className="grow"><b className="bodym">{n} {n === 1 ? 'oferta' : 'ofertas'} a tus solicitudes de compra</b><div className="cap">{open.map(r => product(r.productId).name).join(' · ')} · elige la que más te convenga</div></div><Icon n="chevron-right" s="1.1em" /></div></button>
        ) : null; })()}
        {lastDone.length > 0 && (
          <Card tone="dark"><div className="row"><div className="grow"><b className="bodym">Tu pedido de la semana pasada</b><div className="cap">{lastDone.map(s => product(s.items[0].productId).name).join(' · ')}</div></div><Btn sm onClick={() => { let n = 0; for (const s of lastDone) for (const it of s.items) { const l = w.listings[it.listingId]; const alt = l && catalogListing(w, l, A.now) ? l : Object.values(w.listings).find(x => x.orgId === s.sellerOrgId && x.productId === it.productId && catalogListing(w, x, A.now)); if (alt) { addToCart(A, alt.id, Math.min(alt.available, it.unit === alt.unit ? it.qty : defaultQty(alt))); n++; } } A.toast(n ? `Agregamos ${n} ${n === 1 ? 'producto' : 'productos'} al carrito.` : 'Esos productos ya no están publicados.', n ? 'ok' : 'warn'); if (n) A.reset('B-09'); }}>Repetir</Btn></div></Card>
        )}
        <div className="row between"><div className="sect">Productos destacados</div><button className="linkbtn" onClick={() => A.go('B-06', {})}>Ver todo</button></div>
        {filtered.length === 0 && <Card><Empty icon="search" title="Sin productos con esos filtros" text="Quita un filtro o busca otro producto." /></Card>}
        {filtered.slice(0, 12).map(l => <ListingCard key={l.id} l={l} />)}
      </div>
    </Screen>
  );
}

/* ---------- B-06 · Resultados y filtros ---------- */
interface Filt { sort: 'near' | 'price' | 'rating'; lvl?: number; doc?: TaxDocType; when?: 'tomorrow' | 'week' | 'alm'; max?: number }
function Results() {
  const A = useApp();
  const org = A.org!, w = A.w;
  const [q, setQ] = useState<string>(A.top.p?.q ?? '');
  const [f, setF] = useState<Filt>(A.dev.flow.filt ?? { sort: 'near' });
  const match = (l: Listing) => {
    if (!q) return true;
    const t = q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const p = product(l.productId);
    return [p.name, ...p.synonyms, w.orgs[l.orgId]?.name ?? ''].some(s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(t));
  };
  const base = Object.values(w.listings).filter(l => catalogListing(w, l, A.now) && match(l));
  const list = base.filter(l => {
    const s = w.orgs[l.orgId];
    if (f.lvl && s.level < f.lvl) return false;
    if (f.doc && !taxDocsFor(s).includes(f.doc)) return false;
    if (f.when === 'alm' && !l.fromLotId) return false;
    if (f.when === 'tomorrow' && !(farmerServes(s, org.district) && s.deliveryDays.includes(lima(A.now + DAY).dow))) return false;
    if (f.max && pricePerKg(l) > f.max) return false;
    return true;
  }).sort((a, b) => f.sort === 'price' ? pricePerKg(a) - pricePerKg(b) : f.sort === 'rating' ? orgStats(w, b.orgId).rating - orgStats(w, a.orgId).rating : kmBetween(w.orgs[a.orgId].district, org.district) - kmBetween(w.orgs[b.orgId].district, org.district));
  const openFilters = () => A.sheet(<FilterSheet f={f} onApply={(nf) => { setF(nf); A.patch(d => { d.flow = { ...d.flow, filt: nf }; }); }} count={(nf) => base.filter(l => { const s = w.orgs[l.orgId]; return (!nf.lvl || s.level >= nf.lvl) && (!nf.doc || taxDocsFor(s).includes(nf.doc)) && (nf.when !== 'alm' || !!l.fromLotId) && (!nf.max || pricePerKg(l) <= nf.max); }).length} />);
  return (
    <Screen title={q ? q[0].toUpperCase() + q.slice(1) : 'Catálogo'} sub={`${list.length} resultados en Arequipa`} right={<button className="act" aria-label="Filtros" onClick={openFilters}><Icon n="sliders-horizontal" s="1.3em" /></button>}>
      <div className="stack">
        <Inp value={q} onInput={setQ} placeholder="Buscar producto o agricultor" suffix={<Icon n="search" />} label="Buscar" mode="search" />
        <div className="chips">
          {[['near', 'Más cerca'], ['price', 'Menor precio'], ['rating', 'Mejor calificado']].map(([v, l]) => <ChipBtn key={v} on={f.sort === v} onClick={() => setF({ ...f, sort: v as Filt['sort'] })}>{l}</ChipBtn>)}
          <button className="chip line" onClick={openFilters}><Icon n="sliders-horizontal" s="1.1em" />Filtros{(f.lvl || f.doc || f.when || f.max) ? ' ·' : ''}</button>
        </div>
        {list.length === 0 && <Card><Empty icon="search" title="Sin resultados" text="Prueba con «papa», «cebolla» o «arroz», o quita filtros." /></Card>}
        {list.map(l => <ListingCard key={l.id} l={l} />)}
      </div>
    </Screen>
  );
}
function FilterSheet({ f, onApply, count }: { f: Filt; onApply: (f: Filt) => void; count: (f: Filt) => number }) {
  const A = useApp();
  const [x, setX] = useState<Filt>(f);
  return (
    <SheetBody title="Filtros">
      <div className="row between"><span /><button className="linkbtn" onClick={() => setX({ sort: 'near' })}>Limpiar</button></div>
      <div className="lbl">Ordenar por</div>
      <div className="chips">{[['near', 'Más cerca'], ['price', 'Menor precio'], ['rating', 'Mejor calificado']].map(([v, l]) => <ChipBtn key={v} on={x.sort === v} onClick={() => setX({ ...x, sort: v as Filt['sort'] })}>{l}</ChipBtn>)}</div>
      <div className="lbl">Nivel del agricultor</div>
      <div className="chips"><ChipBtn on={x.lvl === 2} onClick={() => setX({ ...x, lvl: x.lvl === 2 ? undefined : 2 })}>Verificado (2)</ChipBtn><ChipBtn on={x.lvl === 3} onClick={() => setX({ ...x, lvl: x.lvl === 3 ? undefined : 3 })}>Formal (3)</ChipBtn></div>
      <div className="lbl">Comprobante</div>
      <div className="chips">{(['BOLETA', 'FACTURA', 'LIQUIDACION'] as TaxDocType[]).map(d => <ChipBtn key={d} on={x.doc === d} onClick={() => setX({ ...x, doc: x.doc === d ? undefined : d })}>{TAXDOC_LABEL[d]}</ChipBtn>)}</div>
      <div className="lbl">Entrega</div>
      <div className="chips">{[['tomorrow', 'Mañana'], ['week', 'Esta semana'], ['alm', 'Retiro en almacén']].map(([v, l]) => <ChipBtn key={v} on={x.when === v} onClick={() => setX({ ...x, when: x.when === v ? undefined : v as Filt['when'] })}>{l}</ChipBtn>)}</div>
      <div className="row between"><span className="lbl">Precio máximo</span><b className="bodym">{x.max ? `${money(x.max)} por kg` : 'Sin tope'}</b></div>
      <input type="range" min={0.5} max={10} step={0.1} value={x.max ?? 10} onChange={(e: any) => { const v = Number(e.currentTarget.value); setX({ ...x, max: v >= 10 ? undefined : v }); }} aria-label="Precio máximo por kilo" style={{ width: "100%", accentColor: "#2C5F2D" }} />
      <Btn full kind="dark" onClick={() => { onApply(x); A.sheet(null); }}>Ver {count(x)} resultados</Btn>
    </SheetBody>
  );
}

/* ---------- B-07 · Detalle del producto (y B-24 · comprar desde un almacén) ---------- */
function ProductDetail() {
  const A = useApp();
  const l = A.w.listings[A.top.p?.id as string];
  const [qty, setQ] = useState<number>(l ? defaultQty(l) : 1);
  if (!l) return <Screen title="Producto"><Empty title="No encontramos el producto" /></Screen>;
  const seller = A.w.orgs[l.orgId];
  const p = product(l.productId);
  const vis = catalogListing(A.w, l, A.now);
  const docs = taxDocsFor(seller);
  const ppk = pricePerKg(l);
  const save = r2(p.ref.mayorista - ppk);
  const lot = l.fromLotId ? A.w.lots[l.fromLotId] : undefined;
  const wh = lot ? A.w.orgs[lot.facilityOrgId] : undefined;
  const fav = A.w.favorites[A.org!.id]?.sellers.includes(seller.id);
  const unitL = l.unit === 'kg' ? 'kg' : UNIT_LABEL[l.unit].many;
  return (
    <Screen title={p.name + (l.variety ? ` ${l.variety}` : '')} sub={`${seller.name} · ${placeLabel(seller.district)}`} foot={vis ? (
      <div className="qtyfoot">
        <Qty value={qty} onChange={setQ} step={l.unit === 'kg' ? 5 : 1} min={l.minQty || 1} max={l.available} unit={l.unit === 'kg' ? 'kg' : UNIT_LABEL[l.unit].many} />
        <Btn kind="primary" onClick={() => { addToCart(A, l.id, qty); A.toast('Agregado al carrito.', 'ok', { label: 'Ver carrito', run: () => A.reset('B-09') }); A.back(); }}>Agregar · {money(lineTotal(l, qty))}</Btn>
      </div>
    ) : undefined}>
      <div className="stack">
        <div style={{ position: "relative" }}>{l.photoIds[0] ? <Photo id={l.photoIds[0]} /> : <div className="photo" style={{ aspectRatio: "16/9" }}><Tile pid={l.productId} size="lg" /></div>}
          {l.harvestSeal && startOfDay(l.harvestDate) === startOfDay(A.now) && <span className="chip forest" style={{ position: "absolute", top: ".7em", left: ".7em" }}><Icon n="sparkles" s="1.1em" />Cosechado hoy</span>}</div>
        {!vis && <Note icon="ban" tone="danger">{l.status === 'PAUSED' ? 'El agricultor pausó esta publicación.' : l.available <= 0 ? 'Agotado por ahora.' : 'Esta publicación ya no está disponible.'}</Note>}
        <div className="row between"><div><span className="big">{money(ppk)}</span> <span className="cap">por kg</span>{l.unit !== 'kg' && <div className="cap">{money(l.price)} el {UNIT_LABEL[l.unit].one} de {numTrim(l.unitKg)} kg</div>}</div><Chip tone={seller.level >= 2 ? 'leaf' : ''} icon="shield-check">Nivel {seller.level}</Chip></div>
        <div className="cap">Quedan {numTrim(l.available)} {unitL} · calidad {l.quality.toLowerCase()} · {harvestText(l.harvestDate, A.now).toLowerCase()}{l.minQty ? ` · mínimo ${l.minQty} ${unitL}` : ''}</div>
        {l.tiers?.length ? <Card><Kv rows={l.tiers.map(t => [`${t.minKg} kg o más`, `${money(t.price)} por kg`])} /></Card> : null}
        {lot && wh && <Card tone="soft"><div className="row g8"><Icon n="shield-check" /><b className="bodym">Lote verificado en almacén</b></div><div className="mt"><Kv rows={[['Almacén', wh.name], ['Constancia', lot.code], ['Peso verificado', fkg(lot.weightKg)], ['Calidad', lot.quality]]} /></div><div className="chips mt"><Chip tone="line" icon="truck">Envío o retiro en {placeLabel(wh.district)}</Chip>{A.org!.subscription?.plan !== 'PRO' && <Chip tone="warn" icon="lock">Reserva anticipada de lotes: solo Pro</Chip>}</div></Card>}
        <Card tone="soft"><div className="row top g8"><Icon n="trending-up" /><div className="bodym">Mayorista de referencia: <b>{money(p.ref.mayorista)} por kg</b> ({p.ref.source.startsWith('Midagri') ? 'Midagri' : 'referencia de ejemplo'}).{save > 0 ? <> Ahorras <b>{money(save)}</b> por kg.</> : ''}</div></div></Card>
        <Card tone="warn"><div className="row top g8"><Icon n="file-text" /><div className="bodym">{docs.includes('FACTURA') ? `${seller.name.split(' ')[0]} emite boleta o factura.` : docs.includes('BOLETA') ? `${seller.name.split(' ')[0]} está en el Nuevo RUS: solo da boleta (RN-34).` : <>{seller.name.split(' ')[0]} aún no tiene RUC: el comprobante es la <b>liquidación de compra</b> que emites tú en la SUNAT.</>}</div></div></Card>
        <button className="card" onClick={() => A.go('B-08', { id: seller.id })}><div className="row"><Av org={seller} /><div className="grow"><b className="bodym">{seller.name}</b><div className="cap">{placeLabel(seller.district)} · {ratingText(A.w, seller.id)} · {orgStats(A.w, seller.id).completed} pedidos</div></div><Icon n="chevron-right" s="1.1em" /></div></button>
        <button className="linkbtn" style={{ alignSelf: "flex-start" }} onClick={() => A.act('FAVORITE_TOGGLE', { kind: 'seller', id: seller.id, on: !fav }, { ok: fav ? 'Quitamos de tus favoritos.' : 'Agregado a tus favoritos.' })}>{fav ? 'Quitar de mis favoritos' : 'Agregar a mis favoritos'}</button>
      </div>
    </Screen>
  );
}

/* ---------- B-08 · Perfil del agricultor ---------- */
function FarmerProfile() {
  const A = useApp();
  const o = A.w.orgs[A.top.p?.id as string];
  if (!o) return <Screen title="Agricultor"><Empty title="No encontramos al agricultor" /></Screen>;
  const st = orgStats(A.w, o.id);
  const lists = Object.values(A.w.listings).filter(l => l.orgId === o.id && catalogListing(A.w, l, A.now));
  const revs = Object.values(A.w.reviews).filter(r => r.toOrg === o.id && r.published).sort((a, b) => b.at - a.at);
  const since = lima(o.createdAt);
  return (
    <Screen bar={
      <header className="bar home" style={{ alignItems: "center" }}>
        <button className="back" onClick={() => A.back()} aria-label="Volver"><Icon n="chevron-left" s="1.6em" /></button>
        <Av org={o} size="lg" />
        <div className="tt"><h1>{o.name}</h1><p>Agricultor · {placeLabel(o.district)}</p><div className="chips" style={{ marginTop: ".35em" }}><span className="chip leaf"><Icon n="shield-check" s="1.05em" />{o.level >= 3 ? 'Formal' : o.level >= 2 ? 'Verificado' : 'Nivel 1'}</span><span className="chip" style={{ background: "rgba(255,255,255,.15)", color: "#fff" }}>Desde {['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][since.m - 1]} {since.y}</span></div></div>
      </header>
    }>
      <div className="stack">
        <div className="grid4">
          <Stat n={st.rating ? `★ ${String(st.rating).replace('.', ',')}` : '—'} l={`${st.count} opiniones`} />
          <Stat n={st.onTimePct ? pct(st.onTimePct).replace(' ', '') : '—'} l="a tiempo" />
          <Stat n={st.completed} l="pedidos" />
          <Stat n={st.responseMin ? (st.responseMin >= 60 ? `${Math.floor(st.responseMin / 60)} h` : `${st.responseMin}′`) : '—'} l="responde" />
        </div>
        <div className="sect">Qué vende ahora</div>
        <Card>{lists.length === 0 ? <Empty icon="package" title="No tiene publicaciones activas" /> : <div className="list">{lists.map(l => <button key={l.id} className="li" onClick={() => A.go('B-07', { id: l.id })}><Tile pid={l.productId} size="sm" /><div className="grow"><b className="bodym">{product(l.productId).name}</b><div className="cap">Quedan {numTrim(l.available)} {l.unit === 'kg' ? 'kg' : UNIT_LABEL[l.unit].many}{l.fromLotId ? ' · en almacén aliado' : ''}</div></div><b className="price">{money(pricePerKg(l))}</b></button>)}</div>}</Card>
        {revs.slice(0, 4).map(r => <ReviewCard key={r.id} id={r.id} />)}
        <p className="cap center" style={{ margin: "0" }}><Icon n="lock" s="1em" /> Mostramos su distrito, nunca la ubicación de su chacra.</p>
      </div>
    </Screen>
  );
}

/* ---------- B-09 · Carrito ---------- */
function Cart() {
  const A = useApp();
  const org = A.org!;
  const g = groups(A.w, cartOf(A));
  const sub = org.subscription;
  const plan = sub ? A.w.settings.plans[sub.plan] : undefined;
  const month = monthPurchases(A.w, org.id, A.now);
  const totalProducts = r2(g.reduce((a, x) => a + x.lines.filter(y => y.ok).reduce((b, y) => b + lineTotal(y.l, y.qty), 0), 0));
  const lim = buyerLimit(A.w.settings, org.level);
  const would = r2(month + totalProducts);
  const overPlan = plan?.purchaseCap !== null && plan?.purchaseCap !== undefined && would > plan.purchaseCap;
  const bad = g.some(x => x.lines.some(y => !y.ok));
  const go = () => {
    if (org.level < 1) { A.toast('Primero verificamos tu negocio (nivel 1).', 'warn'); A.go('B-04'); return; }
    if (totalProducts > lim.perOrder) { A.toast(`Con el nivel ${org.level} tu tope por pedido es ${money(lim.perOrder)}.`, 'err'); return; }
    if (overPlan && !A.dev.flow.upgrade) { A.sheet(<PlanLimitSheet month={month} order={totalProducts} />); return; }
    A.go('B-10');
  };
  if (!g.length) return <Screen title="Carrito" back={false}><Card><Empty icon="shopping-cart" title="Tu carrito está vacío" text="Busca papa, cebolla o arroz y agrégalos aquí."><Btn kind="dark" onClick={() => A.reset('B-05')}>Ver el catálogo</Btn></Empty></Card></Screen>;
  return (
    <Screen title="Carrito" sub={`${g.length} ${g.length === 1 ? 'agricultor' : 'agricultores'}`} back={false} foot={<><Btn full onClick={go} disabled={bad} why={bad ? 'Quita o corrige lo que ya no está disponible' : undefined}>Continuar</Btn><div className="why">{g.length > 1 ? `Son ${g.length} pedidos: pagas a cada agricultor por separado.` : 'Pagas directo al agricultor.'}</div></>}>
      <div className="stack">
        {g.map((x, i) => {
          const subtotal = r2(x.lines.filter(y => y.ok).reduce((a, y) => a + lineTotal(y.l, y.qty), 0));
          const pl = planFor(A, x.seller, subtotal);
          const kgT = x.lines.reduce((a, y) => a + y.qty * y.l.unitKg, 0);
          const dc = deliveryCost(A, x.seller, pl, kgT);
          return (
            <Card key={x.seller.id}>
              <div className="row"><Av org={x.seller} /><div className="grow"><b className="bodym">{x.seller.name}</b><div className="cap">{placeLabel(x.seller.district)} · nivel {x.seller.level} · pedido {i + 1} de {g.length}</div></div></div>
              <div className="list mt">
                {x.lines.map(y => (
                  <div key={y.l.id} className="stack tight">
                    <div className="row between"><span className="bodym">{product(y.l.productId).name} · {y.l.unit === 'kg' ? fkg(y.qty) : qtyText(y.qty, y.l.unit, y.l.unitKg)} × {money(y.l.price)}</span><b className="bodym">{money(lineTotal(y.l, y.qty))}</b></div>
                    <div className="row between"><Qty value={y.qty} onChange={(v) => setQty(A, y.l.id, v)} step={y.l.unit === 'kg' ? 5 : 1} min={0} max={y.l.available} unit={y.l.unit === 'kg' ? 'kg' : UNIT_LABEL[y.l.unit].many} /><button className="iconbtn danger" aria-label={`Quitar ${product(y.l.productId).name.toLowerCase()} del carrito`} title="Quitar" onClick={() => setQty(A, y.l.id, 0)}><Icon n="trash" s="1.15em" /></button></div>
                    {y.why && <div className="errt"><Icon n="circle-alert" s="1.1em" />{y.why}</div>}
                  </div>
                ))}
              </div>
              <div className="row between mt"><span className="cap">Entrega</span><b className="cap" style={{ color: "var(--ink)" }}>{pl.mode === 'CARRIER' ? `Transportista aliado · ${money(dc.freight)} al recibir` : pl.mode === 'PICKUP' ? 'Recojo por tu cuenta' : dc.fee ? `Envío ${money(dc.fee)}` : 'Incluida'} · {dateShort(pl.date)}</b></div>
              <div className="row between mt"><Chip tone="terra" icon="file-text">{TAXDOC_LABEL[pl.taxDoc]}</Chip><b>{money(r2(subtotal + dc.fee))}</b></div>
            </Card>
          );
        })}
        {plan && (
          <Card tone={overPlan ? 'warn' : 'soft'}>
            <div className="row between"><span className="bodym b">Tu plan {plan.name} en {periodLabel(periodOf(A.now)).split(' de ')[0]}</span><span className="bodym">{moneyShort(would)}{plan.purchaseCap ? ` de ${moneyShort(plan.purchaseCap)}` : ''}</span></div>
            {plan.purchaseCap && <div className="mt"><Prog v={would / plan.purchaseCap} tone={overPlan ? 'warn' : ''} /></div>}
            {overPlan && <div className="cap mt" style={{ color: "inherit" }}>Con este carrito pasas el límite del plan: te mostramos tus opciones al continuar.</div>}
          </Card>
        )}
        <div className="row between"><span className="h3">Total</span><span className="big">{money(totalProducts)}</span></div>
      </div>
    </Screen>
  );
}

export function PlanLimitSheet({ month, order }: { month: number; order: number }) {
  const A = useApp();
  const sub = A.org!.subscription!;
  const s = A.w.settings;
  const would = r2(month + order);
  const next = would <= (s.plans.PRO.purchaseCap ?? Infinity) ? 'PRO' : 'EMPRESA';
  const diff = r2(s.plans[next].price - s.plans[sub.plan].price);
  const trial = sub.status === 'TRIAL';
  const [op, setOp] = useState('');
  return (
    <SheetBody>
      <div className="center"><span className="icirc warn" style={{ width: "3.2em", height: "3.2em" }}><Icon n="triangle-alert" s="1.5em" /></span></div>
      <h2 className="h2 center">Este pedido pasa el límite de tu plan {s.plans[sub.plan].name}</h2>
      <Card><Kv rows={[[`Compraste en ${periodLabel(periodOf(A.now)).split(' de ')[0]}`, money(month)], ['Este pedido', money(order)], ['Llegarías a', money(would)], [`Límite del ${s.plans[sub.plan].name}`, money(s.plans[sub.plan].purchaseCap ?? 0)]]} /></Card>
      <p className="bodym center" style={{ margin: "0" }}>Desde {moneyShort(s.plans[sub.plan].purchaseCap ?? 0)} al mes el plan {s.plans[next].name} es obligatorio. {trial ? <>Estás en tu mes gratis: <b>pasar a {s.plans[next].name} no cuesta nada hasta el {dateShort(sub.trialEndsOn)}</b>.</> : <>Este mes solo pagas la diferencia: <b>{money(diff)}</b>. Luego, {money(s.plans[next].price)} al mes.</>}</p>
      {!trial && <Field label={`N.º de operación del pago de ${money(diff)} (Yape a Mesagri)`}><Inp value={op} onInput={(v) => setOp(v.replace(/\D/g, ''))} mode="numeric" placeholder="05123987" label="Número de operación" /></Field>}
      <Btn full disabled={!trial && op.length < 4} why={!trial && op.length < 4 ? 'Escribe el número de operación' : undefined} onClick={() => { A.patch(d => { d.flow = { ...d.flow, upgrade: { plan: next, method: 'YAPE', operation: op } }; }); A.sheet(null); A.go('B-10'); }}>Pasar a {s.plans[next].name} y comprar</Btn>
      <Btn full kind="sec" onClick={() => A.sheet(null)}>Quitar productos</Btn>
      <p className="cap center" style={{ margin: "0" }}>Si pasas 2 meses debajo de {moneyShort(s.plans.BASICO.purchaseCap ?? 0)}, vuelves solo al Básico (RN-38).</p>
    </SheetBody>
  );
}

/* ---------- B-10 · Entrega y comprobante ---------- */
function CheckoutDelivery() {
  const A = useApp();
  const org = A.org!;
  const g = groups(A.w, cartOf(A));
  const [addrOpen, setAddrOpen] = useState(false);
  if (!g.length) return <Screen title="Entrega y comprobante"><Empty title="Tu carrito está vacío" /></Screen>;
  return (
    <Screen title="Entrega y comprobante" sub="Paso 2 de 3" foot={<Btn full onClick={() => A.go('B-11')}>Continuar al pago</Btn>}>
      <div className="stack">
        {(org.locales ?? []).length > 1 ? (
          <div className="stack tight">
            <div className="sect">¿A qué local llega?</div>
            {org.locales!.map(l => {
              const on = (A.dev.flow.localId ?? localOf(org)?.id) === l.id;
              return (
                <div key={l.id} className={'card ' + (on ? 'sel' : 'line')} role="radio" aria-checked={on ? 'true' : 'false'} tabIndex={0} style={{ cursor: "pointer" }} onClick={() => A.patch(d => { d.flow = { ...d.flow, localId: l.id }; })}>
                  <div className="row"><span className={'radio' + (on ? ' on' : '')} /><div className="grow"><b className="bodym">{l.name} · {districtName(l.district)}</b><div className="cap">{l.address} · recibe {l.receiver}</div></div></div>
                </div>
              );
            })}
          </div>
        ) : (
          <>
            <button className="card" onClick={() => setAddrOpen(!addrOpen)}><div className="row"><Icon n="map-pin" /><div className="grow"><b className="bodym">{org.name} · {districtName(org.district)}</b><div className="cap">{org.address} · recibe {org.receiver}</div></div><span className="linkbtn" style={{ textDecoration: "none" }}>Cambiar</span></div></button>
            {addrOpen && <AddressEditor onDone={() => setAddrOpen(false)} />}
          </>
        )}
        {g.map((x, i) => {
          const subtotal = r2(x.lines.filter(y => y.ok).reduce((a, y) => a + lineTotal(y.l, y.qty), 0));
          const pl = planFor(A, x.seller, subtotal);
          const kgT = x.lines.reduce((a, y) => a + y.qty * y.l.unitKg, 0);
          const dc = deliveryCost(A, x.seller, pl, kgT);
          const docs = taxDocsFor(x.seller);
          const route = dc.route;
          const days = pl.mode === 'FARMER' ? x.seller.deliveryDays : pl.mode === 'CARRIER' && route ? routeDays(A.w, route.id, A.now) : [];
          const opts = nextDays(A.now, days, 3, pl.mode === 'PICKUP' ? 1 : 1);
          return (
            <div key={x.seller.id} className="stack tight">
              <div className="sect">Pedido {i + 1} · {x.seller.name}</div>
              <button className="card" onClick={() => A.go('B-28', { seller: x.seller.id })}><div className="row"><Icon n={pl.mode === 'CARRIER' ? 'truck' : pl.mode === 'PICKUP' ? 'hand-coins' : 'sprout'} /><div className="grow"><b className="bodym">{pl.mode === 'CARRIER' ? 'Transportista aliado' : pl.mode === 'PICKUP' ? 'Recojo por tu cuenta' : 'Envío del agricultor'}</b><div className="cap">{pl.mode === 'CARRIER' ? `Flete ${money(dc.freight)} al recibir` : pl.mode === 'PICKUP' ? 'Sin costo · tú pones el vehículo' : dc.fee ? `Envío ${money(dc.fee)}` : 'Envío incluido'}</div></div><span className="linkbtn" style={{ textDecoration: "none" }}>Cambiar</span></div></button>
              <div className="chips">{opts.map(d => <ChipBtn key={d} on={startOfDay(pl.date) === d} onClick={() => setPlan(A, x.seller.id, { date: d })}>{dateShort(d)}{pl.mode === 'FARMER' && startOfDay(pl.date) === d ? ` · ${pl.slot}` : ''}</ChipBtn>)}</div>
              <Seg value={pl.taxDoc} onChange={(v) => { if (docs.includes(v)) setPlan(A, x.seller.id, { taxDoc: v }); else A.toast(v === 'FACTURA' ? `${x.seller.name} no emite factura (RN-34).` : `${x.seller.name} no puede dar ese comprobante.`, 'warn'); }} options={(['BOLETA', 'FACTURA', 'LIQUIDACION'] as TaxDocType[]).map(d => ({ v: d, l: <span style={docs.includes(d) ? undefined : { opacity: ".45" }}>{d === 'LIQUIDACION' ? 'Liquidación' : TAXDOC_LABEL[d]}</span> }))} />
              {pl.taxDoc === 'LIQUIDACION' && <p className="cap" style={{ margin: "0" }}>{x.seller.name.split(' ')[0]} todavía no tiene RUC: la liquidación de compra la emites tú en la SUNAT y la adjuntas al pedido.</p>}
            </div>
          );
        })}
        <p className="cap" style={{ margin: "0" }}>En cada pedido eliges: recojo, envío del agricultor o transportista aliado.</p>
      </div>
    </Screen>
  );
}
function AddressEditor({ onDone }: { onDone: () => void }) {
  const A = useApp();
  const org = A.org!;
  const [district, setDistrict] = useState(org.district);
  const [address, setAddress] = useState(org.address ?? '');
  const [receiver, setReceiver] = useState(org.receiver ?? '');
  return (
    <Card tone="soft">
      <div className="stack tight">
        <Field label="Distrito"><Sel value={district} onChange={setDistrict} options={CITY_DISTRICTS.map(d => ({ v: d.code, l: d.name }))} label="Distrito" /></Field>
        <Field label="Dirección"><Inp value={address} onInput={setAddress} label="Dirección" /></Field>
        <Field label="Quién recibe"><Inp value={receiver} onInput={setReceiver} label="Quién recibe" /></Field>
        <Btn sm kind="dark" onClick={() => { if (A.act('ORG_UPDATE', { orgId: org.id, district, address, receiver }, { ok: 'Dirección guardada.' }).ok) onDone(); }}>Guardar dirección</Btn>
      </div>
    </Card>
  );
}

/* ---------- B-28 · ¿Recojo o envío? ---------- */
function DeliveryChoice() {
  const A = useApp();
  const seller = A.w.orgs[A.top.p?.seller as string];
  const g = groups(A.w, cartOf(A)).find(x => x.seller.id === seller?.id);
  if (!seller || !g) return <Screen title="¿Cómo lo recibes?"><Empty title="Sin pedido" /></Screen>;
  const subtotal = r2(g.lines.reduce((a, y) => a + lineTotal(y.l, y.qty), 0));
  const kgT = g.lines.reduce((a, y) => a + y.qty * y.l.unitKg, 0);
  const pl = planFor(A, seller, subtotal);
  const district = A.org!.district;
  const serves = farmerServes(seller, district);
  const route = routeFor(A.w.settings, sellerProvince(A.w, seller.id), provinceOf(district) ?? 'AREQUIPA');
  const fr = route ? freightFor(route, kgT) : undefined;
  const rdays = route ? routeDays(A.w, route.id, A.now) : [];
  const nextRoute = nextDays(A.now, rdays, 1)[0];
  const nextFarm = nextDays(A.now, seller.deliveryDays, 1)[0];
  const km = kmBetween(seller.district, district);
  const opt = (mode: DeliveryMode, icon: string, title: string, sub: string, price: string, when: string, ok: boolean, extra?: any) => (
    <div className={'card ' + (pl.mode === mode ? 'sel' : 'line')} role="radio" aria-checked={pl.mode === mode ? 'true' : 'false'} aria-disabled={ok ? undefined : 'true'} tabIndex={0} style={ok ? { cursor: "pointer" } : { opacity: ".55" }} onClick={() => ok && setPlan(A, seller.id, { mode, date: mode === 'CARRIER' ? nextRoute ?? pl.date : mode === 'FARMER' ? nextFarm ?? pl.date : pl.date, slot: mode === 'CARRIER' ? '18:00 a 19:30' : mode === 'PICKUP' ? '8:00 a 12:00' : '7:00 a 9:00' })}>
      <div className="row top"><span className={'icirc ' + (pl.mode === mode ? 'dark' : '')}><Icon n={icon} /></span><div className="grow"><div className="row between"><b className="bodym">{title}</b><b>{price}</b></div><div className="row between top"><span className="cap">{sub}</span><span className="cap nowrap">{when}</span></div>{pl.mode === mode && extra}</div></div>
    </div>
  );
  const next = () => A.replace(pl.mode === 'CARRIER' ? 'B-30' : pl.mode === 'PICKUP' ? 'B-29' : 'B-10', { seller: seller.id });
  return (
    <Screen title="¿Cómo lo recibes?" sub={`Paso 2 de 3 · pedido a ${seller.name}`} foot={<><Btn full onClick={next}>Continuar</Btn><div className="why">Eliges en cada pedido. El flete no cuenta para el límite de tu plan.</div></>}>
      <div className="stack">
        <Card><div className="row between"><b className="bodym">{g.lines.map(y => `${product(y.l.productId).name} · ${y.l.unit === 'kg' ? fkg(y.qty) : qtyText(y.qty, y.l.unit, y.l.unitKg)}`).join(', ')}</b><b>{money(subtotal)}</b></div><div className="cap"><Icon n="route" s="1em" /> De {placeLabel(seller.district)} a {A.org!.name}, {districtName(district)} · {km} km</div></Card>
        {opt('PICKUP', 'hand-coins', 'Recojo yo', `En el punto que indique ${seller.name.split(' ')[0]}${seller.pickupPoint ? ` (${seller.pickupPoint})` : ''}. Tú pones el vehículo.`, money(0), '', true)}
        {opt('FARMER', 'sprout', 'Envío del agricultor', serves ? `${seller.name.split(' ')[0]} reparte en ${districtName(district)} los ${seller.deliveryDays.map(d => DOW_LONG[d]).join(', ')}.` : `${seller.name.split(' ')[0]} todavía no reparte en ${districtName(district)} (RN-27).`, serves ? (farmerFee(seller, district) ? money(farmerFee(seller, district)) : 'Incluido') : '—', nextFarm && serves ? dateShort(nextFarm) : '', serves)}
        {opt('CARRIER', 'truck', 'Transportista aliado', route ? 'Verificado por Mesagri, con seguimiento y código de entrega.' : 'Todavía no hay transportistas aliados en esta ruta.', fr ? money(fr.freight) : '—', nextRoute ? dateShort(nextRoute) : '', !!route && rdays.length > 0,
          route && route.scope === 'RUTA' ? <div className="chips mt"><Chip tone="line">{money(route.pricePerKg)} por kg</Chip><Chip tone="line">Mínimo {money(route.minFee)}</Chip><Chip tone="line">18:00 a 19:30</Chip></div> : route ? <div className="chips mt"><Chip tone="line">Moto {money(route.cityMoto)} · camioneta {money(route.cityVan)}</Chip></div> : null)}
        <Note icon="banknote">El flete se lo pagas directo al transportista cuando recibes. Mesagri no te cobra nada por el envío.</Note>
      </div>
    </Screen>
  );
}

/* ---------- B-29 · Recojo por tu cuenta ---------- */
function PickupPlan() {
  const A = useApp();
  const seller = A.w.orgs[A.top.p?.seller as string];
  if (!seller) return <Screen title="Recojo"><Empty title="Sin pedido" /></Screen>;
  const pl = planFor(A, seller, 0);
  const days = nextDays(A.now, [], 3, 1);
  const [by, setBy] = useState(pl.pickupBy ?? A.org!.receiver ?? A.me!.name);
  const [dni, setDni] = useState(pl.pickupDni ?? '');
  const [plate, setPlate] = useState(pl.plate ?? '');
  return (
    <Screen title="Recojo por tu cuenta" sub={`Pedido a ${seller.name}`} foot={<Btn full onClick={() => { setPlan(A, seller.id, { mode: 'PICKUP', pickupBy: by, pickupDni: dni, plate }); A.replace('B-10'); }}>Confirmar recojo</Btn>}>
      <div className="stack">
        <Card><div className="row top"><Icon n="map-pin" /><div><b className="bodym">Punto de recojo de {seller.name.split(' ')[0]}</b><div className="cap">{seller.pickupPoint ?? placeLabel(seller.district)} · la dirección exacta se muestra cuando acepte el pedido</div></div></div></Card>
        <div className="lbl">¿Cuándo recoges?</div>
        <div className="chips">{days.map(d => <ChipBtn key={d} on={startOfDay(pl.date) === d} onClick={() => setPlan(A, seller.id, { date: d, slot: '8:00 a 12:00' })}>{dateShort(d)} · 8:00 a 12:00</ChipBtn>)}</div>
        <div className="grid2">
          <Field label="¿Quién recoge?"><Inp value={by} onInput={setBy} label="Quién recoge" /></Field>
          <Field label="DNI"><Inp value={dni} onInput={(v) => setDni(v.replace(/\D/g, '').slice(0, 8))} mode="numeric" label="DNI de quien recoge" /></Field>
        </div>
        <Field label="Placa del vehículo (opcional)"><Inp value={plate} onInput={setPlate} placeholder="V2B-390" suffix={<Icon n="truck" />} label="Placa" /></Field>
        <Card tone="dark"><b>Código de recojo</b><div className="cap">Te lo damos cuando el agricultor acepte. Díctaselo cuando tengas los sacos contados y pesados.</div></Card>
        <Note icon="triangle-alert" tone="warn">Si mandas un transporte tuyo, los papeles del traslado y lo que pase en el camino van por tu cuenta.</Note>
      </div>
    </Screen>
  );
}

/* ---------- B-30 · Envío con transportista aliado ---------- */
function CarrierPlan() {
  const A = useApp();
  const seller = A.w.orgs[A.top.p?.seller as string];
  const g = groups(A.w, cartOf(A)).find(x => x.seller.id === seller?.id);
  if (!seller || !g) return <Screen title="Envío"><Empty title="Sin pedido" /></Screen>;
  const subtotal = r2(g.lines.reduce((a, y) => a + lineTotal(y.l, y.qty), 0));
  const kgT = r2(g.lines.reduce((a, y) => a + y.qty * y.l.unitKg, 0));
  const pl = planFor(A, seller, subtotal);
  const route = routeFor(A.w.settings, sellerProvince(A.w, seller.id), provinceOf(A.org!.district) ?? 'AREQUIPA');
  const fr = route ? freightFor(route, kgT) : undefined;
  const favs = A.w.favorites[A.org!.id]?.carriers ?? [];
  const [who, setWho] = useState<'best' | 'fav'>(pl.carrier ? 'fav' : 'best');
  // candidatos como los vería el motor (mismo orden: favoritos, luego calificación)
  const fake: any = { id: 'x', routeId: route?.id, pickupAt: pl.date + 14 * HOUR, weightKg: kgT, cargoValue: subtotal, offers: [], buyerOrgId: who === 'fav' ? A.org!.id : 'nadie', scope: route?.scope };
  const cands = route ? eligibleCarriers(A.w, fake, A.now) : [];
  const top = who === 'fav' ? cands.find(c => favs.includes(c.id)) ?? cands[0] : [...cands].sort((a, b) => carrierStats(A.w, b.id).rating - carrierStats(A.w, a.id).rating)[0];
  const cs = top ? carrierStats(A.w, top.id) : undefined;
  const person = top ? userOfOrg(A.w, top.id) : undefined;
  const r0 = top?.carrier?.routes.find(r => r.routeId === route?.id);
  return (
    <Screen title="Envío con transportista" sub={`Paso 2 de 3 · pedido a ${seller.name}`} foot={<Btn full onClick={() => { setPlan(A, seller.id, { mode: 'CARRIER', carrier: who === 'fav' ? top?.id : undefined, slot: r0 ? `${r0.arrives} aprox.` : '18:00 a 19:30' }); A.replace('B-10'); }} disabled={!route || !cands.length} why={!cands.length ? 'No hay transportistas aptos ese día: elige otra fecha' : undefined}>Pedir envío</Btn>}>
      <div className="stack">
        <Card><Kv rows={[['Carga', g.lines.map(y => `${product(y.l.productId).name} · ${y.l.unit === 'kg' ? fkg(y.qty) : qtyText(y.qty, y.l.unit, y.l.unitKg)}`).join(', ')], ['Recojo', `${dateShort(pl.date)} · ${r0 ? r0.departs : '14:20'} · ${placeLabel(seller.district)}`], ['Entrega', `${dateShort(pl.date)} · ${r0 ? `${r0.arrives} aprox.` : '18:00 a 19:30'}`]]} /></Card>
        {fr && route && <Card><Kv total rows={[[route.scope === 'RUTA' ? `Flete: ${fkg(kgT)} × ${money(route.pricePerKg)}${fr.perKg ? '' : ` (mínimo ${money(route.minFee)})`}` : `Reparto en la ciudad (${fr.vclass === 'V1' ? 'moto' : 'camioneta'})`, money(fr.freight)], ['Cargo de Mesagri a tu negocio', money(0)], ['Pagas al recibir', money(fr.freight)]]} /></Card>}
        <div className="lbl">¿Quién lo lleva?</div>
        <Seg value={who} onChange={setWho} options={[{ v: 'best', l: 'El mejor disponible' }, { v: 'fav', l: 'Mi favorito' }]} />
        {top ? <Card><div className="row"><span className="av" style={{ background: "#1E3F20" }}>{person?.name.split(' ').slice(0, 2).map(x => x[0]).join('')}</span><div className="grow"><b className="bodym">{person?.shortName} {person?.name.split(' ')[1] ?? ''}</b><div className="cap">{top.carrier?.level} Verificado · {cs?.onTimePct ? pct(cs.onTimePct) : '—'} a tiempo</div></div><b className="price">★ {cs?.rating ? String(cs.rating).replace('.', ',') : '—'}</b></div><div className="cap mt">{who === 'fav' && favs.includes(top.id) ? 'Es tu favorito: le ofrecemos primero.' : 'Es el mejor calificado de la ruta.'} Si no acepta en {route?.scope === 'CIUDAD' ? '15 minutos' : '2 h'}, pasa al siguiente.</div><button className="linkbtn" style={{ paddingLeft: "0" }} onClick={() => A.go('B-34', { id: top.id })}>Ver su perfil</button></Card>
          : <Note icon="calendar" tone="warn">No hay transportistas aptos para esa fecha: cambia el día en el paso anterior.</Note>}
        <Card tone="soft"><div className="stack tight">
          <div className="row top g8"><Icon n="shield-check" s="1.1em" /><span className="bodym">El transportista responde si la carga se pierde o se daña en el camino.</span></div>
          <div className="row top g8"><Icon n="clock" s="1.1em" /><span className="bodym">Tienes 24 h desde que recibes para reclamar, con fotos.</span></div>
          <div className="row top g8"><Icon n="x" s="1.1em" /><span className="bodym">Si cancelas cuando ya salió a recoger, pagas el 30 % del flete.</span></div>
        </div></Card>
      </div>
    </Screen>
  );
}

/* ---------- B-11 · Confirmar pedido y pago ---------- */
function CheckoutPay() {
  const A = useApp();
  const org = A.org!;
  const g = groups(A.w, cartOf(A));
  const [busy, setBusy] = useState(false);
  if (!g.length) return <Screen title="Confirmar pedido"><Empty title="Tu carrito está vacío" /></Screen>;
  const rows = g.map(x => {
    const subtotal = r2(x.lines.filter(y => y.ok).reduce((a, y) => a + lineTotal(y.l, y.qty), 0));
    const pl = planFor(A, x.seller, subtotal);
    const kgT = x.lines.reduce((a, y) => a + y.qty * y.l.unitKg, 0);
    const dc = deliveryCost(A, x.seller, pl, kgT);
    return { x, subtotal, pl, dc, total: r2(subtotal + dc.fee) };
  });
  const grand = r2(rows.reduce((a, r) => a + r.total, 0));
  const prepay = prepayRequired(A.w.settings, org.level);
  const place = () => {
    setBusy(true);
    const orderId = 'o-' + uid();
    const subs = rows.map(r => ({ subOrderId: 'so-' + uid(), sellerOrgId: r.x.seller.id, items: r.x.lines.filter(y => y.ok).map(y => ({ listingId: y.l.id, qty: y.qty })), deliveryMode: r.pl.mode, deliveryDate: r.pl.date, slot: r.pl.slot, taxDoc: r.pl.taxDoc, payMethod: r.pl.pay, shipmentId: r.pl.mode === 'CARRIER' ? 'sh-' + uid() : undefined, preferredCarrier: r.pl.carrier }));
    const loc = localOf(org, A.dev.flow.localId);
    const res = A.act('ORDER_PLACE', { orderId, address: loc?.address ?? org.address, district: loc?.district ?? org.district, subs, upgrade: A.dev.flow.upgrade }, { quiet: true });
    setBusy(false);
    if (!res.ok) {
      if (res.error?.code === 'PLAN_LIMIT') { A.sheet(<PlanLimitSheet month={res.error.data.month} order={res.error.data.order} />); return; }
      A.toast(res.error!.message, 'err');
      return;
    }
    A.patch(d => { d.cart = []; d.flow = { ...d.flow, plans: {}, upgrade: undefined }; d.stack = [{ s: 'B-13' }]; });
    A.toast(!A.dev.online ? 'Pedido guardado: se envía cuando vuelva la señal.' : `Pedido enviado. ${rows.length > 1 ? 'Cada agricultor' : rows[0].x.seller.name.split(' ')[0]} tiene ${A.w.settings.orderResponseHours} h para aceptar.`);
  };
  return (
    <Screen title="Confirmar pedido" sub={`Paso 3 de 3${prepay ? ` · nivel ${org.level}: pagas antes de la entrega` : ''}`} foot={<Btn full onClick={place} loading={busy}>Confirmar pedido</Btn>}>
      <div className="stack">
        <Card><Kv total rows={[...rows.map(r => [`${r.x.seller.name.split(' ')[0]} · ${r.x.lines.map(y => `${product(y.l.productId).name.toLowerCase()} ${y.l.unit === 'kg' ? fkg(y.qty) : qtyText(y.qty, y.l.unit, y.l.unitKg)}`).join(', ')}${r.dc.fee ? ' + envío' : ''}`, money(r.total)] as [string, string]), ...(rows.some(r => r.dc.freight) ? [['Flete al transportista (al recibir)', money(rows.reduce((a, r) => a + r.dc.freight, 0))] as [string, string]] : []), ['Total', money(grand)]]} /></Card>
        {A.dev.flow.upgrade && <Note icon="sparkles" tone="soft">Con este pedido pasas al plan {A.w.settings.plans[A.dev.flow.upgrade.plan as 'PRO'].name}.</Note>}
        {rows.map(r => {
          const methods = digitalMethods(r.x.seller);
          const cash = cashCheck(A.w.settings, r.total, org, r.x.seller);
          const acct = (m: string) => r.x.seller.payout.find(a => (m === 'TRANSFER' ? a.kind === 'BANK' : a.kind === m));
          const opt = (m: PayMethod, title: string, sub: string, ok: boolean, why?: string) => (
            <div className={'card ' + (r.pl.pay === m ? 'sel' : 'line')} role="radio" aria-checked={r.pl.pay === m ? 'true' : 'false'} aria-disabled={ok ? undefined : 'true'} tabIndex={0} style={ok ? { cursor: "pointer" } : { opacity: ".55" }} onClick={() => ok ? setPlan(A, r.x.seller.id, { pay: m }) : why && A.toast(why, 'info')}>
              <div className="row"><span className={'radio' + (r.pl.pay === m ? ' on' : '')} /><div className="grow"><b className="bodym">{title}</b><div className="cap">{ok ? sub : why}</div></div></div>
            </div>
          );
          return (
            <div key={r.x.seller.id} className="stack tight">
              <div className="sect">¿Cómo le pagas a {r.x.seller.name.split(' ')[0]}?</div>
              {opt(methods.includes('YAPE') ? 'YAPE' : 'PLIN', methods.includes('YAPE') && methods.includes('PLIN') ? 'Yape o Plin' : methods.includes('PLIN') ? 'Plin' : 'Yape', `Directo a su número${acct('YAPE') ? '' : ''} · lo ves al confirmar`, methods.includes('YAPE') || methods.includes('PLIN'), `${r.x.seller.name.split(' ')[0]} no recibe Yape ni Plin.`)}
              {opt('TRANSFER', 'Transferencia', 'A su cuenta · subes la constancia', methods.includes('TRANSFER'), `${r.x.seller.name.split(' ')[0]} no recibe transferencias.`)}
              {opt('CASH', 'Efectivo al recibir', `Hasta ${moneyShort(A.w.settings.cashThreshold - 0.01)}`, cash.ok, cash.reason)}
            </div>
          );
        })}
        <Card tone="soft"><div className="bodym">Mesagri no guarda tu dinero: pagas directo al agricultor y él confirma tu constancia.{prepay ? ' Con tu nivel pagas cuando el agricultor acepte, antes de que prepare (RN-24).' : ''}</div></Card>
      </div>
    </Screen>
  );
}

/* ---------- B-12 · Constancia de pago ---------- */
function PaymentProof() {
  const A = useApp();
  const s = A.w.subOrders[A.top.p?.id as string];
  const seller = s ? A.w.orgs[s.sellerOrgId] : undefined;
  const methods = seller ? digitalMethods(seller) : [];
  const [method, setMethod] = useState<PayMethod>(s && methods.includes(s.payment.method as any) ? s.payment.method : (methods[0] ?? 'YAPE'));
  const [op, setOp] = useState('');
  const [photo, setPhoto] = useState<string | undefined>();
  const [when, setWhen] = useState(hhmm(A.now));
  if (!s || !seller) return <Screen title="Constancia de pago"><Empty title="No encontramos el pedido" /></Screen>;
  const acct = seller.payout.find(a => (method === 'TRANSFER' ? a.kind === 'BANK' : a.kind === method));
  const visible = !['PENDING_CONFIRMATION'].includes(s.status);
  const send = () => {
    const [hh, mm] = when.split(':').map(Number);
    const paidAt = startOfDay(A.now) + ((hh || 0) * 60 + (mm || 0)) * 60_000;
    const r = A.act('PAYMENT_UPLOAD', { subOrderId: s.id, method, operation: op, amount: s.total, paidAt, photoId: photo });
    if (r.ok) { A.toast(`Enviamos tu constancia. ${seller.name.split(' ')[0]} confirma que le llegó.`); A.back(); }
  };
  return (
    <Screen title="Constancia de pago" sub="Sube la captura de tu pago" foot={<><Btn full onClick={send} disabled={!visible || !!permWhy(A.w, A.me, 'PAYMENT_UPLOAD')} why={permWhy(A.w, A.me, 'PAYMENT_UPLOAD')}>Enviar constancia</Btn><div className="why">{seller.name.split(' ')[0]} confirma que le llegó. Si dice que no, Soporte revisa ambas versiones.</div></>}>
      <div className="stack">
        <Card><div className="row between"><b className="bodym">Pedido {s.code}</b><Chip tone="warn">Por pagar</Chip></div><div className="cap">{seller.name} · {itemsShort(s).toLowerCase()}</div><div className="big mt">{money(s.total)}</div></Card>
        {methods.length > 1 && <Seg value={method} onChange={setMethod} options={methods.map(m => ({ v: m as PayMethod, l: PAY_LABEL[m as PayMethod] }))} />}
        {visible && acct ? <Card tone="soft"><div className="row"><div className="grow"><div className="cap">{acct.kind === 'BANK' ? 'Cuenta (CCI) a nombre de' : `${PAY_LABEL[acct.kind === 'PLIN' ? 'PLIN' : 'YAPE']} a nombre de`}</div><b className="bodym">{acct.holder}{acct.relation !== 'PROPIA' ? ' (autorizada)' : ''} · {acct.kind === 'BANK' ? acct.number.replace(/(\d{3})(\d{3})(\d+)(\d{2})$/, '$1 $2 … $4') : acct.number.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3')}</b></div><Btn xs kind="light" onClick={() => { try { navigator.clipboard.writeText(acct.number); A.toast('Número copiado.', 'info'); } catch { A.toast(acct.number, 'info'); } }}>Copiar</Btn></div></Card>
          : <Note icon="clock" tone="warn">Verás los datos de cobro cuando el agricultor acepte tu pedido.</Note>}
        <PhotoPick value={photo} onChange={setPhoto} label="Captura de tu pago" kind="pago" sample={{ value: money(s.total), label: `a ${acct?.holder ?? seller.name}`, stamp: op || '05123987' }} />
        <div className="grid2">
          <Field label="N.º de operación"><Inp value={op} onInput={(v) => setOp(v.replace(/\D/g, ''))} mode="numeric" placeholder="05123987" label="Número de operación" /></Field>
          <Field label="Hora del pago"><Inp value={when} onInput={setWhen} placeholder="19:32" label="Hora del pago" /></Field>
        </div>
        <Note icon="shield-check">Mesagri nunca te pedirá tu clave del banco ni de Yape.</Note>
      </div>
    </Screen>
  );
}

/* ---------- B-13 · Mis pedidos ---------- */
function BuyerOrders() {
  const A = useApp();
  const subs = Object.values(A.w.subOrders).filter(s => s.buyerOrgId === A.org!.id).sort((a, b) => b.createdAt - a.createdAt);
  const g = { cur: subs.filter(s => ['PENDING_CONFIRMATION', 'CONFIRMED', 'AWAITING_HARVEST', 'PREPARING', 'READY', 'IN_TRANSIT', 'DELIVERED', 'DISPUTED'].includes(s.status)), done: subs.filter(s => s.status === 'COMPLETED'), dead: subs.filter(s => ['REJECTED', 'EXPIRED', 'CANCELLED_BY_BUYER', 'CANCELLED_BY_SELLER'].includes(s.status)) };
  const [tab, setTab] = useState<'cur' | 'done' | 'dead'>(A.top.p?.tab ?? 'cur');
  return (
    <Screen title="Mis pedidos" back={false} right={<button className="act" aria-label="Mensajes" onClick={() => A.go('A-18')}><Icon n="message-circle" s="1.3em" /></button>}>
      <div className="stack">
        <Seg value={tab} onChange={setTab} options={[{ v: 'cur', l: `En curso ${g.cur.length}` }, { v: 'done', l: `Entregados ${g.done.length}` }, { v: 'dead', l: `Cancelados ${g.dead.length}` }]} />
        <OrderShortcuts />
        {g[tab].length === 0 && <Card><Empty icon="shopping-bag" title="Nada por aquí" text={tab === 'cur' ? 'Haz tu primer pedido desde el catálogo.' : undefined} /></Card>}
        {g[tab].slice(0, 30).map(s => <BuyerOrderCard key={s.id} s={s} />)}
      </div>
    </Screen>
  );
}
/* Solicitudes de compra y pedidos programados, a un toque desde «Mis pedidos» */
function OrderShortcuts() {
  const A = useApp();
  const org = A.org!;
  const open = Object.values(A.w.requests).filter(r => r.buyerOrgId === org.id && r.status === 'OPEN');
  const offers = open.reduce((a, r) => a + r.offers.filter(o => o.status === 'SENT').length, 0);
  const pending = Object.values(A.w.schedules).filter(x => x.buyerOrgId === org.id && x.draft?.status === 'PENDING').length;
  return (
    <div className="grid2">
      <button className="card soft" style={{ padding: '.7em .8em' }} onClick={() => A.go('B-17')} aria-label={`Solicitudes de compra${offers ? `, ${offers} ${offers === 1 ? 'oferta' : 'ofertas'}` : ''}`}>
        <div className="row g8"><Icon n="clipboard-list" s="1.25em" /><div className="grow"><b className="bodym">Solicitudes</b><div className="cap">{offers ? `${offers} ${offers === 1 ? 'oferta nueva' : 'ofertas nuevas'}` : open.length ? `${open.length} ${open.length === 1 ? 'abierta' : 'abiertas'}` : 'Pide y te ofrecen'}</div></div></div>
      </button>
      <button className="card soft" style={{ padding: '.7em .8em' }} onClick={() => A.go('B-22')} aria-label={`Pedidos programados${pending ? `, ${pending} por aprobar` : ''}`}>
        <div className="row g8"><Icon n="repeat" s="1.25em" /><div className="grow"><b className="bodym">Programados</b><div className="cap">{pending ? `${pending} por aprobar` : isPro(org) ? 'Cada semana, solos' : 'Con el plan Pro'}</div></div></div>
      </button>
    </div>
  );
}
function BuyerOrderCard({ s }: { s: SubOrder }) {
  const A = useApp();
  const st = statusInfo(s, 'buyer');
  const label = s.status === 'CONFIRMED' && s.payment.status === 'CONFIRMED' ? `Pagado · llega ${dateShort(s.deliveryDate)}` : s.status === 'PENDING_CONFIRMATION' ? `Esperando que acepte · ${duration(Math.max(0, s.confirmBy - A.now))}` : st.label;
  const act = s.status === 'CONFIRMED' && s.payment.status === 'NONE' && s.payment.method !== 'CASH' ? ['Pagar', 'B-12'] : s.status === 'DELIVERED' ? ['Revisar', 'B-15'] : s.status === 'COMPLETED' ? (s.reviewBuyer ? ['Repetir', 'REPEAT'] : ['Calificar', 'B-16']) : ['Seguir', 'B-14'];
  return (
    <Card>
      <div className="row between top"><div className="grow"><b className="bodym">{orgName(A.w, s.sellerOrgId)}</b><div className="cap">{s.code} · {itemsShort(s).toLowerCase()}</div></div><b className="price">{money(s.total)}</b></div>
      <div className="row between wrap mt"><Chip tone={st.tone} icon={st.icon}>{label}</Chip><Btn xs kind={act[0] === 'Seguir' || act[0] === 'Repetir' ? 'dark' : 'primary'} onClick={() => { if (act[1] === 'REPEAT') { let n = 0; for (const it of s.items) { const l = A.w.listings[it.listingId]; const alt = l && catalogListing(A.w, l, A.now) ? l : Object.values(A.w.listings).find(x => x.orgId === s.sellerOrgId && x.productId === it.productId && catalogListing(A.w, x, A.now)); if (alt) { addToCart(A, alt.id, Math.min(alt.available, it.unit === alt.unit ? it.qty : defaultQty(alt))); n++; } } if (n) A.reset('B-09'); else A.toast('Ese producto ya no está publicado.', 'warn'); } else A.go(act[1], { id: s.id }); }}>{act[0]}</Btn></div>
    </Card>
  );
}

/* ---------- B-14 · Detalle y seguimiento ---------- */
function BuyerOrder() {
  const A = useApp();
  const s = A.w.subOrders[A.top.p?.id as string];
  if (!s) return <Screen title="Pedido"><Empty title="No encontramos el pedido" /></Screen>;
  const seller = A.w.orgs[s.sellerOrgId];
  const sh = s.shipmentId ? A.w.shipments[s.shipmentId] : undefined;
  const st = statusInfo(s, 'buyer');
  const needPay = s.status === 'CONFIRMED' && s.payment.status === 'NONE' && s.payment.method !== 'CASH';
  const canCancel = ['PENDING_CONFIRMATION', 'CONFIRMED', 'PREPARING', 'READY'].includes(s.status) && !(sh && ['PICKED_UP', 'ARRIVED'].includes(sh.status));
  const showCode = ['CONFIRMED', 'PREPARING', 'READY', 'IN_TRANSIT'].includes(s.status);
  const code = s.deliveryMode === 'PICKUP' ? s.pickupCode : s.deliveryCode;
  const foot = needPay ? <Btn full onClick={() => A.go('B-12', { id: s.id })}>Pagar {money(s.total)} y subir la constancia</Btn>
    : s.status === 'DELIVERED' ? <Btn full kind="dark" onClick={() => A.go('B-15', { id: s.id })}>¿Llegó todo bien? Revisa y confirma</Btn>
    : s.status === 'COMPLETED' && !s.reviewBuyer ? <Btn full onClick={() => A.go('B-16', { id: s.id })}>Califica a {seller.name.split(' ')[0]}</Btn> : undefined;
  return (
    <Screen title={`Pedido ${s.code}`} sub={`${seller.name} · ${itemsShort(s).toLowerCase()}`} foot={foot}>
      <div className="stack">
        {(() => { const o = originOf(A.w, s); return o ? <button className="card soft" onClick={() => A.go(o.kind === 'REQUEST' ? 'B-17' : 'B-22', { id: o.id })}><div className="row"><Icon n={o.kind === 'REQUEST' ? 'clipboard-list' : 'repeat'} /><div className="grow bodym">{o.label}</div><Icon n="chevron-right" s="1.1em" /></div></button> : null; })()}
        {s.status === 'EXPIRED' && <Note icon="clock" tone="danger">{seller.name.split(' ')[0]} no respondió en {A.w.settings.orderResponseHours} horas: el pedido venció. No pagas nada (RN-08).</Note>}
        {s.status === 'REJECTED' && <Note icon="x" tone="danger">{seller.name.split(' ')[0]} no pudo aceptar: {s.rejectReason}. No pagas nada.</Note>}
        {s.payment.status === 'NOT_RECEIVED' && <Note icon="triangle-alert" tone="danger">{seller.name.split(' ')[0]} dice que no le llegó tu pago. Soporte revisa tu constancia y su movimiento.</Note>}
        <Card><Timeline steps={timelineFor(s, A.w)} /></Card>
        {showCode && code && (
          <Card tone="dark">
            <div className="row between"><div><div className="cap">{s.deliveryMode === 'PICKUP' ? 'Código de recojo' : 'Código de entrega'}</div><div className="code mt">{code.split('').map((d, i) => <span key={i}>{d}</span>)}</div></div><Icon n="lock" s="1.6em" /></div>
            <div className="cap mt">{s.deliveryMode === 'PICKUP' ? `Díctaselo a ${seller.name.split(' ')[0]} cuando tengas los sacos contados y pesados.` : sh?.carrierOrgId ? `Díctaselo a ${userOfOrg(A.w, sh.carrierOrgId)?.shortName ?? 'tu transportista'} solo cuando tengas tu pedido contado.` : `Díctaselo a ${seller.name.split(' ')[0]} solo cuando tengas tu ${product(s.items[0].productId).name.toLowerCase()}.`}</div>
          </Card>
        )}
        <div className="btnrow">
          <Btn kind="sec" icon="send" onClick={() => A.go('CHAT', { id: s.id })}>Mensaje</Btn>
          {sh ? <Btn kind="sec" icon="truck" onClick={() => A.go('B-31', { id: sh.id })}>Ver envío</Btn> : ['IN_TRANSIT', 'DELIVERED'].includes(s.status) ? <Btn kind="sec" icon="triangle-alert" onClick={() => A.sheet(<DisputeSheet id={s.id} />)}>Problema</Btn> : null}
        </div>
        {sh && ['IN_TRANSIT', 'DELIVERED'].includes(s.status) && <button className="linkbtn" style={{ alignSelf: "center" }} onClick={() => A.sheet(<DisputeSheet id={s.id} />)}>Problema con el producto</button>}
        <Card><Kv total rows={[...s.items.map(i => [product(i.productId).name, `${i.unit === 'kg' ? fkg(i.qty) : qtyText(i.qty, i.unit, i.unitKg)} × ${money(i.price)}`] as [string, string]), ['Entrega', `${deliveryText(s)} · ${dateShort(s.deliveryDate)} ${slotOf(A.w, s)}`], ['Comprobante', TAXDOC_LABEL[s.taxDoc] + (s.taxDocNumber ? ` ${s.taxDocNumber}` : '')], ['Pago', `${PAY_LABEL[s.payment.method]}${s.payment.status === 'CONFIRMED' ? ' · confirmado' : s.payment.status === 'UPLOADED' ? ' · por confirmar' : ''}`], ['Total', money(s.total)]]} /></Card>
        {s.taxDoc === 'LIQUIDACION' && !s.taxDocNumber && !['PENDING_CONFIRMATION', 'REJECTED', 'EXPIRED', 'CANCELLED_BY_BUYER', 'CANCELLED_BY_SELLER'].includes(s.status) && <LiqCard id={s.id} />}
        {s.status === 'DISPUTED' && s.disputeId && <Note icon="triangle-alert" tone="warn">Disputa {A.w.disputes[s.disputeId]?.code}: Soporte revisa las fotos y el chat y propone una solución a ambos (RN-15).</Note>}
        {canCancel && <button className="linkbtn" style={{ alignSelf: "center", color: "var(--danger)" }} onClick={async () => { const late = s.status !== 'PENDING_CONFIRMATION'; const ok = await A.confirm({ title: '¿Cancelar el pedido?', text: late ? `${seller.name.split(' ')[0]} ya aceptó: se anota en tu reputación${sh?.status === 'GOING_TO_PICKUP' ? ' y pagas el 30 % del flete al transportista (RN-61)' : ''}. Si ya pagaste, coordinen la devolución.` : 'Todavía no lo acepta: cancelas sin costo.', ok: 'Cancelar pedido', danger: true }); if (ok) A.act('SUBORDER_CANCEL', { subOrderId: s.id, reason: 'Cancelado por el comprador' }, { ok: 'Pedido cancelado.' }); }}>Cancelar el pedido</button>}
      </div>
    </Screen>
  );
}
function LiqCard({ id }: { id: string }) {
  const A = useApp();
  const [n, setN] = useState('');
  return <Card tone="soft"><b className="bodym">Registra tu liquidación de compra</b><div className="cap">El agricultor no tiene RUC: la emites tú en la SUNAT (RN-34).</div><div className="row g8 mt"><div className="grow"><Inp value={n} onInput={setN} placeholder="E001-88" label="Serie y número" /></div><Btn sm kind="dark" onClick={() => A.act('TAXDOC_REGISTER', { subOrderId: id, number: n }, { ok: 'Liquidación registrada.' })}>Guardar</Btn></div></Card>;
}
function DisputeSheet({ id }: { id: string }) {
  const A = useApp();
  const s = A.w.subOrders[id];
  const [kind, setKind] = useState<'NO_LLEGO' | 'CANTIDAD' | 'CALIDAD' | 'OTRO'>(s.status === 'IN_TRANSIT' ? 'NO_LLEGO' : 'CANTIDAD');
  const [desc, setDesc] = useState('');
  const [photo, setPhoto] = useState<string | undefined>();
  return (
    <SheetBody title="Reportar un problema" sub="Soporte revisa ambas versiones y propone una solución. Mesagri no retiene dinero.">
      <div className="chips">{(s.status === 'IN_TRANSIT' ? [['NO_LLEGO', 'No llegó']] : [['CANTIDAD', 'Llegó menos'], ['CALIDAD', 'Calidad'], ['OTRO', 'Otro']]).map(([v, l]) => <ChipBtn key={v} on={kind === v} onClick={() => setKind(v as any)}>{l}</ChipBtn>)}</div>
      <Inp area value={desc} onInput={setDesc} placeholder="Cuéntanos qué pasó" label="Qué pasó" />
      <PhotoPick value={photo} onChange={setPhoto} label="Foto (tu prueba)" kind="balanza" />
      <Btn full kind="danger" onClick={() => { if (A.act('DISPUTE_OPEN', { subOrderId: id, kind, description: desc, photoIds: photo ? [photo] : [], disputeId: 'dsp-' + uid() }, { ok: 'Enviamos tu reporte a Soporte.' }).ok) A.sheet(null); }}>Enviar a Soporte</Btn>
    </SheetBody>
  );
}

/* ---------- B-15 · Recepción y conformidad ---------- */
function Receive() {
  const A = useApp();
  const s = A.w.subOrders[A.top.p?.id as string];
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries((s?.items ?? []).map(i => [i.listingId, String(i.qty).replace('.', ',')])));
  const [q, setQ] = useState<Record<string, 'OK' | 'FAIL'>>({});
  const [photos, setPhotos] = useState<(string | undefined)[]>([undefined, undefined]);
  const [note, setNote] = useState('');
  if (!s) return <Screen title="¿Llegó todo bien?"><Empty title="No encontramos el pedido" /></Screen>;
  const lines = s.items.map(i => ({ listingId: i.listingId, acceptedQty: Number((vals[i.listingId] ?? '').replace(',', '.')) || 0, quality: q[i.listingId] ?? 'OK' }));
  const allOk = lines.every((l, k) => l.acceptedQty >= s.items[k].qty - 1e-9 && l.quality === 'OK');
  const send = (ok: boolean) => {
    const payload = ok ? { subOrderId: s.id, lines: s.items.map(i => ({ listingId: i.listingId, acceptedQty: i.qty, quality: 'OK' })) } : { subOrderId: s.id, lines, photoIds: photos.filter(Boolean), note, disputeId: 'dsp-' + uid() };
    const r = A.act('RECEIPT_CONFIRM', payload);
    if (!r.ok) return;
    if (ok) { A.toast('¡Gracias! Confirmaste la recepción.'); A.replace('B-16', { id: s.id }); }
    else { A.toast('Reportaste la diferencia: Soporte media entre ustedes.', 'warn'); A.back(); }
  };
  const left = (s.deliveredAt ?? A.now) + A.w.settings.autoCompleteHours * HOUR - A.now;
  return (
    <Screen title="¿Llegó todo bien?" sub={`Pedido ${s.code} · entregado ${s.deliveredAt ? hhmm(s.deliveredAt) : ''}`} foot={<><Btn full kind="dark" onClick={() => send(true)} disabled={!allOk || !!permWhy(A.w, A.me, 'RECEIPT_CONFIRM')} why={permWhy(A.w, A.me, 'RECEIPT_CONFIRM') ?? (!allOk ? 'Hay una diferencia: repórtala' : undefined)}>Todo conforme</Btn><Btn full kind="sec" onClick={() => send(false)} disabled={!!permWhy(A.w, A.me, 'RECEIPT_CONFIRM')} why={permWhy(A.w, A.me, 'RECEIPT_CONFIRM')}>Reportar un problema</Btn></>}>
      <div className="stack">
        {s.items.map(i => (
          <Card key={i.listingId}>
            <div className="row between"><b className="bodym">{product(i.productId).name}</b><span className="cap">pediste {i.unit === 'kg' ? fkg(i.qty) : qtyText(i.qty, i.unit, i.unitKg)}</span></div>
            <div className="autogrid mt">
              <Field label="Recibiste"><Inp value={vals[i.listingId] ?? ''} onInput={(v) => setVals({ ...vals, [i.listingId]: v })} mode="decimal" suffix={<span className="row g4">{i.unit === 'kg' ? 'kg' : UNIT_LABEL[i.unit].many}<Icon n="scale" s="1em" /></span>} label="Cantidad recibida" /></Field>
              <Field label="Calidad"><Seg value={q[i.listingId] ?? 'OK'} onChange={(v) => setQ({ ...q, [i.listingId]: v })} options={[{ v: 'OK', l: 'Conforme' }, { v: 'FAIL', l: 'Con fallas' }]} /></Field>
            </div>
          </Card>
        ))}
        <div className="row top">
          <div className="photos grow" style={{ gridTemplateColumns: "1fr 1fr" }}>{photos.map((p, k) => <PhotoPick key={k} value={p} onChange={(v) => { const n = [...photos]; n[k] = v; setPhotos(n); }} label={k ? 'Balanza' : 'Producto'} kind={k ? 'balanza' : 'producto'} />)}</div>
        </div>
        <p className="cap" style={{ margin: "0" }}>Foto opcional. Si hay un problema, es tu prueba.</p>
        {!allOk && <Inp area value={note} onInput={setNote} placeholder="Cuéntanos qué pasó (opcional)" label="Nota" />}
        <Note icon="clock">Si no respondes en {left > 72 * HOUR ? duration(left) : `${Math.max(1, Math.round(left / HOUR))} h`}, el pedido se da por conforme. Recién ahí cuenta como venta del agricultor (RN-11).</Note>
      </div>
    </Screen>
  );
}

/* ---------- B-16 · Calificar ---------- */
function RateSeller() {
  const A = useApp();
  const s = A.w.subOrders[A.top.p?.id as string];
  const [stars, setStars] = useState(5);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  if (!s) return <Screen title="Calificar"><Empty title="No encontramos el pedido" /></Screen>;
  const seller = A.w.orgs[s.sellerOrgId];
  if (s.reviewBuyer) return <Screen title={`Califica a ${seller.name.split(' ')[0]}`}><Card><Empty icon="star" title="Ya calificaste este pedido" text="Se publica junto con la calificación del agricultor, o a los 7 días." /></Card></Screen>;
  return (
    <Screen title={`Califica a ${seller.name.split(' ')[0]}`} sub={`Pedido ${s.code}`} foot={<Btn full onClick={() => {
      // Si llegó con transportista aliado y aún no lo califica, sigue con él (RN-64)
      const sh = s.shipmentId ? A.w.shipments[s.shipmentId] : undefined;
      const rateCarrier = !!sh?.carrierOrgId && ['DELIVERED', 'CLOSED'].includes(sh.status) && !sh.rating;
      const carrier = rateCarrier ? A.w.orgs[sh!.carrierOrgId!]?.name.split(' ')[0] : '';
      if (A.act('REVIEW_SUBMIT', { reviewId: 'rv-' + uid(), subOrderId: s.id, side: 'BUYER', stars, tags, comment }, { ok: rateCarrier ? `Gracias. Ahora califica a ${carrier}, quien te trajo el pedido.` : 'Gracias por calificar.' }).ok) {
        if (rateCarrier) A.replace('B-33', { id: sh!.id, next: 'orders' }); else A.reset('B-13', { tab: 'done' });
      }
    }} disabled={s.status !== 'COMPLETED'} why={s.status !== 'COMPLETED' ? 'Se califica cuando el pedido está conforme' : undefined}>Enviar calificación</Btn>}>
      <div className="stack">
        <Card><div className="stack" style={{ alignItems: "center" }}><Av org={seller} size="lg" /><b className="bodym">¿Cómo te fue con este pedido?</b><Stars v={stars} onChange={setStars} size="1.1em" /></div></Card>
        <div className="lbl">¿Qué destacas?</div>
        <div className="chips">{['Puntual', 'Peso exacto', 'Buena calidad', 'Buen trato', 'Bien empacado'].map(t => <ChipBtn key={t} on={tags.includes(t)} onClick={() => setTags(tags.includes(t) ? tags.filter(x => x !== t) : [...tags, t])}>{t}</ChipBtn>)}</div>
        <Field label="Comentario (opcional)"><Inp area value={comment} onInput={setComment} placeholder="Cebolla firme y bien seleccionada. Llegó a las 7 en punto." label="Comentario" /></Field>
        <p className="cap center" style={{ margin: "0" }}>Tu opinión es pública y {seller.name.split(' ')[0]} puede responderla. Solo califican quienes recibieron el pedido.</p>
      </div>
    </Screen>
  );
}

reg('B-05', BuyerHome, { nav: true, tab: 'B-05' });
reg('B-06', Results, { nav: true, tab: 'B-05' });
reg('B-07', ProductDetail);
reg('B-24', ProductDetail);
reg('B-08', FarmerProfile, { nav: true, tab: 'B-05' });
reg('B-09', Cart, { nav: true, tab: 'B-09' });
reg('B-10', CheckoutDelivery);
reg('B-28', DeliveryChoice);
reg('B-29', PickupPlan);
reg('B-30', CarrierPlan);
reg('B-11', CheckoutPay);
reg('B-12', PaymentProof);
reg('B-13', BuyerOrders, { nav: true, tab: 'B-13' });
reg('B-14', BuyerOrder);
reg('B-15', Receive);
reg('B-16', RateSeller);

void useMemo; void useEffect; void Tog; void QR; void MapSketch; void CodeInput; void OrderCard; void ReviewSheet; void ICirc; void Prog; void LEVEL_NAME; void suggestedPricePerKg; void PRODUCTS; void kgOf; void dayMonth; void ago; void relDay; void Stat;
