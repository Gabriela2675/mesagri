/*
 * App del agricultor (2): chacras, reputación, perfil, ventas y comisión, estado de cuenta,
 * solicitudes y permisos (R2) y entrega al transportista. A-16, A-17, A-20, A-25 a A-28, A-30.
 */
import { useState } from 'react';
import { reg } from './registry';
import { HelperBanner } from './r2';
import { useApp, type AppCtx } from '../ctx';
import { Screen, Btn, Icon, Field, Inp, Sel, Card, Chip, ChipBtn, Seg, Kv, Av, ICirc, Empty, Note, SheetBody, Tile, Prog, Stat, Stars, Photo, PhotoPick, QR, Tog } from '../ui/kit';
import { PRODUCTS, product, allProducts } from '@mesagri/shared/catalog';
import { orgStats, reviewsTo, subOrdersOf, overdueStatement } from '@mesagri/shared/queries';
import { money, moneyShort, kg as fkg, dateShort, hhmm, relDay, ago, pct, dateNum } from '@mesagri/shared/format';
import { periodOf, periodLabel, DAY, HOUR } from '@mesagri/shared/time';
import { uid } from '@mesagri/shared/ids';
import { orgName, userOfOrg, levelChip, PAY_LABEL, itemsShort, sacos, permWhy } from '../helpers';
import { placeLabel, districtName } from '@mesagri/shared/ubigeo';
import { carrierStats } from '@mesagri/shared/queries';
import { r2 } from '@mesagri/shared/rules';
import { docPdf } from '../pdf';
import { saveFile, SAVE_UNAVAILABLE } from '../platform';
import { districtOptions } from './onboarding';
import { PrefsSheet, PrivacySheet } from './common';
import type { Statement } from '@mesagri/shared/types';

/* ---------- A-16 · Mis chacras ---------- */
function Farms() {
  const A = useApp();
  const farms = Object.values(A.w.farms).filter(f => f.orgId === A.org!.id);
  const [adding, setAdding] = useState(farms.length === 0);
  return (
    <Screen title={adding ? 'Agregar chacra' : 'Mis chacras'} sub={`${farms.length} ${farms.length === 1 ? 'registrada' : 'registradas'}`}>
      {adding ? <AddFarm onDone={() => setAdding(false)} /> : (
        <div className="stack">
          {farms.map(f => (
            <Card key={f.id}>
              <div className="row between"><b className="h3">{f.name}</b><Chip tone={f.gps === 'APP' ? 'leaf' : 'warn'} icon="map-pin">{f.gps === 'APP' ? 'GPS de la app' : 'Ubicación manual'}</Chip></div>
              <div className="cap">{placeLabel(f.district)} · {String(f.areaHa).replace('.', ',')} ha · {f.tenure === 'PROPIA' ? 'propia' : f.tenure === 'COMUNAL' ? 'comunal' : 'alquilada'}</div>
              <div className="chips mt">{f.crops.map(c => <Chip key={c}>{product(c).short}</Chip>)}</div>
            </Card>
          ))}
          <Btn full kind="sec" icon="plus" onClick={() => setAdding(true)}>Agregar chacra</Btn>
          <Note icon="lock">Los compradores solo ven tu distrito, nunca la ubicación exacta de tu chacra (RN-17).</Note>
        </div>
      )}
    </Screen>
  );
}

