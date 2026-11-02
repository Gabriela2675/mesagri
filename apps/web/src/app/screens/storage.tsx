/*
 * Almacenes aliados: lado del agricultor (A-21 a A-24) y app del almacén (C-01 a C-15).
 * Reserva con tarifa congelada, recepción con peso y calidad, constancia con QR (no es warrant),
 * orden de salida que se activa con el alquiler pagado, incidentes y cobros.
 */
import { useState } from 'react';
import { reg } from './registry';
import { useApp, type AppCtx } from '../ctx';
import { Screen, Btn, Icon, Field, Inp, Sel, Card, Chip, ChipBtn, Seg, Kv, Av, ICirc, Empty, Note, SheetBody, Tile, Prog, Stat, QR, Photo, PhotoPick, Qty, Tog, BarAct, Steps } from '../ui/kit';
import { PRODUCTS, allProducts, product, suggestedPricePerKg } from '@mesagri/shared/catalog';
import { warehouseOccupancy, warehouseBlockers, rateFor, overdueStatement, expiredDocs, expiringDocs } from '@mesagri/shared/queries';
import { storageQuote, r2, isRucValid, WAREHOUSE_LEVEL_NAME } from '@mesagri/shared/rules';
import { money, moneyShort, kg as fkg, dateShort, hhmm, relDay, ago, pct, dateNum, numTrim, duration } from '@mesagri/shared/format';
import { DAY, HOUR, startOfDay, periodOf, periodStart, nextPeriod, addBusinessDays, DOW_CHIP, lima, limaTime } from '@mesagri/shared/time';
import { uid } from '@mesagri/shared/ids';
import { orgName, userOfOrg, itemsShort, notifsFor, levelChip, PAY_LABEL } from '../helpers';
import { DISTRICT_BY_CODE, placeLabel, districtName } from '@mesagri/shared/ubigeo';
import { docPdf } from '../pdf';
import { saveFile, SAVE_UNAVAILABLE } from '../platform';
import { RoleHead, RucLookup, regGet, regSet, districtOptions } from './onboarding';
import { StatementView, MESAGRI_YAPE } from './farmer2';
import { PrefsSheet, NameSheet, PermsSheet } from './common';
import { canAskPermissions } from '../platform';
import { accruedRent } from '@mesagri/shared/engine/billing';
import type { Org, Lot, Booking, ReleaseOrder, Evidence, World } from '@mesagri/shared/types';

const KM_PER_UNIT = 176 / Math.hypot(75 - 16, 63 - 82);
export function kmBetween(a?: string, b?: string): number {
  const pa = DISTRICT_BY_CODE[a ?? '']?.geo, pb = DISTRICT_BY_CODE[b ?? '']?.geo;
  if (!pa || !pb) return 0;
  return Math.round(Math.hypot(pa.x - pb.x, pa.y - pb.y) * KM_PER_UNIT);
}
const TYPE_LABEL: Record<string, string> = { MOLINO: 'Molino', SECO: 'Almacén seco', ACOPIO: 'Centro de acopio' };
const QL: Record<string, string> = { A: 'Calidad A', B: 'Calidad B', C: 'Calidad C' };
const lossFarmPerMonth = (pid: string) => (product(pid).merma === 'TUBERCULO' ? 0.07 : 0.025);
const lossStorePerMonth = (w: World, pid: string) => (product(pid).merma === 'TUBERCULO' ? w.settings.storage.mermaPapa : w.settings.storage.mermaGranos);

/* ================= Agricultor ================= */

/* ---------- A-21 · Almacenes cercanos ---------- */
function NearbyWarehouses() {
  const A = useApp();
  const org = A.org!;
  const crops = [...new Set(Object.values(A.w.farms).filter(f => f.orgId === org.id).flatMap(f => f.crops))].filter(c => product(c).storable);
  const [prod, setProd] = useState<string>(crops[0] ?? '');
  const [near, setNear] = useState(false);
  const list = Object.values(A.w.orgs).filter(o => o.type === 'WAREHOUSE' && o.warehouse && o.status === 'ACTIVE')
    .map(o => ({ o, km: kmBetween(org.district, o.district), occ: warehouseOccupancy(A.w, o.id), blockers: warehouseBlockers(A.w, o, A.now) }))
    .filter(x => (!prod || x.o.warehouse!.products.includes(prod)) && (!near || x.km <= 20))
    .sort((a, b) => (a.blockers.length - b.blockers.length) || a.km - b.km);
  return (
    <Screen title="Guardar mi cosecha" sub="Almacenes aliados cerca de ti">
      <div className="stack">
        <div className="chips">
          {crops.map(c => <ChipBtn key={c} on={prod === c} onClick={() => setProd(prod === c ? '' : c)}>{product(c).short}</ChipBtn>)}
          <ChipBtn on={near} onClick={() => setNear(!near)}>Hasta 20 km</ChipBtn>
        </div>
        <WarehouseMap me={org.district} pins={list.map(x => ({ code: x.o.district, ok: !x.blockers.length }))} />
        {list.length === 0 && <Card><Empty icon="warehouse" title="No hay almacenes aliados para eso en tu zona" text="Prueba con otro producto o quita el filtro de distancia." /></Card>}
        {list.map(({ o, km, occ, blockers }) => {
          const h = o.warehouse!;
          const ok = blockers.length === 0;
          return (
            <button key={o.id} className="card" onClick={() => ok ? A.go('A-22', { fid: o.id, pid: prod || h.products[0] }) : A.toast('Solo puedes reservar en almacenes verificados (nivel A2).', 'info')} aria-disabled={ok ? undefined : 'true'}>
              <div className="row top">
                <ICirc n="warehouse" tone={ok ? 'dark' : ''} />
                <div className="grow">
                  <b className="h3" style={{ fontSize: "1em" }}>{o.name}</b>
                  <div className="cap">{TYPE_LABEL[h.facilityType]} · {h.products.map(p => product(p).short.toLowerCase()).slice(0, 3).join(', ')} · {km} km</div>
                  <div className="chips mt">{ok ? <Chip tone="field" icon="shield-check">Verificado</Chip> : <Chip tone="warn">Verificación en curso</Chip>}<Chip tone="line">{h.level}</Chip></div>
                  <div className="row between mt"><span><b className="price">{money(prod ? rateFor(o, prod) : h.defaultRate)}</b> <span className="cap">por saco al mes</span></span><span className="cap">Espacio libre: <b style={{ color: "var(--ink)" }}>{occ.free} sacos</b></span></div>
                </div>
              </div>
            </button>
          );
        })}
        <p className="cap center" style={{ margin: "0" }}>Solo puedes reservar en almacenes verificados por Mesagri.</p>
      </div>
    </Screen>
  );
}

function WarehouseMap({ me, pins }: { me: string; pins: { code: string; ok: boolean }[] }) {
  const g = (c: string) => DISTRICT_BY_CODE[c]?.geo ?? { x: 50, y: 50 };
  const m = g(me);
  return (
    <div className="map">
      <svg viewBox="0 6 100 86" role="img" aria-label="Mapa esquemático de almacenes aliados">
        <rect x="0" y="0" width="100" height="100" fill="#E3ECD8" />
        <path d="M-10 86 C 5 84, 10 92, 22 96 L 40 110 L -10 110 Z" fill="#CFE3EF" />
        <path d="M14 84 C 22 76, 30 70, 38 62 S 46 44, 50 30 S 56 18, 66 16" fill="none" stroke="#B9D7E8" strokeWidth="2" strokeLinecap="round" />
        <path d="M16 82 L 27 72 L 40 64 L 55 69 L 75 63" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M60 18 L 64 32 L 69 46 L 75 63" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
        {pins.map((p, i) => { const q = g(p.code); return <g key={i} transform={`translate(${q.x} ${q.y})`}><path d="M0 0 C -3 -3.8, -3.2 -6.4, 0 -7.6 C 3.2 -6.4, 3 -3.8, 0 0 Z" fill={p.ok ? '#A66633' : '#C9B79C'} stroke="#fff" strokeWidth=".6" /><circle cy="-4.9" r="1.2" fill="#fff" /></g>; })}
        <g transform={`translate(${m.x} ${m.y})`}><circle r="2.6" fill="#2C5F2D" stroke="#fff" strokeWidth="1" /><text y="6" textAnchor="middle" fontSize="3.6" fontWeight="800" fill="#1E3F20" fontFamily="Nunito, sans-serif">Tú</text></g>
        <text x="74" y="70" fontSize="3.4" fontWeight="800" fill="#5B6B57" fontFamily="Nunito, sans-serif">Arequipa</text>
        <text x="8" y="90" fontSize="3.4" fontWeight="800" fill="#5B6B57" fontFamily="Nunito, sans-serif">Camaná</text>
        <text x="62" y="13" fontSize="3.4" fontWeight="800" fill="#5B6B57" fontFamily="Nunito, sans-serif">Colca</text>
      </svg>
    </div>
  );
}

/* ---------- A-22 · Reservar y calcular ---------- */
function Reserve() {
  const A = useApp();
  const wh = A.w.orgs[A.top.p?.fid as string];
  const [pid, setPid] = useState<string>(A.top.p?.pid ?? wh?.warehouse?.products[0] ?? '');
  const [sacks, setSacks] = useState(10);
  const [months, setMonths] = useState(2);
  const [day, setDay] = useState(1);
  const [rise, setRise] = useState(0.3);
  if (!wh?.warehouse) return <Screen title="Reservar espacio"><Empty title="No encontramos el almacén" /></Screen>;
  const h = wh.warehouse;
  const rate = rateFor(wh, pid);
  const kgPerSack = product(pid).sackKg;
  const myListing = Object.values(A.w.listings).filter(l => l.orgId === A.org!.id && l.productId === pid).sort((a, b) => b.createdAt - a.createdAt)[0];
  const ppk = myListing ? r2(myListing.price / myListing.unitKg) : product(pid).ref.chacra;
  const kgT = sacks * kgPerSack;
  const q = storageQuote({ sacks, kgPerSack, pricePerKg: ppk, rise, months, rate, freight: r2(kgT * 0.05), lossFarm: Math.min(0.5, lossFarmPerMonth(pid) * months), lossStore: lossStorePerMonth(A.w, pid) * months });
  const arrival = startOfDay(A.now) + day * DAY + 8 * HOUR;
  const occ = warehouseOccupancy(A.w, wh.id);
  const book = () => {
    const r = A.act('STO_BOOK', { bookingId: 'bk-' + uid(), facilityOrgId: wh.id, productId: pid, sacks, kgPerSack, months, arrivalDate: arrival });
    if (!r.ok) return;
    A.toast(`Reserva ${r.result.code} enviada: ${wh.name} responde en 24 h. Tarifa congelada en ${money(rate)} por saco al mes.`);
    A.reset('A-23');
  };
  const opt = (label: string, sub: string, v: number, best: boolean) => (
    <div className={'row between' + (best ? ' card soft' : '')} style={best ? { padding: ".55em .7em", margin: "0 -.4em" } : { padding: ".45em 0" }}><div><b className="bodym">{label}</b><div className="cap">{sub}</div></div><b style={{ fontSize: "1.05em" }}>{money(v)}</b></div>
  );
  return (
    <Screen title="Reservar espacio" sub={wh.name} foot={<><Btn full onClick={book} disabled={sacks > occ.free} why={sacks > occ.free ? `Quedan ${occ.free} sacos libres` : undefined}>Reservar espacio</Btn><Btn full kind="sec" onClick={() => { A.patch(d => { d.flow = { ...d.flow, pub: { productId: pid, qty: sacks, unit: 'saco', unitKg: kgPerSack, pricePerKg: ppk, harvestDays: 0, quality: 'PRIMERA' } }; }); A.reset('A-10', { mode: 'form' }); }}>Mejor vender ahora</Btn></>}>
      <div className="stack">
        <Card>
          <div className="grid2">
            <Field label="Producto"><Sel value={pid} onChange={setPid} options={h.products.map(p => ({ v: p, l: product(p).name }))} label="Producto" /></Field>
            <Field label="Sacos"><Qty value={sacks} onChange={setSacks} min={1} max={Math.max(1, occ.free)} /></Field>
          </div>
          <div className="lbl mt">Tiempo</div>
          <Seg value={months} onChange={setMonths} options={[1, 2, 3, 6].map(m => ({ v: m, l: m === 1 ? '1 mes' : `${m} meses` }))} />
          <div className="lbl mt">Llevas tu cosecha</div>
          <div className="chips">{[0, 1, 2, 3, 4].map(d => <ChipBtn key={d} on={day === d} onClick={() => setDay(d)}>{d === 0 ? 'Hoy' : d === 1 ? 'Mañana' : dateShort(startOfDay(A.now) + d * DAY)}</ChipBtn>)}</div>
          <div className="mt"><Kv rows={[['Producto', product(pid).name], ['Cantidad', `${sacks} sacos · ${fkg(kgT)}`], ['Tiempo', months === 1 ? '1 mes' : `${months} meses`], ['Llevas tu cosecha', `${dateShort(arrival)} · 8:00`]]} /></div>
        </Card>
        <Card>
          <div className="row g8"><Icon n="scale" /><b className="h3" style={{ fontSize: "1em" }}>¿Te conviene guardar?</b></div>
          <div className="cap mt">Si el precio sube {pct(rise)} en {months === 1 ? '1 mes' : `${months} meses`} (precio de hoy: {money(ppk)} por kg):</div>
          <div className="chips mt">{[0, 0.1, 0.2, 0.3].map(r => <ChipBtn key={r} on={rise === r} onClick={() => setRise(r)}>{r === 0 ? 'No sube' : `Sube ${pct(r)}`}</ChipBtn>)}</div>
          <div className="mt">
            {opt('Vender hoy', 'Sin esperar', q.sellToday, q.best === 'HOY')}
            {opt('Guardar en tu chacra', `se pierde hasta ${pct(Math.min(0.5, lossFarmPerMonth(pid) * months))}`, q.farmRise, q.best === 'CHACRA')}
            {opt('Guardar aquí', 'ya restamos alquiler y flete', q.storeRise, q.best === 'ALMACEN')}
          </div>
          <hr className="hr" />
          <div className="cap">Si el precio <b>no sube</b>: {money(q.storeFlat)} aquí y {money(q.farmFlat)} en tu chacra.</div>
          <div className="mt"><Chip tone="terra">Conviene si el precio sube más de {pct(Math.max(0, q.breakEven))}</Chip></div>
          <div className="row between mt"><span className="cap">Alquiler: {money(rate)} × {sacks} sacos × {months} {months === 1 ? 'mes' : 'meses'}</span><b>{money(q.rent)}</b></div>
        </Card>
        <p className="cap" style={{ margin: "0" }}>La tarifa queda congelada al reservar (RN-43). El almacén responde en 24 h; si no, la reserva vence y te sugerimos otro.</p>
      </div>
    </Screen>
  );
}

