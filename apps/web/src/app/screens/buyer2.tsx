/*
 * App del comprador MYPE (2): membresía y planes, reporte de ahorro, comprobantes del mes, pagar la
 * membresía, seguimiento del envío, recibir y pagar el flete, calificar y perfil del transportista.
 * B-20, B-21, B-25, B-26, B-27, B-31 a B-34 y las pantallas de R2 (B-17, B-22, B-23).
 */
import { useState } from 'react';
import { reg } from './registry';
import { HelperBanner } from './r2';
import { useApp, type AppCtx } from '../ctx';
import { Screen, Btn, Icon, Field, Inp, Card, Chip, ChipBtn, Seg, Kv, Av, ICirc, Empty, Note, SheetBody, Tile, Prog, Stat, Stars, Photo, PhotoPick, Timeline, Tog, type TlStep } from '../ui/kit';
import { MapSketch } from '../ui/map';
import { product } from '@mesagri/shared/catalog';
import { monthPurchases, carrierStats, orgStats } from '@mesagri/shared/queries';
import { r2, PLAN_ORDER, TAXDOC_LABEL } from '@mesagri/shared/rules';
import { money, moneyShort, kg as fkg, dateShort, hhmm, relDay, ago, pct, dateNum, numTrim } from '@mesagri/shared/format';
import { periodOf, periodLabel, prevPeriod, startOfDay, lima, DAY, HOUR, DOW_LONG } from '@mesagri/shared/time';
import { uid } from '@mesagri/shared/ids';
import { orgName, userOfOrg, levelChip, PAY_LABEL, itemsShort, shipStatusText, shipProgress, kgOf, sacos } from '../helpers';
import { placeLabel, districtName } from '@mesagri/shared/ubigeo';
import { docPdf } from '../pdf';
import { saveFile, SAVE_UNAVAILABLE, callPhone } from '../platform';
import { PrefsSheet, PrivacySheet } from './common';
import { MESAGRI_YAPE } from './farmer2';
import type { Org, Shipment, SubOrder, World, PayMethod } from '@mesagri/shared/types';

type Plan = 'BASICO' | 'PRO' | 'EMPRESA';
const isPro = (o?: Org) => !!o?.subscription && PLAN_ORDER.indexOf(o.subscription.plan) >= PLAN_ORDER.indexOf('PRO');
const maskPhone = (n: string) => n.replace(/\D/g, '').replace(/^(\d)\d{2}(\d)?\d*(\d{3})$/, '$1•• ••• $3');
const personInitials = (name?: string) => (name ?? '··').split(' ').slice(0, 2).map(x => x[0]).join('');