function AddFarm({ onDone }: { onDone: () => void }) {
  const A = useApp();
  const [name, setName] = useState('');
  const [district, setDistrict] = useState(A.org!.district);
  const [area, setArea] = useState('');
  const [tenure, setTenure] = useState<'PROPIA' | 'COMUNAL' | 'ALQUILADA'>('PROPIA');
  const [crops, setCrops] = useState<string[]>([]);
  const [photos, setPhotos] = useState<(string | undefined)[]>([undefined, undefined, undefined]);
  const [gps, setGps] = useState(false);
  const save = () => {
    const r = A.act('FARM_ADD', { farmId: 'farm-' + uid(), orgId: A.org!.id, name, district, areaHa: Number(area.replace(',', '.')), tenure, crops, gps: gps ? 'APP' : 'MANUAL', photoIds: photos.filter(Boolean) }, { ok: 'Guardamos tu chacra.' });
    if (r.ok) onDone();
  };
  return (
    <div className="stack">
      <div className="sect">Toma las fotos y el GPS en la misma chacra</div>
      <div className="map" style={{ padding: "0" }}>
        <svg viewBox="0 0 300 120" role="img" aria-label="Ubicación de la chacra (esquema)"><rect width="300" height="120" fill="#E3ECD8" /><path d="M0 92 C 60 70, 120 110, 180 84 S 270 72, 300 86" stroke="#97BC62" strokeWidth="10" fill="none" opacity=".7" /><path d="M95 30 L170 24 L190 66 L150 92 L100 76 Z" fill="#E8D7B2" stroke="#A66633" strokeWidth="2" strokeDasharray="5 4" /><circle cx="145" cy="56" r="9" fill="#A66633" /><circle cx="145" cy="56" r="3.5" fill="#fff" /></svg>
        <button className="chip line" style={{ position: "absolute", right: ".6em", bottom: ".6em" }} onClick={() => {
          // GPS del celular: necesita permiso y conexión segura (https o la misma laptop); si no, queda la ubicación del distrito
          const done = (msg: string, tone: 'ok' | 'info' = 'ok') => { setGps(true); A.toast(msg, tone); };
          try {
            if (!navigator.geolocation || !(window as any).isSecureContext) { done(`Marcamos el centro de ${districtName(district)}: el GPS se usa al abrir la app con conexión segura.`, 'info'); return; }
            navigator.geolocation.getCurrentPosition(
              (pos) => done(`Ubicación marcada con el GPS (±${Math.round(pos.coords.accuracy)} m). Los compradores solo ven tu distrito.`),
              () => done(`No tenemos permiso para el GPS: marcamos el centro de ${districtName(district)}.`, 'info'),
              { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
            );
          } catch { done(`Marcamos el centro de ${districtName(district)}.`, 'info'); }
        }}><Icon n="map-pin" s="1.1em" />{gps ? 'GPS marcado' : 'Marcar con GPS'}</button>
      </div>
      <Field label="Nombre de la chacra"><Inp value={name} onInput={setName} placeholder="Pampa Alta" label="Nombre de la chacra" /></Field>
      <div className="grid2">
        <Field label="Distrito"><Sel value={district} onChange={setDistrict} options={districtOptions(d => !d.city || d.code === '040101')} label="Distrito" /></Field>
        <Field label="Área"><Inp value={area} onInput={setArea} mode="decimal" suffix="ha" placeholder="1,5" label="Área en hectáreas" /></Field>
      </div>
      <div className="lbl">Tenencia</div>
      <Seg value={tenure} onChange={setTenure} options={[{ v: 'PROPIA', l: 'Propia' }, { v: 'COMUNAL', l: 'Comunal' }, { v: 'ALQUILADA', l: 'Alquilada' }]} />
      <div className="lbl">Qué siembras</div>
      <div className="chips">{allProducts().slice(0, 18).map(p => <ChipBtn key={p.id} on={crops.includes(p.id)} onClick={() => setCrops(crops.includes(p.id) ? crops.filter(c => c !== p.id) : [...crops, p.id])}>{p.short}</ChipBtn>)}</div>
      <div className="photos">{photos.map((ph, i) => <PhotoPick key={i} value={ph} onChange={(v) => { const n = [...photos]; n[i] = v; setPhotos(n); if (v) setGps(true); }} label={`Chacra · foto ${i + 1}`} kind="chacra" sample={{ stamp: `GPS dentro del área · ${hhmm(A.now)}` }} />)}</div>
      <Note icon="lock">Los compradores solo ven tu distrito, nunca la ubicación exacta (RN-17).</Note>
      <Btn full onClick={save}>Guardar chacra</Btn>
    </div>
  );
}

/* ---------- A-17 · Reputación ---------- */
function Reputation() {
  const A = useApp();
  const org = A.org!;
  const st = orgStats(A.w, org.id);
  const revs = reviewsTo(A.w, org.id);
  const total = Math.max(1, st.dist.reduce((a, b) => a + b, 0));
  return (
    <Screen title="Mi reputación" sub="Lo que ven los compradores">
      <div className="stack">
        <Card>
          <div className="row">
            <div className="center" style={{ minWidth: "6em" }}><div className="display" style={{ fontSize: "2.6em" }}>{st.rating ? String(st.rating).replace('.', ',') : '—'}</div><Stars v={st.rating} /><div className="cap">{st.count} opiniones</div></div>
            <div className="grow stack tight">{[5, 4, 3, 2, 1].map(n => <div key={n} className="row g8"><span className="cap" style={{ width: "1em" }}>{n}</span><div className="grow"><Prog v={st.dist[n - 1] / total} tone="terra" /></div></div>)}</div>
          </div>
        </Card>
        <div className="grid2">
          <Stat n={st.onTimePct ? pct(st.onTimePct) : '—'} l="Pedidos a tiempo" />
          <Stat n={st.responseMin ? (st.responseMin >= 60 ? `${Math.floor(st.responseMin / 60)} h ${st.responseMin % 60} min` : `${st.responseMin} min`) : '—'} l="Tiempo de respuesta" />
          <Stat n={st.disputesLost} l="Disputas perdidas" />
          <Stat n={st.completed} l="Pedidos entregados" />
        </div>
        <button className="card line" onClick={() => A.go('A-17V')}><div className="row"><ICirc n="shield-check" /><div className="grow"><b className="bodym">Nivel de verificación</b><div className="cap">{levelChip(org).label} · qué tienes y qué falta para subir</div></div><Icon n="chevron-right" s="1.1em" /></div></button>
        {revs.length === 0 && <Card><Empty icon="star" title="Sin calificaciones todavía" text="Las opiniones se publican cuando ambos califican, o a los 7 días (RN-12)." /></Card>}
        {revs.slice(0, 12).map(r => <ReviewCard key={r.id} id={r.id} />)}
      </div>
    </Screen>
  );
}
export function ReviewCard({ id }: { id: string }) {
  const A = useApp();
  const r = A.w.reviews[id];
  const [reply, setReply] = useState('');
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <Stars v={r.stars} />
      {r.comment && <div className="bodym mt">«{r.comment}»</div>}
      {r.tags.length > 0 && <div className="chips mt">{r.tags.map(t => <Chip key={t}>{t}</Chip>)}</div>}
      <div className="cap mt">{orgName(A.w, r.fromOrg)} · {ago(r.at, A.now)}</div>
      {r.reply ? <div className="card soft mt"><div className="cap b">Tu respuesta</div><div className="bodym">{r.reply}</div></div> : r.toOrg === A.org?.id && (open
        ? <div className="row g8 mt"><div className="grow"><Inp value={reply} onInput={setReply} placeholder="Responde con respeto" label="Respuesta" /></div><Btn sm kind="dark" onClick={() => { if (A.act('REVIEW_REPLY', { reviewId: id, text: reply }, { ok: 'Respuesta publicada.' }).ok) setOpen(false); }}>Enviar</Btn></div>
        : <button className="linkbtn" style={{ paddingLeft: "0" }} onClick={() => setOpen(true)}>Responder</button>)}
    </Card>
  );
}