/* ---------- A-23 · Mi cosecha guardada ---------- */
function MyStorage() {
  const A = useApp();
  const org = A.org!;
  const lots = Object.values(A.w.lots).filter(l => l.farmerOrgId === org.id && l.status !== 'RETURNED' && !(l.status === 'CLOSED' && A.now - l.intakeAt > 60 * DAY)).sort((a, b) => b.intakeAt - a.intakeAt);
  const bookings = Object.values(A.w.bookings).filter(b => b.farmerOrgId === org.id && ['PENDING', 'ACCEPTED'].includes(b.status)).sort((a, b) => b.createdAt - a.createdAt);
  return (
    <Screen title="Mi cosecha guardada" sub={`${lots.filter(l => l.status !== 'CLOSED').length} lotes en almacenes aliados`} foot={<Btn full kind="sec" icon="warehouse" onClick={() => A.go('A-21')}>Guardar más cosecha</Btn>}>
      <div className="stack">
        {bookings.map(b => <BookingCard key={b.id} b={b} />)}
        {lots.length === 0 && bookings.length === 0 && <Card><Empty icon="warehouse" title="Todavía no guardas cosecha" text="Guarda en un almacén aliado y vende cuando el precio esté mejor. La app te ayuda a decidir.">
          <Btn kind="dark" onClick={() => A.go('A-21')}>Buscar almacén</Btn></Empty></Card>}
        {lots.map(l => <LotCard key={l.id} l={l} />)}
        <p className="cap center" style={{ margin: "0" }}>El alquiler se paga al almacén cuando retiras o vendes.</p>
      </div>
    </Screen>
  );
}

function BookingCard({ b }: { b: Booking }) {
  const A = useApp();
  const wh = A.w.orgs[b.facilityOrgId];
  const left = b.createdAt + A.w.settings.storage.bookingHours * HOUR - A.now;
  return (
    <Card tone={b.status === 'ACCEPTED' ? 'soft' : undefined}>
      <div className="row between"><b className="bodym">Reserva {b.code} · {product(b.productId).name}</b>{b.status === 'PENDING' ? <Chip tone="warn" icon="clock">Responde en {duration(Math.max(0, left))}</Chip> : <Chip tone="field">Aceptada</Chip>}</div>
      <div className="cap">{wh?.name} · {b.sacks} sacos · {b.months} {b.months === 1 ? 'mes' : 'meses'} · {money(b.rate)} por saco al mes</div>
      {b.status === 'ACCEPTED' && <div className="row mt"><QR text={b.qr} size={78} /><div className="grow bodym">Lleva tu cosecha el <b>{dateShort(b.arrivalDate)}</b> y muestra este QR. El almacén pesa y te da la constancia.</div></div>}
      <div className="mt"><Btn xs kind="secd" onClick={async () => { if (await A.confirm({ title: '¿Cancelar la reserva?', ok: 'Cancelar reserva', danger: true })) A.act('STO_BOOK_CANCEL', { bookingId: b.id }, { ok: 'Reserva cancelada.' }); }}>Cancelar reserva</Btn></div>
    </Card>
  );
}

function trend(l: Lot, now: number): number { const days = Math.max(1, (now - l.intakeAt) / DAY); return Math.round(Math.min(0.25, days * 0.0065) * 100) / 100; }

function LotCard({ l }: { l: Lot }) {
  const A = useApp();
  const wh = A.w.orgs[l.facilityOrgId];
  const lst = l.listingId ? A.w.listings[l.listingId] : undefined;
  const soldSacks = lst ? Math.round(lst.sold + lst.reserved) : 0;
  const t = trend(l, A.now);
  const daysLeft = Math.ceil((l.expiresOn - A.now) / DAY);
  const inc = Object.values(A.w.stoIncidents).find(i => i.lotId === l.id && i.status === 'OPEN');
  return (
    <Card>
      <div className="row between"><b className="h3">{product(l.productId).name}</b><Chip tone={l.status === 'DISPUTE' ? 'danger' : l.status === 'FOR_SALE' ? 'terra' : l.status === 'CLOSED' ? 'ghost' : 'field'}>{l.status === 'FOR_SALE' ? 'En venta' : l.status === 'DISPUTE' ? 'En disputa' : l.status === 'WAITING_FARMER' ? 'Revisa el peso' : l.status === 'CLOSED' ? 'Cerrado' : QL[l.quality]}</Chip></div>
      <div className="cap">{wh?.name} · lote {l.code}</div>
      <div className="row between mt top">
        <div><div className="big">{fkg(l.balanceKg)}</div><div className="cap">{l.balanceSacks} sacos · pesados al ingresar</div></div>
        <svg width="110" height="40" viewBox="0 0 110 40" aria-hidden="true"><polyline points={`0,34 18,30 36,31 54,24 72,20 90,14 110,${Math.max(4, 30 - t * 100)}`} fill="none" stroke="#2C5F2D" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </div>
      <div className="cap right">{t > 0 ? `+${pct(t)} desde que guardaste (referencia de ejemplo)` : 'Precio estable'}</div>
      {lst && <div className="mt"><Prog v={lst.qtyTotal ? soldSacks / lst.qtyTotal : 0} tone="terra" /><div className="cap mt">Vendiste {soldSacks} sacos · quedan {numTrim(lst.available)} en venta a {money(lst.price)} el saco</div></div>}
      <div className="chips mt"><Chip tone="line" icon="clock">Guardado hace {Math.max(0, Math.floor((A.now - l.intakeAt) / DAY))} días</Chip><Chip tone={daysLeft <= 7 ? 'warn' : 'line'}>Vence {dateShort(l.expiresOn)}</Chip></div>
      {l.status === 'WAITING_FARMER' && (
        <div className="card warn mt"><b className="bodym">Declaraste {fkg(l.declaredKg)} y la balanza marcó {fkg(l.weightKg)}</b><div className="bodym">Acepta lo medido para recibir tu constancia, o llévate tu cosecha (RN-44).</div>
          <div className="btnrow mt"><Btn sm kind="sec" onClick={() => A.act('STO_INTAKE_DECIDE', { lotId: l.id, accept: false }, { ok: 'Avisamos al almacén que te llevas tu cosecha.' })}>Me la llevo</Btn><Btn sm kind="dark" onClick={() => A.act('STO_INTAKE_DECIDE', { lotId: l.id, accept: true }, { ok: 'Aceptaste el peso: tu constancia ya está lista.' })}>Acepto el peso</Btn></div></div>
      )}
      {inc && <Note icon="triangle-alert" tone="danger">{inc.code} · {inc.kind}: {fkg(inc.diffKg)} ({pct(inc.diffPct)}). El almacén compensa al precio del día si pasa la tolerancia del convenio.</Note>}
      {['IN_DEPOSIT', 'FOR_SALE'].includes(l.status) && <>
        {!lst || !['ACTIVE', 'PAUSED', 'SOLD_OUT'].includes(lst.status) ? <div className="mt"><Btn full onClick={() => A.sheet(<SellFromLot id={l.id} />)}>Vender desde el almacén</Btn></div> : null}
        <div className="btnrow mt"><Btn sm kind="sec" icon="file-text" onClick={() => A.sheet(<ReceiptSheet id={l.id} />)}>Constancia</Btn><Btn sm kind="sec" onClick={() => A.go('A-24', { lot: l.id })}>Retirar</Btn></div>
      </>}
    </Card>
  );
}

function SellFromLot({ id }: { id: string }) {
  const A = useApp();
  const l = A.w.lots[id];
  const per = l.balanceSacks ? r2(l.balanceKg / l.balanceSacks) : 50;
  const [sacks, setSacks] = useState(l.balanceSacks);
  const [price, setPrice] = useState(String(r2(suggestedPricePerKg(l.productId) * per)).replace('.', ','));
  const go = async (confirmPrice = false) => {
    const p = { orgId: A.org!.id, listingId: 'l-' + uid(), productId: l.productId, unit: 'saco', unitKg: per, qty: sacks, price: Number(price.replace(',', '.')), harvestDate: l.intakeAt, quality: l.quality === 'A' ? 'PRIMERA' : l.quality === 'B' ? 'SEGUNDA' : 'TERCERA', photoIds: l.photoIds, fromLotId: l.id, confirmPrice };
    const c = A.check('LISTING_PUBLISH', p);
    if (!c.ok && c.error?.code === 'PRICE_CONFIRM' && !confirmPrice) { if (await A.confirm({ title: '¿Confirmas el precio?', text: c.error.message, ok: 'Sí, confirmo' })) go(true); return; }
    if (A.act('LISTING_PUBLISH', p, { ok: 'Publicado con el sello «Lote verificado en almacén».' }).ok) A.sheet(null);
  };
  return (
    <SheetBody title="Vender desde el almacén" sub={`${product(l.productId).name} · lote ${l.code} · ${QL[l.quality]} · peso verificado`}>
      <Field label="Sacos en venta"><Qty value={sacks} onChange={setSacks} min={1} max={l.balanceSacks} unit="sacos" /></Field>
      <Field label={`Precio por saco de ${numTrim(per)} kg`} help={`Sugerido: ${money(r2(suggestedPricePerKg(l.productId) * per))} (${money(suggestedPricePerKg(l.productId))} por kg)`}><Inp value={price} onInput={setPrice} mode="decimal" prefix="S/" label="Precio por saco" /></Field>
      <Note icon="shield-check">Los compradores ven «Lote verificado en almacén», con el peso y la calidad que midió el almacén. Se entrega con orden de salida.</Note>
      <Btn full onClick={() => go()}>Publicar en el catálogo</Btn>
    </SheetBody>
  );
}

