/*
 * Entrega R2 funcionando en la app:
 *   B-17 · Solicitudes de compra de la MYPE (publicar, ver ofertas, aceptar una y generar el pedido)
 *   A-27 · Solicitudes de compra para el agricultor (ofertar y seguir sus ofertas)
 *   B-22 · Pedidos programados (plan Pro): se arman solos y la MYPE los aprueba
 *   B-23 · Equipo y locales de la MYPE (plan Pro)
 *   A-28 · Quién publica por mí (familiar o promotor con permisos)
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { reg } from './registry';
import { useApp, type AppCtx } from '../ctx';
import { Screen, Btn, Icon, Field, Inp, Sel, Card, Chip, ChipBtn, Seg, Kv, Av, ICirc, Empty, Note, SheetBody, Tile, Tog, Due } from '../ui/kit';
import { product, allProducts, suggestedPricePerKg } from '@mesagri/shared/catalog';
import { orgStats, farmerServes, farmerFee, sellerProvince, catalogListing } from '@mesagri/shared/queries';
import { taxDocsFor, TAXDOC_LABEL, cashCheck, digitalMethods, freightFor, routeFor, r2, maskPhone, isPhoneValid } from '@mesagri/shared/rules';
import { money, kg as fkg, numTrim, dateShort, hhmm, pct } from '@mesagri/shared/format';
import { DAY, HOUR, startOfDay, DOW_CHIP, DOW_LONG, lima } from '@mesagri/shared/time';
import { uid } from '@mesagri/shared/ids';
import { districtName, provinceOf, CITY_DISTRICTS } from '@mesagri/shared/ubigeo';
import { canDo, isTitular, memberOf, isPro, FREQ_LABEL, localOf } from '@mesagri/shared/engine/r2';
import type { PurchaseRequest, RequestOffer, Schedule, Org, Local, MemberPerm, OrgMember, DeliveryMode, PayMethod, TaxDocType, Quality } from '@mesagri/shared/types';
import { orgName, levelChip, statusInfo, PAY_LABEL, itemsShort, where, withDistrict } from '../helpers';
import { PlanLimitSheet } from './buyer';

const STATUS_REQ: Record<PurchaseRequest['status'], { l: string; tone: string }> = {
  OPEN: { l: 'Recibe ofertas', tone: 'leaf' }, AWARDED: { l: 'Oferta aceptada', tone: 'terra' }, CLOSED: { l: 'Cerrada', tone: 'ghost' }, EXPIRED: { l: 'Venció', tone: 'ghost' },
};
const STATUS_OFFER: Record<RequestOffer['status'], { l: string; tone: string }> = {
  SENT: { l: 'Enviada', tone: 'warn' }, ACCEPTED: { l: 'Aceptada', tone: 'leaf' }, REJECTED: { l: 'No elegida', tone: 'ghost' }, WITHDRAWN: { l: 'Retirada', tone: 'ghost' },
};
const QUALITY_LABEL: Record<Quality, string> = { PRIMERA: 'Primera', SEGUNDA: 'Segunda', TERCERA: 'Tercera' };
const sortedProducts = () => allProducts().slice().sort((a, b) => a.name.localeCompare(b.name, 'es'));
const nextDayChips = (now: number, from: number, n: number) => Array.from({ length: n }, (_, i) => startOfDay(now) + (from + i) * DAY);
const daysText = (days: number[]) => days.length === 7 ? 'todos los días' : days.map(d => DOW_CHIP[d].toLowerCase()).join(', ');

/* ============================== B-17 · Solicitudes de compra (MYPE) ============================== */

function BuyerRequests() {
  const A = useApp();
  const org = A.org!;
  const id = A.top.p?.id as string | undefined;
  if (id) return <BuyerRequestDetail id={id} />;
  const mine = Object.values(A.w.requests).filter(r => r.buyerOrgId === org.id).sort((a, b) => b.createdAt - a.createdAt);
  const open = mine.filter(r => r.status === 'OPEN');
  const past = mine.filter(r => r.status !== 'OPEN');
  const can = canDo(A.w, A.me, 'PEDIR');
  return (
    <Screen title="Solicitudes de compra" sub="Pides y los agricultores te ofrecen su precio" foot={<Btn full icon="plus" disabled={!can} why="Pídele al titular el permiso para hacer pedidos" onClick={() => A.sheet(<NewRequestSheet />)}>Nueva solicitud</Btn>}>
      <div className="stack">
        {!mine.length && <Card><Empty icon="clipboard-list" title="Todavía no publicas solicitudes" text="Di qué producto necesitas, cuántos kilos, para qué día y hasta qué precio. Los agricultores que lo tienen te ofrecen; tú eliges y se genera el pedido." /></Card>}
        {open.length > 0 && <div className="sect">Abiertas ({open.length})</div>}
        {open.map(r => <RequestCard key={r.id} r={r} onOpen={() => A.go('B-17', { id: r.id })} />)}
        {past.length > 0 && <div className="sect">Anteriores</div>}
        {past.slice(0, 12).map(r => <RequestCard key={r.id} r={r} onOpen={() => A.go('B-17', { id: r.id })} />)}
        <Note icon="info">Las ofertas llegan hasta las 18:00 de la víspera del día que pediste. Al aceptar una, el agricultor confirma el pedido como siempre y pagas directo a él.</Note>
      </div>
    </Screen>
  );
}

function RequestCard({ r, onOpen, farmer }: { r: PurchaseRequest; onOpen: () => void; farmer?: boolean }) {
  const A = useApp();
  const p = product(r.productId);
  const st = STATUS_REQ[r.status];
  const sent = r.offers.filter(o => o.status !== 'WITHDRAWN').length;
  const mineOffer = farmer ? r.offers.find(o => o.sellerOrgId === A.org?.id && o.status !== 'WITHDRAWN') : undefined;
  return (
    <button className="card" onClick={onOpen} aria-label={`${p.name}, ${fkg(r.kg)}, ${r.code}`}>
      <div className="row top">
        <Tile pid={r.productId} />
        <div className="grow">
          <div className="row between top"><b className="bodym">{p.name} · {fkg(r.kg)}</b><span className="cap nowrap">{r.code}</span></div>
          <div className="cap">{farmer ? `${orgName(A.w, r.buyerOrgId)} · ${districtName(r.district)}` : `Para el ${dateShort(r.neededOn)} · ${districtName(r.district)}`}</div>
          <div className="cap">{farmer ? `Para el ${dateShort(r.neededOn)}` : ''}{farmer && r.maxPricePerKg ? ' · ' : ''}{r.maxPricePerKg ? `Hasta ${money(r.maxPricePerKg)} por kg` : (farmer ? '' : 'Sin precio máximo')}</div>
          <div className="row g8 wrap mt">
            {mineOffer ? <Chip tone={STATUS_OFFER[mineOffer.status].tone}>Tu oferta: {STATUS_OFFER[mineOffer.status].l.toLowerCase()}</Chip> : <Chip tone={st.tone}>{st.l}</Chip>}
            <Chip tone="ghost" icon="hand-coins">{sent} {sent === 1 ? 'oferta' : 'ofertas'}</Chip>
            {r.status === 'OPEN' && <span className="cap"><Due at={r.closesAt} now={A.now} prefix="Cierra en" /></span>}
          </div>
        </div>
      </div>
    </button>
  );
}