/* ---------- A-20 · Perfil y preferencias ---------- */
function Profile() {
  const A = useApp();
  const org = A.org!, me = A.me!;
  const farms = Object.values(A.w.farms).filter(f => f.orgId === org.id);
  const acct = org.payout[0];
  const lc = levelChip(org);
  const item = (icon: string, title: string, sub: string, onClick: () => void, tone = '') => (
    <button className="li" onClick={onClick}><ICirc n={icon} tone={tone} /><div className="grow"><b className="bodym">{title}</b><div className="cap">{sub}</div></div><Icon n="chevron-right" s="1.1em" /></button>
  );
  return (
    <Screen bar={
      <header className="bar home" style={{ alignItems: "center" }}>
        <Av org={org} size="lg" />
        <div className="tt"><h1>{org.name}</h1><p>Agricultor · {placeLabel(org.district)}</p><span className={'chip ' + (lc.tone || 'leaf')} style={{ marginTop: ".35em" }}><Icon n="shield-check" s="1.1em" />{lc.label}</span></div>
      </header>
    }>
      <div className="stack">
        <HelperBanner />
        <Card><div className="list">
          {item('globe', 'Idioma', `${me.prefs.lang === 'es' ? 'Castellano' : me.prefs.lang === 'qu' ? 'Runasimi' : 'Aymar aru'} · guía de audio ${me.prefs.audioGuide ? 'activada' : 'apagada'}`, () => A.sheet(<PrefsSheet />))}
          {item('banknote', 'Cuentas de cobro', acct ? `${acct.kind === 'BANK' ? 'Cuenta' : acct.kind === 'PLIN' ? 'Plin' : 'Yape'} ···· ${acct.number.slice(-3)} · ${acct.relation === 'PROPIA' ? 'a mi nombre' : 'de ' + acct.holder}${org.acceptsCash ? ' · y efectivo' : ''}` : org.acceptsCash ? 'Solo efectivo' : 'Sin cuenta', () => A.go('A-06'))}
          {item('map', 'Mis chacras y zonas', `${farms.length} ${farms.length === 1 ? 'chacra' : 'chacras'} · entrega en ${org.serviceAreas.length} distritos`, () => A.sheet(<SheetBody title="Chacras y zonas"><Btn full kind="sec" icon="sprout" onClick={() => A.go('A-16')}>Mis chacras</Btn><Btn full kind="sec" icon="map-pin" onClick={() => A.go('A-07')}>Zonas y días de entrega</Btn></SheetBody>))}
          {item('users', 'Quién puede publicar por mí', 'Un familiar o el promotor de tu asociación', () => A.go('A-28'))}
        </div></Card>
        <Card><div className="list">
          {item('star', 'Mi reputación', `${orgStats(A.w, org.id).count} opiniones`, () => A.go('A-17'))}
          {item('shield-check', 'Mi verificación', lc.label, () => A.go('A-17V'))}
          {item('percent', 'Mis ventas y comisión', 'Ventas sin comisión y estado de cuenta', () => A.go('A-25'))}
          {item('message-circle', 'Mensajes', 'Conversaciones por pedido', () => A.go('A-18'))}
          {item('bell', 'Avisos', 'Pedidos, pagos, almacén y precios', () => A.go('A-29'))}
          {item('file-text', 'Solicitudes de compra', 'Las MYPE piden y tú ofreces tu precio', () => A.go('A-27'))}
        </div></Card>
        <Card><div className="list">
          {item('lock', 'Privacidad y mis datos', 'Descargar o borrar mis datos', () => A.sheet(<PrivacySheet />))}
          {item('circle-question-mark', 'Ayuda', 'Preguntas, WhatsApp y reclamos', () => A.go('A-19'))}
          {item('log-out', 'Cerrar sesión', me.phone.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3'), () => A.logout(), 'terra')}
        </div></Card>
      </div>
    </Screen>
  );
}

/* ---------- A-25 · Mis ventas y comisión ---------- */
function Sales() {
  const A = useApp();
  const org = A.org!, w = A.w;
  const period = periodOf(A.now);
  const done = subOrdersOf(w, s => s.sellerOrgId === org.id && s.status === 'COMPLETED' && periodOf(s.completedAt ?? 0) === period);
  const free = w.settings.commission.freeSales;
  const used = Math.min(free, org.counters.freeSalesUsed);
  const sold = done.reduce((a, s) => a + (s.saleAmount ?? s.subtotal), 0);
  const com = done.reduce((a, s) => a + (s.commission ?? 0), 0);
  const last = Object.values(w.statements).filter(s => s.orgId === org.id).sort((a, b) => b.period.localeCompare(a.period))[0];
  const papa = done.find(s => s.items[0]?.productId.startsWith('papa')) ?? subOrdersOf(w, s => s.sellerOrgId === org.id && s.status === 'COMPLETED' && s.items[0]?.productId.startsWith('papa'))[0];
  return (
    <Screen title="Mis ventas" sub={periodLabel(period)} foot={last && ['ISSUED', 'OVERDUE'].includes(last.status) ? <><Btn full onClick={() => A.go('A-26', { id: last.id })}>Pagar {money(last.total)} con Yape</Btn><div className="why">Vence el {dateShort(last.dueAt)} · recibes boleta electrónica</div></> : undefined}>
      <div className="stack">
        <Card tone="soft">
          <div className="row between"><b className="bodym">Ventas sin comisión</b><b className="ok">{used} de {free} usadas</b></div>
          <div className="mt"><Prog v={used / free} /></div>
          <div className="cap mt">{used >= free ? `Desde tu ${free + 1}.ª venta pagas ${pct(w.settings.commission.rate)} solo de lo que vendes.` : `Te quedan ${free - used}. Después, ${pct(w.settings.commission.rate)} de cada venta conforme.`}</div>
        </Card>
        <div className="grid2">
          <Stat n={moneyShort(sold)} l={`Vendiste · ${done.length} ${done.length === 1 ? 'venta' : 'ventas'}`} />
          <Stat n={money(com)} l={`Comisión ${pct(w.settings.commission.rate)} · se paga al mes`} tone="terra" />
        </div>
        <Card>
          {done.length === 0 ? <Empty icon="shopping-bag" title="Sin ventas conformes este mes" text="Cuando el comprador da su conformidad, la venta aparece aquí." /> : (
            <div className="list">
              {done.map(s => (
                <button key={s.id} className="li" onClick={() => A.go('A-13', { id: s.id })}>
                  <div className="grow"><b className="bodym">{orgName(w, s.buyerOrgId)}</b><div className="cap">Venta {s.saleNumber} · {itemsShort(s)}</div></div>
                  <div className="right"><b className="bodym">{money(s.saleAmount ?? s.subtotal)}</b><div className="cap">{s.commission ? `${pct(s.commissionRate)}: ${money(s.commission)}` : 'sin comisión'}</div></div>
                </button>
              ))}
            </div>
          )}
        </Card>
        {papa && <Note icon="trending-up">Tu {product(papa.items[0].productId).name.toLowerCase()} salió a <b>{money(papa.items[0].price / papa.items[0].unitKg)} el kilo</b>. En chacra te pagaban {money(product(papa.items[0].productId).ref.chacra)} (Midagri).</Note>}
        <Btn full kind="sec" icon="receipt" onClick={() => A.go('A-26', last ? { id: last.id } : undefined)}>Estados de cuenta</Btn>
      </div>
    </Screen>
  );
}

/* ---------- A-26 · Estado de cuenta (también C-13 y T-17) ---------- */
export const MESAGRI_YAPE = '900 000 100';
export async function downloadStatement(A: AppCtx, st: Statement) {
  const org = A.w.orgs[st.orgId];
  const kindLabel = st.kind === 'FARMER' ? 'Comisión de agricultor (3 % desde la 6.ª venta)' : st.kind === 'WAREHOUSE' ? 'Comisión de almacén aliado (10 % del alquiler)' : 'Comisión de transportista aliado (10 % del flete)';
  const bytes = docPdf({
    kicker: 'Estado de cuenta', badge: st.code, title: `Estado de cuenta de ${periodLabel(st.period)}`, subtitle: `${org?.name ?? ''}${org?.ruc ? ` · RUC ${org.ruc}` : org?.dni ? ` · DNI ${org.dni.slice(0, 1)}•••••${org.dni.slice(6)}` : ''} · ${kindLabel}`,
    rows: [['Emitido', dateNum(st.issuedAt)], ['Vence', dateNum(st.dueAt)], ['Base del mes', money(st.base)], ['Estado', ({ ISSUED: 'Emitido', PAYMENT_REGISTERED: 'Pago registrado', PAID: 'Pagado', OVERDUE: 'Vencido', VOID: 'Anulado' } as any)[st.status]], ...(st.receiptNumber ? [['Comprobante de Mesagri', st.receiptNumber] as [string, string]] : [])],
    table: { cols: ['Concepto', 'Base', 'Tasa', 'Monto'], align: ['left', 'right', 'right', 'right'], rows: st.items.map(i => [i.label + (i.voided ? ' (anulado)' : ''), money(i.base), i.rate ? pct(i.rate) : '—', money(i.voided ? 0 : i.amount)]), total: ['Total a pagar', money(st.total)] },
    notes: [`Paga con Yape a Mesagri S.A.C. (${MESAGRI_YAPE}, número de ejemplo) o por transferencia y registra el número de operación en la app.`, st.kind === 'FARMER' ? 'Si no se paga hasta el día 10, no podrás publicar hasta ponerte al día (RN-40). Tus pedidos en curso siguen.' : st.kind === 'CARRIER' ? 'Si no se paga hasta el día 10, dejas de recibir ofertas nuevas (RN-40).' : 'Si no se paga hasta el día 10, no recibes reservas nuevas (RN-40).', 'Mesagri no recibe el dinero de las ventas, alquileres ni fletes: solo cobra su comisión.'],
  });
  const r = await saveFile(`${st.code}.pdf`, bytes);
  if (r === 'error' || r === 'unavailable') A.toast(r === 'unavailable' ? SAVE_UNAVAILABLE : 'No pudimos descargar el PDF.', 'err');
}

export function StatementView() {
  const A = useApp();
  const org = A.org!;
  const all = Object.values(A.w.statements).filter(s => s.orgId === org.id).sort((a, b) => b.period.localeCompare(a.period));
  const st: Statement | undefined = (A.top.p?.id ? A.w.statements[A.top.p.id as string] : undefined) || all.find(s => ['ISSUED', 'OVERDUE', 'PAYMENT_REGISTERED'].includes(s.status)) || all[0];
  if (!st) return <Screen title="Estado de cuenta"><Empty icon="receipt" title="Todavía no tienes estados de cuenta" text="Se emiten el día 1 de cada mes con las ventas conformes del mes anterior." /></Screen>;
  const free = A.w.settings.commission.freeSales;
  const charged = st.items.filter(i => i.amount > 0 && !i.voided);
  const summary = st.kind === 'FARMER'
    ? `${pct(A.w.settings.commission.rate)} de ${money(charged.reduce((a, i) => a + i.base, 0))} · ventas ${charged.length ? `${charged[0].saleNumber}.ª a ${charged[charged.length - 1].saleNumber}.ª` : '—'} (las ${free} primeras fueron gratis)`
    : st.kind === 'WAREHOUSE' ? `10 % del alquiler del mes (${money(st.base)})` : `Comisión de Mesagri: 10 % de tus fletes (${money(st.base)})`;
  const canPay = ['ISSUED', 'OVERDUE'].includes(st.status) && st.total > 0;
  return (
    <Screen title="Estado de cuenta" sub={st.kind === 'FARMER' ? 'Comisión de Mesagri' : st.kind === 'WAREHOUSE' ? 'Comisión del alquiler' : `Emitido el ${dateShort(st.issuedAt)}`} foot={canPay ? <Btn full onClick={() => A.sheet(<PayStatement id={st.id} />)}>Pagar {money(st.total)} con Yape</Btn> : undefined}>
      <div className="stack">
        {st.status === 'OVERDUE' && <Note icon="triangle-alert" tone="danger">{st.kind === 'FARMER' ? 'Venció: no puedes publicar hasta pagar' : st.kind === 'CARRIER' ? 'Venció: no recibes ofertas nuevas hasta pagar' : 'Venció: no recibes reservas nuevas hasta pagar'}. Lo que está en curso sigue (RN-40).</Note>}
        <Card tone="dark">
          <div className="row between"><span className="cap b" style={{ letterSpacing: ".1em" }}>{periodLabel(st.period).toUpperCase()}</span><Chip tone={st.status === 'PAID' ? 'leaf' : st.status === 'OVERDUE' ? 'danger' : st.status === 'PAYMENT_REGISTERED' ? 'info' : 'warn'}>{st.status === 'PAID' ? `Pagado${st.receiptNumber ? ' · ' + st.receiptNumber : ''}` : st.status === 'PAYMENT_REGISTERED' ? 'Pago por conciliar' : st.status === 'OVERDUE' ? 'Vencido' : `Vence el ${dateShort(st.dueAt).replace(/^\w+ /, '')}`}</Chip></div>
          <div className="display" style={{ fontSize: "2.2em", margin: ".15em 0" }}>{money(st.total)}</div>
          <div className="cap">{summary}</div>
        </Card>
        <Card>
          <div className="list">
            {st.items.map(i => (
              <button key={i.id} className="li" style={{ padding: ".55em 0", minHeight: "0" }} onClick={() => !i.voided && i.amount > 0 && A.sheet(<ClaimCharge stId={st.id} itemId={i.id} />)}>
                <span className="grow cap" style={{ color: "var(--ink)", fontSize: ".82em" }}>{i.label}{i.voided ? ' · anulado' : ''}</span>
                <b className="bodym" style={i.voided ? { textDecoration: "line-through", color: "var(--moss)" } : undefined}>{money(i.amount)}</b>
              </button>
            ))}
            <div className="row between" style={{ padding: ".6em 0" }}><b>Total</b><b>{money(st.total)}</b></div>
          </div>
        </Card>
        {st.claim && <Note icon="message-circle" tone={st.claim.status === 'ACCEPTED' ? 'soft' : st.claim.status === 'REJECTED' ? 'danger' : 'warn'}>Reclamo de un cargo: {st.claim.reason} · {st.claim.status === 'OPEN' ? 'en revisión' : st.claim.status === 'ACCEPTED' ? 'aceptado, cargo anulado' : 'no procede'}</Note>}
        {st.reconcileNote && <Note icon="triangle-alert" tone="danger">Revisa tu pago: {st.reconcileNote}</Note>}
        <div className="btnrow">
          <Btn kind="sec" icon="download" onClick={() => downloadStatement(A, st)}>Descargar PDF</Btn>
          <Btn kind="sec" onClick={() => A.sheet(<SheetBody title="Meses anteriores">{all.map(s => <button key={s.id} className="card line" onClick={() => { A.sheet(null); A.replace(A.top.s, { id: s.id }); }}><div className="row between"><span className="b bodym">{periodLabel(s.period)}</span><span className="bodym">{money(s.total)} · {s.status === 'PAID' ? 'pagado' : s.status === 'OVERDUE' ? 'vencido' : s.status === 'PAYMENT_REGISTERED' ? 'por conciliar' : 'por pagar'}</span></div></button>)}</SheetBody>)}>Meses anteriores</Btn>
        </div>
        <p className="cap center" style={{ margin: "0" }}>Toca un cargo si no corresponde. Recibes {org.ruc ? 'factura' : 'boleta'} electrónica. {st.kind === 'FARMER' ? 'Si no pagas hasta el día 10, no podrás publicar hasta ponerte al día.' : ''}</p>
      </div>
    </Screen>
  );
}

function PayStatement({ id }: { id: string }) {
  const A = useApp();
  const st = A.w.statements[id];
  const [method, setMethod] = useState<'YAPE' | 'PLIN' | 'TRANSFER'>('YAPE');
  const [op, setOp] = useState('');
  return (
    <SheetBody title={`Pagar ${money(st.total)}`} sub="Paga desde tu app y escribe el número de operación.">
      <Seg value={method} onChange={setMethod} options={[{ v: 'YAPE', l: 'Yape' }, { v: 'PLIN', l: 'Plin' }, { v: 'TRANSFER', l: 'Transferencia' }]} />
      <Card tone="soft"><Kv rows={[['A nombre de', 'Mesagri S.A.C.'], [method === 'TRANSFER' ? 'Cuenta (CCI)' : 'Número', method === 'TRANSFER' ? '002 215 000000000000 01 (ejemplo)' : `${MESAGRI_YAPE} (ejemplo)`], ['Monto', money(st.total)], ['Referencia', st.code]]} /></Card>
      <Field label="N.º de operación"><Inp value={op} onInput={(v) => setOp(v.replace(/\D/g, ''))} mode="numeric" placeholder="05123987" label="Número de operación" /></Field>
      <Note icon="shield-check">Mesagri nunca te pedirá tu clave del banco ni de Yape.</Note>
      <Btn full disabled={!!permWhy(A.w, A.me, 'STATEMENT_PAY')} why={permWhy(A.w, A.me, 'STATEMENT_PAY')} onClick={() => { if (A.act('STATEMENT_PAY', { statementId: id, method, operation: op }, { ok: 'Pago registrado: ya puedes operar con normalidad.' }).ok) A.sheet(null); }}>Registrar pago</Btn>
    </SheetBody>
  );
}

function ClaimCharge({ stId, itemId }: { stId: string; itemId: string }) {
  const A = useApp();
  const st = A.w.statements[stId];
  const it = st.items.find(i => i.id === itemId)!;
  const [reason, setReason] = useState('');
  return (
    <SheetBody title="Reclamar este cargo" sub={`${it.label} · ${money(it.amount)}`}>
      <Inp area value={reason} onInput={setReason} placeholder="Por ejemplo: el comprador canceló y nunca se entregó" label="Motivo" />
      <Btn full kind="dark" onClick={() => { if (A.act('STATEMENT_CLAIM', { statementId: stId, itemId, reason }, { ok: 'Reclamo enviado: lo revisa el equipo y te responde.' }).ok) A.sheet(null); }}>Enviar reclamo</Btn>
    </SheetBody>
  );
}

/* ---------- A-30 · Entrega al transportista ---------- */
function HandToCarrier() {
  const A = useApp();
  const sh = A.w.shipments[A.top.p?.id as string];
  const [sacks, setSacks] = useState(sh ? String(sh.sacks) : '');
  const [kgv, setKg] = useState(sh ? String(sh.weightKg).replace('.', ',') : '');
  const [ph, setPh] = useState<(string | undefined)[]>([undefined, undefined, undefined]);
  const [guide, setGuide] = useState('');
  if (!sh) return <Screen title="Entrega al transportista"><Empty title="No encontramos el envío" /></Screen>;
  const s = A.w.subOrders[sh.subOrderId];
  const c = sh.carrierOrgId ? A.w.orgs[sh.carrierOrgId] : undefined;
  const person = userOfOrg(A.w, sh.carrierOrgId);
  const cs = c ? carrierStats(A.w, c.id) : undefined;
  const picked = ['PICKED_UP', 'ARRIVED', 'DELIVERED', 'CLOSED'].includes(sh.status);
  const rel = Object.values(A.w.releases).find(r => r.subOrderId === s?.id && r.status !== 'EXPIRED');
  const qr = rel ? rel.code : s?.pickupQr ?? '';
  const noShowOk = A.now >= sh.pickupAt + HOUR && ['ASSIGNED', 'GOING_TO_PICKUP'].includes(sh.status);
  return (
    <Screen title="Entrega al transportista" sub={`${A.me!.shortName} · ${relDay(sh.pickupAt, A.now)}`} foot={!picked && s && s.status === 'PREPARING' ? <Btn full kind="dark" onClick={() => A.act('SUBORDER_READY', { subOrderId: s.id }, { ok: 'Carga lista: avisamos al transportista.' })}>Marcar la carga lista</Btn> : undefined}>
      <div className="stack">
        {c ? <Card><div className="row"><span className="av" style={{ background: "#1E3F20" }}>{person?.name.split(' ').slice(0, 2).map(x => x[0]).join('')}</span><div className="grow"><b className="bodym">{person?.shortName ?? c.name} · llega {hhmm(sh.pickupAt)}</b><div className="cap">{c.carrier?.vehicle.body} {c.carrier?.vehicle.plate} · {c.carrier?.level} Verificado</div></div><span className="price nowrap">★ {cs?.rating ? String(cs.rating).replace('.', ',') : '—'}</span></div></Card>
          : <Note icon="clock" tone="warn">{sh.status === 'OFFERING' ? 'Estamos buscando un transportista aliado.' : 'Sin transportista asignado.'}</Note>}
        {c && <Note icon="eye">Antes de entregar, mira que la placa y la persona sean las de la app.</Note>}
        <Card><Kv rows={[['Pedido', `${s?.code ?? ''} · ${orgName(A.w, sh.buyerOrgId)}`], ['Producto', s ? itemsShort(s) : ''], ['Envío', `${sh.code} · a ${districtName(sh.destLabel)}`], ['Flete', `${money(sh.freight)} · lo paga el comprador al recibir`]]} /></Card>
        {picked ? (
          <Card tone="soft"><div className="row top"><Icon n="circle-check" /><div className="bodym"><b>{person?.shortName ?? 'El transportista'} recogió la carga {sh.pickup ? `a las ${hhmm(sh.pickup.at)} · ${sacos(sh.pickup.sacks)} · ${fkg(sh.pickup.kg)}` : ''}.</b> Desde ahora la carga está a su cargo hasta entregarla (RN-59).</div></div></Card>
        ) : (
          <>
            <div className="grid2">
              <Field label="Sacos"><Inp value={sacks} onInput={setSacks} mode="numeric" label="Sacos" /></Field>
              <Field label="Peso"><Inp value={kgv} onInput={setKg} mode="decimal" suffix={<Icon n="scale" />} label="Peso en kg" /></Field>
            </div>
            <div className="photos">{['Sacos', 'Balanza', 'Carga en el furgón'].map((l, i) => <PhotoPick key={l} value={ph[i]} onChange={(v) => { const n = [...ph]; n[i] = v; setPh(n); }} label={l} kind={i === 1 ? 'balanza' : 'sacos'} sample={i === 1 ? { value: `${kgv} kg` } : undefined} />)}</div>
            <Field label="Guía de remisión (remitente)" help={A.org!.ruc ? 'La emites en la SUNAT antes de que salga la carga.' : 'Sin RUC: la guía del transportista acompaña la carga (por validar en el piloto).'}><Inp value={guide} onInput={setGuide} placeholder="T001-00123" suffix={<Icon n="file-text" />} label="Guía de remisión" /></Field>
            <Card tone="dark"><div className="row"><QR text={qr} size={84} /><div className="grow"><b>Muéstrale este QR a {person?.shortName ?? 'tu transportista'}</b><div className="cap">Al escanearlo, la carga queda a su cargo. Código {qr}</div></div></div></Card>
            {s && s.status !== 'READY' && !rel && <Note icon="info" tone="warn">Marca la carga como lista para que el transportista pueda recogerla.</Note>}
          </>
        )}
        {noShowOk && <Btn full kind="secd" onClick={async () => { if (await A.confirm({ title: '¿El transportista no llegó?', text: 'Se registra una inasistencia y buscamos a otro transportista para tu pedido.', ok: 'No llegó', danger: true })) A.act('SHIP_NO_SHOW', { shipmentId: sh.id }, { ok: 'Registramos la inasistencia. Buscamos otro transportista.' }); }}>El transportista no llegó</Btn>}
      </div>
    </Screen>
  );
}

reg('A-16', Farms);
reg('A-17', Reputation, { nav: true, tab: 'A-20' });
reg('A-20', Profile, { nav: true, tab: 'A-20' });
reg('A-25', Sales, { nav: true, tab: 'A-20' });
reg('A-26', StatementView);
reg('A-30', HandToCarrier);

void overdueStatement; void r2; void DAY; void PAY_LABEL; void Tog; void Photo;