export function ReceiptSheet({ id }: { id: string }) {
  const A = useApp();
  const l = A.w.lots[id];
  const wh = A.w.orgs[l.facilityOrgId], farmer = A.w.orgs[l.farmerOrgId];
  return (
    <SheetBody title="Constancia de depósito">
      <ReceiptCard l={l} />
      <div className="btnrow"><Btn kind="dark" icon="download" onClick={() => downloadReceipt(A, l.id)}>PDF</Btn><Btn kind="sec" icon="share-2" onClick={() => shareText(A, `Constancia de depósito ${l.code} · ${product(l.productId).name} · ${fkg(l.balanceKg)} · ${wh?.name} · depositante ${farmer?.name}. Verificable en Mesagri.`)}>Compartir</Btn></div>
    </SheetBody>
  );
}
export function ReceiptCard({ l }: { l: Lot }) {
  const A = useApp();
  const wh = A.w.orgs[l.facilityOrgId], farmer = A.w.orgs[l.farmerOrgId];
  return (
    <Card>
      <div className="row top between"><div><div className="sect" style={{ margin: "0" }}>Constancia de depósito</div><div className="h2" style={{ fontFamily: "var(--sans)", fontWeight: "900" }}>{l.code}</div><Chip tone="field" icon="shield-check">Verificable</Chip></div><QR text={`MESAGRI:${l.code}`} size={86} /></div>
      <div className="mt"><Kv rows={[['Almacén', wh?.name], ['Depositante', farmer?.name], ['Producto', `${product(l.productId).name} · ${QL[l.quality].toLowerCase()}`], ['Cantidad', `${l.sacks} sacos · ${fkg(l.weightKg)}`], ['Saldo', `${l.balanceSacks} sacos · ${fkg(l.balanceKg)}`], ['Ingreso', `${dateNum(l.intakeAt)} · ${hhmm(l.intakeAt)}`], ['Vence', dateNum(l.expiresOn)], ['Alquiler', `${money(l.rate)} por saco al mes`]]} /></div>
      <div className="mt"><Note icon="info">Es una constancia de Mesagri. No es un certificado de depósito ni un warrant (Ley 27287).</Note></div>
    </Card>
  );
}
async function downloadReceipt(A: AppCtx, id: string) {
  const l = A.w.lots[id];
  const wh = A.w.orgs[l.facilityOrgId], farmer = A.w.orgs[l.farmerOrgId];
  const bytes = docPdf({ kicker: 'Constancia de depósito', badge: l.code, title: `Constancia de depósito ${l.code}`, subtitle: `${wh?.name ?? ''} · ${placeLabel(wh?.district)}`, qr: `MESAGRI:${l.code}`, rows: [['Depositante', farmer?.name ?? ''], ['Producto', `${product(l.productId).name} · ${QL[l.quality]}`], ['Cantidad al ingresar', `${l.sacks} sacos · ${fkg(l.weightKg)}`], ['Saldo', `${l.balanceSacks} sacos · ${fkg(l.balanceKg)}`], ['Ingreso', `${dateNum(l.intakeAt)} ${hhmm(l.intakeAt)}`], ['Vence', dateNum(l.expiresOn)], ['Alquiler', `${money(l.rate)} por saco al mes (tarifa congelada)`]], notes: ['Es una constancia de Mesagri: no es un certificado de depósito ni un warrant (Ley 27287).', 'El depositario es el almacén aliado (Código Civil, art. 1814): responde por la merma que pase la tolerancia del convenio.', 'Nada sale del almacén sin una orden de salida activa (alquiler pagado).'] });
  const r = await saveFile(`constancia-${l.code}.pdf`, bytes);
  if (r === 'error' || r === 'unavailable') A.toast(r === 'unavailable' ? SAVE_UNAVAILABLE : 'No pudimos descargar el PDF.', 'err');
}
async function shareText(A: AppCtx, text: string) {
  try { if ((navigator as any).share) { await (navigator as any).share({ text }); return; } } catch { /* cancelado */ }
  try { await navigator.clipboard.writeText(text); A.toast('Copiamos el texto: pégalo en WhatsApp.', 'info'); } catch { A.toast(text, 'info'); }
}

/* ---------- A-24 · Retirar o vender del almacén ---------- */
function rentFor(w: World, l: Lot, sacks: number, now: number) {
  const b = w.bookings[l.bookingId];
  const months = Math.max(b?.months ?? 1, Math.max(1, Math.ceil((now - l.intakeAt) / (30 * DAY))));
  return { months, amount: r2(sacks * l.rate * months) };
}
function Withdraw() {
  const A = useApp();
  const l = A.w.lots[A.top.p?.lot as string];
  const subs = l?.listingId ? Object.values(A.w.subOrders).filter(s => s.items.some(i => i.listingId === l.listingId) && ['CONFIRMED', 'PREPARING', 'READY'].includes(s.status) && !Object.values(A.w.releases).some(r => r.subOrderId === s.id && r.status !== 'EXPIRED')) : [];
  const [who, setWho] = useState<'FARMER' | 'BUYER'>(A.top.p?.sub || subs.length ? 'BUYER' : 'FARMER');
  const [sub, setSub] = useState<string>(A.top.p?.sub ?? subs[0]?.id ?? '');
  const so = sub ? A.w.subOrders[sub] : undefined;
  const [sacks, setSacks] = useState<number>(so ? Math.round(so.items[0]?.qty ?? 1) : Math.min(4, l?.balanceSacks ?? 1));
  if (!l) return <Screen title="Retirar de almacén"><Empty title="No encontramos el lote" /></Screen>;
  const wh = A.w.orgs[l.facilityOrgId];
  const rent = rentFor(A.w, l, sacks, A.now);
  const releases = Object.values(A.w.releases).filter(r => r.lotId === l.id).sort((a, b) => b.createdAt - a.createdAt);
  const create = () => {
    const sh = so?.shipmentId ? A.w.shipments[so.shipmentId] : undefined;
    const picker = who === 'FARMER' ? 'FARMER' : sh ? 'CARRIER' : 'BUYER';
    const pickerName = who === 'FARMER' ? A.me!.name : sh?.carrierOrgId ? `${orgName(A.w, sh.carrierOrgId)}` : orgName(A.w, so?.buyerOrgId);
    const r = A.act('STO_RELEASE_CREATE', { releaseId: 'rel-' + uid(), lotId: l.id, sacks, picker, pickerName, subOrderId: who === 'BUYER' ? sub || undefined : undefined });
    if (r.ok) A.toast(`Orden de salida ${r.result.code} creada. Paga ${money(rent.amount)} al almacén para activarla.`);
  };
  return (
    <Screen title="Retirar de almacén" sub="Orden de salida con QR">
      <div className="stack">
        <Card><b className="bodym">{product(l.productId).name} · lote {l.code}</b><div className="cap">{wh?.name} · quedan {fkg(l.balanceKg)} ({l.balanceSacks} sacos)</div></Card>
        <Seg value={who} onChange={(v) => { setWho(v); if (v === 'BUYER' && so) setSacks(Math.round(so.items[0]?.qty ?? 1)); }} options={[{ v: 'FARMER', l: 'Retiro yo' }, { v: 'BUYER', l: 'Lo recoge mi comprador' }]} />
        <div className="grid2">
          <Field label="Sacos que salen"><Qty value={sacks} onChange={setSacks} min={1} max={l.balanceSacks} /></Field>
          {who === 'BUYER' && <Field label="Pedido">{subs.length ? <Sel value={sub} onChange={(v) => { setSub(v); const x = A.w.subOrders[v]; if (x) setSacks(Math.round(x.items[0]?.qty ?? 1)); }} options={subs.map(s => ({ v: s.id, l: `${s.code} · ${orgName(A.w, s.buyerOrgId)}` }))} label="Pedido" /> : <div className="cap">No hay pedidos de este lote por entregar.</div>}</Field>}
        </div>
        <Card><Kv rows={[[`Alquiler de esos ${sacks} sacos`, `${sacks} × ${money(l.rate)} × ${rent.months} ${rent.months === 1 ? 'mes' : 'meses'}`], ['Pagas al almacén, directo', money(rent.amount)]]} /></Card>
        <Btn full kind="dark" onClick={create} disabled={who === 'BUYER' && !sub} why={who === 'BUYER' && !sub ? 'Elige el pedido' : undefined}>Crear orden de salida</Btn>
        {releases.map(r => <ReleaseCard key={r.id} r={r} />)}
      </div>
    </Screen>
  );
}

function ReleaseCard({ r }: { r: ReleaseOrder }) {
  const A = useApp();
  const lot = A.w.lots[r.lotId];
  const wh = A.w.orgs[lot?.facilityOrgId ?? ''];
  const acct = wh?.payout[0];
  return (
    <Card tone={r.status === 'ACTIVE' ? 'soft' : r.status === 'USED' ? undefined : 'line'}>
      <div className="row">
        <QR text={r.code} size={78} />
        <div className="grow">
          <b className="bodym">Orden de salida {r.code}</b>
          <div className="cap">{r.sacks} sacos · {r.pickerName}{r.subOrderId ? ` · pedido ${A.w.subOrders[r.subOrderId]?.code}` : ''}</div>
          <div className="mt">{r.status === 'WAITING_RENT' ? <Chip tone="warn">{r.rentDeclaredAt ? 'Pagaste: el almacén confirma' : 'Espera el pago del alquiler'}</Chip> : r.status === 'ACTIVE' ? <Chip tone="field">Activa hasta {dateShort(r.expiresAt!)}</Chip> : r.status === 'USED' ? <Chip tone="leaf">Usada {r.usedAt ? dateShort(r.usedAt) : ''}</Chip> : <Chip tone="danger">Venció</Chip>}</div>
        </div>
      </div>
      {r.status === 'WAITING_RENT' && !r.rentDeclaredAt && <div className="mt stack tight"><div className="cap">Se activa cuando el almacén confirma tu pago. Vale {A.w.settings.storage.releaseDays} días.{acct ? ` Paga a ${acct.holder} (${acct.kind === 'BANK' ? 'cuenta' : 'Yape'} ···· ${acct.number.slice(-3)}).` : ''}</div><Btn full onClick={() => A.act('STO_RENT_DECLARE', { releaseId: r.id, method: 'YAPE' }, { ok: 'Avisamos al almacén que pagaste. Lo confirma y se activa tu orden.' })}>Ya pagué {money(r.rentAmount)} al almacén</Btn></div>}
    </Card>
  );
}

/* ================= Almacén aliado ================= */

/* ---------- C-01 · Registro del negocio ---------- */
const storable = () => allProducts().filter(p => p.storable);
function WhBusiness() {
  const A = useApp();
  const R = regGet(A);
  const W = R.wh ?? {};
  const [ruc, setRuc] = useState<string>(R.ruc ?? '');
  const [legal, setLegal] = useState<string>(R.legalName ?? '');
  const [type, setType] = useState<string>(W.facilityType ?? 'MOLINO');
  const [cap, setCap] = useState<string>(String(W.capacitySacks ?? 500));
  const [district, setDistrict] = useState<string>(R.district ?? '040201');
  const [prods, setProds] = useState<string[]>(W.products ?? ['arroz_cascara', 'frejol_canario']);
  const [err, setErr] = useState('');
  const next = () => {
    if (!(ruc.length === 11 && isRucValid(ruc))) { setErr('Escribe un RUC válido de 11 dígitos.'); return; }
    const pad = A.w.padron[ruc];
    if (pad && pad.condicion !== 'HABIDO') { setErr('Con el RUC no habido no se puede registrar el almacén (RN-19).'); return; }
    if (Object.values(A.w.orgs).some(o => o.ruc === ruc)) { setErr('Ese RUC ya tiene una cuenta en Mesagri.'); return; }
    if (!(Number(cap) >= 10)) { setErr('El espacio mínimo para Mesagri es de 10 sacos.'); return; }
    if (!prods.length) { setErr('Elige al menos un producto que recibes.'); return; }
    regSet(A, { ruc, legalName: pad?.name ?? legal, bizName: (pad?.name ?? legal).replace(/\s(S\.A\.C\.|E\.I\.R\.L\.|S\.R\.L\.)$/i, ''), district, wh: { ...W, facilityType: type, capacitySacks: Number(cap), products: prods } });
    A.go('A-02');
  };
  return (
    <Screen title="Crear cuenta" foot={<Btn full kind="forest" onClick={next}>Continuar</Btn>}>
      <div className="stack">
        <RoleHead role="WAREHOUSE" step={1} label="Tu negocio" />
        <RucLookup ruc={ruc} setRuc={(v) => { setRuc(v); setErr(''); }} onFound={setLegal} />
        {ruc.length === 11 && !A.w.padron[ruc] && <Field label="Razón social"><Inp value={legal} onInput={setLegal} label="Razón social" /></Field>}
        <div className="lbl">Tipo de almacén</div>
        <div className="chips">{[['MOLINO', 'Molino'], ['SECO', 'Seco'], ['ACOPIO', 'Centro de acopio']].map(([v, l]) => <ChipBtn key={v} on={type === v} onClick={() => setType(v)}>{l}</ChipBtn>)}<span className="chip ghost" title="Mesagri no admite cadena de frío en esta etapa">Con frío · no por ahora</span></div>
        <div className="grid2">
          <Field label="Espacio para Mesagri"><Inp value={cap} onInput={setCap} mode="numeric" suffix="sacos" label="Espacio en sacos" /></Field>
          <Field label="Ubicación"><Sel value={district} onChange={setDistrict} options={districtOptions(d => !d.city || d.code === '040101')} label="Distrito" /></Field>
        </div>
        <div className="lbl">Productos que recibes</div>
        <div className="chips">{storable().map(p => <ChipBtn key={p.id} on={prods.includes(p.id)} onClick={() => setProds(prods.includes(p.id) ? prods.filter(x => x !== p.id) : [...prods, p.id])}>{p.short}</ChipBtn>)}</div>
        {err && <Note icon="circle-alert" tone="danger">{err}</Note>}
      </div>
    </Screen>
  );
}