function BuyerRequestDetail({ id }: { id: string }) {
  const A = useApp();
  const r = A.w.requests[id];
  if (!r || r.buyerOrgId !== A.org!.id) return <Screen title="Solicitud de compra"><Empty title="No encontramos la solicitud" /></Screen>;
  const p = product(r.productId);
  const offers = r.offers.filter(o => o.status !== 'WITHDRAWN').sort((a, b) => (a.status === 'ACCEPTED' ? -1 : 0) - (b.status === 'ACCEPTED' ? -1 : 0) || a.pricePerKg - b.pricePerKg);
  const sub = r.subOrderId ? A.w.subOrders[r.subOrderId] : undefined;
  const loc = (A.org!.locales ?? []).find(l => l.id === r.localId);
  const can = canDo(A.w, A.me, 'PEDIR');
  const close = async () => {
    if (!await A.confirm({ title: '¿Cerrar la solicitud?', text: 'Ya no recibirá ofertas y avisamos a quienes ofertaron.', ok: 'Cerrar', danger: true })) return;
    A.act('REQUEST_CLOSE', { requestId: r.id }, { ok: 'Solicitud cerrada.' });
  };
  return (
    <Screen title={`${p.name} · ${fkg(r.kg)}`} sub={`${r.code} · para el ${dateShort(r.neededOn)}`}>
      <div className="stack">
        <Card>
          <div className="row top"><Tile pid={r.productId} size="lg" /><div className="grow">
            <div className="row between"><b className="h3">{p.name}</b><Chip tone={STATUS_REQ[r.status].tone}>{STATUS_REQ[r.status].l}</Chip></div>
            <Kv rows={[
              ['Cantidad', fkg(r.kg)], ['Entrega', `${dateShort(r.neededOn)} · ${loc ? loc.name : districtName(r.district)}`],
              ['Precio máximo', r.maxPricePerKg ? `${money(r.maxPricePerKg)} por kg` : 'Sin tope'],
              r.status === 'OPEN' ? ['Ofertas hasta', `${dateShort(r.closesAt)} · ${hhmm(r.closesAt)}`] : null,
            ]} />
          </div></div>
          {r.note && <p className="bodym" style={{ margin: ".6em 0 0" }}>«{r.note}»</p>}
        </Card>
        {sub && (
          <button className="card hl" onClick={() => A.go('B-14', { id: sub.id })}>
            <div className="row"><ICirc n="shopping-bag" tone="terra" /><div className="grow"><b className="bodym">Pedido {sub.code} · {orgName(A.w, sub.sellerOrgId)}</b><div className="cap">{statusInfo(sub, 'buyer').label} · {money(sub.total)}</div></div><Icon n="chevron-right" s="1.1em" /></div>
          </button>
        )}
        <div className="sect">Ofertas ({offers.length})</div>
        {!offers.length && <Card><Empty icon="hand-coins" title="Todavía no hay ofertas" text={r.status === 'OPEN' ? 'Avisamos a los agricultores que venden este producto. Te llega un aviso con cada oferta.' : 'La solicitud cerró sin ofertas.'} /></Card>}
        {offers.map(o => {
          const s = A.w.orgs[o.sellerOrgId];
          const st = s ? orgStats(A.w, s.id) : undefined;
          const lc = levelChip(s);
          return (
            <Card key={o.id} tone={o.status === 'ACCEPTED' ? 'soft' : undefined}>
              <div className="row top">
                <Av org={s} />
                <div className="grow">
                  <div className="row between top"><b className="bodym">{s?.name ?? '—'}</b><b className="price nowrap">{money(o.pricePerKg)}<span className="cap"> /kg</span></b></div>
                  <div className="cap">{where(s)} · <Chip tone={lc.tone}>{lc.label}</Chip>{st && st.count ? ` · ★ ${numTrim(st.rating, 1)} (${st.count})` : ''}</div>
                  <Kv rows={[
                    ['Ofrece', o.kg < r.kg ? `${fkg(o.kg)} de ${fkg(r.kg)}` : fkg(o.kg)], ['Total', money(r2(o.kg * o.pricePerKg))],
                    ['Calidad', QUALITY_LABEL[o.quality]], o.harvestDate ? ['Cosecha', dateShort(o.harvestDate)] : null,
                  ]} />
                  {o.note && <div className="cap">«{o.note}»</div>}
                  <div className="row g8 wrap mt">
                    <Chip tone={STATUS_OFFER[o.status].tone}>{STATUS_OFFER[o.status].l}</Chip>
                    <Btn xs kind="sec" onClick={() => A.go('B-08', { id: o.sellerOrgId })}>Ver agricultor</Btn>
                    {r.status === 'OPEN' && o.status === 'SENT' && <Btn xs kind="dark" disabled={!can} why="No tienes permiso para hacer pedidos" onClick={() => A.sheet(<AcceptOfferSheet r={r} o={o} />)}>Aceptar</Btn>}
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
        {r.status === 'OPEN' && <Btn full kind="secd" onClick={close} disabled={!can}>Cerrar sin elegir</Btn>}
        {r.status !== 'OPEN' && <Btn full kind="sec" icon="repeat" disabled={!can} onClick={() => A.sheet(<NewRequestSheet from={r} />)}>Pedir otra vez lo mismo</Btn>}
      </div>
    </Screen>
  );
}

function NewRequestSheet({ from }: { from?: PurchaseRequest }) {
  const A = useApp();
  const org = A.org!;
  const locs = org.locales ?? [];
  const [pid, setPid] = useState(from?.productId ?? 'papa_amarilla');
  const [kg, setKg] = useState(from ? String(from.kg) : '');
  const [day, setDay] = useState<number>(startOfDay(A.now) + 3 * DAY);
  const [max, setMax] = useState(from?.maxPricePerKg ? String(from.maxPricePerKg).replace('.', ',') : '');
  const [note, setNote] = useState(from?.note ?? '');
  const [loc, setLoc] = useState(from?.localId ?? localOf(org)?.id ?? '');
  const [err, setErr] = useState('');
  const p = product(pid);
  const send = () => {
    const kgN = Number(kg.replace(',', '.'));
    if (!(kgN >= 5)) { setErr('Escribe cuántos kilos necesitas (desde 5 kg).'); return; }
    const requestId = 'req-' + uid();
    const r = A.act('REQUEST_CREATE', { requestId, productId: pid, kg: kgN, maxPricePerKg: max ? Number(max.replace(',', '.')) : undefined, neededOn: day, note: note.trim() || undefined, localId: loc || undefined }, { quiet: true });
    if (!r.ok) { setErr(r.error!.message); return; }
    A.sheet(null);
    A.toast('Publicamos tu solicitud y avisamos a los agricultores que tienen ese producto.');
    A.go('B-17', { id: requestId });
  };
  return (
    <SheetBody title="Nueva solicitud de compra" sub="Los agricultores te ofrecen su precio. Tú eliges.">
      <Field label="Producto"><Sel value={pid} onChange={(v) => { setPid(v); setErr(''); }} options={sortedProducts().map(x => ({ v: x.id, l: x.name }))} label="Producto" /></Field>
      <div className="grid2">
        <Field label="Cantidad"><Inp value={kg} onInput={(v) => { setKg(v); setErr(''); }} mode="decimal" suffix="kg" placeholder="100" label="Kilos" /></Field>
        <Field label="Hasta (S/ por kg)" help={`Mayorista: ${money(p.ref.mayorista)}`}><Inp value={max} onInput={setMax} mode="decimal" prefix="S/" placeholder="opcional" label="Precio máximo por kilo" /></Field>
      </div>
      <div className="lbl">¿Para qué día?</div>
      <div className="chips">{nextDayChips(A.now, 1, 8).map(d => <ChipBtn key={d} on={day === d} onClick={() => setDay(d)}>{dateShort(d)}</ChipBtn>)}</div>
      {locs.length > 1 && <Field label="¿A qué local?"><Sel value={loc} onChange={setLoc} options={locs.map(l => ({ v: l.id, l: `${l.name} · ${districtName(l.district)}` }))} label="Local" /></Field>}
      <Field label="Detalle (opcional)"><Inp area value={note} onInput={setNote} placeholder="Tamaño, variedad, empaque…" label="Detalle" /></Field>
      {err && <Note icon="circle-alert" tone="danger">{err}</Note>}
      <Btn full kind="dark" onClick={send}>Publicar solicitud</Btn>
    </SheetBody>
  );
}

function AcceptOfferSheet({ r, o }: { r: PurchaseRequest; o: RequestOffer }) {
  const A = useApp();
  const buyer = A.org!;
  const seller = A.w.orgs[o.sellerOrgId];
  const subtotal = r2(o.kg * o.pricePerKg);
  const serves = seller ? farmerServes(seller, r.district) : false;
  const route = seller ? routeFor(A.w.settings, sellerProvince(A.w, seller.id), provinceOf(r.district) ?? 'AREQUIPA') : undefined;
  const modes: { v: DeliveryMode; l: string; s: string }[] = [];
  if (serves) modes.push({ v: 'FARMER', l: 'Envío del agricultor', s: farmerFee(seller!, r.district) ? `Envío ${money(farmerFee(seller!, r.district))}` : 'Envío incluido' });
  if (route) modes.push({ v: 'CARRIER', l: 'Transportista aliado', s: `Flete ${money(freightFor(route, o.kg).freight)} al recibir` });
  modes.push({ v: 'PICKUP', l: 'Recojo por mi cuenta', s: seller?.pickupPoint ? `En ${seller.pickupPoint}` : 'Coordinas con el agricultor' });
  const [mode, setMode] = useState<DeliveryMode>(modes[0].v);
  const docs = seller ? taxDocsFor(seller) : (['BOLETA'] as TaxDocType[]);
  const [tax, setTax] = useState<TaxDocType>(docs.includes('FACTURA') ? 'FACTURA' : docs[0]);
  const methods = seller ? digitalMethods(seller) : [];
  const total = r2(subtotal + (mode === 'FARMER' && seller ? farmerFee(seller, r.district) : 0));
  const cash = seller ? cashCheck(A.w.settings, total, buyer, seller) : { ok: false, reason: '' };
  const payOpts: { v: PayMethod; ok: boolean }[] = [...methods.map(m => ({ v: m as PayMethod, ok: true })), { v: 'CASH', ok: cash.ok }];
  const [pay, setPay] = useState<PayMethod>((payOpts.find(x => x.ok)?.v ?? 'YAPE') as PayMethod);
  const [busy, setBusy] = useState(false);
  const accept = () => {
    setBusy(true);
    const subOrderId = 'so-' + uid();
    const res = A.act('REQUEST_ACCEPT', { requestId: r.id, offerId: o.id, orderId: 'o-' + uid(), subOrderId, deliveryMode: mode, payMethod: pay, taxDoc: tax, upgrade: A.dev.flow.upgrade }, { quiet: true });
    setBusy(false);
    if (!res.ok) {
      if (res.error?.code === 'PLAN_LIMIT') { A.sheet(<PlanLimitSheet month={res.error.data.month} order={res.error.data.order} />); return; }
      A.toast(res.error!.message, 'err');
      return;
    }
    A.patch(d => { d.flow = { ...d.flow, upgrade: undefined }; d.stack = [{ s: 'B-13' }, { s: 'B-14', p: { id: subOrderId } }]; });
    A.toast(`Aceptaste la oferta de ${seller?.name.split(' ')[0] ?? 'el agricultor'}: tiene ${A.w.settings.orderResponseHours} h para confirmar el pedido.`);
  };
  return (
    <SheetBody title="Aceptar la oferta" sub={`${seller?.name ?? ''} · ${fkg(o.kg)} a ${money(o.pricePerKg)} por kg`}>
      <Card tone="soft"><Kv total rows={[[`${product(r.productId).name} · ${fkg(o.kg)}`, money(subtotal)], ...(total !== subtotal ? [['Envío del agricultor', money(r2(total - subtotal))] as [string, string]] : []), ['Total', money(total)]]} /></Card>
      <div className="lbl">¿Cómo lo recibes el {dateShort(r.neededOn)}?</div>
      <div className="stack tight">{modes.map(m => (
        <div key={m.v} className={'card ' + (mode === m.v ? 'sel' : 'line')} role="radio" aria-checked={mode === m.v ? 'true' : 'false'} tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => setMode(m.v)} onKeyDown={(e: any) => { if (e.key === 'Enter' || e.key === ' ') setMode(m.v); }}>
          <div className="row"><span className={'radio' + (mode === m.v ? ' on' : '')} /><div className="grow"><b className="bodym">{m.l}</b><div className="cap">{m.s}</div></div></div>
        </div>
      ))}</div>
      <div className="lbl">¿Cómo le pagas?</div>
      <div className="chips">{payOpts.map(x => <ChipBtn key={x.v} on={pay === x.v} onClick={() => x.ok ? setPay(x.v) : A.toast(cash.reason ?? 'No disponible', 'info')}>{PAY_LABEL[x.v]}{x.ok ? '' : ' ·  no'}</ChipBtn>)}</div>
      <div className="lbl">Comprobante</div>
      <Seg value={tax} onChange={(v) => docs.includes(v) ? setTax(v) : A.toast(`${seller?.name ?? 'El agricultor'} no puede dar ese comprobante (RN-34).`, 'info')} options={(['BOLETA', 'FACTURA', 'LIQUIDACION'] as TaxDocType[]).map(d => ({ v: d, l: <span style={docs.includes(d) ? undefined : { opacity: '.45' }}>{d === 'LIQUIDACION' ? 'Liquidación' : TAXDOC_LABEL[d]}</span> }))} />
      <Btn full kind="dark" onClick={accept} loading={busy}>Aceptar y hacer el pedido</Btn>
      <p className="cap center" style={{ margin: 0 }}>Avisamos a los demás agricultores que elegiste otra oferta.</p>
    </SheetBody>
  );
}

/* ============================== A-27 · Solicitudes de compra (agricultor) ============================== */

function FarmerRequests() {
  const A = useApp();
  const org = A.org!;
  const [tab, setTab] = useState<'OPEN' | 'MINE'>('OPEN');
  const focus = A.top.p?.id as string | undefined;
  const sells = new Set(Object.values(A.w.listings).filter(l => l.orgId === org.id).map(l => l.productId));
  const open = Object.values(A.w.requests).filter(r => r.status === 'OPEN' && A.now < r.closesAt)
    .sort((a, b) => (a.id === focus ? -1 : b.id === focus ? 1 : 0) || (sells.has(b.productId) ? 1 : 0) - (sells.has(a.productId) ? 1 : 0) || a.neededOn - b.neededOn);
  const mine = Object.values(A.w.requests).filter(r => r.offers.some(o => o.sellerOrgId === org.id)).sort((a, b) => b.createdAt - a.createdAt);
  return (
    <Screen title="Solicitudes de compra" sub="Las MYPE piden y tú ofreces tu precio">
      <div className="stack">
        <Seg value={tab} onChange={setTab} options={[{ v: 'OPEN', l: `Abiertas (${open.length})` }, { v: 'MINE', l: `Mis ofertas (${mine.length})` }]} />
        {tab === 'OPEN' && (
          <>
            {!open.length && <Card><Empty icon="clipboard-list" title="No hay solicitudes abiertas" text="Te avisamos cuando un negocio pida un producto que vendes." /></Card>}
            {open.map(r => <RequestCard key={r.id} r={r} farmer onOpen={() => A.sheet(<OfferSheet r={r} />)} />)}
          </>
        )}
        {tab === 'MINE' && (
          <>
            {!mine.length && <Card><Empty icon="hand-coins" title="Todavía no ofertas" text="Ofrece tu precio en una solicitud abierta: si el negocio la acepta, se genera el pedido." /></Card>}
            {mine.map(r => {
              const o = r.offers.filter(x => x.sellerOrgId === org.id).sort((a, b) => b.at - a.at)[0];
              const sub = o.status === 'ACCEPTED' && r.subOrderId ? A.w.subOrders[r.subOrderId] : undefined;
              return (
                <Card key={r.id}>
                  <div className="row top"><Tile pid={r.productId} /><div className="grow">
                    <div className="row between top"><b className="bodym">{product(r.productId).name} · {fkg(o.kg)}</b><Chip tone={STATUS_OFFER[o.status].tone}>{STATUS_OFFER[o.status].l}</Chip></div>
                    <div className="cap">{orgName(A.w, r.buyerOrgId)} · para el {dateShort(r.neededOn)} · tu precio {money(o.pricePerKg)}/kg</div>
                    <div className="row g8 wrap mt">
                      {sub && <Btn xs kind="dark" onClick={() => A.go('A-13', { id: sub.id })}>Ver pedido {sub.code}</Btn>}
                      {o.status === 'SENT' && r.status === 'OPEN' && <Btn xs kind="secd" onClick={() => A.act('REQUEST_OFFER_WITHDRAW', { requestId: r.id, offerId: o.id }, { ok: 'Retiraste tu oferta.' })}>Retirar oferta</Btn>}
                    </div>
                  </div></div>
                </Card>
              );
            })}
          </>
        )}
        <Note icon="info">Si te aceptan, el pedido llega a «Pedidos nuevos» y lo confirmas en {A.w.settings.orderResponseHours} h como cualquier otro. La comisión es la de siempre.</Note>
      </div>
    </Screen>
  );
}

function OfferSheet({ r }: { r: PurchaseRequest }) {
  const A = useApp();
  const org = A.org!;
  const p = product(r.productId);
  const mine = r.offers.find(o => o.sellerOrgId === org.id && o.status === 'SENT');
  const myListing = Object.values(A.w.listings).filter(l => l.orgId === org.id && l.productId === r.productId && l.unit === 'kg' && catalogListing(A.w, l, A.now))[0];
  const sug = r2(Math.min(r.maxPricePerKg ?? Infinity, myListing?.price ?? suggestedPricePerKg(r.productId)));
  const [price, setPrice] = useState(String(sug).replace('.', ','));
  const [kg, setKg] = useState(String(r.kg));
  const [harvest, setHarvest] = useState<number>(startOfDay(A.now) + DAY);
  const [quality, setQuality] = useState<Quality>('PRIMERA');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const can = canDo(A.w, A.me, 'PUBLICAR');
  const priceN = Number(price.replace(',', '.')) || 0, kgN = Number(kg.replace(',', '.')) || 0;
  const send = () => {
    const res = A.act('REQUEST_OFFER', { requestId: r.id, offerId: 'ofr-' + uid(), pricePerKg: priceN, kg: kgN, harvestDate: harvest, quality, note: note.trim() || undefined }, { quiet: true });
    if (!res.ok) { setErr(res.error!.message); return; }
    A.sheet(null);
    A.toast(`Enviamos tu oferta a ${orgName(A.w, r.buyerOrgId)}. Te avisamos si la aceptan.`);
  };
  return (
    <SheetBody title={`${p.name} · ${fkg(r.kg)}`} sub={`${orgName(A.w, r.buyerOrgId)} · ${districtName(r.district)} · para el ${dateShort(r.neededOn)}`}>
      <Kv rows={[['Pide', fkg(r.kg)], ['Paga hasta', r.maxPricePerKg ? `${money(r.maxPricePerKg)} por kg` : 'Sin tope'], ['Ofertas', String(r.offers.filter(o => o.status === 'SENT').length)], ['Cierra', `${dateShort(r.closesAt)} · ${hhmm(r.closesAt)}`]]} />
      {r.note && <p className="bodym" style={{ margin: 0 }}>«{r.note}»</p>}
      {mine ? (
        <>
          <Note icon="clock" tone="warn">Ya ofreciste {fkg(mine.kg)} a {money(mine.pricePerKg)} por kg. Espera la respuesta o retírala para cambiarla.</Note>
          <Btn full kind="secd" onClick={() => { if (A.act('REQUEST_OFFER_WITHDRAW', { requestId: r.id, offerId: mine.id }, { ok: 'Retiraste tu oferta.' }).ok) A.sheet(null); }}>Retirar mi oferta</Btn>
        </>
      ) : (
        <>
          <div className="grid2">
            <Field label="Tu precio por kg" help={`Sugerido: ${money(suggestedPricePerKg(r.productId))}`}><Inp value={price} onInput={(v) => { setPrice(v); setErr(''); }} mode="decimal" prefix="S/" label="Precio por kilo" /></Field>
            <Field label="Kilos que ofreces"><Inp value={kg} onInput={(v) => { setKg(v); setErr(''); }} mode="decimal" suffix="kg" label="Kilos" /></Field>
          </div>
          <div className="lbl">Cosecha</div>
          <div className="chips">{[0, 1, 2, 3].map(i => { const d = startOfDay(A.now) + i * DAY; return <ChipBtn key={d} on={harvest === d} onClick={() => setHarvest(d)}>{i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : dateShort(d)}</ChipBtn>; })}</div>
          <div className="lbl">Calidad</div>
          <Seg value={quality} onChange={setQuality} options={(['PRIMERA', 'SEGUNDA', 'TERCERA'] as Quality[]).map(q => ({ v: q, l: QUALITY_LABEL[q] }))} />
          <Field label="Mensaje (opcional)"><Inp value={note} onInput={setNote} placeholder="Variedad, cómo la entregas…" label="Mensaje" /></Field>
          <Card tone="soft"><div className="row between"><span className="bodym">Recibirías</span><b className="price">{money(r2(priceN * kgN))}</b></div></Card>
          {err && <Note icon="circle-alert" tone="danger">{err}</Note>}
          <Btn full kind="dark" onClick={send} disabled={!can || !(priceN > 0 && kgN > 0)} why={!can ? 'No tienes permiso para publicar por esta cuenta' : 'Escribe tu precio y los kilos'}>Enviar oferta</Btn>
        </>
      )}
    </SheetBody>
  );
}

/* ============================== B-22 · Pedidos programados (Pro) ============================== */

function Scheduled() {
  const A = useApp();
  const org = A.org!;
  const id = A.top.p?.id as string | undefined;
  if (id) return <ScheduleDetail id={id} />;
  const list = Object.values(A.w.schedules).filter(s => s.buyerOrgId === org.id).sort((a, b) => a.nextDelivery - b.nextDelivery);
  const pro = isPro(org);
  const can = canDo(A.w, A.me, 'APROBAR');
  return (
    <Screen title="Pedidos programados" sub="Plan Pro · se arman solos y tú los apruebas" foot={pro ? <Btn full icon="plus" disabled={!can} why="Pídele al titular el permiso para aprobar" onClick={() => A.sheet(<NewScheduleSheet />)}>Programar un pedido</Btn> : undefined}>
      <div className="stack">
        {!pro && (
          <Card tone="warn">
            <div className="row top"><Icon n="sparkles" /><div className="stack tight grow"><b className="bodym">Es una función del plan Pro</b><span className="bodym">Con Pro, tus pedidos de cada semana se arman solos dos días antes y solo los apruebas. No se piden si el precio sube más de lo que tú digas.</span>
              <div><Btn sm kind="dark" onClick={() => A.go('B-20')}>Ver el plan Pro</Btn></div></div></div>
          </Card>
        )}
        {!list.length && pro && <Card><Empty icon="repeat" title="Sin pedidos programados" text="Elige un pedido que ya hiciste y di cada cuánto lo quieres. Dos días antes te llega para aprobarlo." /></Card>}
        {list.map(s => {
          const pending = s.draft?.status === 'PENDING';
          return (
            <button key={s.id} className={'card' + (pending ? ' hl' : '')} onClick={() => A.go('B-22', { id: s.id })}>
              <div className="row top">
                <ICirc n="repeat" tone={pending ? 'terra' : s.active ? 'dark' : ''} />
                <div className="grow">
                  <div className="row between top"><b className="bodym">{s.name}</b><span className="cap nowrap">{s.code}</span></div>
                  <div className="cap">{FREQ_LABEL[s.frequency]} · {DOW_LONG[s.weekday]} · {s.items.map(i => `${product(i.productId).name.toLowerCase()} ${numTrim(i.qty)} ${i.unit}`).join(', ')}</div>
                  <div className="row g8 wrap mt">
                    {pending ? <Chip tone="terra" icon="clock">Por aprobar · entrega {dateShort(s.draft!.deliveryDate)}</Chip> : s.active ? <Chip tone="leaf">Próxima entrega {dateShort(s.nextDelivery)}</Chip> : <Chip tone="ghost">Pausado</Chip>}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
        <Note icon="info">El pedido se arma solo 2 días antes de la entrega, a las 8:00, con los precios del día. Lo apruebas hasta las 18:00 del día anterior. Si un producto sube más que tu tope o no hay stock, no se pide solo: te proponemos otro agricultor.</Note>
      </div>
    </Screen>
  );
}

function ScheduleDetail({ id }: { id: string }) {
  const A = useApp();
  const s = A.w.schedules[id];
  const [useAlt, setUseAlt] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  if (!s || s.buyerOrgId !== A.org!.id) return <Screen title="Pedido programado"><Empty title="No encontramos el pedido programado" /></Screen>;
  const can = canDo(A.w, A.me, 'APROBAR');
  const d = s.draft;
  const pending = d?.status === 'PENDING';
  const upd = (p: any, ok?: string) => A.act('SCHEDULE_UPDATE', { scheduleId: s.id, ...p }, { ok });
  const approve = () => {
    if (!d) return;
    const sellers = new Set<string>();
    d.lines.forEach((l, i) => { if (l.ok) sellers.add(l.sellerOrgId); else if (l.alt && useAlt[String(i)]) sellers.add(l.alt.sellerOrgId); });
    setBusy(true);
    const res = A.act('SCHEDULE_APPROVE', { scheduleId: s.id, orderId: 'o-' + uid(), subOrderIds: [...sellers].map(() => 'so-' + uid()), useAlt, upgrade: A.dev.flow.upgrade }, { quiet: true });
    setBusy(false);
    if (!res.ok) {
      if (res.error?.code === 'PLAN_LIMIT') { A.sheet(<PlanLimitSheet month={res.error.data.month} order={res.error.data.order} />); return; }
      A.toast(res.error!.message, 'err');
      return;
    }
    A.patch(x => { x.flow = { ...x.flow, upgrade: undefined }; x.stack = [{ s: 'B-13' }]; });
    A.toast(`Pedido enviado para el ${dateShort(d.deliveryDate)}. Cada agricultor tiene ${A.w.settings.orderResponseHours} h para aceptar.`);
  };
  const remove = async () => {
    if (!await A.confirm({ title: '¿Eliminar este pedido programado?', text: 'Los pedidos que ya se hicieron siguen igual.', ok: 'Eliminar', danger: true })) return;
    if (A.act('SCHEDULE_DELETE', { scheduleId: s.id }, { ok: 'Eliminado.' }).ok) A.back();
  };
  const altTotal = d ? r2(d.total + d.lines.reduce((a, l, i) => a + (!l.ok && l.alt && useAlt[String(i)] ? l.alt.price * l.qty : 0), 0)) : 0;
  return (
    <Screen title={s.name} sub={`${s.code} · ${FREQ_LABEL[s.frequency].toLowerCase()} · ${DOW_LONG[s.weekday]}`}>
      <div className="stack">
        {pending && d && (
          <Card tone="warn">
            <div className="row between"><b className="h3">Por aprobar</b><Chip tone="terra">Entrega {dateShort(d.deliveryDate)}</Chip></div>
            <div className="cap">Armado el {dateShort(d.at)} {hhmm(d.at)} · apruébalo hasta {dateShort(d.deliveryDate - DAY)} 18:00</div>
            <div className="list mt">
              {d.lines.map((l, i) => (
                <div key={i} className="row top" style={{ padding: '.5em 0' }}>
                  <Tile pid={l.productId} size="sm" />
                  <div className="grow">
                    <b className="bodym">{product(l.productId).name} · {numTrim(l.qty)} {l.unit}</b>
                    <div className="cap">{orgName(A.w, l.sellerOrgId)}{l.price !== undefined ? ` · ${money(l.price)} por ${l.unit}` : ''}</div>
                    {!l.ok && <div className="cap bad">{l.reason}</div>}
                    {!l.ok && l.alt && <div className="mt"><Tog on={!!useAlt[String(i)]} onChange={(v) => setUseAlt({ ...useAlt, [String(i)]: v })} label={`Pedírselo a ${orgName(A.w, l.alt.sellerOrgId)}`} sub={`${money(l.alt.price)} por ${l.unit}`} /></div>}
                  </div>
                  {l.ok ? <Icon n="circle-check" /> : <Icon n="triangle-alert" />}
                </div>
              ))}
            </div>
            <div className="row between mt"><span className="bodym">Total aproximado</span><b className="price">{money(altTotal)}</b></div>
            <div className="btnrow mt">
              <Btn kind="sec" onClick={() => A.act('SCHEDULE_SKIP', { scheduleId: s.id }, { ok: 'Esta entrega no se pide.' })} disabled={!can}>Saltar esta vez</Btn>
              <Btn kind="dark" onClick={approve} loading={busy} disabled={!can} why="No tienes permiso para aprobar">Aprobar y pedir</Btn>
            </div>
          </Card>
        )}
        <Card>
          <Tog on={s.active} onChange={(v) => upd({ active: v }, v ? 'Reactivado.' : 'Pausado: no se arma hasta que lo reactives.')} label={s.active ? 'Activo' : 'Pausado'} sub={s.active ? `Próxima entrega: ${dateShort(s.nextDelivery)}` : 'No se arma ningún pedido'} disabled={!can} />
          <div className="lbl mt">¿Cada cuánto?</div>
          <Seg value={s.frequency} onChange={(v) => upd({ frequency: v })} options={(['SEMANAL', 'QUINCENAL', 'MENSUAL'] as Schedule['frequency'][]).map(f => ({ v: f, l: FREQ_LABEL[f] }))} />
          <div className="lbl mt">Día de entrega</div>
          <div className="chips">{[1, 2, 3, 4, 5, 6, 7].map(dw => <ChipBtn key={dw} on={s.weekday === dw} onClick={() => upd({ weekday: dw })}>{DOW_CHIP[dw]}</ChipBtn>)}</div>
          <div className="lbl mt">Pedir solo si el precio no sube más de</div>
          <Seg value={String(s.maxIncrease)} onChange={(v) => upd({ maxIncrease: Number(v) })} options={['0', '0.05', '0.1', '0.15', '0.2'].map(v => ({ v, l: pct(Number(v)) }))} />
        </Card>
        <div className="sect">Productos</div>
        <Card><div className="list">{s.items.map((it, i) => (
          <div key={i} className="row" style={{ padding: '.45em 0' }}>
            <Tile pid={it.productId} size="sm" />
            <div className="grow"><b className="bodym">{product(it.productId).name}</b><div className="cap">{orgName(A.w, it.sellerOrgId)} · precio al programar {money(it.refPrice)} por {it.unit}</div></div>
            <div className="row g8"><Btn xs kind="sec" label={`Menos ${product(it.productId).name}`} onClick={() => upd({ qty: s.items.map((x, j) => j === i ? Math.max(it.unit === 'kg' ? 5 : 1, x.qty - (it.unit === 'kg' ? 10 : 1)) : x.qty) })}>−</Btn><b className="nowrap">{numTrim(it.qty)} {it.unit}</b><Btn xs kind="sec" label={`Más ${product(it.productId).name}`} onClick={() => upd({ qty: s.items.map((x, j) => j === i ? x.qty + (it.unit === 'kg' ? 10 : 1) : x.qty) })}>+</Btn></div>
          </div>
        ))}</div></Card>
        <Kv rows={[['Entrega', s.deliveryMode === 'CARRIER' ? 'Transportista aliado' : s.deliveryMode === 'PICKUP' ? 'Recojo' : 'Envío del agricultor'], ['Pago', PAY_LABEL[s.payMethod]], ['Comprobante', TAXDOC_LABEL[s.taxDoc]], ['Local', localOf(A.org!, s.localId)?.name ?? 'Principal']]} />
        {s.history.length > 0 && <><div className="sect">Historial</div><Card><div className="list">{s.history.slice().reverse().slice(0, 8).map((h, i) => <div key={i} className="row between" style={{ padding: '.35em 0' }}><span className="bodym">{h.text}</span><span className="cap nowrap">{dateShort(h.at)}</span></div>)}</div></Card></>}
        <Btn full kind="secd" icon="trash" onClick={remove} disabled={!can}>Eliminar</Btn>
      </div>
    </Screen>
  );
}

function NewScheduleSheet() {
  const A = useApp();
  const org = A.org!;
  const recent = Object.values(A.w.subOrders).filter(s => s.buyerOrgId === org.id && !['REJECTED', 'EXPIRED', 'CANCELLED_BY_BUYER', 'CANCELLED_BY_SELLER'].includes(s.status)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
  const [from, setFrom] = useState(recent[0]?.id ?? '');
  const [freq, setFreq] = useState<Schedule['frequency']>('SEMANAL');
  const [weekday, setWeekday] = useState(lima(A.now + 3 * DAY).dow);
  const [inc, setInc] = useState('0.1');
  const [name, setName] = useState('');
  const create = () => {
    const scheduleId = 'prg-' + uid();
    const r = A.act('SCHEDULE_CREATE', { scheduleId, fromSubOrderId: from, frequency: freq, weekday, maxIncrease: Number(inc), name: name.trim() || undefined }, { quiet: true });
    if (!r.ok) { A.toast(r.error!.message, 'err'); return; }
    A.sheet(null);
    A.toast(`Listo: dos días antes de cada ${DOW_LONG[weekday]} te llega para aprobar.`);
    A.go('B-22', { id: scheduleId });
  };
  if (!recent.length) return <SheetBody title="Programar un pedido"><Empty icon="shopping-bag" title="Primero haz un pedido" text="Programas un pedido a partir de uno que ya hiciste." /></SheetBody>;
  return (
    <SheetBody title="Programar un pedido" sub="Elige un pedido que ya hiciste">
      <div className="stack tight">{recent.map(s => (
        <div key={s.id} className={'card ' + (from === s.id ? 'sel' : 'line')} role="radio" aria-checked={from === s.id ? 'true' : 'false'} tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => setFrom(s.id)}>
          <div className="row"><span className={'radio' + (from === s.id ? ' on' : '')} /><div className="grow"><b className="bodym">{orgName(A.w, s.sellerOrgId)}</b><div className="cap">{itemsShort(s)} · {money(s.total)} · {dateShort(s.createdAt)}</div></div></div>
        </div>
      ))}</div>
      <Field label="Nombre (opcional)"><Inp value={name} onInput={setName} placeholder="Papa de cada jueves" label="Nombre" /></Field>
      <div className="lbl">¿Cada cuánto?</div>
      <Seg value={freq} onChange={setFreq} options={(['SEMANAL', 'QUINCENAL', 'MENSUAL'] as Schedule['frequency'][]).map(f => ({ v: f, l: FREQ_LABEL[f] }))} />
      <div className="lbl">Día de entrega</div>
      <div className="chips">{[1, 2, 3, 4, 5, 6, 7].map(dw => <ChipBtn key={dw} on={weekday === dw} onClick={() => setWeekday(dw)}>{DOW_CHIP[dw]}</ChipBtn>)}</div>
      <div className="lbl">Pedir solo si el precio no sube más de</div>
      <Seg value={inc} onChange={setInc} options={['0.05', '0.1', '0.15', '0.2'].map(v => ({ v, l: pct(Number(v)) }))} />
      <Btn full kind="dark" onClick={create} disabled={!from}>Programar</Btn>
    </SheetBody>
  );
}

/* ============================== B-23 · Equipo y locales (Pro) ============================== */

const TEAM_PERMS: { v: MemberPerm; l: string; s: string }[] = [
  { v: 'PEDIR', l: 'Hacer pedidos', s: 'Carrito, solicitudes de compra y cancelar' },
  { v: 'APROBAR', l: 'Aprobar y recibir', s: 'Recibir con conformidad, pedidos programados y reclamos' },
  { v: 'PAGAR', l: 'Pagar', s: 'Constancias de pago, fletes y membresía' },
];
const DELEGATE_PERMS: { v: MemberPerm; l: string; s: string }[] = [
  { v: 'PUBLICAR', l: 'Publicar cosechas', s: 'Publicar, editar, pausar y ofertar en solicitudes' },
  { v: 'PEDIDOS', l: 'Responder pedidos', s: 'Aceptar, preparar y entregar · el chat del pedido' },
];

function PermsEditor({ options, value, onChange }: { options: typeof TEAM_PERMS; value: MemberPerm[]; onChange: (v: MemberPerm[]) => void }) {
  return <Card>{options.map(o => <Tog key={o.v} on={value.includes(o.v)} onChange={(on) => onChange(on ? [...value, o.v] : value.filter(x => x !== o.v))} label={o.l} sub={o.s} />)}</Card>;
}

function MemberSheet({ kind, m }: { kind: 'TEAM' | 'DELEGATE'; m?: OrgMember }) {
  const A = useApp();
  const opts = kind === 'TEAM' ? TEAM_PERMS : DELEGATE_PERMS;
  const u = m ? A.w.users[m.userId] : undefined;
  const [name, setName] = useState(u?.name ?? '');
  const [phone, setPhone] = useState(u?.phone ?? '');
  const [note, setNote] = useState(m?.note ?? '');
  const [rel, setRel] = useState<'FAMILIAR' | 'PROMOTOR'>(m?.kind === 'PROMOTOR' ? 'PROMOTOR' : 'FAMILIAR');
  const [perms, setPerms] = useState<MemberPerm[]>(m?.perms ?? (kind === 'TEAM' ? ['PEDIR'] : ['PUBLICAR']));
  const [err, setErr] = useState('');
  const save = () => {
    setErr('');
    if (m) {
      const r = A.act(kind === 'TEAM' ? 'TEAM_SET' : 'DELEGATE_SET', { userId: m.userId, perms }, { quiet: true });
      if (!r.ok) { setErr(r.error!.message); return; }
      A.sheet(null); A.toast('Guardamos los permisos.');
      return;
    }
    const p = phone.replace(/\s/g, '');
    if (!isPhoneValid(p)) { setErr('Ese número no parece correcto: son 9 dígitos y empieza con 9.'); return; }
    const r = A.act(kind === 'TEAM' ? 'TEAM_ADD' : 'DELEGATE_ADD', { userId: 'u-' + uid(), name: name.trim(), phone: p, perms, note: note.trim() || undefined, kind: rel }, { quiet: true });
    if (!r.ok) { setErr(r.error!.message); return; }
    A.sheet(null);
    A.toast(`Le enviamos un mensaje a ${name.trim().split(' ')[0]}: entra a Mesagri con su celular ${maskPhone(p)}.`);
  };
  return (
    <SheetBody title={m ? `Permisos de ${u?.shortName ?? ''}` : kind === 'TEAM' ? 'Invitar a tu equipo' : 'Dar permiso a otra persona'} sub={kind === 'TEAM' ? 'Entra con su propio celular y código; lo que haga queda a su nombre.' : 'Lo que haga por ti queda a su nombre. Confirmar pagos y tu cuenta de cobro siguen siendo solo tuyos.'}>
      {!m && <>
        <Field label="Nombre completo"><Inp value={name} onInput={setName} placeholder="Como figura en su DNI" label="Nombre completo" /></Field>
        <Field label="Celular"><Inp value={phone} onInput={setPhone} mode="tel" prefix="+51" placeholder="9__ ___ ___" label="Celular" /></Field>
        {kind === 'DELEGATE' && <Seg value={rel} onChange={setRel} options={[{ v: 'FAMILIAR', l: 'Familiar' }, { v: 'PROMOTOR', l: 'Promotor de mi asociación' }]} />}
        <Field label={kind === 'TEAM' ? 'Cargo (opcional)' : 'Parentesco o cargo (opcional)'}><Inp value={note} onInput={setNote} placeholder={kind === 'TEAM' ? 'Cocina, caja, compras…' : 'Hija, sobrino, promotor…'} label="Cargo" /></Field>
      </>}
      <div className="lbl">Qué puede hacer</div>
      <PermsEditor options={opts} value={perms} onChange={setPerms} />
      {err && <Note icon="circle-alert" tone="danger">{err}</Note>}
      <Btn full kind="dark" onClick={save} disabled={!perms.length} why="Elige al menos un permiso">{m ? 'Guardar' : kind === 'TEAM' ? 'Invitar' : 'Dar permiso'}</Btn>
    </SheetBody>
  );
}

function MemberRow({ m, kind }: { m: OrgMember; kind: 'TEAM' | 'DELEGATE' }) {
  const A = useApp();
  const u = A.w.users[m.userId];
  const titular = A.me ? isTitular(A.w, A.me) : false;
  const opts = kind === 'TEAM' ? TEAM_PERMS : DELEGATE_PERMS;
  const remove = async () => {
    if (!await A.confirm({ title: `¿Quitar a ${u?.shortName ?? 'esta persona'}?`, text: 'Ya no podrá entrar a tu cuenta. Lo que hizo queda en el historial.', ok: 'Quitar', danger: true })) return;
    A.act(kind === 'TEAM' ? 'TEAM_REMOVE' : 'DELEGATE_REMOVE', { userId: m.userId }, { ok: 'Quitamos el acceso.' });
  };
  return (
    <Card>
      <div className="row top">
        <Av name={u?.name ?? '—'} color={m.active ? '#2C5F2D' : '#8A938A'} />
        <div className="grow">
          <div className="row between top"><b className="bodym">{u?.name ?? m.userId}</b>{!m.active && <Chip tone="ghost">Pausado</Chip>}</div>
          <div className="cap">{m.kind === 'PROMOTOR' ? 'Promotor' : m.kind === 'FAMILIAR' ? 'Familiar' : 'Equipo'}{m.note ? ` · ${m.note}` : ''} · {maskPhone(u?.phone)}</div>
          <div className="chips mt">{opts.filter(o => m.perms.includes(o.v)).map(o => <Chip key={o.v} tone="leaf">{o.l}</Chip>)}</div>
          {titular && (
            <div className="row g8 wrap mt">
              <Btn xs kind="sec" onClick={() => A.sheet(<MemberSheet kind={kind} m={m} />)}>Permisos</Btn>
              <Btn xs kind="sec" onClick={() => A.act(kind === 'TEAM' ? 'TEAM_SET' : 'DELEGATE_SET', { userId: m.userId, active: !m.active }, { ok: m.active ? 'Acceso pausado.' : 'Acceso activo.' })}>{m.active ? 'Pausar' : 'Activar'}</Btn>
              <Btn xs kind="secd" onClick={remove}>Quitar</Btn>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function TitularCard({ org }: { org: Org }) {
  const A = useApp();
  const t = A.w.users[org.memberIds[0]];
  return <Card tone="soft"><div className="row"><Av org={org} /><div className="grow"><b className="bodym">{t?.name ?? '—'}{t?.id === A.me?.id ? ' (tú)' : ''}</b><div className="cap">Titular · puede todo, incluso cambiar el equipo</div></div><Chip tone="leaf" icon="shield-check">Titular</Chip></div></Card>;
}

function Team() {
  const A = useApp();
  const org = A.org!;
  const plan = org.subscription ? A.w.settings.plans[org.subscription.plan] : undefined;
  const pro = isPro(org);
  const titular = A.me ? isTitular(A.w, A.me) : false;
  const team = (org.members ?? []).filter(m => m.kind === 'EQUIPO');
  const locs = org.locales ?? (org.address ? [{ id: 'principal', name: 'Local principal', district: org.district, address: org.address, receiver: org.receiver ?? '', days: [1, 2, 3, 4, 5, 6], isDefault: true } as Local] : []);
  const maxUsers = plan?.users ?? null, maxLocs = plan?.locations ?? null;
  return (
    <Screen title="Equipo y locales" sub={`${org.name} · plan ${plan?.name ?? '—'}`}>
      <div className="stack">
        {!titular && <Note icon="lock">Solo {A.w.users[org.memberIds[0]]?.name ?? 'el titular'} cambia el equipo y los locales.</Note>}
        <div className="sect">Equipo · {1 + team.length}{maxUsers ? ` de ${maxUsers}` : ''} usuarios</div>
        <TitularCard org={org} />
        {team.map(m => <MemberRow key={m.userId} m={m} kind="TEAM" />)}
        {titular && (pro
          ? <Btn full kind="sec" icon="plus" disabled={maxUsers !== null && 1 + team.length >= maxUsers} why={`Tu plan permite ${maxUsers} usuarios`} onClick={() => A.sheet(<MemberSheet kind="TEAM" />)}>Invitar a alguien</Btn>
          : <Card tone="warn"><div className="row top"><Icon n="sparkles" /><div className="grow bodym">Con el plan Pro invitas hasta 5 personas (cocina, caja o compras) y tienes hasta 3 locales. <button className="linkbtn" onClick={() => A.go('B-20')}>Ver planes</button></div></div></Card>)}
        <div className="sect">Locales · {locs.length}{maxLocs ? ` de ${maxLocs}` : ''}</div>
        {locs.map(l => (
          <Card key={l.id}>
            <div className="row top"><ICirc n="map-pin" tone={l.isDefault ? 'dark' : ''} /><div className="grow">
              <div className="row between top"><b className="bodym">{l.name}</b>{l.isDefault && <Chip tone="leaf">Principal</Chip>}</div>
              <div className="cap">{withDistrict(l.address, districtName(l.district))}</div>
              <div className="cap">Recibe {l.receiver || '—'} · {daysText(l.days)}</div>
              {titular && <div className="row g8 wrap mt">
                <Btn xs kind="sec" onClick={() => A.sheet(<LocalSheet l={l} />)}>Editar</Btn>
                {!l.isDefault && <Btn xs kind="sec" onClick={() => A.act('LOCAL_SAVE', { local: { ...l, isDefault: true } }, { ok: `${l.name} es ahora tu local principal.` })}>Hacer principal</Btn>}
                {!l.isDefault && <Btn xs kind="secd" onClick={() => A.act('LOCAL_REMOVE', { localId: l.id }, { ok: 'Quitamos el local.' })}>Quitar</Btn>}
              </div>}
            </div></div>
          </Card>
        ))}
        {titular && <Btn full kind="sec" icon="plus" disabled={maxLocs !== null && locs.length >= maxLocs} why={maxLocs === 1 ? 'Tu plan Básico es para 1 local; con Pro tienes hasta 3' : `Tu plan permite ${maxLocs} locales`} onClick={() => A.sheet(<LocalSheet />)}>Agregar un local</Btn>}
        <Note icon="info">Al hacer un pedido eliges a qué local llega. Cada persona entra con su propio celular y lo que hace queda a su nombre.</Note>
      </div>
    </Screen>
  );
}

function LocalSheet({ l }: { l?: Local }) {
  const A = useApp();
  const [name, setName] = useState(l?.name ?? '');
  const [district, setDistrict] = useState(l?.district ?? A.org!.district);
  const [address, setAddress] = useState(l?.address ?? '');
  const [receiver, setReceiver] = useState(l?.receiver ?? '');
  const [days, setDays] = useState<number[]>(l?.days ?? [1, 2, 3, 4, 5, 6]);
  const [err, setErr] = useState('');
  const save = () => {
    const r = A.act('LOCAL_SAVE', { local: { id: l?.id ?? 'loc-' + uid(), name, district, address, receiver, days, isDefault: l?.isDefault } }, { quiet: true });
    if (!r.ok) { setErr(r.error!.message); return; }
    A.sheet(null); A.toast(l ? 'Guardamos el local.' : 'Agregamos el local.');
  };
  return (
    <SheetBody title={l ? `Editar ${l.name}` : 'Nuevo local'}>
      <Field label="Nombre"><Inp value={name} onInput={setName} placeholder="Restaurante del segundo piso" label="Nombre del local" /></Field>
      <Field label="Distrito"><Sel value={district} onChange={setDistrict} options={CITY_DISTRICTS.map(d => ({ v: d.code, l: d.name }))} label="Distrito" /></Field>
      <Field label="Dirección donde reciben"><Inp value={address} onInput={setAddress} label="Dirección" /></Field>
      <Field label="Quién recibe"><Inp value={receiver} onInput={setReceiver} label="Quién recibe" /></Field>
      <div className="lbl">Días en que reciben</div>
      <div className="chips">{[1, 2, 3, 4, 5, 6, 7].map(d => <ChipBtn key={d} on={days.includes(d)} onClick={() => setDays(days.includes(d) ? days.filter(x => x !== d) : [...days, d].sort())}>{DOW_CHIP[d]}</ChipBtn>)}</div>
      {err && <Note icon="circle-alert" tone="danger">{err}</Note>}
      <Btn full kind="dark" onClick={save}>Guardar</Btn>
    </SheetBody>
  );
}

/* ============================== A-28 · Quién publica por mí ============================== */

function Delegates() {
  const A = useApp();
  const org = A.org!;
  const titular = A.me ? isTitular(A.w, A.me) : false;
  const list = (org.members ?? []).filter(m => m.kind !== 'EQUIPO');
  const me = A.me ? memberOf(A.w, A.me) : undefined;
  return (
    <Screen title="Quién publica por mí" sub="Un familiar o el promotor de tu asociación">
      <div className="stack">
        {me && <Card tone="soft"><div className="row top"><Icon n="users" /><div className="bodym">Ayudas a <b>{A.w.users[org.memberIds[0]]?.name}</b>: puedes {DELEGATE_PERMS.filter(o => me.perms.includes(o.v)).map(o => o.l.toLowerCase()).join(' y ')}. Lo que hagas queda a tu nombre.</div></div></Card>}
        <p className="bodym" style={{ margin: 0 }}>Dale permiso a alguien de confianza para publicar tu cosecha o responder pedidos por ti. Entra con su propio celular. Tú decides qué puede hacer y lo quitas cuando quieras.</p>
        <TitularCard org={org} />
        {!list.length && <Card><Empty icon="users" title="Nadie publica por ti todavía" text="Útil si no tienes señal en la chacra o prefieres que tu hija, tu hijo o el promotor te ayuden." /></Card>}
        {list.map(m => <MemberRow key={m.userId} m={m} kind="DELEGATE" />)}
        {titular && <Btn full kind="dark" icon="plus" disabled={list.length >= 3} why="Hasta 3 personas" onClick={() => A.sheet(<MemberSheet kind="DELEGATE" />)}>Dar permiso a otra persona</Btn>}
        <Note icon="shield-check">Cada cosa que hagan por ti queda registrada a su nombre (RF-IDI-12). Confirmar pagos, tu cuenta de cobro y tus estados de cuenta siguen siendo solo tuyos.</Note>
      </div>
    </Screen>
  );
}

/** Aviso para quien actúa por otra cuenta (equipo de la MYPE o quien publica por el agricultor). */
export function HelperBanner() {
  const A = useApp();
  const me = A.me, org = A.org;
  if (!me || !org || isTitular(A.w, me)) return null;
  const m = memberOf(A.w, me);
  if (!m) return null;
  const opts = m.kind === 'EQUIPO' ? TEAM_PERMS : DELEGATE_PERMS;
  return (
    <Card tone="soft">
      <div className="row top"><Icon n="users" /><div className="bodym">{m.kind === 'EQUIPO' ? 'Trabajas en' : 'Ayudas a'} <b>{m.kind === 'EQUIPO' ? org.name : A.w.users[org.memberIds[0]]?.name}</b>. Puedes {opts.filter(o => m.perms.includes(o.v)).map(o => o.l.toLowerCase()).join(', ') || 'ver la cuenta'}.</div></div>
    </Card>
  );
}

reg('B-17', BuyerRequests, { nav: true, tab: 'B-13' });
reg('A-27', FarmerRequests, { nav: true, tab: 'A-12' });
reg('B-22', Scheduled, { nav: true, tab: 'B-13' });
reg('B-23', Team, { nav: true, tab: 'B-20' });
reg('A-28', Delegates, { nav: true, tab: 'A-20' });

void Kv; void Icon; void HOUR; void ({} as ReactNode); void ({} as AppCtx);