/* ---------- B-20 · Membresía, planes y cuenta ---------- */
function Membership() {
  const A = useApp();
  const org = A.org!, me = A.me!, w = A.w;
  const sub = org.subscription;
  const s = w.settings;
  const month = monthPurchases(w, org.id, A.now);
  const lc = levelChip(org);
  const item = (icon: string, title: string, sub2: string, onClick: () => void, tone = '') => (
    <button className="li" onClick={onClick}><ICirc n={icon} tone={tone} /><div className="grow"><b className="bodym">{title}</b><div className="cap">{sub2}</div></div><Icon n="chevron-right" s="1.1em" /></button>
  );
  const cap = sub ? s.plans[sub.plan].purchaseCap : null;
  const near = cap ? month / cap : 0;
  const suggest: Plan | undefined = sub && sub.plan === 'BASICO' && near >= 0.6 ? 'PRO' : sub && sub.plan === 'PRO' && near >= 0.8 ? 'EMPRESA' : undefined;
  const statusLine = !sub ? '' : sub.status === 'TRIAL' ? `Mes gratis hasta el ${dateShort(sub.trialEndsOn)}` : sub.status === 'ACTIVE' ? `Pagado hasta el ${dateShort(sub.paidUntil)}` : sub.status === 'GRACE' ? `Venció: paga hasta el ${dateShort(sub.graceUntil!)}` : 'Sin membresía: no puedes confirmar pedidos';
  return (
    <Screen bar={
      <header className="bar home" style={{ alignItems: "center" }}>
        <Av org={org} size="lg" />
        <div className="tt"><h1>{org.name}</h1><p>{({ RESTAURANTE: 'Restaurante', HOTEL: 'Hotel', BODEGA: 'Bodega', COMEDOR: 'Comedor' } as any)[org.businessType ?? 'RESTAURANTE']} · {placeLabel(org.district)}</p><span className={'chip ' + (lc.tone || 'leaf')} style={{ marginTop: ".35em" }}><Icon n="shield-check" s="1.1em" />{lc.label}</span></div>
      </header>
    }>
      <div className="stack">
        <HelperBanner />
        {sub && (
          <>
            <div className="sect">Tu membresía</div>
            <Card tone={near >= 0.8 ? 'warn' : 'soft'}>
              <div className="row between wrap"><b className="bodym">Este mes compraste</b><span className="bodym"><b>{money(month)}</b>{cap ? ` de ${moneyShort(cap)}` : ' · sin tope'}</span></div>
              {cap && <div className="mt"><Prog v={month / cap} tone={near >= 0.8 ? 'terra' : ''} /></div>}
              <div className="cap mt" style={{ color: "inherit" }}>{cap && near >= 0.8 ? `Te falta poco para el límite del ${s.plans[sub.plan].name}.` : statusLine}</div>
            </Card>
            {(['BASICO', 'PRO', 'EMPRESA'] as Plan[]).map(p => {
              const d = s.plans[p];
              const mine = sub.plan === p;
              return (
                <div key={p} className={'card' + (mine && suggest !== p ? ' sel' : '')} style={suggest === p ? { boxShadow: "none", border: "2.5px solid var(--terra)" } : undefined}>
                  <div className="row between top"><div className="row g8 wrap"><b className="h3">{d.name}</b>{mine && <Chip tone="leaf">Tu plan</Chip>}{suggest === p && <Chip tone="terra">Te conviene</Chip>}</div><span className="price nowrap">{money(d.price).replace(',00', '')}<span className="cap" style={{ fontWeight: "700" }}> /mes</span></span></div>
                  <div className="cap">{p === 'BASICO' ? 'Para empezar' : p === 'PRO' ? 'Para negocios que crecen' : 'Hoteles y cadenas'}</div>
                  <div className="stack tight mt">{d.features.map(f => <div key={f} className="row top g8"><Icon n="check" s="1.05em" /><span className="bodym" style={{ fontSize: ".86em" }}>{f}</span></div>)}</div>
                </div>
              );
            })}
            {sub.plan !== 'EMPRESA' && <Btn full onClick={() => A.sheet(<UpgradeSheet to={suggest ?? (sub.plan === 'BASICO' ? 'PRO' : 'EMPRESA')} />)}>Pasar a {s.plans[suggest ?? (sub.plan === 'BASICO' ? 'PRO' : 'EMPRESA')].name}</Btn>}
            <p className="cap center" style={{ margin: "0" }}>Precios con IGV. El primer mes es gratis. Si no renuevas, conservas tu historial. Bajas de plan solo tras {s.membership.downgradeMonths} meses debajo del límite (RN-38).</p>
          </>
        )}
        <Card><div className="list">
          {item('credit-card', 'Pagar la membresía', statusLine, () => A.go('B-26'), sub?.status === 'GRACE' || sub?.status === 'INACTIVE' ? 'terra' : '')}
          {item('shield-check', 'Verificación del negocio', `${lc.label} · topes de compra`, () => A.go('B-04'))}
          {item('file-text', 'Comprobantes del mes', isPro(org) ? 'Todo junto para tu contador' : 'Lista del mes · descarga con Pro', () => A.go('B-25'))}
          {item('map-pin', 'Dirección de entrega', `${org.address ?? '—'} · recibe ${org.receiver ?? '—'}`, () => A.sheet(<AddressSheet />))}
          {item('heart', 'Mis favoritos', `${(w.favorites[org.id]?.sellers.length ?? 0)} agricultores · ${(w.favorites[org.id]?.carriers.length ?? 0)} transportistas`, () => A.sheet(<FavoritesSheet />))}
        </div></Card>
        <Card><div className="list">
          {item('clipboard-list', 'Solicitudes de compra', (() => { const open = Object.values(w.requests).filter(r => r.buyerOrgId === org.id && r.status === 'OPEN'); const n = open.reduce((a, r) => a + r.offers.filter(o => o.status === 'SENT').length, 0); return open.length ? `${open.length} abiertas · ${n} ${n === 1 ? 'oferta' : 'ofertas'} por ver` : 'Pides y los agricultores te ofrecen su precio'; })(), () => A.go('B-17'))}
          {item('repeat', 'Pedidos programados', isPro(org) ? (() => { const p = Object.values(w.schedules).filter(x => x.buyerOrgId === org.id && x.draft?.status === 'PENDING').length; return p ? `${p} por aprobar` : 'Se arman solos y tú los apruebas'; })() : 'Plan Pro · se arman solos y tú los apruebas', () => A.go('B-22'), Object.values(w.schedules).some(x => x.buyerOrgId === org.id && x.draft?.status === 'PENDING') ? 'terra' : '')}
          {item('users', 'Equipo y locales', `${1 + (org.members ?? []).filter(m => m.kind === 'EQUIPO').length} usuarios · ${(org.locales ?? []).length || 1} ${((org.locales ?? []).length || 1) === 1 ? 'local' : 'locales'}`, () => A.go('B-23'))}
        </div></Card>
        <Card><div className="list">
          {item('globe', 'Idioma y letra', `Castellano · letra ${me.prefs.textScale > 1.1 ? 'grande' : 'normal'}`, () => A.sheet(<PrefsSheet />))}
          {item('message-circle', 'Mensajes', 'Conversaciones por pedido', () => A.go('A-18'))}
          {item('lock', 'Privacidad y mis datos', 'Descargar o borrar mis datos', () => A.sheet(<PrivacySheet />))}
          {item('circle-question-mark', 'Ayuda', 'Preguntas, WhatsApp y libro de reclamaciones', () => A.go('A-19'))}
          {item('log-out', 'Cerrar sesión', me.phone.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3'), () => A.logout(), 'terra')}
        </div></Card>
      </div>
    </Screen>
  );
}

function UpgradeSheet({ to }: { to: Plan }) {
  const A = useApp();
  const sub = A.org!.subscription!;
  const s = A.w.settings;
  const trial = sub.status === 'TRIAL';
  const diff = r2(s.plans[to].price - s.plans[sub.plan].price);
  const [op, setOp] = useState('');
  return (
    <SheetBody title={`Pasar a ${s.plans[to].name}`} sub={trial ? `Estás en tu mes gratis: el cambio no cuesta nada hasta el ${dateShort(sub.trialEndsOn)}.` : `Este mes pagas solo la diferencia: ${money(diff)}. Luego, ${money(s.plans[to].price)} al mes.`}>
      <Card tone="soft"><div className="stack tight">{s.plans[to].features.map(f => <div key={f} className="row top g8"><Icon n="check" s="1.05em" /><span className="bodym">{f}</span></div>)}</div></Card>
      {!trial && <>
        <Card><Kv rows={[['Yape a', `Mesagri S.A.C. · ${MESAGRI_YAPE} (ejemplo)`], ['Monto', money(diff)]]} /></Card>
        <Field label="N.º de operación"><Inp value={op} onInput={(v) => setOp(v.replace(/\D/g, ''))} mode="numeric" placeholder="05123987" label="Número de operación" /></Field>
      </>}
      <Btn full onClick={() => { if (A.act('SUB_UPGRADE', { plan: to, method: 'YAPE', operation: op }, { ok: `Ya tienes el plan ${s.plans[to].name}.` }).ok) A.sheet(null); }}>{trial ? `Pasar a ${s.plans[to].name} sin costo` : `Pagar ${money(diff)} y pasar a ${s.plans[to].name}`}</Btn>
    </SheetBody>
  );
}

function AddressSheet() {
  const A = useApp();
  const org = A.org!;
  const [address, setAddress] = useState(org.address ?? '');
  const [receiver, setReceiver] = useState(org.receiver ?? '');
  return (
    <SheetBody title="Dirección de entrega" sub={`${org.name} · ${districtName(org.district)}`}>
      <Field label="Dirección"><Inp value={address} onInput={setAddress} label="Dirección" /></Field>
      <Field label="Quién recibe"><Inp value={receiver} onInput={setReceiver} label="Quién recibe" /></Field>
      <Btn full kind="dark" onClick={() => { if (A.act('ORG_UPDATE', { orgId: org.id, address, receiver }, { ok: 'Dirección guardada.' }).ok) A.sheet(null); }}>Guardar</Btn>
    </SheetBody>
  );
}

function FavoritesSheet() {
  const A = useApp();
  const f = A.w.favorites[A.org!.id] ?? { listings: [], sellers: [], carriers: [] };
  return (
    <SheetBody title="Mis favoritos" sub="A tus transportistas favoritos les ofrecemos primero tus envíos (RN-56).">
      {f.sellers.length + f.carriers.length === 0 && <Empty icon="heart" title="Todavía no tienes favoritos" text="Agrégalos desde el perfil de un agricultor o al calificar un envío." />}
      {f.sellers.map(id => <button key={id} className="card line" onClick={() => { A.sheet(null); A.go('B-08', { id }); }}><div className="row"><Av org={A.w.orgs[id]} /><div className="grow"><b className="bodym">{orgName(A.w, id)}</b><div className="cap">Agricultor · {placeLabel(A.w.orgs[id]?.district)}</div></div><Icon n="chevron-right" s="1.1em" /></div></button>)}
      {f.carriers.map(id => <button key={id} className="card line" onClick={() => { A.sheet(null); A.go('B-34', { id }); }}><div className="row"><span className="av" style={{ background: "#1E3F20" }}>{personInitials(userOfOrg(A.w, id)?.name)}</span><div className="grow"><b className="bodym">{userOfOrg(A.w, id)?.name ?? orgName(A.w, id)}</b><div className="cap">Transportista · {A.w.orgs[id]?.carrier?.vehicle.plate}</div></div><Icon n="chevron-right" s="1.1em" /></div></button>)}
    </SheetBody>
  );
}

/* ---------- B-21 · Reporte de ahorro ---------- */
export function savingsOf(w: World, orgId: string, period: string) {
  const subs = Object.values(w.subOrders).filter(s => s.buyerOrgId === orgId && s.status === 'COMPLETED' && periodOf(s.completedAt ?? s.deliveredAt ?? 0) === period);
  const byProduct = new Map<string, { kg: number; paid: number; saved: number }>();
  let spent = 0;
  for (const s of subs) for (const it of s.items) {
    const qty = it.acceptedQty ?? it.qty;
    const kgv = qty * it.unitKg;
    const perKg = it.unitKg ? it.price / it.unitKg : it.price;
    const saved = Math.max(0, (product(it.productId).ref.mayorista - perKg) * kgv);
    const cur = byProduct.get(it.productId) ?? { kg: 0, paid: 0, saved: 0 };
    cur.kg += kgv; cur.paid += qty * it.price; cur.saved += saved;
    byProduct.set(it.productId, cur);
    spent += qty * it.price;
  }
  const rows = [...byProduct.entries()].map(([pid, v]) => ({ pid, ...v, saved: r2(v.saved) })).sort((a, b) => b.saved - a.saved);
  const days = new Set(subs.map(s => startOfDay(s.deliveredAt ?? s.completedAt ?? 0))).size;
  return { subs, rows, total: r2(rows.reduce((a, r) => a + r.saved, 0)), spent: r2(spent), sellers: new Set(subs.map(s => s.sellerOrgId)).size, trips: days };
}
function Savings() {
  const A = useApp();
  const org = A.org!, w = A.w;
  const cur = periodOf(A.now), prev = prevPeriod(cur);
  const [period, setPeriod] = useState(() => savingsOf(w, org.id, cur).subs.length ? cur : prev);
  const r = savingsOf(w, org.id, period);
  const pro = isPro(org);
  const plan = org.subscription ? w.settings.plans[org.subscription.plan] : undefined;
  const max = Math.max(1, ...r.rows.map(x => x.saved));
  const download = async () => {
    const lines = [['Producto', 'Kilos', 'Pagaste (S/)', 'Mayorista de referencia (S/ por kg)', 'Ahorro (S/)'], ...r.rows.map(x => [product(x.pid).name, numTrim(x.kg, 1), x.paid.toFixed(2).replace('.', ','), product(x.pid).ref.mayorista.toFixed(2).replace('.', ','), x.saved.toFixed(2).replace('.', ',')]), ['Total', '', r.spent.toFixed(2).replace('.', ','), '', r.total.toFixed(2).replace('.', ',')]];
    const csv = '﻿' + lines.map(l => l.map(c => /[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(';')).join('\r\n');
    const res = await saveFile(`ahorro-${org.name.replace(/\W+/g, '-').toLowerCase()}-${period}.csv`, new Blob([csv], { type: 'text/csv' }));
    if (res === 'error' || res === 'unavailable') A.toast(res === 'unavailable' ? SAVE_UNAVAILABLE : 'No pudimos descargar el archivo.', 'err');
  };
  return (
    <Screen title="Reportes" sub={periodLabel(period)} back={false} right={pro ? <span className="chip terra" style={{ fontSize: ".7em" }}>PRO</span> : undefined}>
      <div className="stack">
        <Seg value={period} onChange={setPeriod} options={[{ v: prev, l: periodLabel(prev).split(' ')[0].replace(/^./, c => c.toUpperCase()) }, { v: cur, l: periodLabel(cur).split(' ')[0].replace(/^./, c => c.toUpperCase()) }]} />
        <Card tone="dark">
          <div className="cap b" style={{ letterSpacing: ".1em", color: "var(--leaf)" }}>AHORRASTE {period === cur ? 'ESTE MES' : 'EN ' + periodLabel(period).split(' ')[0].toUpperCase()}</div>
          <div className="display" style={{ fontSize: "2.4em", margin: ".1em 0" }}>{money(r.total).replace(',00', '')}</div>
          <div className="cap">frente al precio mayorista de referencia del Midagri</div>
          <div className="chips mt"><span className="chip" style={{ background: "rgba(255,255,255,.14)", color: "#fff" }}>Compraste {moneyShort(r.spent)}</span><span className="chip" style={{ background: "rgba(255,255,255,.14)", color: "#fff" }}>{r.sellers} {r.sellers === 1 ? 'agricultor' : 'agricultores'}</span></div>
        </Card>
        {r.rows.length === 0 && <Card><Empty icon="chart-column" title="Sin compras conformes en este mes" text="Cuando das tu conformidad, la compra entra al reporte." /></Card>}
        {pro ? (
          <>
            {r.rows.length > 0 && <Card>
              <b className="bodym">Ahorro por producto</b>
              <div className="stack tight mt">{r.rows.map(x => <div key={x.pid}><div className="row between"><span className="bodym">{product(x.pid).name}</span><b className="bodym">{money(x.saved)}</b></div><Prog v={x.saved / max} /><div className="cap">{fkg(x.kg)} · pagaste {money(x.paid)}</div></div>)}</div>
            </Card>}
            <div className="grid2">
              <Stat n={plan && r.total ? `${Math.floor(r.total / plan.price)} veces` : '—'} l={`Tu plan ${plan?.name ?? ''} se pagó`} />
              <Stat n={r.trips} l="Viajes al mercado evitados" />
            </div>
            <Btn full kind="dark" icon="download" onClick={download} disabled={!r.rows.length}>Descargar para Excel (CSV)</Btn>
          </>
        ) : (
          <Card tone="soft"><div className="row top"><Icon n="lock" /><div className="grow"><b className="bodym">El detalle por producto y la descarga son del plan Pro</b><div className="cap">Con Pro ves cuánto ahorras en cada producto, cuántos viajes al mercado te evitas y lo descargas para tu contador.</div><Btn sm kind="primary" cls="mt" onClick={() => A.sheet(<UpgradeSheet to="PRO" />)}>Pasar a Pro</Btn></div></div></Card>
        )}
        <Btn full kind="sec" icon="file-text" onClick={() => A.go('B-25', { period })}>Comprobantes del mes</Btn>
        <p className="cap center" style={{ margin: "0" }}>El ahorro compara lo que pagaste por kilo con el precio mayorista de referencia de cada producto (Midagri o valor de ejemplo).</p>
      </div>
    </Screen>
  );
}

/* ---------- B-25 · Comprobantes del mes ---------- */
function Receipts() {
  const A = useApp();
  const org = A.org!, w = A.w;
  const cur = periodOf(A.now);
  const [period, setPeriod] = useState<string>(A.top.p?.period ?? (Object.values(w.subOrders).some(s => s.buyerOrgId === org.id && s.status === 'COMPLETED' && periodOf(s.completedAt ?? 0) === cur) ? cur : prevPeriod(cur)));
  const subs = Object.values(w.subOrders).filter(s => s.buyerOrgId === org.id && s.status === 'COMPLETED' && periodOf(s.completedAt ?? 0) === period).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  const invs = Object.values(w.invoices).filter(i => i.orgId === org.id && i.period === period && i.status !== 'VOID');
  const missing = subs.filter(s => !s.taxDocNumber);
  const total = r2(subs.reduce((a, s) => a + s.total, 0));
  const pro = isPro(org);
  const download = async () => {
    const bytes = docPdf({
      kicker: 'Comprobantes del mes', badge: periodLabel(period), title: `Compras de ${periodLabel(period)}`, subtitle: `${org.legalName ?? org.name}${org.ruc ? ` · RUC ${org.ruc}` : ''}`,
      rows: [['Comprobantes', String(subs.length + invs.length)], ['Compras del mes', money(total)], ['Sin comprobante adjunto', String(missing.length)]],
      table: { cols: ['Fecha', 'Comprobante', 'Proveedor', 'Monto'], align: ['left', 'left', 'left', 'right'], rows: [...subs.map(s => [dateNum(s.completedAt ?? s.createdAt), `${TAXDOC_LABEL[s.taxDoc]} ${s.taxDocNumber ?? '(pendiente)'}`, orgName(w, s.sellerOrgId), money(s.total)]), ...invs.map(i => [dateNum(i.issuedAt), `Factura ${i.receiptNumber ?? '(por emitir)'}`, 'Mesagri S.A.C. · membresía', money(i.amount)])], total: ['Total', money(r2(total + invs.reduce((a, i) => a + i.amount, 0)))] },
      notes: ['Mesagri ordena los comprobantes que emiten tus proveedores; no los emite por ellos.', 'Las liquidaciones de compra las emite tu negocio en la SUNAT cuando el agricultor no tiene RUC (RN-34).'],
    });
    const r = await saveFile(`comprobantes-${period}.pdf`, bytes);
    if (r === 'error' || r === 'unavailable') A.toast(r === 'unavailable' ? SAVE_UNAVAILABLE : 'No pudimos descargar el PDF.', 'err');
  };
  return (
    <Screen title="Comprobantes" sub={periodLabel(period)} right={pro ? <span className="chip terra" style={{ fontSize: ".7em" }}>PRO</span> : undefined}
      foot={<Btn full kind="dark" icon={pro ? 'download' : 'lock'} onClick={() => pro ? download() : A.sheet(<UpgradeSheet to="PRO" />)}>{pro ? 'Descargar todo para tu contador' : 'Descargar todo: plan Pro'}</Btn>}>
      <div className="stack">
        <Seg value={period} onChange={setPeriod} options={[{ v: prevPeriod(cur), l: periodLabel(prevPeriod(cur)).split(' ')[0].replace(/^./, c => c.toUpperCase()) }, { v: cur, l: periodLabel(cur).split(' ')[0].replace(/^./, c => c.toUpperCase()) }]} />
        <div className="grid2"><Stat n={subs.length + invs.length} l="comprobantes" /><Stat n={moneyShort(total)} l="compras del mes" /></div>
        {missing.length > 0 && <Note icon="triangle-alert" tone="warn">{missing.length} {missing.length === 1 ? 'pedido sin comprobante adjunto' : 'pedidos sin comprobante adjunto'}</Note>}
        <Card>
          {subs.length + invs.length === 0 ? <Empty icon="file-text" title="Sin comprobantes este mes" /> : (
            <div className="list">
              {subs.map(s => (
                <button key={s.id} className="li" onClick={() => A.go('B-14', { id: s.id })}>
                  <ICirc n="file-text" tone={s.taxDocNumber ? '' : 'terra'} />
                  <div className="grow"><b className="bodym">{TAXDOC_LABEL[s.taxDoc]} {s.taxDocNumber ?? ''}</b><div className="cap">{orgName(w, s.sellerOrgId)} · {itemsShort(s).toLowerCase()}{!s.taxDocNumber && s.taxDoc === 'LIQUIDACION' ? ' · emítela en la SUNAT' : ''}</div></div>
                  <div className="right"><b className="bodym">{money(s.total)}</b><div><Chip tone={s.taxDocNumber ? 'line' : 'warn'}>{s.taxDocNumber ? (s.taxDoc === 'FACTURA' ? 'XML y PDF' : 'PDF') : 'Pendiente'}</Chip></div></div>
                </button>
              ))}
              {invs.map(i => (
                <div key={i.id} className="li">
                  <ICirc n="receipt" tone="terra" />
                  <div className="grow"><b className="bodym">Factura {i.receiptNumber ?? ''}</b><div className="cap">Mesagri · {i.concept.toLowerCase()}</div></div>
                  <div className="right"><b className="bodym">{money(i.amount)}</b><div><Chip tone="line">{i.status === 'ISSUED' ? 'Por pagar' : 'XML y PDF'}</Chip></div></div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <p className="cap center" style={{ margin: "0" }}>Mesagri ordena los comprobantes que emiten tus proveedores; no los emite por ellos.</p>
      </div>
    </Screen>
  );
}

/* ---------- B-26 · Pagar la membresía ---------- */
function PayMembership() {
  const A = useApp();
  const org = A.org!;
  const sub = org.subscription;
  const [method, setMethod] = useState<PayMethod>('YAPE');
  const [op, setOp] = useState('');
  if (!sub) return <Screen title="Pagar membresía"><Empty title="Tu cuenta no tiene membresía" /></Screen>;
  const plan = A.w.settings.plans[sub.plan];
  const period = periodOf(sub.paidUntil);
  const graceEnd = sub.graceUntil ?? sub.paidUntil + A.w.settings.membership.graceDays * DAY;
  const chip = sub.status === 'TRIAL' ? `Gratis hasta el ${dateShort(sub.trialEndsOn)}` : sub.status === 'ACTIVE' ? `Pagado hasta el ${dateShort(sub.paidUntil)}` : sub.status === 'GRACE' ? `Paga hasta el ${dateShort(graceEnd)}` : 'Sin membresía';
  const pay = () => {
    const r = A.act('SUB_PAY', { method, operation: method === 'CARD' ? '' : op }, { ok: `Membresía pagada: plan ${plan.name} activo.` });
    if (r.ok) A.back();
  };
  return (
    <Screen title="Pagar membresía" sub={org.name} foot={<><Btn full onClick={pay}>Pagar {money(plan.price)}</Btn><div className="why">Si no pagas hasta el {dateShort(graceEnd)}, tu cuenta queda sin membresía: no puedes comprar, pero conservas tu historial (RN-35).</div></>}>
      <div className="stack">
        <Card tone="dark">
          <div className="row between wrap"><span className="cap b" style={{ letterSpacing: ".1em", color: "var(--leaf)" }}>PLAN {plan.name.toUpperCase()} · {periodLabel(period).toUpperCase()}</span><span className={'chip ' + (sub.status === 'GRACE' || sub.status === 'INACTIVE' ? 'warn' : 'leaf')}>{chip}</span></div>
          <div className="display" style={{ fontSize: "2.2em", margin: ".1em 0" }}>{money(plan.price)}</div>
          <div className="cap">Con IGV. {sub.status === 'GRACE' ? `Venció el ${dateShort(sub.paidUntil)}: tienes ${A.w.settings.membership.graceDays} días de gracia.` : sub.status === 'TRIAL' ? 'Pagar ahora no te quita el mes gratis: el pago cubre el mes siguiente.' : sub.status === 'ACTIVE' ? 'Pagas por adelantado el mes siguiente.' : 'Al pagar vuelves a comprar al instante.'}</div>
        </Card>
        <div className="sect">Medio de pago</div>
        {([['YAPE', 'Yape', `A Mesagri S.A.C. · ${MESAGRI_YAPE} (ejemplo)`], ['TRANSFER', 'Transferencia', 'CCI 002 215 000000000000 01 (ejemplo)'], ['CARD', 'Tarjeta', 'En el piloto se paga en la pasarela del banco; aquí se simula sin pedir datos de tarjeta']] as [PayMethod, string, string][]).map(([m, t, d]) => (
          <div key={m} className={'card ' + (method === m ? 'sel' : 'line')} role="radio" aria-checked={method === m ? 'true' : 'false'} tabIndex={0} style={{ cursor: "pointer" }} onClick={() => setMethod(m)} onKeyDown={(e: any) => { if (e.key === 'Enter' || e.key === ' ') setMethod(m); }}>
            <div className="row"><span className={'radio' + (method === m ? ' on' : '')} /><div className="grow"><b className="bodym">{t}</b><div className="cap">{d}</div></div></div>
          </div>
        ))}
        {method !== 'CARD' && <Field label="N.º de operación"><Inp value={op} onInput={(v) => setOp(v.replace(/\D/g, ''))} mode="numeric" placeholder="05123987" label="Número de operación" /></Field>}
        <Card><Kv rows={[['Factura a', `${org.legalName ?? org.name}${org.ruc ? ` · RUC ${org.ruc}` : ''}`], ['Comprobante', 'Factura electrónica de Mesagri'], ['Renovación', method === 'CARD' ? 'Automática cada mes' : 'Pagas cada mes desde tu celular']]} /></Card>
        {sub.history.length > 0 && <Card><b className="bodym">Historial</b><div className="stack tight mt">{sub.history.slice(-4).reverse().map((h, i) => <div key={i} className="row top g8"><Icon n="circle-dot" s="1em" /><div className="grow"><span className="bodym" style={{ fontSize: ".86em" }}>{h.text}</span><div className="cap">{dateShort(h.at)}</div></div></div>)}</div></Card>}
        <Note icon="shield-check">Mesagri nunca te pedirá tu clave del banco ni de Yape.</Note>
      </div>
    </Screen>
  );
}

/* ---------- B-31 · Seguimiento del envío ---------- */
function carrierPerson(w: World, orgId?: string) {
  const u = userOfOrg(w, orgId);
  const o = orgId ? w.orgs[orgId] : undefined;
  return { u, o, short: u?.shortName ?? o?.name ?? 'El transportista', full: u?.name ?? o?.name ?? '' };
}
function shipTimeline(sh: Shipment, w: World, now: number) {
  const ev = (k: string) => sh.events.find(e => e.kind === k);
  const c = carrierPerson(w, sh.carrierOrgId);
  const assigned = ev('ASSIGNED');
  const done = ['DELIVERED', 'CLOSED'].includes(sh.status);
  return [
    { t: assigned ? `${c.short} aceptó el envío` : sh.status === 'NO_CARRIER' ? 'Nadie aceptó todavía' : 'Buscando transportista', s: assigned ? `${relDay(assigned.at, now)} · ${hhmm(assigned.at)}` : sh.status === 'OFFERING' ? 'Le ofrecemos a los verificados de la ruta' : '', state: assigned ? 'done' : sh.status === 'NO_CARRIER' ? 'fail' : 'cur' },
    { t: `Recogió en ${districtName(w.orgs[sh.sellerOrgId]?.district)}`, s: sh.pickup ? `${hhmm(sh.pickup.at)} · ${sacos(sh.pickup.sacks)} · ${fkg(sh.pickup.kg)} · con fotos` : `Recojo ${relDay(sh.pickupAt, now)} · ${hhmm(sh.pickupAt)}`, state: sh.pickup ? 'done' : assigned ? 'cur' : 'pend' },
    { t: sh.status === 'ARRIVED' ? 'Llegó a tu local' : 'En camino', s: `Llega entre ${hhmm(sh.deliverFrom)} y ${hhmm(sh.deliverTo)}`, state: done || sh.status === 'ARRIVED' ? 'done' : sh.status === 'PICKED_UP' ? 'cur' : 'pend' },
    { t: 'Entrega con tu código', s: done && sh.delivery ? `${hhmm(sh.delivery.at)} · flete pagado: ${money(sh.freight)}` : `Pagas el flete: ${money(sh.freight)}`, state: done ? 'done' : sh.status === 'ARRIVED' ? 'cur' : 'pend' },
  ] as TlStep[];
}
function ShipTrack() {
  const A = useApp();
  const sh = A.w.shipments[A.top.p?.id as string];
  if (!sh) return <Screen title="Envío"><Empty title="No encontramos el envío" /></Screen>;
  const s = A.w.subOrders[sh.subOrderId];
  const c = carrierPerson(A.w, sh.carrierOrgId);
  const cs = sh.carrierOrgId ? carrierStats(A.w, sh.carrierOrgId) : undefined;
  const st = shipStatusText(sh);
  const seller = A.w.orgs[sh.sellerOrgId];
  if (sh.status === 'NO_CARRIER') return <NoCarrier sh={sh} />;
  const showCode = s && !['DELIVERED', 'CLOSED', 'CANCELLED'].includes(sh.status) && sh.carrierOrgId;
  const foot = ['PICKED_UP', 'ARRIVED'].includes(sh.status) ? <Btn full onClick={() => A.go('B-32', { id: sh.id })}>{sh.status === 'ARRIVED' ? `${c.short} llegó: recibir y pagar el flete` : 'Recibir y pagar el flete'}</Btn>
    : ['DELIVERED', 'CLOSED'].includes(sh.status) && !sh.rating ? <Btn full onClick={() => A.go('B-33', { id: sh.id })}>Califica a {c.short}</Btn>
    : s?.status === 'DELIVERED' ? <Btn full kind="dark" onClick={() => A.go('B-15', { id: s.id })}>Revisa el producto y da tu conformidad</Btn> : undefined;
  return (
    <Screen title={`Envío ${sh.code}`} sub={`Pedido ${s?.code ?? ''} · ${s ? itemsShort(s).toLowerCase() : ''}`} foot={foot}>
      <div className="stack">
        <MapSketch from={seller?.district} to={sh.destLabel} progress={shipProgress(sh, A.now)} km={sh.distanceKm} fromLabel={districtName(seller?.district)} toLabel="Tu local" height="11em" />
        {sh.carrierOrgId ? (
          <Card><div className="row"><span className="av" style={{ background: "#1E3F20" }}>{personInitials(c.full)}</span><div className="grow"><button className="linkbtn" style={{ padding: "0", minHeight: "0", textDecoration: "none", color: "var(--ink)" }} onClick={() => A.go('B-34', { id: sh.carrierOrgId })}><b className="bodym">{c.full}</b></button><div className="cap">{c.o?.carrier?.vehicle.plate} · {c.o?.carrier?.level} · {cs?.rating ? `${String(cs.rating).replace('.', ',')} estrellas` : 'nuevo'}</div></div>
            <button className="iconbtn" aria-label={`Llamar a ${c.short}`} onClick={() => { if (!callPhone(c.u?.phone)) A.toast(`No tenemos el número de ${c.short}: escríbele por el chat del pedido.`, 'warn'); }}><Icon n="phone" s="1.1em" /></button>
            {s && <button className="iconbtn" aria-label={`Escribir a ${c.short}`} onClick={() => A.go('CHAT', { id: s.id })}><Icon n="send" s="1.1em" /></button>}
          </div></Card>
        ) : <Note icon="clock" tone="warn">{sh.status === 'WAITING_FARMER' ? `Buscamos transportista cuando ${seller?.name.split(' ')[0]} acepte el pedido.` : sh.status === 'CANCELLED' ? `Envío cancelado: ${sh.cancelReason ?? ''}` : `Le ofrecemos el envío a los transportistas verificados de la ruta${sh.offers.length ? ` (van ${sh.offers.length})` : ''}. Si nadie acepta en ${A.w.settings.carrier.noCarrierHours} horas, eliges otra opción sin costo.`}</Note>}
        <Card><Timeline steps={shipTimeline(sh, A.w, A.now)} /></Card>
        {showCode && s && <Card tone="dark"><div className="row between"><div><div className="cap">Código de entrega</div><div className="code mt">{s.deliveryCode.split('').map((d, i) => <span key={i}>{d}</span>)}</div></div><Icon n="lock" s="1.6em" /></div><div className="cap mt">Díctaselo a {c.short} solo cuando tengas los sacos contados.</div></Card>}
        {sh.incidents.length > 0 && <Card tone="warn"><b className="bodym">Avisos en ruta</b>{sh.incidents.slice(-3).map(i => <div key={i.id} className="cap mt" style={{ color: "inherit" }}>{hhmm(i.at)} · {i.kind}{i.newEta ? ` · nueva hora ${i.newEta}` : ''}{i.text ? ` · ${i.text}` : ''}</div>)}</Card>}
        {sh.claim && <Note icon="triangle-alert" tone={sh.claim.status === 'RESOLVED' ? 'soft' : 'warn'}>Reclamo: {sh.claim.kind} · {sh.claim.text}{sh.claim.response ? ` · Descargo: ${sh.claim.response}` : ''}{sh.claim.resolution ? ` · Resuelto: ${sh.claim.resolution}` : ' · Soporte lo revisa'}</Note>}
        <Card><Kv rows={[['Flete', `${money(sh.freight)} · lo pagas al recibir`], ['Carga', `${sacos(sh.sacks)} · ${fkg(sh.weightKg)}`], ['Ruta', `${districtName(seller?.district)} → ${districtName(sh.destLabel)} · ${sh.distanceKm} km`], ['Estado', st.label]]} /></Card>
        {['WAITING_FARMER', 'OFFERING', 'ASSIGNED', 'GOING_TO_PICKUP'].includes(sh.status) && <button className="linkbtn" style={{ alignSelf: "center" }} onClick={() => A.sheet(<SwitchSheet id={sh.id} />)}>Cambiar cómo lo recibo</button>}
        {['DELIVERED', 'CLOSED'].includes(sh.status) && !sh.claim && sh.delivery && A.now < sh.delivery.at + A.w.settings.claimHours * HOUR && <button className="linkbtn" style={{ alignSelf: "center", color: "var(--danger)" }} onClick={() => A.sheet(<ClaimSheet id={sh.id} />)}>Reclamar por el envío ({Math.max(1, Math.round((sh.delivery.at + A.w.settings.claimHours * HOUR - A.now) / HOUR))} h)</button>}
      </div>
    </Screen>
  );
}

function SwitchSheet({ id }: { id: string }) {
  const A = useApp();
  const sh = A.w.shipments[id];
  const s = A.w.subOrders[sh.subOrderId];
  const seller = A.w.orgs[sh.sellerOrgId];
  const serves = !!seller?.serviceAreas.find(a => a.district === s?.district);
  const ff = sh.status === 'GOING_TO_PICKUP' ? r2(sh.freight * A.w.settings.carrier.falseFreight) : 0;
  const go = (mode: 'PICKUP' | 'FARMER') => { if (A.act('SHIP_SWITCH_MODE', { shipmentId: id, mode }, { ok: mode === 'PICKUP' ? 'Listo: recogerás por tu cuenta.' : `Listo: lo lleva ${seller?.name.split(' ')[0]}.` }).ok) { A.sheet(null); A.back(); } };
  return (
    <SheetBody title="Cambiar cómo lo recibo" sub={ff ? `${carrierPerson(A.w, sh.carrierOrgId).short} ya salió a recoger: pagas el 30 % del flete (${money(ff)}, RN-61).` : 'Sin costo: el transportista todavía no sale a recoger.'}>
      <Btn full kind="sec" icon="hand-coins" onClick={() => go('PICKUP')}>Recojo yo</Btn>
      <Btn full kind="sec" icon="sprout" disabled={!serves} why={!serves ? `${seller?.name.split(' ')[0]} no reparte en tu distrito (RN-27)` : undefined} onClick={() => go('FARMER')}>Envío del agricultor</Btn>
    </SheetBody>
  );
}

function ClaimSheet({ id }: { id: string }) {
  const A = useApp();
  const [kind, setKind] = useState('Faltan kilos');
  const [kgLost, setKgLost] = useState('');
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<string | undefined>();
  return (
    <SheetBody title="Reclamar por el envío" sub="El transportista responde si la carga se pierde o se daña en el camino (RN-59). Soporte media.">
      <div className="chips">{['Faltan kilos', 'Carga dañada o mojada', 'Faltan sacos', 'Otro'].map(k => <ChipBtn key={k} on={kind === k} onClick={() => setKind(k)}>{k}</ChipBtn>)}</div>
      <Field label="Kilos que faltan (si aplica)"><Inp value={kgLost} onInput={setKgLost} mode="decimal" suffix="kg" label="Kilos que faltan" /></Field>
      <Inp area value={text} onInput={setText} placeholder="Cuéntanos qué pasó" label="Qué pasó" />
      <PhotoPick value={photo} onChange={setPhoto} label="Foto (tu prueba)" kind="sacos" />
      <Btn full kind="danger" onClick={() => { if (A.act('SHIP_CLAIM', { shipmentId: id, kind, kgLost: Number(kgLost.replace(',', '.')) || 0, text, photoIds: photo ? [photo] : [] }, { ok: 'Enviamos tu reclamo: el transportista envía su descargo.' }).ok) A.sheet(null); }}>Enviar reclamo</Btn>
    </SheetBody>
  );
}

/* ---------- B-31 · Sin transportista ---------- */
function NoCarrier({ sh }: { sh: Shipment }) {
  const A = useApp();
  const s = A.w.subOrders[sh.subOrderId];
  const seller = A.w.orgs[sh.sellerOrgId];
  const serves = !!seller?.serviceAreas.find(a => a.district === s?.district);
  const route = A.w.settings.routes.find(r => r.id === sh.routeId);
  const days: number[] = [];
  const carriers = Object.values(A.w.orgs).filter(o => o.carrier?.routes.some(r => r.routeId === sh.routeId));
  const rdays = new Set<number>(); carriers.forEach(o => o.carrier!.routes.filter(r => r.routeId === sh.routeId).forEach(r => r.days.forEach(d => rdays.add(d))));
  for (let i = 1; days.length < 3 && i < 15; i++) { const t = startOfDay(A.now) + i * DAY; if (rdays.has(lima(t).dow)) days.push(t); }
  const [opt, setOpt] = useState<'AGAIN' | 'FARMER' | 'PICKUP'>('AGAIN');
  const [day, setDay] = useState<number>(days[0] ?? startOfDay(A.now) + DAY);
  const go = () => {
    const r = opt === 'AGAIN' ? A.act('SHIP_REOFFER', { shipmentId: sh.id, date: day }, { ok: 'Buscamos transportista para esa fecha.' }) : A.act('SHIP_SWITCH_MODE', { shipmentId: sh.id, mode: opt }, { ok: opt === 'PICKUP' ? 'Listo: recogerás por tu cuenta.' : `Listo: lo lleva ${seller?.name.split(' ')[0]}.` });
    if (r.ok && opt !== 'AGAIN') A.back();
  };
  const card = (v: typeof opt, icon: string, title: string, sub: string, price: string, ok = true, extra?: any) => (
    <div className={'card ' + (opt === v ? 'sel' : 'line')} role="radio" aria-checked={opt === v ? 'true' : 'false'} aria-disabled={ok ? undefined : 'true'} tabIndex={0} style={ok ? { cursor: "pointer" } : { opacity: ".55" }} onClick={() => ok && setOpt(v)}>
      <div className="row top"><span className={'icirc ' + (opt === v ? 'dark' : '')}><Icon n={icon} /></span><div className="grow"><div className="row between"><b className="bodym">{title}</b><b>{price}</b></div><div className="cap">{sub}</div>{opt === v && extra}</div></div>
    </div>
  );
  return (
    <Screen title={`Envío ${sh.code}`} sub="Sin transportista por ahora" foot={<><Btn full onClick={go}>Confirmar</Btn>{s && <Btn full kind="sec" onClick={async () => { if (await A.confirm({ title: '¿Cancelar el pedido?', text: 'Nadie aceptó el envío: cancelas sin costo y sin afectar tu reputación.', ok: 'Cancelar pedido', danger: true })) { if (A.act('SUBORDER_CANCEL', { subOrderId: s.id, reason: 'Sin transportista disponible' }, { ok: 'Pedido cancelado sin costo.' }).ok) A.back(); } }}>Cancelar el pedido sin costo</Btn>}</>}>
      <div className="stack">
        <Card tone="warn"><div className="row top"><Icon n="triangle-alert" /><div className="bodym"><b>Ningún transportista aceptó en {A.w.settings.carrier.noCarrierHours} horas.</b> No pagas nada por el intento. Tu pedido sigue reservado: elige cómo quieres recibirlo.</div></div></Card>
        {s && <Card><b className="bodym">{itemsShort(s)}</b><div className="cap">{seller?.name} · {districtName(seller?.district)} → {districtName(s.district)} · pedido {s.code}</div></Card>}
        {card('AGAIN', 'repeat', 'Buscar otra vez', `Para el ${days[0] ? dateShort(day) : 'día que elijas'}, día de ruta`, money(sh.freight), days.length > 0, <div className="chips mt">{days.map(d => <ChipBtn key={d} on={day === d} onClick={() => setDay(d)}>{dateShort(d)}</ChipBtn>)}</div>)}
        {card('FARMER', 'sprout', 'Envío del agricultor', serves ? `${seller?.name.split(' ')[0]} reparte en tu distrito` : `${seller?.name.split(' ')[0]} todavía no reparte en ${districtName(s?.district)}`, serves ? money(seller!.serviceAreas.find(a => a.district === s?.district)!.fee) : '—', serves)}
        {card('PICKUP', 'hand-coins', 'Recojo yo', `En el punto que indique ${seller?.name.split(' ')[0]}${seller?.pickupPoint ? ` (${seller.pickupPoint})` : ''}`, money(0))}
        <p className="cap center" style={{ margin: "0" }}>En la etapa inicial hay {carriers.length} transportistas en la ruta {route?.name ?? ''} ({[...rdays].sort().map(d => DOW_LONG[d]).join(', ')}).</p>
      </div>
    </Screen>
  );
}

/* ---------- B-32 · Recibir y pagar el flete ---------- */
function ReceiveFreight() {
  const A = useApp();
  const sh = A.w.shipments[A.top.p?.id as string];
  const [sacks, setSacks] = useState(sh ? String(sh.pickup?.sacks ?? sh.sacks) : '');
  const [kgv, setKg] = useState(sh ? String(sh.pickup?.kg ?? sh.weightKg).replace('.', ',') : '');
  const [ok, setOk] = useState<'OK' | 'FAIL'>('OK');
  const [ph, setPh] = useState<(string | undefined)[]>([undefined, undefined]);
  const [method, setMethod] = useState<PayMethod>('YAPE');
  if (!sh) return <Screen title="Recibir el envío"><Empty title="No encontramos el envío" /></Screen>;
  const s = A.w.subOrders[sh.subOrderId];
  const c = carrierPerson(A.w, sh.carrierOrgId);
  const acct = c.o?.payout.find(a => a.kind === 'YAPE') ?? c.o?.payout[0];
  const paid = !!sh.buyerPaid;
  const delivered = ['DELIVERED', 'CLOSED'].includes(sh.status);
  const base = sh.pickup?.kg ?? sh.weightKg;
  const kNum = Number(kgv.replace(',', '.')) || 0;
  const diff = base ? (kNum - base) / base : 0;
  const pay = () => { A.act('SHIP_BUYER_PAID', { shipmentId: sh.id, method }, { ok: `Avisamos a ${c.short} que le pagaste. Dicta tu código.` }); };
  return (
    <Screen title="¿Llegó todo bien?" sub={`${sh.code} · ${c.short}${sh.status === 'ARRIVED' ? ` llegó a las ${hhmm(sh.events.find(e => e.kind === 'ARRIVED')?.at ?? A.now)}` : ''}`}
      foot={delivered ? (s?.status === 'DELIVERED' ? <Btn full kind="dark" onClick={() => A.replace('B-15', { id: s.id })}>Da tu conformidad del producto</Btn> : !sh.rating ? <Btn full onClick={() => A.replace('B-33', { id: sh.id })}>Califica a {c.short}</Btn> : undefined)
        : paid ? undefined : <><Btn full kind="dark" onClick={pay}>Ya pagué: dar mi código</Btn><Btn full kind="sec" onClick={() => A.sheet(<IncidentSheet id={sh.id} />)}>Reportar un problema</Btn></>}>
      <div className="stack">
        {s && <Card>
          <div className="row between"><b className="bodym">{itemsShort(s)}</b><span className="cap">pediste {sacos(sh.sacks)} · {fkg(sh.weightKg)}</span></div>
          <div className="grid2 mt">
            <Field label="Sacos"><Inp value={sacks} onInput={setSacks} mode="numeric" label="Sacos recibidos" /></Field>
            <Field label="Peso"><Inp value={kgv} onInput={setKg} mode="decimal" suffix={<Icon n="scale" />} label="Peso recibido en kg" /></Field>
          </div>
          <div className="mt"><Seg value={ok} onChange={setOk} options={[{ v: 'OK', l: 'Conforme' }, { v: 'FAIL', l: 'Con fallas' }]} /></div>
          {Math.abs(diff) > A.w.settings.carrier.weightTolerance && <div className="errt mt"><Icon n="circle-alert" s="1.1em" />Diferencia de {pct(Math.abs(diff))}: más del 1 %. Puedes reclamar en 24 h con fotos (RN-60).</div>}
        </Card>}
        <div className="photos" style={{ gridTemplateColumns: "1fr 1fr" }}>{['Sacos recibidos', 'Balanza'].map((l, i) => <PhotoPick key={l} value={ph[i]} onChange={(v) => { const n = [...ph]; n[i] = v; setPh(n); }} label={l} kind={i ? 'balanza' : 'sacos'} sample={i ? { value: `${kgv} kg` } : undefined} />)}</div>
        {!delivered && !paid && (
          <Card tone="dark">
            <div className="row between"><span className="cap b" style={{ letterSpacing: ".1em", color: "var(--leaf)" }}>PAGA EL FLETE A {c.short.toUpperCase()}</span>{acct && <button className="chip" style={{ background: "#fff", color: "var(--forest)" }} onClick={() => { try { navigator.clipboard.writeText(acct.number); A.toast('Número copiado.', 'info'); } catch { A.toast(acct.number, 'info'); } }}>Copiar</button>}</div>
            <div className="display" style={{ fontSize: "2em", margin: ".1em 0" }}>{money(sh.freight)}</div>
            <div className="cap">{acct ? `${acct.kind === 'BANK' ? 'Cuenta' : acct.kind === 'PLIN' ? 'Plin' : 'Yape'} ${maskPhone(acct.number)} · ${acct.holder}` : 'En efectivo'}</div>
            <div className="mt"><Seg dark value={method} onChange={setMethod} options={[{ v: 'YAPE', l: 'Yape' }, { v: 'PLIN', l: 'Plin' }, { v: 'CASH', l: 'Efectivo' }]} /></div>
          </Card>
        )}
        {(paid || delivered) && s && !delivered && <Card tone="dark"><div className="row between"><div><div className="cap">Código de entrega</div><div className="code mt">{s.deliveryCode.split('').map((d, i) => <span key={i}>{d}</span>)}</div></div><Icon n="lock" s="1.6em" /></div><div className="cap mt">Pagaste el flete por {PAY_LABEL[sh.buyerPaid!.method]}. Díctale este código a {c.short} para cerrar la entrega.</div></Card>}
        {delivered && <Card tone="soft"><div className="row top"><Icon n="circle-check" /><div className="bodym"><b>Entregado {sh.delivery ? `a las ${hhmm(sh.delivery.at)}` : ''}</b> · flete pagado a {c.short}. Tienes 24 h para reclamar por el envío con fotos.</div></div></Card>}
        <p className="cap center" style={{ margin: "0" }}>Hasta 1 % de diferencia de peso es normal. El producto se lo pagas a {orgName(A.w, sh.sellerOrgId).split(' ')[0]} aparte.</p>
      </div>
    </Screen>
  );
}

function IncidentSheet({ id }: { id: string }) {
  const A = useApp();
  const [kind, setKind] = useState('Carga dañada o mojada');
  const [text, setText] = useState('');
  return (
    <SheetBody title="Reportar un problema" sub="Avisamos al transportista y al agricultor. Si no hay acuerdo, Soporte media.">
      <div className="chips">{['Carga dañada o mojada', 'Faltan sacos', 'Peso distinto', 'Otro'].map(k => <ChipBtn key={k} on={kind === k} onClick={() => setKind(k)}>{k}</ChipBtn>)}</div>
      <Inp area value={text} onInput={setText} placeholder="Cuéntanos qué pasó" label="Qué pasó" />
      <Btn full kind="danger" onClick={() => { if (A.act('SHIP_INCIDENT', { shipmentId: id, incidentId: 'inc-' + uid(), kind, text }, { ok: 'Avisamos a todos. Revisen juntos antes de cerrar.' }).ok) A.sheet(null); }}>Enviar aviso</Btn>
    </SheetBody>
  );
}

/* ---------- B-33 · Calificar y recomendar ---------- */
function RateCarrier() {
  const A = useApp();
  const sh = A.w.shipments[A.top.p?.id as string];
  const [v, setV] = useState({ punctuality: 5, care: 5, treatment: 5 });
  const [tags, setTags] = useState<string[]>([]);
  const [rec, setRec] = useState(true);
  const [fav, setFav] = useState(false);
  const [comment, setComment] = useState('');
  if (!sh) return <Screen title="Califica el envío"><Empty title="No encontramos el envío" /></Screen>;
  const c = carrierPerson(A.w, sh.carrierOrgId);
  const s = A.w.subOrders[sh.subOrderId];
  if (sh.rating) return <Screen title="Califica el envío"><Card><Empty icon="star" title="Ya calificaste este envío" text={`${c.short} puede responder tu opinión.`} /></Card></Screen>;
  const avg = Math.round((v.punctuality + v.care + v.treatment) / 3);
  const send = () => { if (A.act('SHIP_RATE', { shipmentId: sh.id, ...v, tags, recommends: rec, favorite: fav, comment }, { ok: 'Gracias por calificar.' }).ok) { if (s?.status === 'DELIVERED') A.replace('B-15', { id: s.id }); else if (A.top.p?.next === 'orders') A.reset('B-13', { tab: 'done' }); else A.back(); } };
  return (
    <Screen title="Califica el envío" sub={`${sh.code} · pedido ${s?.code ?? ''}`} foot={<><Btn full onClick={send} disabled={!['DELIVERED', 'CLOSED'].includes(sh.status)} why={!['DELIVERED', 'CLOSED'].includes(sh.status) ? 'Se califica cuando recibes' : undefined}>Enviar calificación</Btn><div className="why">Solo califica quien recibió el envío. {c.short} puede responder.</div></>}>
      <div className="stack">
        <Card><div className="stack" style={{ alignItems: "center" }}><span className="av lg" style={{ background: "#1E3F20" }}>{personInitials(c.full)}</span><b className="bodym">¿Cómo te fue con {c.short}?</b><Stars v={avg} onChange={(n) => setV({ punctuality: n, care: n, treatment: n })} size="1.1em" /></div></Card>
        <Card><div className="stack tight">{([['punctuality', 'Puntualidad'], ['care', 'Cuidado de la carga'], ['treatment', 'Trato']] as ['punctuality' | 'care' | 'treatment', string][]).map(([k, l]) => <div key={k} className="row between"><span className="bodym">{l}</span><Stars v={v[k]} onChange={(n) => setV({ ...v, [k]: n })} /></div>)}</div></Card>
        <div className="lbl">¿Qué destacas?</div>
        <div className="chips">{['Llegó a la hora', 'Sacos secos y completos', 'Ayudó a descargar', 'Avisó por el chat'].map(t => <ChipBtn key={t} on={tags.includes(t)} onClick={() => setTags(tags.includes(t) ? tags.filter(x => x !== t) : [...tags, t])}>{t}</ChipBtn>)}</div>
        <Card><Tog on={rec} onChange={setRec} label="¿Lo recomiendas a otros negocios?" sub="Tu recomendación aparece en su perfil" /><div className="mt"><Tog on={fav} onChange={setFav} label="Agregar a mis favoritos" sub="Tus favoritos reciben primero tus envíos" /></div></Card>
        <Field label="Comentario (opcional)"><Inp area value={comment} onInput={setComment} placeholder="Llegó a la hora, con los sacos secos y completos." label="Comentario" /></Field>
      </div>
    </Screen>
  );
}

/* ---------- B-34 · Perfil del transportista ---------- */
function CarrierProfile() {
  const A = useApp();
  const o = A.w.orgs[A.top.p?.id as string];
  if (!o?.carrier) return <Screen title="Transportista"><Empty title="No encontramos al transportista" /></Screen>;
  const c = carrierPerson(A.w, o.id);
  const cs = carrierStats(A.w, o.id);
  const fav = A.w.favorites[A.org!.id]?.carriers.includes(o.id);
  const routes = o.carrier.routes.map(r => A.w.settings.routes.find(x => x.id === r.routeId)?.name ?? r.routeId);
  const days = [...new Set(o.carrier.routes.flatMap(r => r.days))].sort().map(d => DOW_LONG[d]);
  const okDocs = o.carrier.vehicle.docs.filter(d => d.status === 'OK' && (!d.expiresOn || d.expiresOn > A.now)).map(d => d.label.split(' ')[0]);
  const rated = Object.values(A.w.shipments).filter(s => s.carrierOrgId === o.id && s.rating).sort((a, b) => b.rating!.at - a.rating!.at);
  return (
    <Screen bar={
      <header className="bar home" style={{ alignItems: "center" }}>
        <button className="back" onClick={() => A.back()} aria-label="Volver"><Icon n="chevron-left" s="1.6em" /></button>
        <span className="av lg" style={{ background: "#C97C3E" }}>{personInitials(c.full)}</span>
        <div className="tt"><h1>{c.full}</h1><p>{o.name} · {placeLabel(o.district)}</p><div className="chips" style={{ marginTop: ".35em" }}><span className="chip terra"><Icon n="shield-check" s="1.05em" />{o.carrier.level} · {({ T0: 'Registrado', T1: 'Documentos', T2: 'Verificado', T3: 'Destacado' } as any)[o.carrier.level]}</span><span className="chip" style={{ background: "rgba(255,255,255,.15)", color: "#fff" }}>★ {cs.rating ? String(cs.rating).replace('.', ',') : '—'} · {cs.count} opiniones</span></div></div>
      </header>
    } foot={<Btn full kind={fav ? 'sec' : 'dark'} icon="heart" onClick={() => A.act('FAVORITE_TOGGLE', { kind: 'carrier', id: o.id, on: !fav }, { ok: fav ? 'Lo quitaste de tus favoritos.' : `${c.short} es tu favorito: le ofrecemos primero tus envíos.` })}>{fav ? 'Quitar de mis favoritos' : 'Agregar a mis favoritos'}</Btn>}>
      <div className="stack">
        <div className="grid3"><Stat n={cs.shipments ? pct(cs.onTimePct).replace(/\s/g, ' ') : '—'} l="A tiempo" /><Stat n={cs.shipments} l="Envíos" /><Stat n={cs.recommends} l="Recomiendan" /></div>
        <Card><Kv rows={[['Vehículo', `${o.carrier.vehicle.body} · hasta ${numTrim(o.carrier.vehicle.payloadKg, 0)} kg`], ['Placa', o.carrier.vehicle.plate], ['Ruta', routes.join(' · ')], ['Días', days.join(', ')], ['Papeles vigentes', okDocs.length ? okDocs.join(', ') : '—']]} /></Card>
        {rated.length === 0 && <Card><Empty icon="star" title="Todavía sin opiniones" /></Card>}
        {rated.slice(0, 5).map(s => (
          <Card key={s.id}>
            <Stars v={Math.round((s.rating!.punctuality + s.rating!.care + s.rating!.treatment) / 3)} />
            {s.rating!.comment && <div className="bodym mt">«{s.rating!.comment}»</div>}
            <div className="cap mt">{orgName(A.w, s.buyerOrgId)} · {ago(s.rating!.at, A.now)}{s.rating!.recommends ? ' · lo recomienda' : ''}</div>
            {s.rating!.reply && <div className="card soft mt"><div className="cap b">{c.short} respondió</div><div className="bodym">{s.rating!.reply}</div></div>}
          </Card>
        ))}
      </div>
    </Screen>
  );
}

reg('B-20', Membership, { nav: true, tab: 'B-20' });
reg('B-21', Savings, { nav: true, tab: 'B-21' });
reg('B-25', Receipts, { nav: true, tab: 'B-21' });
reg('B-26', PayMembership);
reg('B-31', ShipTrack);
reg('B-32', ReceiveFreight);
reg('B-33', RateCarrier);
reg('B-34', CarrierProfile);

void Photo; void kgOf; void orgStats; void relDay; void Seg; void Tile;
export type { SubOrder };