/* ---------- C-02 · Documentos ---------- */
const WH_DOCS = [
  { k: 'DNI', l: 'DNI del representante', s: 'Foto por ambos lados y selfie', exp: false },
  { k: 'PODER', l: 'Vigencia de poder (SUNARP)', s: 'Emitida hace menos de 30 días', exp: false },
  { k: 'LICENCIA', l: 'Licencia de funcionamiento', s: 'Municipalidad provincial', exp: false },
  { k: 'ITSE', l: 'Certificado ITSE', s: 'Defensa Civil · con fecha de vencimiento', exp: true },
  { k: 'FUMIGACION', l: 'Constancia de fumigación', s: 'De los últimos 6 meses, empresa autorizada', exp: true },
  { k: 'SENASA', l: 'Autorización sanitaria SENASA', s: 'Solo si procesas: pilado, limpieza o envasado', exp: true, optional: true },
  { k: 'FOTOS', l: 'Fotos del local · 3 de 5', s: 'Fachada, interior, piso, techo y balanza (con GPS)', exp: false },
];
function WhDocs() {
  const A = useApp();
  const R = regGet(A);
  const [docs, setDocs] = useState<Record<string, { photo?: string; exp?: string }>>(R.whDocs ?? {});
  const [open, setOpen] = useState<string>('');
  const [processes, setProcesses] = useState<boolean>(!!R.whDocs?.SENASA);
  const required = WH_DOCS.filter(d => !d.optional || processes);
  const ready = required.every(d => docs[d.k]?.photo && (!d.exp || docs[d.k]?.exp));
  const next = () => { regSet(A, { whDocs: docs }); A.go('C-03'); };
  return (
    <Screen title="Crear cuenta" foot={<Btn full kind="forest" onClick={next} disabled={!ready} why={!ready ? 'Sube cada documento con su fecha de vencimiento' : undefined}>Continuar</Btn>}>
      <div className="stack">
        <RoleHead role="WAREHOUSE" step={2} label="Documentos" />
        <Card><Tog on={processes} onChange={setProcesses} label="Proceso el producto" sub="Pilado, limpieza o envasado: pide SENASA" /></Card>
        <Card><div className="list">
          {required.map(d => {
            const v = docs[d.k];
            const ok = !!v?.photo && (!d.exp || !!v?.exp);
            return (
              <div key={d.k} className="stack tight" style={{ padding: ".6em 0" }}>
                <div className="row top">
                  <span className={'icirc ' + (ok ? 'dark' : '')} style={{ width: "1.9em", height: "1.9em" }}>{ok ? <Icon n="check" s="1em" w={3} /> : <Icon n="upload" s="1em" />}</span>
                  <div className="grow"><b className="bodym">{d.l}</b><div className="cap">{v?.exp ? `Vigente hasta el ${dateNum(new Date(v.exp + 'T12:00:00-05:00').getTime())}` : d.s}</div></div>
                  <button className="chip terra" style={{ minHeight: "2.4em" }} onClick={() => setOpen(open === d.k ? '' : d.k)}>{ok ? 'Ver' : 'Subir'}</button>
                </div>
                {open === d.k && <div className="stack tight" style={{ paddingLeft: "2.6em" }}>
                  <PhotoPick value={v?.photo} onChange={(p) => setDocs({ ...docs, [d.k]: { ...v, photo: p } })} label={d.l} kind={d.k === 'FOTOS' ? 'local' : 'dni'} />
                  {d.exp && <Field label="Vence el"><input className="inp" type="date" value={v?.exp ?? ''} onChange={(e: any) => setDocs({ ...docs, [d.k]: { ...v, exp: e.currentTarget.value } })} aria-label="Fecha de vencimiento" /></Field>}
                </div>}
              </div>
            );
          })}
        </div></Card>
        <Note icon="lock">Solo el equipo de verificación ve tus documentos. Los revisamos en 3 días hábiles.</Note>
      </div>
    </Screen>
  );
}

/* ---------- C-03 · Espacio y tarifas ---------- */
function WhRates() {
  const A = useApp();
  const R = regGet(A);
  const W = R.wh ?? {};
  const [cap, setCap] = useState<string>(String(W.capacitySacks ?? 500));
  const [rate, setRate] = useState<string>(String(W.defaultRate ?? 1.8).replace('.', ','));
  const [cond, setCond] = useState<string[]>(W.conditions ?? ['Techo y piso de cemento', 'Parihuelas', 'Ventilado', 'Balanza calibrada']);
  const [dry, setDry] = useState<boolean>(W.dry ?? true);
  const r = Number(rate.replace(',', '.')) || 0;
  const net = r2(r * (1 - A.w.settings.storage.commission));
  const next = () => { regSet(A, { wh: { ...W, capacitySacks: Number(cap), defaultRate: r, conditions: cond, dry } }); A.go('C-04'); };
  return (
    <Screen title="Crear cuenta" foot={<Btn full kind="forest" onClick={next} disabled={!(r > 0)}>Continuar</Btn>}>
      <div className="stack">
        <RoleHead role="WAREHOUSE" step={3} label="Espacio, tarifa y servicios" />
        <div className="grid2">
          <Field label="Sacos para Mesagri"><Inp value={cap} onInput={setCap} mode="numeric" label="Sacos para Mesagri" /></Field>
          <Field label="Tarifa por saco al mes"><Inp value={rate} onInput={setRate} mode="decimal" prefix="S/" label="Tarifa por saco al mes" /></Field>
        </div>
        <p className="cap" style={{ margin: "-.3em 0 0" }}>Saco de 50 kg · referencia en tu zona: S/ 1,50 a S/ 2,00.{(r < 1.2 || r > 2.5) && r > 0 ? ' Tu tarifa está fuera del rango de referencia.' : ''}</p>
        <div className="lbl">Condiciones del local</div>
        <div className="chips">{['Techo y piso de cemento', 'Parihuelas', 'Ventilado', 'Balanza calibrada', 'Vigilancia 24 h'].map(c => <ChipBtn key={c} on={cond.includes(c)} onClick={() => setCond(cond.includes(c) ? cond.filter(x => x !== c) : [...cond, c])}>{c}</ChipBtn>)}</div>
        <div className="lbl">Incluido en la tarifa</div>
        <div className="chips">{['Recepción y pesaje', 'Control de plagas', 'Constancia con QR'].map(c => <Chip key={c}>{c}</Chip>)}</div>
        <Card><Tog on={dry} onChange={setDry} label="Secado de arroz (opcional)" sub="S/ 2,00 por saco · lo cobra el almacén aparte" /></Card>
        <Card tone="soft"><div className="bodym">Por cada saco al mes recibes <b>{money(net)}</b> ({money(r)} menos el 10 % de Mesagri). Con 300 sacos ocupados: <b>{money(r2(net * 300))}</b> al mes.</div></Card>
      </div>
    </Screen>
  );
}

/* ---------- C-04 · Convenio y visita ---------- */
function WhAgreement() {
  const A = useApp();
  const R = regGet(A);
  const W = R.wh ?? {};
  const [acct, setAcct] = useState<string>('');
  const [agree, setAgree] = useState(false);
  const days = [1, 2, 3, 4, 6, 7, 8].map(n => addBusinessDays(startOfDay(A.now), n) + 10 * HOUR).slice(0, 4);
  const [visit, setVisit] = useState<number>(days[1]);
  const [err, setErr] = useState('');
  const send = () => {
    if (acct.replace(/\D/g, '').length < 9) { setErr('Escribe la cuenta (CCI) o el Yape para tus cobros.'); return; }
    if (!agree) { setErr('Lee y acepta el convenio para continuar.'); return; }
    const userId = 'u-' + uid(), orgId = 'org-' + uid();
    const docs = WH_DOCS.filter(d => R.whDocs?.[d.k]?.photo && d.k !== 'DNI' && d.k !== 'PODER' && d.k !== 'FOTOS').map(d => ({ kind: d.k, label: d.l, status: 'PENDING', expiresOn: R.whDocs[d.k]?.exp ? new Date(R.whDocs[d.k].exp + 'T12:00:00-05:00').getTime() : undefined, note: 'Por revisar' }));
    const rate = W.defaultRate ?? 1.8;
    const r = A.act('USER_REGISTER', { userId, orgId, role: 'WAREHOUSE', phone: R.phone, name: R.name ?? R.bizName ?? 'Administrador', lang: 'es', org: { ruc: R.ruc, legalName: R.legalName, name: R.bizName, district: R.district }, warehouse: { facilityType: W.facilityType, capacitySacks: W.capacitySacks, defaultRate: rate, rates: (W.products ?? []).map((p: string) => ({ productId: p, perSackMonth: rate })), products: W.products, services: ['Recepción y pesaje', 'Control de plagas', 'Constancia con QR'], optional: W.dry ? [{ label: 'Secado de arroz', price: 2 }] : [], docs, agreement: true, visitAt: visit } }, { as: userId, quiet: true });
    if (!r.ok) { setErr(r.error!.message); return; }
    A.act('CONSENTS_ACCEPT', { version: '1.0', items: R.consents ?? { distrito: true, dni: true } }, { as: userId, quiet: true });
    A.act('PAYOUT_SET', { orgId, accounts: [{ id: 'pa-' + uid(), kind: acct.replace(/\D/g, '').length > 12 ? 'BANK' : 'YAPE', number: acct.replace(/\D/g, ''), holder: R.legalName ?? R.bizName, relation: 'PROPIA' }], acceptsCash: false }, { as: userId, quiet: true });
    A.act('CARRIER_AGREEMENT', {}, { as: userId, quiet: true });
    const evidence: Evidence[] = WH_DOCS.filter(d => R.whDocs?.[d.k]?.photo).map(d => ({ key: d.k.toLowerCase(), label: d.l, photoId: R.whDocs[d.k].photo, detail: R.whDocs[d.k].exp ? `Vence ${R.whDocs[d.k].exp}` : undefined }));
    evidence.push({ key: 'visita', label: `Visita agendada para el ${dateShort(visit)} ${hhmm(visit)}` });
    A.act('VERIF_SUBMIT', { caseId: 'case-' + uid(), orgId, targetLevel: 2, evidence }, { as: userId, quiet: true });
    A.patch(d => { d.userId = userId; d.stack = [{ s: 'C-05' }]; d.flow = {}; });
    A.toast('Enviamos tu almacén a verificación. Mientras tanto apareces como «próximamente».');
  };
  return (
    <Screen title="Crear cuenta" foot={<><Btn full kind="forest" onClick={send}>Enviar a verificación</Btn><div className="why">Mientras te verificamos apareces como «próximamente».</div></>}>
      <div className="stack">
        <RoleHead role="WAREHOUSE" step={4} label="Cobro, convenio y visita" />
        <Field label="Cuenta para tus cobros" help="El agricultor te paga el alquiler directo a esta cuenta. El titular debe ser tu RUC."><Inp value={acct} onInput={setAcct} mode="numeric" placeholder="CCI de 20 dígitos o número de Yape" label="Cuenta" /></Field>
        <Card>
          <b className="bodym">Convenio de almacén aliado (resumen)</b>
          <ul className="bodym" style={{ paddingLeft: "1.1em", margin: ".5em 0" }}>
            <li>Recibes, guardas y devuelves lo que se deposita (depósito, Código Civil, art. 1814).</li>
            <li>Respondes por la merma que pase la tolerancia de cada producto.</li>
            <li>Mesagri cobra 10 % del alquiler por estado de cuenta mensual.</li>
            <li>Tu constancia no es un certificado de depósito ni un warrant.</li>
          </ul>
          <Tog on={agree} onChange={setAgree} label="Leí y acepto el convenio" />
        </Card>
        <div className="lbl">Agenda la visita de verificación</div>
        <div className="chips">{days.map(d => <ChipBtn key={d} on={visit === d} onClick={() => setVisit(d)}>{dateShort(d)} · {hhmm(d)}</ChipBtn>)}</div>
        {err && <Note icon="circle-alert" tone="danger">{err}</Note>}
      </div>
    </Screen>
  );
}

/* ---------- C-05 · Estado de la verificación ---------- */
function WhStatus() {
  const A = useApp();
  const org = A.org!;
  const h = org.warehouse!;
  const kase = Object.values(A.w.cases).filter(k => k.orgId === org.id).sort((a, b) => b.submittedAt - a.submittedAt)[0];
  const step = h.level >= 'A2' ? 4 : h.visit ? 3 : kase ? 2 : 1;
  const docs = h.docs;
  return (
    <Screen title="Tu verificación" sub={org.name}>
      <div className="stack">
        <Card tone="dark">
          <div className="row between cap" style={{ fontWeight: "900", letterSpacing: ".08em" }}>{['Registrado', 'Documentos', 'Visita', 'Verificado'].map((l, i) => <span key={l} style={{ color: i < step ? '#97BC62' : '#cfe0c1' }}>{l.toUpperCase()}</span>)}</div>
          <div className="prog leaf mt" style={{ background: "rgba(255,255,255,.15)" }}><i style={{ width: `${(step / 4) * 100}%` }} /></div>
          <p className="bodym" style={{ margin: ".6em 0 0" }}>{h.level >= 'A2' ? '¡Listo! Ya recibes reservas de los agricultores.' : 'Mientras tanto apareces como «próximamente» y aún no recibes reservas.'}</p>
        </Card>
        <Card><div className="list">
          <div className="row top" style={{ padding: ".55em 0" }}><span className="icirc dark" style={{ width: "1.9em", height: "1.9em" }}><Icon n="check" s="1em" w={3} /></span><div><b className="bodym">RUC activo y habido</b><div className="cap">Consulta automática a la SUNAT</div></div></div>
          {docs.map(d => {
            const exp = d.expiresOn && d.expiresOn < A.now + 30 * DAY;
            return <div key={d.kind} className="row top" style={{ padding: ".55em 0" }}><span className={'icirc ' + (d.status === 'OK' && !exp ? 'dark' : d.status === 'MISSING' ? '' : 'warn')} style={{ width: "1.9em", height: "1.9em" }}>{d.status === 'OK' && !exp ? <Icon n="check" s="1em" w={3} /> : <Icon n={d.status === 'MISSING' ? 'circle' : 'clock'} s="1em" />}</span><div className="grow"><b className="bodym">{d.label}</b><div className="cap">{d.expiresOn ? `Vigente hasta el ${dateNum(d.expiresOn)}` : d.note ?? ''}</div></div><Chip tone={d.status === 'OK' ? 'leaf' : d.status === 'MISSING' ? 'ghost' : 'warn'}>{d.status === 'OK' ? (exp ? 'Por vencer' : 'Vigente') : d.status === 'MISSING' ? 'Opcional' : 'En revisión'}</Chip></div>;
          })}
          <div className="row top" style={{ padding: ".55em 0" }}><span className={'icirc ' + (h.visit ? 'dark' : '')} style={{ width: "1.9em", height: "1.9em" }}>{h.visit ? <Icon n="check" s="1em" w={3} /> : <Icon n="calendar" s="1em" />}</span><div><b className="bodym">Visita de campo</b><div className="cap">{h.visit ? `${h.visit.score} de 100 · ${dateShort(h.visit.at)}` : h.visitScheduled ? `${dateShort(h.visitScheduled)} · ${hhmm(h.visitScheduled)} · promotor de Mesagri` : 'Por agendar'}</div></div></div>
          <div className="row top" style={{ padding: ".55em 0" }}><span className={'icirc ' + (h.agreementSigned ? 'dark' : '')} style={{ width: "1.9em", height: "1.9em" }}>{h.agreementSigned ? <Icon n="check" s="1em" w={3} /> : null}</span><div><b className="bodym">Convenio de almacén aliado</b><div className="cap">{h.agreementSigned ? 'Aceptado en el registro · se firma tras la visita' : 'Por firmar'}</div></div></div>
        </div></Card>
        {kase && <Note icon="clipboard-list" tone={kase.status === 'NEEDS_INFO' || kase.status === 'REJECTED' ? 'danger' : 'soft'}>Expediente {kase.status === 'APPROVED' ? 'aprobado' : kase.status === 'NEEDS_INFO' ? `observado: ${kase.decision?.reason}` : kase.status === 'REJECTED' ? `rechazado: ${kase.decision?.reason}` : 'en revisión'} · enviado el {dateShort(kase.submittedAt)}.</Note>}
        {h.level >= 'A2' && <Btn full kind="forest" onClick={() => A.reset('C-06')}>Ir a mi panel</Btn>}
      </div>
    </Screen>
  );
}

/* ---------- C-06 · Panel del almacén ---------- */
function monthRent(w: World, orgId: string, now: number) {
  const p = periodOf(now), start = periodStart(p), end = periodStart(nextPeriod(p));
  let accrued = 0;
  for (const l of Object.values(w.lots)) if (l.facilityOrgId === orgId) accrued += accruedRent(w, l.id, start, end);
  const collected = Object.values(w.releases).filter(r => w.lots[r.lotId]?.facilityOrgId === orgId && r.rentPaidAt && r.rentPaidAt >= start && r.rentPaidAt < end).reduce((a, r) => a + r.rentAmount, 0);
  return { accrued: r2(accrued), collected: r2(collected), commission: r2(accrued * w.settings.storage.commission) };
}

function WhHome() {
  const A = useApp();
  const org = A.org!, h = org.warehouse!, w = A.w;
  const occ = warehouseOccupancy(w, org.id);
  const lots = Object.values(w.lots).filter(l => l.facilityOrgId === org.id && ['IN_DEPOSIT', 'FOR_SALE', 'DISPUTE', 'WAITING_FARMER'].includes(l.status));
  const pending = Object.values(w.bookings).filter(b => b.facilityOrgId === org.id && b.status === 'PENDING');
  const m = monthRent(w, org.id, A.now);
  const arrivals = Object.values(w.bookings).filter(b => b.facilityOrgId === org.id && b.status === 'ACCEPTED').sort((a, b) => a.arrivalDate - b.arrivalDate);
  const releases = Object.values(w.releases).filter(r => w.lots[r.lotId]?.facilityOrgId === org.id && ['WAITING_RENT', 'ACTIVE'].includes(r.status));
  const blockers = warehouseBlockers(w, org, A.now);
  const soon = expiringDocs(h.docs, A.now, 45);
  const unread = notifsFor(w, org.id).filter(n => n.at > (Number(A.dev.flow.seenNotifs) || 0)).length;
  return (
    <Screen home hello={`Hola, ${A.me!.shortName}`} title={org.name} right={<BarAct icon="bell" label="Avisos" onClick={() => A.go('A-29')} dot={unread > 0} />}>
      <div className="stack">
        {blockers.length > 0 && <button className="card warn" onClick={() => A.go('C-05')}><div className="row"><Icon n="shield-check" /><div className="grow"><b className="bodym">Todavía no recibes reservas</b><div className="cap" style={{ color: "inherit" }}>{blockers.join(' · ')}</div></div><Icon n="chevron-right" s="1.1em" /></div></button>}
        <Card>
          <div className="row between"><span className="cap b">Ocupación por Mesagri</span><b>{pct(occ.capacity ? occ.occupied / occ.capacity : 0)}</b></div>
          <div className="mt"><Prog v={occ.capacity ? occ.occupied / occ.capacity : 0} tone="terra" /></div>
          <div className="cap mt">{occ.occupied} de {numTrim(occ.capacity)} sacos · {lots.length} lotes guardados · {occ.pending} sacos reservados</div>
        </Card>
        <div className="grid2">
          <Stat n={pending.length} l="Reservas por confirmar" tone="terra" onClick={() => A.go('C-07')} />
          <Stat n={moneyShort(m.accrued)} l="Alquiler del mes (devengado)" onClick={() => A.go('C-13')} />
        </div>
        <Card tone="soft"><div className="row between"><span className="bodym b">Comisión Mesagri (10 %)</span><b>{money(m.commission)}</b></div></Card>
        {soon.map(d => <button key={d.kind} className="card warn" onClick={() => A.go('C-14')}><div className="row"><Icon n="calendar-clock" /><div className="grow"><b className="bodym">{d.label} vence el {dateShort(d.expiresOn!)}</b><div className="cap" style={{ color: "inherit" }}>Renuévala antes para seguir recibiendo reservas.</div></div></div></button>)}
        <div className="sect">Hoy y próximos días</div>
        {arrivals.length === 0 && releases.length === 0 && <Card><Empty icon="calendar" title="Sin ingresos ni retiros programados" /></Card>}
        {arrivals.map(b => (
          <Card key={b.id}><div className="row"><div className="center" style={{ minWidth: "3.4em" }}><b>{relDay(b.arrivalDate, A.now) === 'hoy' ? hhmm(b.arrivalDate) : dateShort(b.arrivalDate).split(' ').slice(1).join(' ')}</b><div className="cap">Ingreso</div></div><div className="grow"><b className="bodym">{orgName(w, b.farmerOrgId)}</b><div className="cap">{b.sacks} sacos de {product(b.productId).name.toLowerCase()} · {b.code}</div></div><Btn xs onClick={() => A.go('C-08', { id: b.id })}>Recibir</Btn></div></Card>
        ))}
        {releases.map(r => { const lot = w.lots[r.lotId]; return (
          <Card key={r.id}><div className="row"><div className="center" style={{ minWidth: "3.4em" }}><b>{r.status === 'ACTIVE' ? 'Activa' : 'Por activar'}</b><div className="cap">Retiro</div></div><div className="grow"><b className="bodym">{r.subOrderId ? orgName(w, w.subOrders[r.subOrderId]?.buyerOrgId) : orgName(w, lot?.farmerOrgId)}</b><div className="cap">{r.sacks} sacos de {product(lot?.productId ?? '').name.toLowerCase()} · {r.code}</div></div><Btn xs kind="dark" onClick={() => A.go('C-11', { id: r.id })}>{r.status === 'ACTIVE' ? 'Entregar' : 'Revisar'}</Btn></div></Card>
        ); })}
        <button className="card line" onClick={() => A.go('C-15')}><div className="row"><ICirc n="truck" /><div className="grow"><b className="bodym">Recojos de transportistas</b><div className="cap">Agenda del día y control antes de entregar</div></div><Icon n="chevron-right" s="1.1em" /></div></button>
      </div>
    </Screen>
  );
}

/* ---------- C-07 · Reservas por confirmar ---------- */
function WhBookings() {
  const A = useApp();
  const org = A.org!;
  const all = Object.values(A.w.bookings).filter(b => b.facilityOrgId === org.id).sort((a, b) => a.createdAt - b.createdAt);
  const g = { p: all.filter(b => b.status === 'PENDING'), a: all.filter(b => b.status === 'ACCEPTED'), h: all.filter(b => !['PENDING', 'ACCEPTED'].includes(b.status)).reverse() };
  const [tab, setTab] = useState<'p' | 'a' | 'h'>('p');
  const occ = warehouseOccupancy(A.w, org.id);
  return (
    <Screen title="Reservas por confirmar" sub={`${org.name} · ${occ.free} sacos libres`}>
      <div className="stack">
        <Seg value={tab} onChange={setTab} options={[{ v: 'p', l: `Por confirmar ${g.p.length}` }, { v: 'a', l: `Aceptadas ${g.a.length}` }, { v: 'h', l: 'Historial' }]} />
        {g[tab].length === 0 && <Card><Empty icon="calendar" title="Nada por aquí" /></Card>}
        {g[tab].map(b => {
          const left = b.createdAt + A.w.settings.storage.bookingHours * HOUR - A.now;
          return (
            <Card key={b.id}>
              <div className="row between"><b className="bodym">{orgName(A.w, b.farmerOrgId)}</b>{b.status === 'PENDING' ? <Chip tone={left < 3 * HOUR ? 'danger' : 'warn'} icon="clock">Quedan {duration(Math.max(0, left))}</Chip> : <Chip tone={b.status === 'ACCEPTED' ? 'field' : b.status === 'RECEIVED' ? 'leaf' : 'ghost'}>{({ ACCEPTED: 'Aceptada', REJECTED: 'Rechazada', EXPIRED: 'Venció', RECEIVED: 'Recibida', CANCELLED: 'Cancelada', LAPSED: 'No llegó' } as any)[b.status]}</Chip>}</div>
              <div className="cap">{b.code} · {product(b.productId).name.toLowerCase()} · {b.sacks} sacos · {b.months} {b.months === 1 ? 'mes' : 'meses'} · {money(b.rate)} por saco</div>
              <div className="bodym mt"><b>Llega {dateShort(b.arrivalDate)} · 8:00</b>{b.status === 'PENDING' && ` · quedarían ${Math.max(0, occ.free - b.sacks)} sacos libres`}</div>
              {b.rejectReason && <div className="cap bad">{b.rejectReason}</div>}
              {b.status === 'PENDING' && <div className="btnrow mt"><Btn sm kind="sec" onClick={() => A.sheet(<RejectBooking id={b.id} />)}>Rechazar</Btn><Btn sm kind="forest" onClick={() => A.act('STO_BOOK_RESPOND', { bookingId: b.id, accept: true }, { ok: 'Reserva aceptada. Avisamos al agricultor.' })}>Aceptar</Btn></div>}
              {b.status === 'ACCEPTED' && <div className="mt"><Btn sm kind="forest" full onClick={() => A.go('C-08', { id: b.id })}>Recibir el lote</Btn></div>}
            </Card>
          );
        })}
        <p className="cap" style={{ margin: "0" }}>Si no respondes en 24 h, la reserva vence sola y el agricultor busca otro almacén. Rechazar exige un motivo.</p>
      </div>
    </Screen>
  );
}
function RejectBooking({ id }: { id: string }) {
  const A = useApp();
  const [reason, setReason] = useState('No tengo espacio para esas fechas');
  return (
    <SheetBody title="¿Por qué rechazas la reserva?" sub="El agricultor ve el motivo y le sugerimos otro almacén.">
      <div className="chips">{['No tengo espacio para esas fechas', 'No recibo ese producto ahora', 'La fecha de ingreso no me acomoda'].map(r => <ChipBtn key={r} on={reason === r} onClick={() => setReason(r)}>{r}</ChipBtn>)}</div>
      <Inp value={reason} onInput={setReason} label="Motivo" />
      <Btn full kind="danger" onClick={() => { if (A.act('STO_BOOK_RESPOND', { bookingId: id, accept: false, reason }, { ok: 'Reserva rechazada.' }).ok) A.sheet(null); }}>Rechazar reserva</Btn>
    </SheetBody>
  );
}

/* ---------- C-08 · Recibir un lote ---------- */
function WhIntake() {
  const A = useApp();
  const b = A.w.bookings[A.top.p?.id as string] ?? Object.values(A.w.bookings).find(x => x.facilityOrgId === A.org!.id && x.status === 'ACCEPTED');
  const [weight, setWeight] = useState(b ? String(b.sacks * b.kgPerSack) : '');
  const [quality, setQuality] = useState<'A' | 'B' | 'C'>('A');
  const [photos, setPhotos] = useState<(string | undefined)[]>([undefined, undefined, undefined]);
  const [scale, setScale] = useState(false);
  if (!b) return <Screen title="Recibir lote"><Empty icon="package" title="No hay reservas aceptadas por recibir" /></Screen>;
  const declared = b.sacks * b.kgPerSack;
  const wv = Number(weight.replace(',', '.')) || 0;
  const diff = declared ? (wv - declared) / declared : 0;
  const over = Math.abs(diff) > A.w.settings.storage.intakeTolerance;
  const save = () => {
    const r = A.act('STO_INTAKE', { bookingId: b.id, lotId: 'lot-' + uid(), weightKg: wv, sacks: b.sacks, quality, photoIds: photos.filter(Boolean), scaleOk: scale });
    if (!r.ok) return;
    if (r.result.waiting) { A.toast(`Diferencia de ${pct(Math.abs(diff))}: el agricultor decide si acepta el peso (RN-44).`, 'warn'); A.reset('C-10'); }
    else { A.toast(`Constancia ${r.result.code} emitida.`); A.replace('C-09', { id: r.result.lotId }); }
  };
  return (
    <Screen title="Recibir lote" sub={A.org!.name} foot={<Btn full kind="forest" onClick={save} disabled={!scale || !(wv > 0)} why={!scale ? 'Confirma la calibración de la balanza' : undefined}>Registrar ingreso y emitir constancia</Btn>}>
      <div className="stack">
        <Card tone="soft"><div className="row"><span className="icirc dark"><Icon n="qr-code" /></span><div className="grow"><b className="bodym">Reserva {b.code} · confirmada</b><div className="cap">{orgName(A.w, b.farmerOrgId)} · {product(b.productId).name} · {b.sacks} sacos · {b.months} {b.months === 1 ? 'mes' : 'meses'}</div></div></div></Card>
        <Field label="Peso en balanza" help={`Declarado: ${fkg(declared)} · diferencia ${diff >= 0 ? '+' : '−'}${pct(Math.abs(diff))}${over ? ' · pasa el 2 %: el agricultor decide' : ''}`}>
          <Inp value={weight} onInput={setWeight} mode="decimal" suffix={<Icon n="scale" />} label="Peso en balanza (kg)" />
        </Field>
        <div className="lbl">Calidad</div>
        <div className="row g8">{(['A', 'B', 'C'] as const).map(q => <button key={q} className={'chip ' + (quality === q ? 'field' : 'line')} style={{ width: "3em", height: "3em", justifyContent: "center", fontSize: ".95em" }} onClick={() => setQuality(q)} aria-pressed={quality === q ? 'true' : 'false'}>{q}</button>)}<span className="cap">{quality === 'A' ? 'Sana, sin brotes' : quality === 'B' ? 'Algo de daño' : 'Descarte o daño visible'}</span></div>
        <div className="lbl">Fotos del lote</div>
        <div className="photos">{photos.map((p, i) => <PhotoPick key={i} value={p} onChange={(v) => { const n = [...photos]; n[i] = v; setPhotos(n); }} label={['Sacos', 'Balanza', 'Muestra'][i]} kind={i === 1 ? 'balanza' : 'sacos'} sample={i === 1 ? { value: `${weight} kg` } : undefined} />)}</div>
        <Card><Tog on={scale} onChange={setScale} label="Balanza con certificado de calibración vigente" /></Card>
      </div>
    </Screen>
  );
}

/* ---------- C-09 · Constancia de depósito ---------- */
function WhReceipt() {
  const A = useApp();
  const l = A.w.lots[A.top.p?.id as string];
  if (!l) return <Screen title="Constancia"><Empty title="No encontramos el lote" /></Screen>;
  const wh = A.w.orgs[l.facilityOrgId], farmer = A.w.orgs[l.farmerOrgId];
  return (
    <Screen title="Constancia de depósito" foot={<div className="btnrow"><Btn kind="forest" icon="download" onClick={() => downloadReceipt(A, l.id)}>PDF</Btn><Btn kind="sec" onClick={() => shareText(A, `Constancia ${l.code}: ${product(l.productId).name}, ${fkg(l.weightKg)}, ${wh?.name}, depositante ${farmer?.name}.`)}>Compartir</Btn></div>}>
      <div className="stack"><ReceiptCard l={l} /></div>
    </Screen>
  );
}

/* ---------- C-10 · Lotes guardados ---------- */
function WhLots() {
  const A = useApp();
  const org = A.org!;
  const [q, setQ] = useState('');
  const [f, setF] = useState<'all' | 'sale' | 'exp' | 'dsp'>('all');
  const lots = Object.values(A.w.lots).filter(l => l.facilityOrgId === org.id && l.status !== 'RETURNED').sort((a, b) => b.intakeAt - a.intakeAt);
  const isExp = (l: Lot) => l.expiresOn - A.now < 10 * DAY && l.status !== 'CLOSED';
  const filtered = lots.filter(l => (f === 'all' || (f === 'sale' && l.status === 'FOR_SALE') || (f === 'exp' && isExp(l)) || (f === 'dsp' && l.status === 'DISPUTE')) && (!q || `${l.code} ${orgName(A.w, l.farmerOrgId)} ${product(l.productId).name}`.toLowerCase().includes(q.toLowerCase())));
  const occSacks = lots.filter(l => l.status !== 'CLOSED').reduce((a, l) => a + l.balanceSacks, 0);
  return (
    <Screen title="Lotes guardados" sub={`${org.name} · ${occSacks} sacos`}>
      <div className="stack">
        <Inp value={q} onInput={setQ} placeholder="Buscar por código, agricultor o producto" suffix={<Icon n="search" />} label="Buscar lote" mode="search" />
        <div className="chips">
          <ChipBtn on={f === 'all'} onClick={() => setF('all')}>Todos {lots.length}</ChipBtn>
          <ChipBtn on={f === 'sale'} onClick={() => setF('sale')}>En venta {lots.filter(l => l.status === 'FOR_SALE').length}</ChipBtn>
          <ChipBtn on={f === 'exp'} onClick={() => setF('exp')}>Por vencer {lots.filter(isExp).length}</ChipBtn>
          <ChipBtn on={f === 'dsp'} onClick={() => setF('dsp')}>En disputa {lots.filter(l => l.status === 'DISPUTE').length}</ChipBtn>
        </div>
        {filtered.length === 0 && <Card><Empty icon="package" title="Sin lotes" /></Card>}
        {filtered.map(l => {
          const lst = l.listingId ? A.w.listings[l.listingId] : undefined;
          const inc = Object.values(A.w.stoIncidents).find(i => i.lotId === l.id);
          return (
            <button key={l.id} className="card" onClick={() => A.sheet(<SheetBody title={`${product(l.productId).name} · ${l.code}`}><Btn full kind="forest" icon="file-text" onClick={() => A.go('C-09', { id: l.id })}>Ver constancia</Btn>{['IN_DEPOSIT', 'FOR_SALE', 'DISPUTE'].includes(l.status) && <Btn full kind="sec" icon="triangle-alert" onClick={() => A.go('C-12', { id: l.id })}>Registrar un incidente</Btn>}</SheetBody>)}>
              <div className="row between"><b className="bodym">{product(l.productId).name} · {l.balanceSacks} sacos</b><Chip tone={l.status === 'FOR_SALE' ? 'field' : l.status === 'DISPUTE' ? 'danger' : isExp(l) ? 'warn' : l.status === 'WAITING_FARMER' ? 'warn' : l.status === 'CLOSED' ? 'ghost' : 'line'}>{l.status === 'FOR_SALE' ? 'En venta' : l.status === 'DISPUTE' ? 'En disputa' : l.status === 'WAITING_FARMER' ? 'Espera al agricultor' : l.status === 'CLOSED' ? 'Cerrado' : isExp(l) ? `Vence en ${Math.max(0, Math.ceil((l.expiresOn - A.now) / DAY))} días` : 'En depósito'}</Chip></div>
              <div className="cap">{l.code} · {orgName(A.w, l.farmerOrgId)}</div>
              <div className="mt"><Prog v={l.sacks ? l.balanceSacks / l.sacks : 0} tone={l.status === 'DISPUTE' ? 'warn' : 'terra'} /></div>
              <div className="cap mt">{inc ? `${inc.kind} de ${pct(inc.diffPct)} · caso ${inc.code}` : lst ? `Vendió ${Math.round(lst.sold)} sacos · quedan ${l.balanceSacks} · vence ${dateNum(l.expiresOn).slice(0, 5)}` : `Ingresó ${dateNum(l.intakeAt).slice(0, 5)} · vence ${dateNum(l.expiresOn).slice(0, 5)}`}</div>
            </button>
          );
        })}
      </div>
    </Screen>
  );
}

/* ---------- C-11 · Entregar con orden de salida ---------- */
function WhRelease() {
  const A = useApp();
  const id = A.top.p?.id as string | undefined;
  const r = id ? A.w.releases[id] : undefined;
  const [picker, setPicker] = useState(false);
  const [kgOut, setKgOut] = useState(r ? String(r.kg) : '');
  const [code, setCode] = useState('');
  if (!r) {
    const list = Object.values(A.w.releases).filter(x => A.w.lots[x.lotId]?.facilityOrgId === A.org!.id).sort((a, b) => b.createdAt - a.createdAt);
    return (
      <Screen title="Órdenes de salida" sub={A.org!.name}>
        <div className="stack">
          {list.length === 0 && <Card><Empty icon="qr-code" title="Sin órdenes de salida" /></Card>}
          {list.map(x => <button key={x.id} className="card" onClick={() => A.go('C-11', { id: x.id })}><div className="row between"><b className="bodym">{x.code} · {x.sacks} sacos</b><Chip tone={x.status === 'ACTIVE' ? 'field' : x.status === 'WAITING_RENT' ? 'warn' : x.status === 'USED' ? 'leaf' : 'danger'}>{({ ACTIVE: 'Activa', WAITING_RENT: 'Sin alquiler pagado', USED: 'Usada', EXPIRED: 'Venció' } as any)[x.status]}</Chip></div><div className="cap">{A.w.lots[x.lotId]?.code} · {x.pickerName}</div></button>)}
        </div>
      </Screen>
    );
  }
  const lot = A.w.lots[r.lotId];
  const so = r.subOrderId ? A.w.subOrders[r.subOrderId] : undefined;
  const sh = so?.shipmentId ? A.w.shipments[so.shipmentId] : undefined;
  const active = r.status === 'ACTIVE';
  const b = A.w.bookings[lot?.bookingId ?? ''];
  const months = Math.max(1, Math.round(r.rentAmount / Math.max(0.01, r.sacks * (lot?.rate ?? 1))));
  const isPickup = so?.deliveryMode === 'PICKUP';
  const checkout = () => { const res = A.act('STO_RELEASE_CHECKOUT', { releaseId: r.id, pickerOk: picker, kgOut: Number(kgOut.replace(',', '.')), code }); if (res.ok) { A.toast(`Salida registrada: ${r.sacks} sacos. El lote baja de tu inventario.`); A.back(); } };
  return (
    <Screen title="Entregar con orden" sub={A.org!.name} foot={r.status === 'USED' ? undefined : <><Btn full kind="forest" onClick={checkout} disabled={!active || !picker} why={!active ? 'Sin alquiler pagado, la orden no se activa y nada sale del almacén.' : !picker ? 'Comprueba a la persona autorizada' : undefined}>{sh ? 'Entregar al transportista' : 'Entregar y cerrar la orden'}</Btn></>}>
      <div className="stack">
        <Card tone="dark"><div className="row"><QR text={r.code} size={64} dark /><div className="grow"><b>{r.code} · {active ? 'válida' : r.status === 'WAITING_RENT' ? 'inactiva' : r.status === 'USED' ? 'usada' : 'vencida'}</b><div className="cap">{active ? `Vale hasta el ${dateShort(r.expiresAt!)}` : r.status === 'WAITING_RENT' ? 'Falta confirmar el alquiler' : ''}</div></div></div></Card>
        <Card><Kv rows={[['Lote', `${lot?.code} · ${product(lot?.productId ?? '').name.toLowerCase()}`], ['Depositante', orgName(A.w, lot?.farmerOrgId)], ['Sale para', so ? `${orgName(A.w, so.buyerOrgId)} · pedido ${so.code}` : 'El mismo agricultor'], ['Sacos', `${r.sacks} (${fkg(r.kg)})`]]} /></Card>
        <Card><div className="list">
          <div className="row top" style={{ padding: ".55em 0" }}><span className={'icirc ' + (active || r.status === 'USED' ? 'dark' : 'warn')} style={{ width: "1.9em", height: "1.9em" }}><Icon n={active || r.status === 'USED' ? 'check' : 'clock'} s="1em" w={3} /></span><div className="grow"><b className="bodym">Alquiler pagado por {userOfOrg(A.w, lot?.farmerOrgId)?.shortName ?? 'el agricultor'}</b><div className="cap">{money(r.rentAmount)} · {r.sacks} sacos × {money(lot?.rate ?? 0)} × {months} {months === 1 ? 'mes' : 'meses'}{r.rentDeclaredAt && !active ? ' · dice que pagó' : ''}</div>
            {r.status === 'WAITING_RENT' && <div className="mt"><Btn sm kind="forest" onClick={() => A.act('STO_RENT_CONFIRM', { releaseId: r.id }, { ok: 'Alquiler confirmado: la orden está activa.' })} disabled={!r.rentDeclaredAt} why={!r.rentDeclaredAt ? 'El agricultor aún no avisa que pagó' : undefined}>Me llegó el alquiler</Btn></div>}</div></div>
          <div className="row top" style={{ padding: ".55em 0" }}><span className={'icirc ' + (picker ? 'dark' : '')} style={{ width: "1.9em", height: "1.9em" }}>{picker && <Icon n="check" s="1em" w={3} />}</span><div className="grow"><b className="bodym">Quien recoge está autorizado</b><div className="cap">{r.pickerName}{sh?.carrierOrgId ? ` · ${A.w.orgs[sh.carrierOrgId]?.carrier?.vehicle.plate}` : ''}</div></div><button className={'tog' + (picker ? ' on' : '')} role="switch" aria-checked={picker ? 'true' : 'false'} aria-label="Quien recoge está autorizado" onClick={() => setPicker(!picker)} /></div>
          <div className="row top" style={{ padding: ".55em 0" }}><span className="icirc" style={{ width: "1.9em", height: "1.9em" }}><Icon n="scale" s="1em" /></span><div className="grow"><b className="bodym">Peso de salida en balanza</b><div className="mt"><Inp value={kgOut} onInput={setKgOut} mode="decimal" suffix="kg" label="Peso de salida" /></div></div></div>
          {isPickup && <div className="row top" style={{ padding: ".55em 0" }}><span className="icirc" style={{ width: "1.9em", height: "1.9em" }}><Icon n="key-round" s="1em" /></span><div className="grow"><b className="bodym">Código de recojo del comprador</b><div className="mt"><Inp value={code} onInput={setCode} mode="numeric" placeholder="4 dígitos" label="Código de recojo" /></div></div></div>}
        </div></Card>
        {sh && !['ASSIGNED', 'GOING_TO_PICKUP'].includes(sh.status) && r.status !== 'USED' && <Note icon="info" tone="warn">El transportista todavía no está asignado a este envío ({sh.code}).</Note>}
        <p className="cap center" style={{ margin: "0" }}>Sin alquiler pagado, la orden no se activa y nada sale del almacén (RN-46).</p>
      </div>
    </Screen>
  );
}

/* ---------- C-12 · Registrar un incidente ---------- */
function WhIncident() {
  const A = useApp();
  const l = A.w.lots[A.top.p?.id as string];
  const [kind, setKind] = useState('Merma de peso');
  const [now, setNow] = useState(l ? String(l.balanceKg) : '');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<(string | undefined)[]>([undefined, undefined]);
  if (!l) return <Screen title="Registrar incidente"><Empty title="No encontramos el lote" /></Screen>;
  const kv = Number(now.replace(',', '.')) || 0;
  const diff = r2(l.balanceKg - kv);
  const dp = l.balanceKg ? diff / l.balanceKg : 0;
  const months = Math.max(0.25, (A.now - l.intakeAt) / (30 * DAY));
  const tol = lossStorePerMonth(A.w, l.productId) * months;
  const over = kind !== 'Merma de peso' || dp > tol;
  const save = () => { if (A.act('STO_INCIDENT', { incidentId: 'inc-' + uid(), lotId: l.id, kind, kgNow: kv, note, photoIds: photos.filter(Boolean) }, { ok: over ? 'Incidente registrado: avisamos al agricultor y a Mesagri.' : 'Merma dentro de la tolerancia: avisamos al agricultor.' }).ok) A.back(); };
  return (
    <Screen title="Registrar incidente" sub={A.org!.name} foot={<Btn full kind="forest" onClick={save}>Registrar y avisar al agricultor</Btn>}>
      <div className="stack">
        <Card><b className="bodym">{l.code} · {product(l.productId).name.toLowerCase()}</b><div className="cap">{orgName(A.w, l.farmerOrgId)} · {l.balanceSacks} sacos · ingresó el {dateNum(l.intakeAt)} con {fkg(l.weightKg)}</div></Card>
        <div className="lbl">¿Qué pasó?</div>
        <div className="chips">{['Merma de peso', 'Plaga', 'Humedad', 'Sacos dañados', 'Robo'].map(k => <ChipBtn key={k} on={kind === k} onClick={() => setKind(k)}>{k}</ChipBtn>)}</div>
        <div className="grid2">
          <Field label="Peso hoy"><Inp value={now} onInput={setNow} mode="decimal" suffix={<Icon n="scale" />} label="Peso hoy" /></Field>
          <Field label="Diferencia"><div className="inp" style={{ display: "flex", alignItems: "center", background: "#f7faf3" }}>{diff >= 0 ? '−' : '+'}{fkg(Math.abs(diff))} ({pct(Math.abs(dp))})</div></Field>
        </div>
        {kind === 'Merma de peso' && <Note icon={over ? 'triangle-alert' : 'info'} tone={over ? 'warn' : 'soft'}>{over ? `Pasa la tolerancia del convenio (${pct(lossStorePerMonth(A.w, l.productId))} al mes, ${pct(tol)} a hoy). Se abre un caso y el agricultor recibe aviso con las fotos del ingreso y de hoy.` : `Dentro de la tolerancia del convenio (${pct(tol)} a hoy): solo se avisa al agricultor.`}</Note>}
        <div className="photos">{photos.map((p, i) => <PhotoPick key={i} value={p} onChange={(v) => { const n = [...photos]; n[i] = v; setPhotos(n); }} label={i ? 'Balanza hoy' : 'El lote hoy'} kind={i ? 'balanza' : 'sacos'} sample={i ? { value: `${now} kg` } : undefined} />)}</div>
        <Inp area value={note} onInput={setNote} placeholder="Nota (opcional)" label="Nota" />
      </div>
    </Screen>
  );
}

/* ---------- C-13 · Cobros y estado de cuenta ---------- */
function WhBilling() {
  const A = useApp();
  const org = A.org!;
  const m = monthRent(A.w, org.id, A.now);
  const last = Object.values(A.w.statements).filter(s => s.orgId === org.id).sort((a, b) => b.period.localeCompare(a.period))[0];
  const pending = Object.values(A.w.lots).filter(l => l.facilityOrgId === org.id && ['IN_DEPOSIT', 'FOR_SALE', 'DISPUTE'].includes(l.status)).reduce((a, l) => a + l.balanceSacks * l.rate, 0);
  return (
    <Screen title="Cobros" sub={`${org.name} · ${({ '11': 'noviembre', '12': 'diciembre', '10': 'octubre' } as any)[periodOf(A.now).slice(5)] ?? periodOf(A.now)}`}>
      <div className="stack">
        <div className="grid2">
          <Stat n={money(m.accrued)} l={`Alquiler del mes · ${warehouseOccupancy(A.w, org.id).occupied} sacos ocupados`} />
          <Stat n={money(r2(m.accrued - m.commission))} l="Te quedas con · 90 %" tone="ok" />
        </div>
        <Card><Kv rows={[['Ya cobrado en salidas de lotes', money(m.collected)], ['Se cobra cuando salga cada lote (por mes)', money(r2(pending))], ['Comisión Mesagri (10 % del mes)', money(m.commission)]]} /></Card>
        {last && <button className="card dark" onClick={() => A.go('C-13S', { id: last.id })}>
          <div className="row between"><span className="cap b" style={{ letterSpacing: ".1em" }}>ESTADO DE CUENTA · {last.period}</span><Chip tone={last.status === 'PAID' ? 'leaf' : last.status === 'OVERDUE' ? 'danger' : 'warn'}>{last.status === 'PAID' ? 'Pagado' : last.status === 'OVERDUE' ? 'Vencido' : `Vence el ${dateNum(last.dueAt).slice(0, 5)}`}</Chip></div>
          <div className="display" style={{ fontSize: "2em" }}>{money(last.total)}</div>
          <div className="cap">Factura electrónica de Mesagri a tu RUC</div>
        </button>}
        {last && ['ISSUED', 'OVERDUE'].includes(last.status) && <Btn full onClick={() => A.go('C-13S', { id: last.id })}>Pagar {money(last.total)}</Btn>}
        <p className="cap center" style={{ margin: "0" }}>El agricultor te paga directo; Mesagri nunca recibe el alquiler. Si no pagas la comisión, no recibes reservas nuevas.</p>
      </div>
    </Screen>
  );
}

/* ---------- C-14 · Mi almacén ---------- */
function WhProfile() {
  const A = useApp();
  const org = A.org!, h = org.warehouse!;
  const occ = warehouseOccupancy(A.w, org.id);
  const lc = levelChip(org);
  return (
    <Screen title="Mi almacén" sub={`${A.me!.name} · administrador`}>
      <div className="stack">
        <Card>
          <div className="row between"><b className="h3">{org.name}</b><Chip tone={lc.tone || 'warn'} icon="shield-check">{lc.label}</Chip></div>
          <div className="mt"><Kv rows={[['Sacos para Mesagri', `${numTrim(h.capacitySacks)} · ocupados ${occ.occupied}`], ['Tarifa', `${money(h.defaultRate)} por saco al mes`], ...h.optional.map(o => [o.label, `${money(o.price)} por saco`] as [string, string]), ['Productos', h.products.map(p => product(p).short.toLowerCase()).join(', ')]]} /></div>
        </Card>
        <div className="sect">Documentos y vencimientos</div>
        <Card><div className="list">
          {h.docs.map(d => {
            const exp = d.expiresOn !== undefined && d.expiresOn < A.now;
            const soon = d.expiresOn !== undefined && !exp && d.expiresOn < A.now + 45 * DAY;
            return (
              <div key={d.kind} className="row top" style={{ padding: ".55em 0" }}>
                <span className={'icirc ' + (d.status === 'MISSING' ? '' : exp || soon ? 'warn' : 'dark')} style={{ width: "1.9em", height: "1.9em" }}>{d.status === 'MISSING' ? null : exp || soon ? <Icon n="triangle-alert" s="1em" /> : <Icon n="check" s="1em" w={3} />}</span>
                <div className="grow"><b className="bodym">{d.label}</b><div className="cap">{d.expiresOn ? `${exp ? 'Venció' : 'Vence'} el ${dateNum(d.expiresOn)}${soon ? ' · súbela antes' : ''}` : d.note ?? 'Vigencia indeterminada'}</div></div>
                {(exp || soon) && <button className="chip terra" style={{ minHeight: "2.4em" }} onClick={() => A.sheet(<RenewDoc kind={d.kind} label={d.label} />)}>Subir</button>}
                {d.status === 'MISSING' && <button className="chip line" style={{ minHeight: "2.4em" }} onClick={() => A.toast('El seguro de mercadería de terceros te acerca al nivel A3 (opcional).', 'info')}>Agregar</button>}
              </div>
            );
          })}
        </div></Card>
        <Btn full kind="sec" onClick={() => A.sheet(<EditCapacity />)}>Editar capacidad y tarifas</Btn>
        <Card><div className="list">
          {[['message-circle', 'Mensajes', () => A.go('A-18')], ['bell', 'Avisos', () => A.go('A-29')], ['shield-check', 'Mi verificación', () => A.go('C-05')], ['user', 'Tu nombre', () => A.sheet(<NameSheet />)], ...(canAskPermissions() ? [['smartphone', 'Permisos de la app', () => A.sheet(<PermsSheet />)]] : []), ['globe', 'Idioma y lectura', () => A.sheet(<PrefsSheet />)], ['circle-question-mark', 'Ayuda y reclamos', () => A.go('A-19')], ['log-out', 'Cerrar sesión', () => A.logout()]].map(([i, l, f]) => <button key={l as string} className="li" onClick={f as () => void}><ICirc n={i as string} /><b className="bodym grow">{l as string}</b><Icon n="chevron-right" s="1.1em" /></button>)}
        </div></Card>
      </div>
    </Screen>
  );
}
export function RenewDoc({ kind, label }: { kind: string; label: string }) {
  const A = useApp();
  const [date, setDate] = useState('');
  const [photo, setPhoto] = useState<string | undefined>();
  return (
    <SheetBody title={`Renovar: ${label}`} sub="Sube el documento nuevo. Verificación lo revisa.">
      <PhotoPick value={photo} onChange={setPhoto} label={label} kind="dni" />
      <Field label="Nueva fecha de vencimiento"><input className="inp" type="date" value={date} onChange={(e: any) => setDate(e.currentTarget.value)} aria-label="Nueva fecha de vencimiento" /></Field>
      <Btn full kind="forest" onClick={() => { if (A.act('CARRIER_DOC_RENEW', { kind, expiresOn: date ? new Date(date + 'T12:00:00-05:00').getTime() : 0, photoId: photo }, { ok: 'Documento renovado: queda por revisar.' }).ok) A.sheet(null); }}>Guardar</Btn>
    </SheetBody>
  );
}
function EditCapacity() {
  const A = useApp();
  const h = A.org!.warehouse!;
  const [cap, setCap] = useState(String(h.capacitySacks));
  const [rate, setRate] = useState(String(h.defaultRate).replace('.', ','));
  return (
    <SheetBody title="Capacidad y tarifa" sub="Las reservas ya aceptadas mantienen su tarifa (RN-43).">
      <Field label="Sacos para Mesagri"><Inp value={cap} onInput={setCap} mode="numeric" label="Sacos" /></Field>
      <Field label="Tarifa por saco al mes"><Inp value={rate} onInput={setRate} mode="decimal" prefix="S/" label="Tarifa" /></Field>
      <Btn full kind="forest" onClick={() => { if (A.act('WAREHOUSE_UPDATE', { capacitySacks: Number(cap), defaultRate: Number(rate.replace(',', '.')) }, { ok: 'Guardamos los cambios.' }).ok) A.sheet(null); }}>Guardar</Btn>
    </SheetBody>
  );
}

/* ---------- C-15 · Recojos de transportistas ---------- */
function WhPickups() {
  const A = useApp();
  const org = A.org!;
  const items = Object.values(A.w.releases).filter(r => A.w.lots[r.lotId]?.facilityOrgId === org.id && r.subOrderId && A.w.subOrders[r.subOrderId]?.shipmentId).map(r => ({ r, so: A.w.subOrders[r.subOrderId!], sh: A.w.shipments[A.w.subOrders[r.subOrderId!].shipmentId!] })).filter(x => x.sh && !['CANCELLED'].includes(x.sh.status)).sort((a, b) => a.sh.pickupAt - b.sh.pickupAt);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const cur = items.find(x => ['ASSIGNED', 'GOING_TO_PICKUP'].includes(x.sh.status));
  const all = ['placa', 'orden', 'zona', 'peso'].every(k => checks[k]);
  const deliver = () => {
    if (!cur) return;
    const res = A.act('STO_RELEASE_CHECKOUT', { releaseId: cur.r.id, pickerOk: true, kgOut: cur.r.kg, waybillCarrier: 'V001-' + String(Math.floor(Math.random() * 900 + 100)).padStart(5, '0') });
    if (res.ok) { A.toast('Entregaste la carga: desde ahora está a cargo del transportista.'); setChecks({}); }
  };
  return (
    <Screen title="Recojos de hoy" sub={`${org.name} · ${dateShort(A.now)}`} foot={cur ? <><Btn full kind="forest" onClick={deliver} disabled={!all || cur.r.status !== 'ACTIVE'} why={cur.r.status !== 'ACTIVE' ? 'La orden de salida está inactiva: falta el alquiler (RN-46)' : !all ? 'Completa las 4 comprobaciones' : undefined}>Entregar al transportista</Btn></> : undefined}>
      <div className="stack">
        {items.length === 0 && <Card><Empty icon="truck" title="Sin recojos de transportistas" text="Cuando un comprador pida envío de un lote guardado aquí, verás la agenda." /></Card>}
        {items.map(({ r, so, sh }) => {
          const c = sh.carrierOrgId ? A.w.orgs[sh.carrierOrgId] : undefined;
          const person = userOfOrg(A.w, sh.carrierOrgId);
          return (
            <Card key={r.id} tone={cur?.r.id === r.id ? 'sel' : undefined}>
              <div className="row between"><b className="bodym">{hhmm(sh.pickupAt)} · {person?.shortName ? `${person.shortName} ${person.name.split(' ')[1] ?? ''}` : c?.name ?? 'Sin asignar'}</b><Chip tone={sh.status === 'GOING_TO_PICKUP' ? 'warn' : ['PICKED_UP', 'ARRIVED', 'DELIVERED', 'CLOSED'].includes(sh.status) ? 'leaf' : 'line'}>{sh.status === 'GOING_TO_PICKUP' ? 'En camino' : ['PICKED_UP', 'ARRIVED', 'DELIVERED', 'CLOSED'].includes(sh.status) ? 'Recogido' : sh.carrierOrgId ? 'Asignado' : 'Buscando'}</Chip></div>
              <div className="cap">{c ? `${c.carrier?.vehicle.body} ${c.carrier?.vehicle.plate} · ${c.carrier?.level} Verificado` : 'Sin transportista todavía'}</div>
              <div className="cap">{sh.code} · {r.sacks} sacos de {product(so.items[0]?.productId ?? '').name.toLowerCase()} · {r.code}</div>
            </Card>
          );
        })}
        {cur && <>
          <div className="sect">Antes de entregar a {userOfOrg(A.w, cur.sh.carrierOrgId)?.shortName ?? 'el transportista'}</div>
          <Card>
            {[['placa', 'La placa y el conductor son los de la app', `${A.w.orgs[cur.sh.carrierOrgId ?? '']?.carrier?.vehicle.plate ?? ''}`], ['orden', 'Orden de salida válida', `${cur.r.code} · ${cur.r.status === 'ACTIVE' ? 'alquiler pagado' : 'falta el alquiler'}`], ['zona', 'Zona de carga limpia y seca', 'Sin olores ni restos de químicos'], ['peso', 'Peso de salida en balanza', `${fkg(cur.r.kg)} · igual al ingreso`]].map(([k, t, s]) => <Tog key={k} on={!!checks[k]} onChange={(v) => setChecks({ ...checks, [k]: v })} label={t} sub={s} />)}
          </Card>
          <p className="cap center" style={{ margin: "0" }}>El transportista firma el recojo con su QR. Desde ahí la carga está a su cargo y el lote baja de tu inventario.</p>
        </>}
      </div>
    </Screen>
  );
}

reg('A-21', NearbyWarehouses, { nav: true, tab: 'A-23' });
reg('A-22', Reserve);
reg('A-23', MyStorage, { nav: true, tab: 'A-23' });
reg('A-24', Withdraw);
reg('C-01', WhBusiness);
reg('C-02', WhDocs);
reg('C-03', WhRates);
reg('C-04', WhAgreement);
reg('C-05', WhStatus, { nav: true, tab: 'C-14' });
reg('C-06', WhHome, { nav: true, tab: 'C-06' });
reg('C-07', WhBookings, { nav: true, tab: 'C-07' });
reg('C-08', WhIntake);
reg('C-09', WhReceipt);
reg('C-10', WhLots, { nav: true, tab: 'C-10' });
reg('C-11', WhRelease);
reg('C-12', WhIncident);
reg('C-13', WhBilling, { nav: true, tab: 'C-13' });
reg('C-13S', StatementView);
reg('C-14', WhProfile, { nav: true, tab: 'C-14' });
reg('C-15', WhPickups, { nav: true, tab: 'C-07' });

void Av; void Tile; void Photo; void Steps; void overdueStatement; void expiredDocs; void ago; void DOW_CHIP; void lima; void limaTime; void PAY_LABEL; void itemsShort; void MESAGRI_YAPE; void WAREHOUSE_LEVEL_NAME; void districtName; void Sel;
