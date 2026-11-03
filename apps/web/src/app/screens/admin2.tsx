/*
 * Panel web de administración (2): catálogo y traducciones (W-09), planes, comisiones y límites con doble
 * aprobación (W-10), reportes sin datos personales (W-11), verificación y red de almacenes (W-13, W-15),
 * cobros y estados de cuenta (W-14), verificación y red de transportistas (W-16, W-17) y tarifas y rutas
 * de envío (W-18).
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { reg } from './registry';
import { useApp, type AppCtx } from '../ctx';
import { Icon, Btn, Inp, Sel, Photo } from '../ui/kit';
import { IdentityReview } from './idreview';
import { WebFrame, Pill, Tabs, Kpi, WSearch, Row, Columns, Meter, norm, downloadCsv, maskRuc, adminName, roleOf, casesOf, AgePill, pilotIndicators } from './admin';
import { PRODUCTS, product, CATEGORY_LABEL, allProducts } from '@mesagri/shared/catalog';
import { carrierStats, warehouseOccupancy, expiringDocs, expiredDocs, sameDay } from '@mesagri/shared/queries';
import { r2, VCLASS_INFO, CARRIER_LEVEL_NAME, WAREHOUSE_LEVEL_NAME } from '@mesagri/shared/rules';
import { SETTING_KEYS, settingDef } from '@mesagri/shared/settings';
import { CRITICAL_KEYS } from '@mesagri/shared/i18n-keys';
import { money, moneyShort, kg as fkg, dateShort, hhmm, relDay, ago, pct, dateNum, numTrim, dateDM } from '@mesagri/shared/format';
import { periodOf, periodLabel, prevPeriod, nextPeriod, periodStart, startOfDay, lima, DAY, HOUR, DOW_CHIP } from '@mesagri/shared/time';
import { uid } from '@mesagri/shared/ids';
import { orgName, PAY_LABEL } from '../helpers';
import { districtName, placeLabel } from '@mesagri/shared/ubigeo';
import { accruedRent, fmtVal } from '@mesagri/shared/engine/billing';
import type { World, Org, Statement, SubInvoice, Shipment, VerifCase, DocItem, Lang } from '@mesagri/shared/types';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const monthOf = (p: string) => cap(periodLabel(p).split(' ')[0]);

/* Producto nuevo del catálogo maestro (RF-ADM-07): lo agrega la administración general y queda en auditoría */
function NewProduct({ onDone }: { onDone: () => void }) {
  const A = useApp();
  const [name, setName] = useState('');
  const [cat, setCat] = useState('HORTALIZAS');
  const [units, setUnits] = useState<string[]>(['kg', 'saco']);
  const [chacra, setChacra] = useState('');
  const [mayorista, setMayorista] = useState('');
  const [days, setDays] = useState('15');
  const [syn, setSyn] = useState('');
  const [storable, setStorable] = useState(false);
  const [err, setErr] = useState('');
  const can = (A.me?.adminRole ?? 'GENERAL') === 'GENERAL';
  const save = () => {
    setErr('');
    const r = A.act('CATALOG_ADD', { name: name.trim(), category: cat, units, chacra: Number(chacra.replace(',', '.')), mayorista: Number(mayorista.replace(',', '.')), perishDays: Number(days), storable, synonyms: syn.split(',').map(x => x.trim()).filter(Boolean) }, { quiet: true });
    if (!r.ok) { setErr(r.error!.message); return; }
    A.toast(`Agregamos «${name.trim()}» al catálogo: ya se puede publicar y pedir.`);
    onDone();
  };
  return (
    <div className="wcard" style={{ background: 'var(--mint)', boxShadow: 'none', margin: '10px 0' }}>
      <h2>Nuevo producto</h2>
      <div className="wform">
        <label className="fld"><span className="lbl">Nombre</span><input className="inp" value={name} onChange={(e: any) => setName(e.currentTarget.value)} placeholder="Kiwicha" /></label>
        <label className="fld"><span className="lbl">Categoría</span><select className="inp" value={cat} onChange={(e: any) => setCat(e.currentTarget.value)}>{Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="fld"><span className="lbl">Precio en chacra (S/ por kg)</span><input className="inp" inputMode="decimal" value={chacra} onChange={(e: any) => setChacra(e.currentTarget.value)} placeholder="4,50" /></label>
        <label className="fld"><span className="lbl">Precio mayorista (S/ por kg)</span><input className="inp" inputMode="decimal" value={mayorista} onChange={(e: any) => setMayorista(e.currentTarget.value)} placeholder="6,80" /></label>
        <label className="fld"><span className="lbl">Días que dura una publicación</span><input className="inp" inputMode="numeric" value={days} onChange={(e: any) => setDays(e.currentTarget.value.replace(/\D/g, ''))} /></label>
        <label className="fld"><span className="lbl">Sinónimos (separados por coma)</span><input className="inp" value={syn} onChange={(e: any) => setSyn(e.currentTarget.value)} placeholder="amaranto, achita" /></label>
      </div>
      <div className="row g8 wrap" style={{ margin: '8px 0' }}>
        {['kg', 'saco', 'arroba', 'jaba', 'atado'].map(u => <button key={u} type="button" className={'chip ' + (units.includes(u) ? 'on' : 'line')} onClick={() => setUnits(units.includes(u) ? units.filter(x => x !== u) : [...units, u])}>{u}</button>)}
        <button type="button" className={'chip ' + (storable ? 'on' : 'line')} onClick={() => setStorable(!storable)}>Se guarda en almacén seco</button>
      </div>
      {err && <p className="errt" role="alert">{err}</p>}
      <div className="row g8"><Btn sm kind="dark" onClick={save} disabled={!can || name.trim().length < 3} why={!can ? 'Solo la administración general agrega productos' : 'Escribe el nombre'}>Agregar al catálogo</Btn><Btn sm kind="sec" onClick={onDone}>Cancelar</Btn></div>
      <p className="wnote">Queda en la auditoría. Los nombres en runasimi y aymar aru se agregan después en «Pantallas críticas», con revisión de hablantes.</p>
    </div>
  );
}

/* ================= W-09 · Catálogo y traducciones ================= */
const TR_STATUS: Record<string, [string, 'warn' | 'danger' | 'info' | 'gray' | '']> = { MACHINE_DRAFT: ['Borrador automático', 'gray'], DRAFT: ['Borrador', 'warn'], REVIEWED: ['Revisada', 'info'], APPROVED: ['Aprobada', ''] };
function Catalog() {
  const A = useApp();
  const w = A.w;
  const [tab, setTab] = useState<'KEYS' | 'PRODUCTS'>('KEYS');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string>(CRITICAL_KEYS[0].key);
  const done = (l: Lang) => CRITICAL_KEYS.filter(k => w.translations[k.key]?.[l]?.status === 'APPROVED').length;
  const keys = CRITICAL_KEYS.filter(k => !q || norm(`${k.key} ${k.es} ${w.translations[k.key]?.qu?.text ?? ''}`).includes(norm(q)));
  const prods = allProducts().filter(p => !q || norm(`${p.name} ${p.synonyms.join(' ')}`).includes(norm(q)));
  const [adding, setAdding] = useState(false);
  const k = CRITICAL_KEYS.find(x => x.key === sel)!;
  return (
    <WebFrame title="Catálogo y traducciones" sub="Productos, sinónimos locales y textos de las pantallas críticas por idioma" right={<WSearch value={q} onInput={setQ} placeholder={tab === 'KEYS' ? 'Buscar texto' : 'Buscar producto'} />}>
      <div className="kpis">
        <Kpi l="Idiomas activos" n={w.settings.languages.enabled.length} s={w.settings.languages.enabled.map(l => ({ es: 'castellano', qu: 'runasimi', ay: 'aymar aru' } as any)[l]).join(' · ')} />
        <Kpi l="Runasimi (quechua)" n={`${done('qu')} de ${CRITICAL_KEYS.length}`} s="textos críticos aprobados" />
        <Kpi l="Aymar aru" n={`${done('ay')} de ${CRITICAL_KEYS.length}`} s="textos críticos aprobados" />
        <Kpi l="Productos" n={allProducts().length} s={`${Object.keys(w.translations).filter(x => x.startsWith('product.')).length} con nombre en runasimi por validar`} />
      </div>
      <Tabs value={tab} onChange={setTab} options={[['KEYS', `Pantallas críticas (${CRITICAL_KEYS.length})`], ['PRODUCTS', `Productos (${allProducts().length})`]]} />
      {tab === 'KEYS' ? (
        <div className="split">
          <div className="wcard">
            <h2>Textos de las pantallas del agricultor</h2>
            <table className="wtable resp"><thead><tr><th>Pantalla</th><th>Castellano</th><th>Runasimi</th><th>Aymar aru</th></tr></thead>
              <tbody>{keys.map(x => { const tq = w.translations[x.key]?.qu, ta = w.translations[x.key]?.ay; return (
                <Row key={x.key} sel={x.key === sel} onOpen={() => setSel(x.key)}>
                  <td data-l="Pantalla" className="nowrap">{x.screen}</td><td data-l="Castellano"><b>{x.es}</b></td>
                  <td data-l="Runasimi">{tq?.text ? <>{tq.text} <Pill tone={TR_STATUS[tq.status][1]}>{TR_STATUS[tq.status][0]}</Pill></> : <Pill tone="danger">Falta traducir</Pill>}</td>
                  <td data-l="Aymar aru">{ta?.text ? <>{ta.text} <Pill tone={TR_STATUS[ta.status][1]}>{TR_STATUS[ta.status][0]}</Pill></> : <Pill tone="danger">Falta traducir</Pill>}</td>
                </Row>
              ); })}</tbody></table>
          </div>
          <div className="stack">
            <TranslationEditor key={k.key} k={k} />
            <div className="wcard"><h2>Cómo se valida</h2><p className="bodym" style={{ margin: "0" }}>Cada texto lo propone un hablante nativo y lo valida un segundo traductor; luego se prueba con agricultores. Un idioma se activa solo cuando <b>todos</b> sus textos críticos están aprobados (RN-32). Mientras tanto, la app muestra castellano con audio.</p></div>
          </div>
        </div>
      ) : (
        <div className="wcard">
          <div className="row between"><h2>Productos ({prods.length})</h2><Btn sm kind="dark" icon="plus" onClick={() => setAdding(!adding)}>{adding ? 'Cerrar' : 'Nuevo producto'}</Btn></div>
          {adding && <NewProduct onDone={() => setAdding(false)} />}
          <table className="wtable resp"><thead><tr><th>Producto</th><th>Categoría</th><th>Castellano (sinónimos)</th><th>Runasimi</th><th>Variedades</th><th className="r">Chacra</th><th className="r">Mayorista</th><th>Fuente</th></tr></thead>
            <tbody>{prods.map(p => { const t = w.translations[`product.${p.id}`]?.qu; return (
              <tr key={p.id}><td data-l="Producto"><div className="row g8"><span className="tile sm" style={{ background: p.color }}>{p.letter}</span><b>{p.name}</b></div></td><td data-l="Categoría">{CATEGORY_LABEL[p.category] ?? p.category}</td><td data-l="Sinónimos" style={{ maxWidth: "280px" }}>{p.synonyms.join(', ')}</td><td data-l="Runasimi">{t ? <>{t.text} <Pill tone={TR_STATUS[t.status][1]}>{TR_STATUS[t.status][0]}</Pill></> : '—'}</td><td data-l="Variedades">{p.varieties?.join(', ') ?? '—'}</td><td data-l="Chacra" className="r tnum">{money(p.ref.chacra)}</td><td data-l="Mayorista" className="r tnum">{money(p.ref.mayorista)}</td><td data-l="Fuente" style={{ maxWidth: "220px" }} className="cap">{p.ref.source}</td></tr>
            ); })}</tbody></table>
          <p className="wnote">Los precios de referencia son por kilo. Los que no vienen del Midagri son valores de ejemplo hasta tener la serie del piloto. Los nombres locales de las variedades se guardan como sinónimos para la búsqueda y la voz.</p>
        </div>
      )}
    </WebFrame>
  );
}
function TranslationEditor({ k }: { k: { key: string; es: string; screen: string } }) {
  const A = useApp();
  const row = A.w.translations[k.key] ?? {};
  const [qu, setQu] = useState(row.qu?.text ?? '');
  const [ay, setAy] = useState(row.ay?.text ?? '');
  const [sq, setSq] = useState<string>(row.qu?.status === 'MACHINE_DRAFT' ? 'DRAFT' : row.qu?.status ?? 'DRAFT');
  const [sa, setSa] = useState<string>(row.ay?.status === 'MACHINE_DRAFT' ? 'DRAFT' : row.ay?.status ?? 'DRAFT');
  const ro = roleOf(A) !== 'GENERAL';
  const save = (lang: 'qu' | 'ay', text: string, status: string) => A.act('TRANSLATION_SET', { key: k.key, lang, text, status }, { ok: status === 'APPROVED' ? 'Traducción aprobada.' : 'Traducción guardada.' });
  const block = (lang: 'qu' | 'ay', label: string, v: string, set: (s: string) => void, st: string, setSt: (s: string) => void) => (
    <div className="stack tight" style={{ marginTop: "10px" }}>
      <div className="row between"><b>{label}</b>{row[lang]?.at && <span className="cap">{adminName(A.w, row[lang]?.by)} · {dateDM(row[lang]!.at!)}</span>}</div>
      <Inp value={v} onInput={set} placeholder="Escribe la traducción (la propone un hablante nativo)" label={label} />
      <div className="row g8 wrap"><Sel value={st} onChange={setSt} options={[{ v: 'DRAFT', l: 'Borrador' }, { v: 'REVIEWED', l: 'Revisada por un segundo traductor' }, { v: 'APPROVED', l: 'Aprobada (probada con agricultores)' }]} label="Estado" /><Btn sm kind="dark" disabled={ro} why={ro ? 'Solo administración edita traducciones' : undefined} onClick={() => save(lang, v, st)}>Guardar</Btn></div>
    </div>
  );
  return (
    <div className="wcard">
      <h2>Editar · {k.screen}</h2>
      <div className="cap">Clave {k.key}</div>
      <div className="bodym" style={{ marginTop: "6px" }}>Castellano: <b>{k.es}</b></div>
      {block('qu', 'Runasimi (quechua)', qu, setQu, sq, setSq)}
      {block('ay', 'Aymar aru', ay, setAy, sa, setSa)}
      <p className="wnote">Las traducciones automáticas nunca se aprueban sin revisión humana.</p>
    </div>
  );
}

/* ================= W-10 · Planes, comisiones y límites ================= */
function Settings() {
  const A = useApp();
  const w = A.w, s = w.settings;
  const me = A.me!;
  const [open, setOpen] = useState<boolean>(!!A.top.p?.propose);
  const [hist, setHist] = useState(false);
  const pend = Object.values(w.proposals).filter(p => p.status === 'PENDING' || p.status === 'APPROVED').sort((a, b) => b.proposedAt - a.proposedAt);
  const all = Object.values(w.proposals).sort((a, b) => b.proposedAt - a.proposedAt);
  const v = (key: string) => { const d = settingDef(key)!; return fmtVal(d.unit, d.get(s)); };
  const pendingFor = (key: string) => pend.find(p => p.key === key);
  const line = (label: string, value: ReactNode, key?: string) => {
    const pp = key ? pendingFor(key) : undefined;
    return <tr key={label}><td>{label}</td><td className="r"><span className="wval">{value}</span>{pp && <div className="cap" style={{ color: "var(--warn)", fontWeight: "800" }}>→ {fmtVal(settingDef(pp.key)!.unit, pp.to)} {pp.status === 'APPROVED' ? `desde el ${dateShort(pp.effectiveFrom)}` : 'por aprobar'}</div>}</td></tr>;
  };
  return (
    <WebFrame title="Planes, comisiones y límites" sub="Valores iniciales del piloto · cada cambio necesita una segunda aprobación (RN-50)"
      right={<><Btn sm kind="sec" onClick={() => setHist(!hist)}>{hist ? 'Ocultar historial' : 'Ver historial de cambios'}</Btn><Btn sm kind="dark" onClick={() => setOpen(!open)}>Proponer cambio</Btn></>}>
      <div className="wtabs"><button className="on">Planes y comisiones</button><button onClick={() => A.reset('W-18')}>Tarifas y rutas de envío</button></div>
      {open && <ProposeForm initial={A.top.p?.propose as string | undefined} onDone={() => setOpen(false)} />}
      {pend.length > 0 && (
        <div className="wcard" style={{ marginBottom: "16px" }}>
          <h2>Cambios por aprobar o por aplicar</h2>
          <table className="wtable resp"><thead><tr><th>Valor</th><th>Cambio</th><th>Desde</th><th>Motivo</th><th>Propuso</th><th /></tr></thead>
            <tbody>{pend.map(p => { const d = settingDef(p.key)!; const mine = p.proposedBy === me.id; return (
              <tr key={p.id}><td data-l="Valor"><b>{p.label}</b></td><td data-l="Cambio" className="nowrap">{fmtVal(d.unit, p.from)} → <b>{fmtVal(d.unit, p.to)}</b></td><td data-l="Desde">{dateShort(p.effectiveFrom)}</td><td data-l="Motivo" style={{ maxWidth: "300px" }}>{p.reason}</td><td data-l="Propuso">{adminName(w, p.proposedBy)} · {ago(p.proposedAt, A.now)}</td>
                <td data-l="">{p.status === 'APPROVED' ? <Pill tone="info">Aprobado · se aplica el {dateDM(p.effectiveFrom)}</Pill> : <div className="row g8 wrap"><Btn sm kind="dark" disabled={mine} why={mine ? 'La segunda firma la da otra persona (RN-50)' : undefined} onClick={() => A.act('SETTING_APPROVE', { proposalId: p.id }, { ok: 'Segunda aprobación registrada.' })}>Aprobar</Btn><Btn sm kind="secd" onClick={() => A.act('SETTING_REJECT', { proposalId: p.id, reason: mine ? 'Retirada por quien la propuso' : 'No procede por ahora' }, { ok: 'Propuesta rechazada.' })}>{mine ? 'Retirar' : 'Rechazar'}</Btn></div>}</td></tr>
            ); })}</tbody></table>
          <p className="wnote">Si sube un precio o una comisión, rige 30 días después del aviso a los usuarios (RN-50). Quien propone no puede aprobar.</p>
        </div>
      )}
      {hist && (
        <div className="wcard" style={{ marginBottom: "16px" }}><h2>Historial de cambios</h2>
          {all.length ? <table className="wtable resp"><thead><tr><th>Fecha</th><th>Valor</th><th>Cambio</th><th>Propuso</th><th>Decidió</th><th>Estado</th></tr></thead>
            <tbody>{all.map(p => { const d = settingDef(p.key)!; return <tr key={p.id}><td data-l="Fecha">{dateNum(p.proposedAt)}</td><td data-l="Valor">{p.label}</td><td data-l="Cambio">{fmtVal(d.unit, p.from)} → {fmtVal(d.unit, p.to)}</td><td data-l="Propuso">{adminName(w, p.proposedBy)}</td><td data-l="Decidió">{p.approvedBy ? adminName(w, p.approvedBy) : '—'}</td><td data-l="Estado"><Pill tone={p.status === 'REJECTED' ? 'danger' : p.status === 'PENDING' ? 'warn' : p.status === 'APPROVED' ? 'info' : ''}>{({ PENDING: 'Por aprobar', APPROVED: 'Aprobado', APPLIED: 'Aplicado', REJECTED: 'Rechazado' } as any)[p.status]}</Pill></td></tr>; })}</tbody></table> : <p className="wnote">Todavía no hay cambios: rigen los valores iniciales del piloto.</p>}
        </div>
      )}
      <div className="wgrid4">
        <div className="wcard kv"><h2>Membresía MYPE</h2><table className="wtable"><tbody>
          {line('Básico · precio al mes', v('plans.BASICO.price'), 'plans.BASICO.price')}
          {line('Básico · compras hasta', v('plans.BASICO.purchaseCap'), 'plans.BASICO.purchaseCap')}
          {line('Pro · precio al mes', v('plans.PRO.price'), 'plans.PRO.price')}
          {line('Pro · compras hasta', v('plans.PRO.purchaseCap'), 'plans.PRO.purchaseCap')}
          {line('Pro · usuarios y locales', `${s.plans.PRO.users} y ${s.plans.PRO.locations}`)}
          {line('Empresa · precio al mes', v('plans.EMPRESA.price'), 'plans.EMPRESA.price')}
          {line('Primer mes', 'Gratis')}
          {line('Días de gracia', v('membership.graceDays'), 'membership.graceDays')}
          {line('Baja de Pro a Básico tras', `${s.membership.downgradeMonths} meses`)}
        </tbody></table></div>
        <div className="wcard kv"><h2>Comisión del agricultor</h2><table className="wtable"><tbody>
          {line('Ventas sin comisión', v('commission.freeSales'), 'commission.freeSales')}
          {line('Comisión desde la 6.ª', v('commission.rate'), 'commission.rate')}
          {line('Base', 'Venta conforme')}
          {line('Estado de cuenta', 'Mensual')}
          {line('Vence el día', v('commission.dueDay'), 'commission.dueDay')}
          {line('Si no paga', 'No publica')}
          {line('Plazo para aceptar', v('orderResponseHours'), 'orderResponseHours')}
          {line('Efectivo solo por debajo de', v('cashThreshold'), 'cashThreshold')}
        </tbody></table><p className="wnote">Los pedidos cancelados o rechazados no pagan comisión (RN-14).</p></div>
        <div className="wcard kv"><h2>Almacenes aliados</h2><table className="wtable"><tbody>
          {line('Comisión del alquiler', v('storage.commission'), 'storage.commission')}
          {line('Reserva sin respuesta vence', v('storage.bookingHours'), 'storage.bookingHours')}
          {line('Si no llega el lote', `${s.storage.lotArrivalDays} días`)}
          {line('Diferencia al ingresar', v('storage.intakeTolerance'), 'storage.intakeTolerance')}
          {line('Merma tolerada: papa', `${pct(s.storage.mermaPapa)} al mes`)}
          {line('Merma tolerada: granos', `${pct(s.storage.mermaGranos)} al mes`)}
          {line('Visita: puntaje mínimo', `${s.storage.minScore} / 100`)}
        </tbody></table></div>
        <div className="wcard kv"><h2>Transportistas aliados</h2><table className="wtable"><tbody>
          {line('Comisión del flete', v('carrier.commission'), 'carrier.commission')}
          {line('Ruta compartida', v('routes.camana-aqp.pricePerKg'), 'routes.camana-aqp.pricePerKg')}
          {line('Mínimo por pedido', v('routes.camana-aqp.minFee'), 'routes.camana-aqp.minFee')}
          {line('Oferta sin respuesta', v('carrier.noCarrierHours'), 'carrier.noCarrierHours')}
          {line('Diferencia de peso', pct(s.carrier.weightTolerance))}
          {line('Falso flete', v('carrier.falseFreight'), 'carrier.falseFreight')}
          {line('Revisión: puntaje mínimo', `${s.carrier.minScore} / 100`)}
        </tbody></table><p className="wnote">Tarifas por ruta y por vehículo en «Tarifas y rutas de envío» (W-18).</p></div>
      </div>
      <div className="wcard" style={{ marginTop: "16px" }}>
        <h2>Límites por nivel de verificación</h2>
        <table className="wtable resp"><thead><tr><th>Nivel</th><th>Agricultor: publicaciones</th><th>Agricultor: por pedido</th><th>Agricultor: al mes</th><th>MYPE: por pedido</th><th>MYPE: al mes</th><th>MYPE: pago</th></tr></thead>
          <tbody>{[0, 1, 2, 3].map(n => { const f = s.farmerLimits[n], b = s.buyerLimits[n]; return <tr key={n}><td data-l="Nivel"><b>{n}</b></td><td data-l="Publicaciones">{f.listings === null ? 'Sin tope' : f.listings}</td><td data-l="Por pedido" className="tnum">{money(f.perOrder).replace(',00', '')}</td><td data-l="Al mes" className="tnum">{f.monthly === null ? 'Sin tope' : money(f.monthly).replace(',00', '')}</td><td data-l="MYPE por pedido" className="tnum">{money(b.perOrder).replace(',00', '')}</td><td data-l="MYPE al mes" className="tnum">{b.monthly === null ? 'Sin tope' : money(b.monthly).replace(',00', '')}</td><td data-l="Pago">{n === 0 ? '—' : b.prepay ? 'Antes de la entrega' : 'También al recibir'}</td></tr>; })}</tbody></table>
      </div>
    </WebFrame>
  );
}
function ProposeForm({ initial, onDone }: { initial?: string; onDone: () => void }) {
  const A = useApp();
  const [key, setKey] = useState<string>(initial ?? SETTING_KEYS[0].key);
  const d = settingDef(key)!;
  const cur = d.get(A.w.settings);
  const [val, setVal] = useState<string>('');
  const [reason, setReason] = useState('');
  const raw = Number(val.replace(',', '.'));
  const value = d.unit === '%' ? raw / 100 : raw;
  const up = d.increaseNotice && value > cur;
  const minDate = startOfDay(A.now) + (up ? 30 : 0) * DAY;
  const [date, setDate] = useState<string>('');
  const eff = date ? new Date(date + 'T00:00:00-05:00').getTime() : (up ? minDate + 8 * HOUR : A.now);
  const send = () => {
    const r = A.act('SETTING_PROPOSE', { proposalId: 'pr-' + uid(), key, value, effectiveFrom: eff, reason }, { ok: 'Propuesta registrada: la aprueba otra persona del equipo.' });
    if (r.ok) onDone();
  };
  return (
    <div className="wcard" style={{ marginBottom: "16px", border: "2px solid var(--field)" }}>
      <h2>Proponer un cambio</h2>
      <div className="wform">
        <label className="fld"><span className="lbl">Valor</span><Sel value={key} onChange={(k) => { setKey(k); setVal(''); setDate(''); }} options={SETTING_KEYS.map(k => ({ v: k.key, l: `${({ MYPE: 'MYPE', AGRICULTOR: 'Agricultor', ALMACEN: 'Almacén', TRANSPORTE: 'Transporte', GENERAL: 'General' } as any)[k.group]} · ${k.label}` }))} label="Valor a cambiar" /></label>
        <label className="fld"><span className="lbl">Hoy</span><div className="inp" style={{ display: "flex", alignItems: "center", background: "#f2f5ee" }}>{fmtVal(d.unit, cur)}</div></label>
        <label className="fld"><span className="lbl">Nuevo valor {d.unit === '%' ? '(en %)' : `(${d.unit})`}</span><Inp value={val} onInput={setVal} mode="decimal" label="Nuevo valor" placeholder={d.unit === '%' ? String(cur * 100) : String(cur)} /></label>
        <label className="fld"><span className="lbl">Rige desde</span><input className="inp" type="date" value={date} min={new Date(minDate + 5 * HOUR).toISOString().slice(0, 10)} onChange={(e: any) => setDate(e.currentTarget.value)} aria-label="Rige desde" /></label>
      </div>
      <div style={{ marginTop: "10px" }}><Inp area value={reason} onInput={setReason} placeholder="Motivo: queda en la auditoría y lo ve quien aprueba" label="Motivo" /></div>
      {up && <p className="wnote" style={{ color: "var(--warn)", fontWeight: "700" }}>Sube un precio o una comisión: avisamos a los usuarios y rige desde el {dateShort(Math.max(eff, minDate))} como pronto (RN-50).</p>}
      <div className="row g8" style={{ justifyContent: "flex-end", marginTop: "10px" }}><Btn sm kind="sec" onClick={onDone}>Cancelar</Btn><Btn sm kind="dark" disabled={!val} onClick={send}>Enviar a segunda aprobación</Btn></div>
    </div>
  );
}

/* ================= W-18 · Tarifas y rutas de envío ================= */
function Rates() {
  const A = useApp();
  const w = A.w, s = w.settings;
  const carriers = Object.values(w.orgs).filter(o => o.carrier && (o.carrier.level === 'T2' || o.carrier.level === 'T3'));
  const city = s.routes.find(r => r.scope === 'CIUDAD')!;
  return (
    <WebFrame title="Tarifas y rutas de envío" sub="La MYPE paga el flete al transportista; Mesagri solo fija la tarifa de referencia · cada cambio necesita una segunda aprobación"
      right={<Btn sm kind="dark" onClick={() => A.reset('W-10', { propose: 'routes.camana-aqp.pricePerKg' })}>Proponer cambio</Btn>}>
      <div className="wtabs"><button onClick={() => A.reset('W-10')}>Planes y comisiones</button><button className="on">Tarifas y rutas de envío</button></div>
      <div className="wgrid3">
        <div className="wcard"><h2>Rutas compartidas</h2>
          <table className="wtable resp"><thead><tr><th>Ruta entre provincias</th><th className="r">S/ por kg</th><th>Días</th><th className="r">Transportistas</th><th>Estado</th></tr></thead>
            <tbody>{s.routes.filter(r => r.scope === 'RUTA').map(r => { const cs = carriers.filter(o => o.carrier!.routes.some(x => x.routeId === r.id)); const days = [...new Set(cs.flatMap(o => o.carrier!.routes.filter(x => x.routeId === r.id).flatMap(x => x.days)))].sort(); return <tr key={r.id}><td data-l="Ruta"><b>{r.name}</b> <span className="cap">({r.distanceKm} km)</span></td><td data-l="S/ por kg" className="r tnum">{money(r.pricePerKg)}</td><td data-l="Días">{days.length ? days.map(d => DOW_CHIP[d].toLowerCase()).join(', ') : 'por definir'}</td><td data-l="Transportistas" className="r">{cs.length}</td><td data-l="Estado"><Pill tone={cs.length ? '' : 'gray'}>{cs.length ? 'Activa' : 'Sin transportistas'}</Pill></td></tr>; })}</tbody></table>
          <p className="wnote">Carga compartida: cada pedido paga por sus kilos, con un mínimo de {money(s.routes[0].minFee).replace(',00', '')}. Un saco de 50 kg paga {money(r2(50 * s.routes[0].pricePerKg))}.</p>
        </div>
        <div className="wcard"><h2>Reparto en Arequipa (por entrega)</h2>
          <table className="wtable"><tbody>
            <tr><td>Moto con cajuela (hasta 20 kg)</td><td className="r"><b>{money(city.cityMoto).replace(',00', '')}</b></td></tr>
            <tr><td>Camioneta o furgón (hasta 1 500 kg)</td><td className="r"><b>{money(city.cityVan).replace(',00', '')}</b></td></tr>
          </tbody></table>
          <div className="sect" style={{ marginTop: "12px" }}>Tiempo para aceptar una oferta</div>
          <table className="wtable"><tbody>
            <tr><td>En la ciudad</td><td className="r"><b>{city.offerMinutes} min</b></td></tr>
            <tr><td>Entre provincias</td><td className="r"><b>{Math.round(s.routes[0].offerMinutes / 60)} h</b></td></tr>
            <tr><td>Sin transportista tras</td><td className="r"><b>{s.carrier.noCarrierHours} h</b></td></tr>
          </tbody></table>
        </div>
        <div className="wcard"><h2>Reglas del envío</h2>
          <table className="wtable"><tbody>
            <tr><td>Comisión de Mesagri</td><td className="r"><b>{pct(s.carrier.commission)}</b></td></tr>
            <tr><td>Diferencia de peso</td><td className="r"><b>{pct(s.carrier.weightTolerance)}</b></td></tr>
            <tr><td>Reclamo por daño</td><td className="r"><b>{s.claimHours} h</b></td></tr>
            <tr><td>Falso flete</td><td className="r"><b>{pct(s.carrier.falseFreight)}</b></td></tr>
            <tr><td>Suspensión tras</td><td className="r"><b>3 faltas</b></td></tr>
            <tr><td>Revisión del vehículo</td><td className="r"><b>cada 6 meses</b></td></tr>
          </tbody></table>
        </div>
      </div>
      <div className="wcard" style={{ marginTop: "16px" }}><h2>Clases de vehículo</h2>
        <table className="wtable resp"><thead><tr><th>Clase</th><th>Vehículo</th><th>Categoría</th><th>Carga máxima en Mesagri</th><th>Licencia</th><th>Papel que lo habilita</th><th>Dónde trabaja</th></tr></thead>
          <tbody>{(['V1', 'V2', 'V3'] as const).map(c => { const v = VCLASS_INFO[c]; return <tr key={c}><td data-l="Clase"><Pill>{c}</Pill></td><td data-l="Vehículo">{v.label}</td><td data-l="Categoría">{v.category}</td><td data-l="Carga máxima">{numTrim(v.maxKg)} kg</td><td data-l="Licencia">{v.license}</td><td data-l="Papel">{v.habilita}</td><td data-l="Dónde">{v.where}</td></tr>; })}</tbody></table>
        <p className="wnote">Todos: SOAT vigente e inspección técnica (CITV) según la antigüedad del vehículo. No se aceptan autos, mototaxis ni trimotos, ni camiones de más de 12 toneladas.</p>
      </div>
      <div className="wcard" style={{ marginTop: "16px" }}><h2>Niveles del transportista</h2>
        <table className="wtable resp"><thead><tr><th>Nivel</th><th>Qué exige</th><th>Qué permite</th></tr></thead>
          <tbody>
            <tr><td data-l="Nivel"><Pill tone="gray">T1</Pill></td><td data-l="Exige">DNI, RUC, licencia, tarjeta vehicular, SOAT, CITV y papel que lo habilita</td><td data-l="Permite">Completar la revisión; aún no recibe envíos</td></tr>
            <tr><td data-l="Nivel"><Pill>T2</Pill></td><td data-l="Exige">Revisión del vehículo con {s.carrier.minScore} de 100, convenio y capacitación</td><td data-l="Permite">Envíos con carga de hasta {moneyShort(s.carrier.capT2)} por viaje</td></tr>
            <tr><td data-l="Nivel"><Pill tone="warn">T3</Pill></td><td data-l="Exige">{s.carrier.t3Shipments} envíos, {String(s.carrier.t3Rating).replace('.', ',')} estrellas, {pct(s.carrier.t3OnTime)} a tiempo y seguro de carga</td><td data-l="Permite">Carga de hasta {moneyShort(s.carrier.capT3)} por viaje y prioridad en ofertas</td></tr>
          </tbody></table>
      </div>
    </WebFrame>
  );
}

/* ================= W-11 · Reportes del piloto ================= */
export function priceIndex(w: World) {
  let paid = 0, chacra = 0, mayor = 0;
  for (const s of Object.values(w.subOrders)) if (s.status === 'COMPLETED') for (const i of s.items) {
    const kgv = (i.acceptedQty ?? i.qty) * i.unitKg;
    paid += (i.acceptedQty ?? i.qty) * i.price;
    chacra += kgv * product(i.productId).ref.chacra;
    mayor += kgv * product(i.productId).ref.mayorista;
  }
  return { farmer: chacra ? paid / chacra - 1 : 0, buyer: mayor ? paid / mayor - 1 : 0 };
}
function Reports() {
  const A = useApp();
  const w = A.w;
  const P = periodOf(A.now);
  const periods = [...new Set([...Object.keys(w.monthlyGmv), ...Object.values(w.invoices).map(i => i.period), ...Object.values(w.statements).map(s => s.period)])].sort().slice(-7);
  const inv = (p: string) => r2(Object.values(w.invoices).filter(i => i.period === p && i.status !== 'VOID').reduce((a, i) => a + i.amount, 0));
  const st = (p: string, k: Statement['kind']) => r2(Object.values(w.statements).filter(s => s.period === p && s.kind === k && s.status !== 'VOID').reduce((a, s) => a + s.total, 0));
  const activeIn = (p: string, side: 'buyer' | 'seller') => new Set(Object.values(w.subOrders).filter(s => periodOf(s.createdAt) === p && !['REJECTED', 'EXPIRED'].includes(s.status)).map(s => side === 'buyer' ? s.buyerOrgId : s.sellerOrgId)).size;
  const idx = priceIndex(w);
  const ind = pilotIndicators(w, A.now);
  const funnel = (type: 'FARMER' | 'BUYER') => { const os = Object.values(w.orgs).filter(o => o.type === type); return [os.length, os.filter(o => o.level >= 1).length, os.filter(o => (type === 'FARMER' ? o.counters.completedSales : o.counters.completedPurchases) > 0).length, activeIn(P, type === 'FARMER' ? 'seller' : 'buyer')]; };
  const ff = funnel('FARMER'), fb = funnel('BUYER');
  const rows = periods.map(p => [monthOf(p), activeIn(p, 'buyer'), activeIn(p, 'seller'), w.monthlyGmv[p] ?? 0, inv(p), st(p, 'FARMER'), st(p, 'WAREHOUSE'), st(p, 'CARRIER')] as [string, number, number, number, number, number, number, number]);
  const exp = () => downloadCsv(A, `reporte-piloto-${P}.csv`, [['Mes', 'MYPE activas', 'Agricultores activos', 'Ventas (GMV)', 'Membresías', 'Comisión agricultores', 'Comisión almacenes', 'Comisión transportistas'], ...rows.map(r => r.map((c, i) => i >= 3 ? Number(c).toFixed(2) : c))]);
  return (
    <WebFrame title="Reportes del piloto" sub={`${monthOf(periods[0] ?? P)} a ${periodLabel(P)} · agregados, sin datos personales${roleOf(A) === 'ANALYST' ? ' (rol analista)' : ''}`} right={<Btn sm kind="sec" icon="download" onClick={exp}>CSV para Excel</Btn>}>
      <div className="kpis">
        <Kpi l="Precio para el agricultor" n={`${idx.farmer >= 0 ? '+' : '−'}${pct(Math.abs(idx.farmer))}`} s="vs. precio en chacra (Midagri o referencia)" tone="ok" />
        <Kpi l="Costo para la MYPE" n={`${idx.buyer >= 0 ? '+' : '−'}${pct(Math.abs(idx.buyer))}`} s="vs. mayorista de referencia" />
        <Kpi l="Pedidos a tiempo" n={ind[0].fmt(ind[0].v)} s="meta: 90 %" />
        <Kpi l="Pedidos con disputa" n={ind[1].fmt(ind[1].v)} s="meta: menos de 3 %" />
      </div>
      <div className="wgrid3">
        <div className="wcard"><h2>Membresías</h2><Columns data={periods.map(p => ({ k: p, label: periodLabel(p), v: inv(p) }))} fmt={money} color="var(--terra6)" caption="Membresías facturadas por mes (S/, con IGV)." current={P} /></div>
        <div className="wcard"><h2>Comisión de agricultores</h2><Columns data={periods.map(p => ({ k: p, label: periodLabel(p), v: st(p, 'FARMER') }))} fmt={money} caption={`Comisión de agricultores por mes (S/). Las ${w.settings.commission.freeSales} primeras ventas de cada agricultor no pagan.`} current={P} /></div>
        <div className="wcard"><h2>Embudo</h2>
          <table className="wtable"><thead><tr><th>Embudo</th><th className="r">Agricultores</th><th className="r">MYPE</th></tr></thead>
            <tbody>{['Registrados', 'Verificados (nivel 1+)', 'Con 1.ª venta o compra', `Activos en ${periodLabel(P).split(' ')[0]}`].map((l, i) => <tr key={l}><td>{l}</td><td className="r tnum">{ff[i]}</td><td className="r tnum">{fb[i]}</td></tr>)}</tbody></table>
          <p className="wnote">Los indicadores de precio y costo usan los precios de referencia del catálogo: son de ejemplo hasta tener la serie real del piloto.</p>
        </div>
      </div>
      <div className="wcard" style={{ marginTop: "16px" }}><h2>Resumen mensual</h2>
        <table className="wtable resp"><thead><tr><th>Mes</th><th className="r">MYPE activas</th><th className="r">Agricultores activos</th><th className="r">Ventas (GMV)</th><th className="r">Membresías</th><th className="r">Comisión agricultores</th><th className="r">Comisión almacenes</th><th className="r">Comisión transportistas</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r[0]}><td data-l="Mes">{r[0]}{r[0] === monthOf(P) ? ' (en curso)' : ''}</td><td data-l="MYPE" className="r tnum">{r[1]}</td><td data-l="Agricultores" className="r tnum">{r[2]}</td><td data-l="Ventas" className="r tnum">{money(r[3]).replace(',00', '')}</td><td data-l="Membresías" className="r tnum">{r[4] ? money(r[4]) : '—'}</td><td data-l="Agricultores" className="r tnum">{r[5] ? money(r[5]) : '—'}</td><td data-l="Almacenes" className="r tnum">{r[6] ? money(r[6]) : '—'}</td><td data-l="Transportistas" className="r tnum">{r[7] ? money(r[7]) : '—'}</td></tr>)}</tbody></table>
        <p className="wnote">Las comisiones de un mes se emiten el día 1 del mes siguiente; el mes en curso todavía no tiene estados de cuenta.</p>
      </div>
    </WebFrame>
  );
}

/* ================= Verificación de almacenes y transportistas (W-13, W-16) ================= */
const DOC_ISSUER: Record<string, string> = { LICENCIA: 'Municipalidad', ITSE: 'Municipalidad', FUMIGACION: 'Empresa autorizada', SENASA: 'SENASA', BALANZA: 'Laboratorio de metrología', SOAT: 'Aseguradora', CITV: 'Centro autorizado', MTC: 'MTC', MUNI: 'Municipalidad', SEGURO: 'Aseguradora' };
function docRow(d: DocItem, now: number): [string, 'warn' | 'danger' | '' | 'gray' | 'info'] {
  if (d.status === 'MISSING') return ['Falta', 'gray'];
  if (d.expiresOn && d.expiresOn < now) return ['Vencido', 'danger'];
  if (d.expiresOn && d.expiresOn < now + 45 * DAY) return [`Vence en ${Math.ceil((d.expiresOn - now) / DAY)} días`, 'warn'];
  if (d.status === 'PENDING') return ['En revisión', 'info'];
  if (d.status === 'OBSERVED') return ['Observado', 'danger'];
  return ['Válido', ''];
}
const WH_POINTS = ['Techo y paredes sin filtraciones', 'Piso seco y parihuelas', 'Lejos de químicos y combustibles', 'Control de plagas con registro', 'Balanza con calibración vigente', 'Extintores y señalización', 'Cierre y vigilancia nocturna'];
const CAR_POINTS = ['Zona de carga limpia, seca y sin olores', 'Sin restos de químicos ni combustible', 'Lona o parihuela sobre el piso', 'Furgón cerrado o toldo que cubre toda la carga', 'Fajas o sogas de sujeción', 'Luces, llantas y frenos', 'Extintor vigente y botiquín'];
function lastCase(w: World, orgId: string): VerifCase | undefined { return Object.values(w.cases).filter(k => k.orgId === orgId).sort((a, b) => b.submittedAt - a.submittedAt)[0]; }
function VerifyPartner({ kind }: { kind: 'WAREHOUSE' | 'CARRIER' }) {
  const A = useApp();
  const w = A.w;
  const isWh = kind === 'WAREHOUSE';
  const orgs = Object.values(w.orgs).filter(o => (isWh ? o.warehouse : o.carrier));
  const lvl = (o: Org) => Number((isWh ? o.warehouse!.level : o.carrier!.level).slice(1));
  const docsOf = (o: Org) => (isWh ? o.warehouse!.docs : o.carrier!.vehicle.docs);
  const open = casesOf(w, [kind]);
  const groups = {
    REV: orgs.filter(o => open.some(k => k.orgId === o.id)),
    VIS: orgs.filter(o => isWh ? (!!o.warehouse!.visitScheduled && !o.warehouse!.visit) : (open.some(k => k.orgId === o.id) && !o.carrier!.inspection)),
    DOC: orgs.filter(o => expiringDocs(docsOf(o), A.now, 45).length + expiredDocs(docsOf(o), A.now).length > 0),
    OK: orgs.filter(o => lvl(o) >= 2 && o.status === 'ACTIVE'),
    SUS: orgs.filter(o => o.status === 'SUSPENDED'),
  };
  type G = keyof typeof groups;
  const [tab, setTab] = useState<G>(groups.REV.length ? 'REV' : 'OK');
  const [q, setQ] = useState('');
  const list = groups[tab].filter(o => !q || norm(`${o.name} ${o.legalName ?? ''} ${o.ruc ?? ''} ${o.carrier?.vehicle.plate ?? ''}`).includes(norm(q)));
  // solo se abre la ficha si el id es de un almacén o transportista (un enlace viejo o de otro tipo muestra la lista)
  const asked = A.top.p?.id as string | undefined;
  const [sel, setSel] = useState<string | undefined>((asked && orgs.some(x => x.id === asked) ? asked : undefined) ?? list[0]?.id ?? orgs[0]?.id);
  const o = sel && orgs.some(x => x.id === sel) ? w.orgs[sel] : undefined;
  const pillOf = (x: Org): [string, 'warn' | 'danger' | '' | 'gray'] => {
    const miss = docsOf(x).find(d => d.status === 'MISSING' && d.kind !== 'SEGURO' && d.kind !== 'SENASA');
    if (isWh) {
      if (x.warehouse!.visit) return ['Visita hecha', ''];
      if (x.warehouse!.visitScheduled && sameDay(x.warehouse!.visitScheduled, A.now)) return ['Visita hoy', 'warn'];
      if (miss) return [`Falta ${miss.label.split(' ')[0].toLowerCase()}`, 'warn'];
      return [x.warehouse!.visitScheduled ? `Visita ${dateDM(x.warehouse!.visitScheduled)}` : 'Documentos', 'gray'];
    }
    if (x.carrier!.inspection) return ['Revisión hecha', ''];
    if (miss) return [`Falta ${miss.label.split(' ')[0].toLowerCase()}`, 'warn'];
    return [`Capacitación ${x.carrier!.training.done}/${x.carrier!.training.total}`, 'gray'];
  };
  return (
    <WebFrame title={isWh ? 'Almacenes aliados · verificación' : 'Transportistas aliados · verificación'} sub="Cada decisión la toma una persona y queda en auditoría (RN-16)" right={<WSearch value={q} onInput={setQ} placeholder={isWh ? 'Buscar RUC o nombre' : 'Buscar RUC, placa o nombre'} />}>
      {roleOf(A) === 'GENERAL' && <div className="wtabs"><button onClick={() => A.reset(isWh ? 'W-15' : 'W-17')}>Red</button><button className="on">Verificación</button></div>}
      <Tabs value={tab} onChange={setTab} options={[['REV', `Por revisar (${groups.REV.length})`], ['VIS', `${isWh ? 'Visitas programadas' : 'Revisiones de vehículo'} (${groups.VIS.length})`], ['DOC', `Documentos por vencer (${groups.DOC.length})`], ['OK', `Verificados (${groups.OK.length})`], ['SUS', `Suspendidos (${groups.SUS.length})`]]} />
      <div className="split rev">
        <div className="stack">
          {list.map(x => { const [t, tone] = pillOf(x); return (
            <button key={x.id} className={'wcard pick-card' + (x.id === sel ? ' on' : '')} onClick={() => setSel(x.id)}>
              <div className="row between top"><div><b>{x.legalName ?? x.name}</b><div className="wnote" style={{ margin: "2px 0 0" }}>{districtName(x.district)} · {isWh ? ({ MOLINO: 'molino', SECO: 'almacén seco', ACOPIO: 'centro de acopio' } as any)[x.warehouse!.facilityType] + ` · ${numTrim(x.warehouse!.capacitySacks)} sacos` : `${x.carrier!.vehicle.body.toLowerCase()} ${x.carrier!.vehicle.category} · ${numTrim(x.carrier!.vehicle.payloadKg)} kg`}</div></div><Pill tone={tone}>{t}</Pill></div>
            </button>
          ); })}
          {list.length === 0 && <div className="wcard"><p className="wnote" style={{ margin: "0" }}>Nada en esta lista.</p></div>}
          {o && <HistoryCard o={o} />}
        </div>
        {o ? <PartnerDetail o={o} kind={kind} key={o.id} /> : <div className="wcard"><p className="wnote">Elige una cuenta.</p></div>}
      </div>
    </WebFrame>
  );
}
function HistoryCard({ o }: { o: Org }) {
  const A = useApp();
  const k = lastCase(A.w, o.id);
  const items: [string, number, boolean?][] = [[`Registro con RUC validado`, o.createdAt]];
  if (k) items.push(...k.history.map(h => [h.text + (h.by && A.w.users[h.by]?.role === 'ADMIN' ? ` · ${adminName(A.w, h.by)}` : ''), h.at] as [string, number]));
  const insp = o.carrier?.inspection ?? o.warehouse?.visit;
  if (insp) items.push([`${o.carrier ? 'Revisión del vehículo' : 'Visita de campo'}: ${insp.score}/100`, insp.at]);
  for (const d of [...expiringDocs((o.carrier?.vehicle.docs ?? o.warehouse?.docs) ?? [], A.now, 45)]) items.push([`${d.label} vence en ${Math.ceil((d.expiresOn! - A.now) / DAY)} días`, A.now, true]);
  return (
    <div className="wcard"><h2>Historial</h2><div className="stack tight">{items.sort((a, b) => a[1] - b[1]).map(([t, at, warn], i) => <div key={i} className="row between" style={{ fontSize: '14px', color: warn ? 'var(--warn)' : undefined, fontWeight: warn ? 700 : undefined }}><span>{t}</span><span className="cap nowrap">{dateDM(at)}</span></div>)}</div></div>
  );
}
function PartnerDetail({ o, kind }: { o: Org; kind: 'WAREHOUSE' | 'CARRIER' }) {
  const A = useApp();
  const w = A.w;
  const isWh = kind === 'WAREHOUSE';
  const k = Object.values(w.cases).filter(x => x.orgId === o.id && ['SUBMITTED', 'IN_REVIEW', 'APPEALED'].includes(x.status)).sort((a, b) => b.submittedAt - a.submittedAt)[0];
  const insp = isWh ? o.warehouse!.visit : o.carrier!.inspection;
  const points = isWh ? WH_POINTS : CAR_POINTS;
  const [checks, setChecks] = useState<boolean[]>(points.map(() => true));
  const [crit, setCrit] = useState(0);
  const [reason, setReason] = useState('');
  const pad = o.ruc ? w.padron[o.ruc] : undefined;
  const user = Object.values(w.users).find(u => u.orgId === o.id);
  const score = Math.round((checks.filter(Boolean).length / checks.length) * 100);
  const docs: (DocItem & { issuer?: string })[] = isWh ? o.warehouse!.docs : [
    { kind: 'DNI', label: 'DNI y rostro en 3 ángulos', status: 'OK', note: 'Vigente' },
    { kind: 'LIC', label: `Licencia ${o.carrier!.driverLicense.cls}`, status: 'OK', expiresOn: o.carrier!.driverLicense.expiresOn },
    ...o.carrier!.vehicle.docs,
  ];
  const photos = (k ?? lastCase(w, o.id))?.evidence.filter(e => e.photoId) ?? [];
  const decide = (result: 'APPROVE' | 'NEEDS_INFO' | 'REJECT') => {
    if (!k) { A.toast('No hay un expediente abierto para esta cuenta.', 'warn'); return; }
    const r = A.act('VERIF_DECIDE', { caseId: k.id, result, reason }, { quiet: true });
    if (!r.ok) { A.toast(r.error!.message, 'err'); return; }
    A.toast(result === 'APPROVE' ? `${o.name} ya está verificado (${isWh ? 'A2' : 'T2'}).` : result === 'NEEDS_INFO' ? 'Observación enviada.' : 'Rechazo registrado.');
  };
  const register = () => {
    const r = isWh ? A.act('WAREHOUSE_VISIT', { orgId: o.id, score, criticalFails: crit }, { ok: `Visita registrada: ${score}/100.` }) : A.act('CARRIER_INSPECTION', { orgId: o.id, score, criticalFails: crit, checklist: Object.fromEntries(points.map((p, i) => [p, checks[i]])) }, { ok: `Revisión registrada: ${score}/100.` });
    void r;
  };
  const failed = points.findIndex((_, i) => !checks[i]);
  const level = isWh ? o.warehouse!.level : o.carrier!.level;
  return (
    <div className="stack">
      <div className="wcard">
        <div className="row between wrap"><div><b style={{ fontSize: "20px" }}>{o.legalName ?? o.name}{!isWh && user ? '' : ''}</b><div className="wnote" style={{ margin: "2px 0 0" }}>RUC {maskRuc(o.ruc)}{pad ? ` · ${pad.estado.toLowerCase()} y ${pad.condicion.toLowerCase()}` : ''} · {placeLabel(o.district)}{isWh ? ` · ${({ MOLINO: 'molino con almacén seco', SECO: 'almacén seco', ACOPIO: 'centro de acopio' } as any)[o.warehouse!.facilityType]}` : ` · ${o.name}`}</div></div>
          <div className="row g8 wrap">{isWh ? <><Pill>{numTrim(o.warehouse!.capacitySacks)} sacos</Pill><Pill tone="warn">{money(o.warehouse!.defaultRate)} por saco al mes</Pill></> : <><Pill>{o.carrier!.vehicle.vclass} · {o.carrier!.vehicle.body.toLowerCase()} {numTrim(o.carrier!.vehicle.payloadKg)} kg</Pill><Pill tone="warn">{o.carrier!.routes.map(r => w.settings.routes.find(x => x.id === r.routeId)?.name ?? '').join(' · ')}</Pill></>}<Pill tone={Number(level.slice(1)) >= 2 ? '' : 'gray'}>{level} · {(isWh ? WAREHOUSE_LEVEL_NAME : CARRIER_LEVEL_NAME)[level]}</Pill></div>
        </div>
      </div>
      <div className="split">
        <div className="wcard"><h2>Documentos</h2>
          <table className="wtable resp"><thead><tr><th>Documento</th><th>Emisor</th><th>Vigencia</th><th>Estado</th></tr></thead>
            <tbody>{docs.map(d => { const [t, tone] = docRow(d, A.now); return <tr key={d.kind}><td data-l="Documento">{d.label}</td><td data-l="Emisor">{d.kind === 'DNI' ? 'RENIEC' : d.kind === 'LIC' ? 'MTC' : DOC_ISSUER[d.kind] ?? '—'}</td><td data-l="Vigencia">{d.expiresOn ? dateNum(d.expiresOn) : d.status === 'MISSING' ? '—' : 'Indeterminada'}</td><td data-l="Estado"><Pill tone={tone}>{t}</Pill></td></tr>; })}</tbody></table>
          {!isWh && <p className="wnote">Capacitación {o.carrier!.training.done} de {o.carrier!.training.total} · convenio {o.carrier!.agreementSigned ? 'firmado (v1.0)' : 'sin firmar'} · inasistencias {o.carrier!.noShows}</p>}
        </div>
        <div className="wcard">
          <h2>{isWh ? 'Visita de campo' : 'Revisión del vehículo'}{insp ? ` · ${insp.score} / 100` : ''}</h2>
          {insp ? <div className="stack tight">{points.map((p, i) => { const warn = insp.criticalFails > 0 ? i === points.length - 1 : insp.score < 100 && i === points.length - 1; return <div key={p} className="row g8"><span className={'icirc ' + (warn ? 'warn' : 'dark')} style={{ width: "24px", height: "24px" }}>{warn ? <Icon n="triangle-alert" s="13" /> : <Icon n="check" s="13" w={3} />}</span><span style={{ fontSize: "14px", fontWeight: "700" }}>{p}</span></div>; })}<p className="wnote">{dateShort(insp.at)} · {adminName(w, insp.by)} · {insp.criticalFails ? `${insp.criticalFails} fallas críticas` : 'sin fallas críticas'}</p></div>
            : <div className="stack tight">
              <p className="wnote" style={{ marginTop: "0" }}>{isWh ? (o.warehouse!.visitScheduled ? `Agendada para el ${dateShort(o.warehouse!.visitScheduled)} · ${hhmm(o.warehouse!.visitScheduled)}.` : 'Sin visita agendada.') : `Revisión agendada: ${(k ?? lastCase(w, o.id))?.evidence.find(e => e.key === 'cita')?.label.replace('Revisión del vehículo agendada para el ', '') ?? 'por agendar'}.`} Marca lo que cumple:</p>
              {points.map((p, i) => <label key={p} className="row g8" style={{ fontSize: "14px", fontWeight: "700", cursor: "pointer" }}><input type="checkbox" checked={checks[i]} onChange={(e: any) => { const n = [...checks]; n[i] = e.currentTarget.checked; setChecks(n); }} style={{ width: "18px", height: "18px", accentColor: "#2C5F2D" }} />{p}</label>)}
              <div className="row g8 wrap"><label className="row g8" style={{ fontSize: "14px", fontWeight: "700" }}>Fallas críticas <input className="inp" type="number" min={0} max={9} value={crit} onChange={(e: any) => setCrit(Number(e.currentTarget.value) || 0)} style={{ width: "5em", minHeight: "38px" }} /></label><Pill tone={score >= (isWh ? w.settings.storage.minScore : w.settings.carrier.minScore) && !crit ? '' : 'danger'}>{score} / 100</Pill></div>
              <Btn sm kind="dark" disabled={!['GENERAL', 'VERIFIER'].includes(roleOf(A))} onClick={register}>Registrar {isWh ? 'visita' : 'revisión'}</Btn>
            </div>}
        </div>
      </div>
      {photos.length > 0 && <div className="wphotos">{photos.map(e => <figure key={e.key}><div className="photo"><Photo id={e.photoId} /></div><figcaption>{e.label}</figcaption></figure>)}</div>}
      {(k ?? lastCase(w, o.id))?.identity && <IdentityReview k={(k ?? lastCase(w, o.id))!} />}
      {k ? (
        <div className="wcard">
          <div className="row between wrap"><h2>Decisión · pide {isWh ? 'A' : 'T'}{k.targetLevel}</h2><span className="cap">Expediente enviado {ago(k.submittedAt, A.now)} · <AgePill t={k.submittedAt} /></span></div>
          <Inp area value={reason} onInput={setReason} placeholder={failed >= 0 ? `Observación: ${points[failed].toLowerCase()}` : 'Motivo o nota de la decisión (el usuario la lee)'} label="Motivo" />
          <div className="row g8 wrap" style={{ justifyContent: "flex-end", marginTop: "10px" }}>
            <Btn sm kind="secd" onClick={() => decide('REJECT')}>Rechazar</Btn>
            <Btn sm kind="sec" onClick={() => { if (!reason.trim()) setReason(`Falta: ${insp ? 'corregir lo observado en la revisión' : 'registrar la revisión'}.`); else decide('NEEDS_INFO'); }}>Observar</Btn>
            <Btn sm kind="dark" onClick={() => decide('APPROVE')}>Aprobar nivel {isWh ? 'A' : 'T'}{k.targetLevel}</Btn>
          </div>
          <p className="wnote">Para aprobar {isWh ? 'A2 hace falta la visita' : 'T2 hace falta la revisión'} con {isWh ? w.settings.storage.minScore : w.settings.carrier.minScore} de 100 o más, sin fallas críticas{isWh ? ' y el convenio firmado' : ', el convenio firmado y la capacitación completa'} (RN-{isWh ? '42' : '52'}).</p>
        </div>
      ) : <div className="wcard"><p className="wnote" style={{ margin: "0" }}>Sin expediente abierto. {o.status === 'SUSPENDED' ? `Suspendido: ${o.suspendedReason}` : `Nivel actual ${level}.`}</p></div>}
    </div>
  );
}

/* ================= W-15 · Red de almacenes ================= */
function WarehouseNet() {
  const A = useApp();
  const w = A.w;
  const P = periodOf(A.now), start = periodStart(P), end = periodStart(nextPeriod(P));
  const whs = Object.values(w.orgs).filter(o => o.warehouse);
  const ver = whs.filter(o => o.warehouse!.level === 'A2' || o.warehouse!.level === 'A3');
  const occ = whs.map(o => ({ o, x: warehouseOccupancy(w, o.id) }));
  const used = occ.reduce((a, y) => a + y.x.occupied, 0), offered = ver.reduce((a, o) => a + o.warehouse!.capacitySacks, 0);
  const rent = r2(Object.values(w.lots).reduce((a, l) => a + accruedRent(w, l.id, start, end), 0));
  const incs = Object.values(w.stoIncidents).filter(i => i.status === 'OPEN');
  const [tab, setTab] = useState<'RED' | 'INC' | 'DOC'>('RED');
  const docsSoon = whs.flatMap(o => [...expiringDocs(o.warehouse!.docs, A.now, 45), ...expiredDocs(o.warehouse!.docs, A.now)].map(d => ({ o, d })));
  return (
    <WebFrame title="Red de almacenes aliados" sub={`${cap(periodLabel(P))} · etapa inicial: ${ver.length} ${ver.length === 1 ? 'almacén verificado' : 'almacenes verificados'}`}>
      <div className="wtabs"><button className={tab === 'RED' ? 'on' : ''} onClick={() => setTab('RED')}>Red</button><button onClick={() => A.reset('W-13')}>Verificación ({casesOf(w, ['WAREHOUSE']).length})</button><button className={tab === 'INC' ? 'on' : ''} onClick={() => setTab('INC')}>Incidentes ({incs.length})</button><button className={tab === 'DOC' ? 'on' : ''} onClick={() => setTab('DOC')}>Documentos por vencer ({docsSoon.length})</button></div>
      <div className="kpis">
        <Kpi l="Almacenes verificados (A2)" n={ver.length} s="meta: 5 al año 2 y 10 al año 3" />
        <Kpi l="Sacos ocupados" n={numTrim(used)} s={`de ${numTrim(offered)} ofrecidos (${pct(offered ? used / offered : 0)})`} />
        <Kpi l="Alquiler del mes" n={money(rent).replace(',00', '')} tone="ok" s={`Mesagri recibe ${pct(w.settings.storage.commission)}: ${money(r2(rent * w.settings.storage.commission))}`} />
        <Kpi l="Incidentes abiertos" n={incs.length} tone={incs.length ? 'terra' : undefined} s={incs[0] ? `${incs[0].code} · ${incs[0].kind.toLowerCase()} ${pct(incs[0].diffPct)}` : 'Ninguno'} />
      </div>
      {tab === 'RED' && <div className="wcard"><h2>Almacenes</h2>
        <table className="wtable resp"><thead><tr><th>Almacén</th><th>Nivel</th><th className="r">Capacidad</th><th className="r">Ocupación</th><th className="r">Lotes</th><th className="r">Tarifa</th><th>Incidentes</th><th>Próximo vencimiento</th></tr></thead>
          <tbody>{occ.map(({ o, x }) => { const lots = Object.values(w.lots).filter(l => l.facilityOrgId === o.id && ['IN_DEPOSIT', 'FOR_SALE', 'DISPUTE'].includes(l.status)).length; const inc = incs.filter(i => w.lots[i.lotId]?.facilityOrgId === o.id).length; const next = o.warehouse!.docs.filter(d => d.expiresOn).sort((a, b) => a.expiresOn! - b.expiresOn!)[0]; const soon = next && next.expiresOn! < A.now + 45 * DAY; return (
            <Row key={o.id} onOpen={() => A.go('W-13', { id: o.id })}><td data-l="Almacén"><b>{o.name}</b> · {districtName(o.district)}</td><td data-l="Nivel"><Pill tone={o.warehouse!.level >= 'A2' ? '' : 'gray'}>{o.warehouse!.level}</Pill></td><td data-l="Capacidad" className="r tnum">{numTrim(o.warehouse!.capacitySacks)} sacos</td><td data-l="Ocupación" className="r tnum">{x.occupied ? `${x.occupied} (${pct(x.occupied / Math.max(1, x.capacity))})` : '—'}</td><td data-l="Lotes" className="r">{lots || '—'}</td><td data-l="Tarifa" className="r tnum">{money(o.warehouse!.defaultRate)}</td><td data-l="Incidentes">{inc ? <Pill tone="warn">{inc} abierto</Pill> : '0'}</td><td data-l="Próximo vencimiento">{next ? (soon ? <Pill tone="warn">{next.label.split(' ')[0]} · {dateNum(next.expiresOn!)}</Pill> : `${next.label.split(' ')[0]} · ${dateNum(next.expiresOn!)}`) : o.warehouse!.visitScheduled ? `Visita: ${dateDM(o.warehouse!.visitScheduled)}` : '—'}</td></Row>
          ); })}</tbody></table></div>}
      {(tab === 'RED' || tab === 'INC') && incs.map(i => <IncidentCard key={i.id} id={i.id} />)}
      {tab === 'INC' && incs.length === 0 && <div className="wcard"><p className="wnote" style={{ margin: "0" }}>No hay incidentes abiertos.</p></div>}
      {tab === 'DOC' && <div className="wcard"><h2>Documentos por vencer</h2><table className="wtable resp"><thead><tr><th>Almacén</th><th>Documento</th><th>Vence</th><th>Estado</th></tr></thead><tbody>{docsSoon.map(({ o, d }) => { const [t, tone] = docRow(d, A.now); return <tr key={o.id + d.kind}><td data-l="Almacén">{o.name}</td><td data-l="Documento">{d.label}</td><td data-l="Vence">{dateNum(d.expiresOn!)}</td><td data-l="Estado"><Pill tone={tone}>{t}</Pill></td></tr>; })}</tbody></table>{docsSoon.length === 0 && <p className="wnote">Todo vigente.</p>}<p className="wnote">Con un documento vencido el almacén deja de recibir reservas nuevas hasta renovarlo.</p></div>}
    </WebFrame>
  );
}
function IncidentCard({ id }: { id: string }) {
  const A = useApp();
  const w = A.w;
  const i = w.stoIncidents[id];
  const lot = w.lots[i.lotId];
  const [note, setNote] = useState('');
  return (
    <div className="wcard" style={{ marginTop: "16px" }}>
      <h2>Incidente abierto</h2>
      <p className="bodym" style={{ margin: "0 0 10px" }}><b>{i.code} · {orgName(w, lot?.facilityOrgId)} · lote {lot?.code} ({lot ? product(lot.productId).name.toLowerCase() : ''}, {orgName(w, lot?.farmerOrgId)}).</b> {i.kind} de {fkg(i.diffKg)} ({pct(i.diffPct)}){i.overTolerance ? ': pasa la tolerancia del convenio' : ''}. {i.note} Plazo para acordar: 5 días hábiles.</p>
      <Inp value={note} onInput={setNote} placeholder="Acuerdo: el almacén compensa 12 kg al precio del día" label="Acuerdo" />
      <div className="row g8 wrap" style={{ marginTop: "10px" }}><Btn sm kind="dark" onClick={() => A.act('STO_INCIDENT_CLOSE', { incidentId: id, note: note || 'Cerrado por administración con acuerdo de las partes.' }, { ok: `${i.code} cerrado.` })}>Cerrar con acuerdo</Btn><Btn sm kind="sec" onClick={() => A.toast('En el piloto se abre un chat con el almacén y el agricultor.', 'info')}>Contactar a ambos</Btn></div>
    </div>
  );
}

/* ================= W-17 · Envíos y red de transportistas ================= */
function CarrierNet() {
  const A = useApp();
  const w = A.w;
  const P = periodOf(A.now), Pp = prevPeriod(P);
  const role = roleOf(A);
  const cs = Object.values(w.orgs).filter(o => o.carrier);
  const ver = cs.filter(o => o.carrier!.level === 'T2' || o.carrier!.level === 'T3');
  const ships = Object.values(w.shipments);
  const sinceTwo = ships.filter(s => s.delivery && periodOf(s.delivery.at) >= Pp);
  const onTime = sinceTwo.length ? sinceTwo.filter(s => s.onTime).length / sinceTwo.length : 0;
  const monthShips = ships.filter(s => s.delivery && periodOf(s.delivery.at) === P);
  const freight = r2(monthShips.reduce((a, s) => a + s.freight, 0));
  const today = ships.filter(s => sameDay(s.pickupAt, A.now) || ['PICKED_UP', 'ARRIVED', 'GOING_TO_PICKUP'].includes(s.status) || (s.delivery && sameDay(s.delivery.at, A.now))).sort((a, b) => a.pickupAt - b.pickupAt);
  const claims = ships.filter(s => s.claim && s.claim.status !== 'RESOLVED');
  const noCarrier = ships.filter(s => s.status === 'NO_CARRIER');
  const docsSoon = cs.flatMap(o => [...expiringDocs(o.carrier!.vehicle.docs, A.now, 45), ...expiredDocs(o.carrier!.vehicle.docs, A.now)].map(d => ({ o, d })));
  const [tab, setTab] = useState<'RED' | 'HOY' | 'INC' | 'DOC'>(A.top.p?.tab ?? (role === 'SUPPORT' ? 'HOY' : 'RED'));
  const shipStatus = (s: Shipment): [string, 'warn' | 'danger' | '' | 'gray' | 'info'] => ({ WAITING_FARMER: ['Espera al agricultor', 'gray'], OFFERING: ['Buscando transportista', 'warn'], ASSIGNED: ['Por recoger', 'gray'], GOING_TO_PICKUP: ['Va a recoger', 'info'], PICKED_UP: ['En camino', 'warn'], ARRIVED: ['En la entrega', 'warn'], DELIVERED: ['Entregado', ''], CLOSED: ['Cerrado', ''], NO_CARRIER: ['Sin transportista', 'danger'], CANCELLED: ['Cancelado', 'danger'] } as Record<string, [string, any]>)[s.status];
  return (
    <WebFrame title="Envíos y red de transportistas" sub={`${cap(periodLabel(P))} · etapa inicial: ${ver.length} transportistas verificados · Mesagri no transporta: conecta`}>
      <div className="wtabs">
        <button className={tab === 'RED' ? 'on' : ''} onClick={() => setTab('RED')}>Red</button>
        <button className={tab === 'HOY' ? 'on' : ''} onClick={() => setTab('HOY')}>Envíos de hoy ({today.length})</button>
        {role !== 'SUPPORT' && <button onClick={() => A.reset('W-16')}>Verificación ({casesOf(w, ['CARRIER']).length})</button>}
        <button className={tab === 'INC' ? 'on' : ''} onClick={() => setTab('INC')}>Incidentes ({claims.length + noCarrier.length})</button>
        <button className={tab === 'DOC' ? 'on' : ''} onClick={() => setTab('DOC')}>Documentos por vencer ({docsSoon.length})</button>
      </div>
      <div className="kpis">
        <Kpi l="Transportistas verificados (T2)" n={ver.length} s="meta: 8 al año 2 y 20 al año 3" />
        <Kpi l={`Envíos desde ${periodLabel(Pp).split(' ')[0]}`} n={sinceTwo.length} s={`${monthShips.length} en ${periodLabel(P).split(' ')[0]} · ${pct(onTime)} a tiempo`} />
        <Kpi l={`Fletes de ${periodLabel(P).split(' ')[0]}`} n={money(freight).replace(',00', '')} tone="ok" s={`Mesagri recibe ${pct(w.settings.carrier.commission)}: ${money(r2(freight * w.settings.carrier.commission))}`} />
        <Kpi l="Incidentes abiertos" n={claims.length + noCarrier.length} tone={claims.length + noCarrier.length ? 'terra' : undefined} s={claims[0] ? `${claims[0].code} · ${claims[0].claim!.kind.toLowerCase()}` : noCarrier[0] ? `${noCarrier[0].code} · sin transportista` : 'Ninguno'} />
      </div>
      {tab === 'RED' && <div className="wcard"><h2>Transportistas</h2>
        <table className="wtable resp"><thead><tr><th>Transportista</th><th>Nivel</th><th>Vehículo</th><th>Ruta</th><th className="r">Envíos</th><th className="r">A tiempo</th><th className="r">Calificación</th><th>Próximo vencimiento</th></tr></thead>
          <tbody>{cs.map(o => { const st = carrierStats(w, o.id); const u = Object.values(w.users).find(x => x.orgId === o.id); const next = o.carrier!.vehicle.docs.filter(d => d.expiresOn).sort((a, b) => a.expiresOn! - b.expiresOn!)[0]; const soon = next && next.expiresOn! < A.now + 45 * DAY; const missing = o.carrier!.vehicle.docs.find(d => d.status === 'MISSING' && d.kind !== 'SEGURO'); return (
            <Row key={o.id} onOpen={role !== 'SUPPORT' ? () => A.go('W-16', { id: o.id }) : undefined}><td data-l="Transportista"><b>{u ? `${u.name.split(' ')[0]} ${u.name.split(' ')[u.name.split(' ').length > 3 ? 2 : 1]}` : o.name}</b> · {districtName(o.district)}</td><td data-l="Nivel"><Pill tone={o.carrier!.level >= 'T2' ? '' : 'gray'}>{o.carrier!.level}</Pill></td><td data-l="Vehículo">{o.carrier!.vehicle.body} {o.carrier!.vehicle.category} · {numTrim(o.carrier!.vehicle.payloadKg)} kg</td><td data-l="Ruta">{o.carrier!.routes.map(r => w.settings.routes.find(x => x.id === r.routeId)?.name ?? '').join(' · ')}</td><td data-l="Envíos" className="r">{st.shipments || '—'}</td><td data-l="A tiempo" className="r">{st.shipments ? pct(st.onTimePct) : '—'}</td><td data-l="Calificación" className="r">{st.rating ? String(st.rating).replace('.', ',') : '—'}</td><td data-l="Próximo vencimiento">{missing ? `Falta ${missing.label.toLowerCase()}` : next ? (soon ? <Pill tone="warn">{next.label.split(' ')[0]} · {dateNum(next.expiresOn!)}</Pill> : `${next.label.split(' ')[0]} · ${dateNum(next.expiresOn!)}`) : '—'}</td></Row>
          ); })}</tbody></table></div>}
      {(tab === 'RED' || tab === 'HOY') && <div className="wcard" style={{ marginTop: "16px" }}><h2>Envíos de hoy · {dateShort(A.now)}</h2>
        <table className="wtable resp"><thead><tr><th>Envío</th><th>Transportista</th><th>De → a</th><th className="r">Carga</th><th className="r">Flete</th><th>Estado</th></tr></thead>
          <tbody>{today.map(s => { const [t, tone] = shipStatus(s); const sub = w.subOrders[s.subOrderId]; return <tr key={s.id}><td data-l="Envío"><b>{s.code}</b><div className="cap">{sub?.code}</div></td><td data-l="Transportista">{s.carrierOrgId ? (Object.values(w.users).find(u => u.orgId === s.carrierOrgId)?.name.split(' ').slice(0, 2).join(' ') ?? orgName(w, s.carrierOrgId)) : '—'}</td><td data-l="De → a">{sub?.fromLot ? 'Almacén' : 'Chacra'} en {districtName(w.orgs[s.sellerOrgId]?.district)} → {orgName(w, s.buyerOrgId)}</td><td data-l="Carga" className="r tnum">{fkg(s.weightKg)}</td><td data-l="Flete" className="r tnum">{money(s.freight)}</td><td data-l="Estado"><Pill tone={tone}>{t}</Pill></td></tr>; })}</tbody></table>
        {today.length === 0 && <p className="wnote">No hay envíos hoy.</p>}</div>}
      {tab === 'INC' && <>
        {claims.map(s => <ClaimCard key={s.id} id={s.id} />)}
        {noCarrier.map(s => <div key={s.id} className="wcard" style={{ marginTop: "16px" }}><h2>{s.code} · sin transportista</h2><p className="bodym" style={{ margin: "0" }}>{orgName(w, s.buyerOrgId)} pidió un envío de {fkg(s.weightKg)} desde {districtName(w.orgs[s.sellerOrgId]?.district)}. Nadie aceptó en {w.settings.carrier.noCarrierHours} h; la MYPE elige otra fecha, recojo o envío del agricultor sin costo (RN-56).</p></div>)}
        {ships.filter(s => s.incidents.length && ['PICKED_UP', 'ARRIVED', 'DELIVERED', 'CLOSED'].includes(s.status)).slice(-5).map(s => <div key={s.id + 'i'} className="wcard" style={{ marginTop: "16px" }}><h2>{s.code} · avisos en ruta</h2>{s.incidents.map(i => <p key={i.id} className="bodym" style={{ margin: "4px 0" }}>{dateDM(i.at)} {hhmm(i.at)} · <b>{i.kind}</b>{i.newEta ? ` · nueva hora ${i.newEta}` : ''}{i.where ? ` · ${i.where}` : ''}{i.text ? ` · ${i.text}` : ''}</p>)}</div>)}
        {claims.length + noCarrier.length === 0 && <div className="wcard" style={{ marginTop: "16px" }}><p className="wnote" style={{ margin: "0" }}>No hay reclamos abiertos.</p></div>}
      </>}
      {tab === 'DOC' && <div className="wcard"><h2>Documentos por vencer</h2><table className="wtable resp"><thead><tr><th>Transportista</th><th>Documento</th><th>Vence</th><th>Estado</th></tr></thead><tbody>{docsSoon.map(({ o, d }) => { const [t, tone] = docRow(d, A.now); return <tr key={o.id + d.kind}><td data-l="Transportista">{o.name}</td><td data-l="Documento">{d.label}</td><td data-l="Vence">{dateNum(d.expiresOn!)}</td><td data-l="Estado"><Pill tone={tone}>{t}</Pill></td></tr>; })}</tbody></table>{docsSoon.length === 0 && <p className="wnote">Todo vigente.</p>}<p className="wnote">Con un documento vencido el transportista deja de recibir ofertas hasta renovarlo (RN-52).</p></div>}
    </WebFrame>
  );
}
function ClaimCard({ id }: { id: string }) {
  const A = useApp();
  const w = A.w;
  const s = w.shipments[id];
  const c = s.claim!;
  const kgPrice = s.weightKg ? s.cargoValue / s.weightKg : 0;
  const [comp, setComp] = useState(String(r2(c.kgLost * kgPrice)).replace('.', ','));
  const [res, setRes] = useState('');
  return (
    <div className="wcard" style={{ marginTop: "16px" }}>
      <h2>Reclamo · {s.code}</h2>
      <p className="bodym" style={{ margin: "0 0 6px" }}><b>{orgName(w, s.buyerOrgId)} reclama: {c.kind.toLowerCase()}{c.kgLost ? ` (${fkg(c.kgLost)})` : ''}.</b> {c.text}</p>
      <p className="bodym" style={{ margin: "0 0 10px" }}>{c.response ? <>Descargo de {orgName(w, s.carrierOrgId)}: «{c.response}»</> : 'Esperando el descargo del transportista.'} Recojo: {s.pickup ? `${fkg(s.pickup.kg)} · ${s.pickup.sacks} sacos` : '—'} · entrega: {s.delivery ? `${fkg(s.delivery.kg)} · ${s.delivery.sacks} sacos` : '—'}.</p>
      <div className="grid2"><label className="fld"><span className="lbl">Compensación (al precio del pedido)</span><Inp value={comp} onInput={setComp} mode="decimal" prefix="S/" label="Compensación" /></label><span /></div>
      <div style={{ marginTop: "8px" }}><Inp area value={res} onInput={setRes} placeholder="Resolución: el transportista compensa los kilos faltantes por Yape" label="Resolución" /></div>
      <div className="row g8" style={{ justifyContent: "flex-end", marginTop: "10px" }}><Btn sm kind="dark" onClick={() => A.act('SHIP_CLAIM_RESOLVE', { shipmentId: id, compensation: Number(comp.replace(',', '.')) || 0, resolution: res }, { ok: 'Reclamo resuelto y registrado.' })}>Resolver</Btn></div>
      <p className="wnote">El transportista responde por la carga desde el recojo hasta la entrega (RN-59). La compensación se paga directo entre las partes.</p>
    </div>
  );
}

/* ================= W-14 · Cobros y estados de cuenta ================= */
type CTab = 'FARMER' | 'BUYER' | 'WAREHOUSE' | 'CARRIER' | 'REC';
function Billing() {
  const A = useApp();
  const w = A.w;
  const P = periodOf(A.now);
  const periods = [...new Set([...Object.values(w.statements).map(s => s.period), ...Object.values(w.invoices).map(i => i.period)])].sort().reverse();
  const [period, setPeriod] = useState<string>(periods.find(p => p < P) ?? periods[0] ?? prevPeriod(P));
  const [tab, setTab] = useState<CTab>('FARMER');
  const [sel, setSel] = useState<string | undefined>();
  const toRec = [...Object.values(w.statements).filter(s => s.status === 'PAYMENT_REGISTERED' || s.claim?.status === 'OPEN'), ...Object.values(w.invoices).filter(i => i.status === 'PAID')];
  const exportAll = () => downloadCsv(A, `cobros-${period}.csv`, [['Tipo', 'Código', 'Cuenta', 'RUC o DNI', 'Periodo', 'Base', 'Monto', 'Estado', 'Medio', 'Operación', 'Comprobante'],
    ...Object.values(w.statements).filter(s => s.period === period).map(s => [s.kind === 'FARMER' ? 'Comisión agricultor' : s.kind === 'WAREHOUSE' ? 'Comisión almacén' : 'Comisión transportista', s.code, orgName(w, s.orgId), w.orgs[s.orgId]?.ruc ?? '', s.period, s.base.toFixed(2), s.total.toFixed(2), s.status, s.payment ? PAY_LABEL[s.payment.method] : '', s.payment?.operation ?? '', s.receiptNumber ?? '']),
    ...Object.values(w.invoices).filter(i => i.period === period).map(i => ['Membresía', i.id, orgName(w, i.orgId), w.orgs[i.orgId]?.ruc ?? '', i.period, '', i.amount.toFixed(2), i.status, i.payment ? PAY_LABEL[i.payment.method] : '', i.payment?.operation ?? '', i.receiptNumber ?? ''])]);
  return (
    <WebFrame title="Cobros y estados de cuenta" sub={`Estados de cuenta de ${periodLabel(period)} (emitidos el 1 de ${periodLabel(nextPeriod(period)).split(' ')[0]}) · hoy ${dateDM(A.now)} · Mesagri cobra lo suyo, nunca el dinero de los pedidos`}
      right={<><Sel value={period} onChange={(p) => { setPeriod(p); setSel(undefined); }} options={periods.map(p => ({ v: p, l: cap(periodLabel(p)) }))} label="Periodo" /><Btn sm kind="sec" icon="download" onClick={exportAll}>Exportar al contador</Btn></>}>
      <Tabs value={tab} onChange={(t) => { setTab(t); setSel(undefined); }} options={[['FARMER', 'Agricultores · comisión'], ['BUYER', 'MYPE · membresías'], ['WAREHOUSE', `Almacenes · ${pct(w.settings.storage.commission)}`], ['CARRIER', `Transportistas · ${pct(w.settings.carrier.commission)}`], ['REC', `Conciliación (${toRec.length})`]]} />
      {tab === 'BUYER' ? <Memberships period={period} /> : tab === 'REC' ? <Reconcile /> : <Statements kind={tab} period={period} sel={sel} setSel={setSel} />}
      <p className="wnote">Cada pago por Yape o transferencia se concilia con su número de operación. Anular un cargo exige motivo, emite nota de crédito y queda en auditoría (RN-41).</p>
    </WebFrame>
  );
}
function stPill(s: Statement, now: number): [string, 'warn' | 'danger' | '' | 'gray' | 'info'] {
  if (s.total === 0) return ['Sin cargo', 'gray'];
  if (s.status === 'PAID') return ['Pagado', ''];
  if (s.status === 'PAYMENT_REGISTERED') return ['Pago por conciliar', 'info'];
  if (s.status === 'OVERDUE') return [s.kind === 'FARMER' ? 'Vencido · no publica' : s.kind === 'CARRIER' ? 'Vencido · sin ofertas' : 'Vencido · sin reservas', 'danger'];
  if (s.status === 'VOID') return ['Anulado', 'gray'];
  return [s.dueAt - now < 3 * DAY ? 'Por vencer' : 'Emitido', 'warn'];
}
function Statements({ kind, period, sel, setSel }: { kind: 'FARMER' | 'WAREHOUSE' | 'CARRIER'; period: string; sel?: string; setSel: (s?: string) => void }) {
  const A = useApp();
  const w = A.w;
  const list = Object.values(w.statements).filter(s => s.kind === kind && s.period === period).sort((a, b) => b.total - a.total);
  const tot = (f: (s: Statement) => boolean) => r2(list.filter(f).reduce((a, s) => a + s.total, 0));
  const emitted = tot(() => true), paid = tot(s => s.status === 'PAID'), due = tot(s => s.status === 'ISSUED' || s.status === 'PAYMENT_REGISTERED'), overdue = tot(s => s.status === 'OVERDUE');
  const rate = kind === 'FARMER' ? w.settings.commission.rate : kind === 'WAREHOUSE' ? w.settings.storage.commission : w.settings.carrier.commission;
  const base = r2(list.reduce((a, s) => a + s.base, 0));
  const nOver = list.filter(s => s.status === 'OVERDUE').length;
  const st = sel ? w.statements[sel] : undefined;
  return (
    <>
      <div className="kpis">
        <Kpi l="Comisión emitida" n={money(emitted).replace(',00', '')} s={`${pct(rate)} de ${moneyShort(base)}${kind === 'FARMER' ? ` (ventas ${w.settings.commission.freeSales + 1}.ª en adelante)` : kind === 'WAREHOUSE' ? ' de alquiler' : ' de fletes'}`} />
        <Kpi l="Ya pagado" n={money(paid).replace(',00', '')} tone="ok" s={`${pct(emitted ? paid / emitted : 0)} · por Yape o transferencia`} />
        <Kpi l="Por vencer" n={money(due).replace(',00', '')} s={list[0] ? `vence el ${dateDM(list[0].dueAt)}` : '—'} />
        <Kpi l="Vencido" n={money(overdue).replace(',00', '')} tone={overdue ? 'terra' : undefined} s={nOver ? `${nOver} ${kind === 'FARMER' ? (nOver === 1 ? 'agricultor no publica' : 'agricultores no publican') : kind === 'CARRIER' ? 'sin ofertas nuevas' : 'sin reservas nuevas'}` : 'Nadie con deuda vencida'} />
      </div>
      <div className={st ? 'split' : ''}>
        <div className="wcard">
          <table className="wtable resp"><thead><tr><th>{kind === 'FARMER' ? 'Agricultor' : kind === 'WAREHOUSE' ? 'Almacén' : 'Transportista'}</th><th>{kind === 'FARMER' ? 'Ventas con comisión' : kind === 'WAREHOUSE' ? 'Alquiler del mes' : 'Fletes del mes'}</th><th className="r">Comisión</th><th>Vence</th><th>Estado</th><th>Comprobante</th><th /></tr></thead>
            <tbody>{list.map(s => { const [t, tone] = stPill(s, A.now); const charged = s.items.filter(i => i.amount > 0 && !i.voided); return (
              <Row key={s.id} sel={s.id === sel} onOpen={() => setSel(s.id)}>
                <td data-l="Cuenta"><b>{orgName(w, s.orgId)}</b></td>
                <td data-l="Base">{kind === 'FARMER' ? `${money(charged.reduce((a, i) => a + i.base, 0)).replace(',00', '')} · ${charged.length} ${charged.length === 1 ? 'venta' : 'ventas'}${s.items.length > charged.length ? ` (${s.items.length - charged.length} gratis)` : ''}` : money(s.base)}</td>
                <td data-l="Comisión" className="r tnum">{money(s.total)}</td><td data-l="Vence">{s.total ? dateDM(s.dueAt) : '—'}</td><td data-l="Estado"><Pill tone={tone}>{t}</Pill>{s.claim?.status === 'OPEN' && <> <Pill tone="info">Reclamo</Pill></>}</td><td data-l="Comprobante">{s.receiptNumber ? `${s.receiptNumber.startsWith('F') ? 'Factura' : 'Boleta'} ${s.receiptNumber}` : '—'}</td>
                <td data-l="">{s.status === 'PAYMENT_REGISTERED' ? <Btn sm kind="dark" onClick={(e: any) => { e.stopPropagation(); setSel(s.id); }}>Conciliar</Btn> : (s.status === 'ISSUED' || s.status === 'OVERDUE') && s.total > 0 ? <Btn sm kind="sec" onClick={(e: any) => { e.stopPropagation(); A.act('BILLING_REMIND', { statementId: s.id }, { ok: `Recordatorio enviado a ${orgName(w, s.orgId)} (WhatsApp con audio).` }); }}>Recordar</Btn> : <Btn sm kind="sec" onClick={(e: any) => { e.stopPropagation(); setSel(s.id); }}>Ver</Btn>}</td>
              </Row>
            ); })}</tbody></table>
          {list.length === 0 && <p className="wnote">No hay estados de cuenta de este tipo en {periodLabel(period)}.</p>}
        </div>
        {st && <StatementPanel id={st.id} key={st.id} onClose={() => setSel(undefined)} />}
      </div>
    </>
  );
}
function StatementPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const A = useApp();
  const w = A.w;
  const st = w.statements[id];
  const [note, setNote] = useState('');
  const [voidFor, setVoidFor] = useState<string | undefined>();
  const [why, setWhy] = useState('');
  const claimItem = st.claim ? st.items.find(i => i.id === st.claim!.itemId) : undefined;
  return (
    <div className="wcard">
      <div className="row between"><h2>{st.code}</h2><button className="linkbtn" onClick={onClose}>Cerrar</button></div>
      <div className="wnote" style={{ marginTop: "-6px" }}>{orgName(w, st.orgId)} · {periodLabel(st.period)} · emitido el {dateNum(st.issuedAt)}</div>
      <table className="wtable" style={{ marginTop: "8px" }}><tbody>
        {st.items.map(i => <tr key={i.id}><td style={i.voided ? { textDecoration: "line-through", color: "var(--moss)" } : undefined}>{i.label}</td><td className="r tnum">{money(i.voided ? 0 : i.amount)}</td><td className="r">{!i.voided && i.amount > 0 && st.status !== 'PAID' && <button className="linkbtn" style={{ color: "var(--danger)", padding: "0", minHeight: "0" }} onClick={() => setVoidFor(i.id)}>Anular</button>}{i.voided && <span className="cap">{i.voidReason}</span>}</td></tr>)}
        <tr><td><b>Total</b></td><td className="r"><b>{money(st.total)}</b></td><td /></tr>
      </tbody></table>
      {voidFor && <div className="stack tight" style={{ marginTop: "10px" }}><Inp value={why} onInput={setWhy} placeholder="Motivo de la anulación (RN-41)" label="Motivo" /><div className="row g8"><Btn sm kind="danger" onClick={() => { if (A.act('CHARGE_VOID', { statementId: id, itemId: voidFor, reason: why }, { ok: 'Cargo anulado: se emitió una nota de crédito.' }).ok) { setVoidFor(undefined); setWhy(''); } }}>Anular el cargo</Btn><Btn sm kind="sec" onClick={() => setVoidFor(undefined)}>Cancelar</Btn></div></div>}
      {st.claim?.status === 'OPEN' && claimItem && <div className="stack tight" style={{ marginTop: "12px" }}><div className="sect">Reclamo del usuario</div><p className="bodym" style={{ margin: "0" }}>{claimItem.label} · {money(claimItem.amount)}: «{st.claim.reason}»</p><Inp value={note} onInput={setNote} placeholder="Respuesta (el usuario la lee)" label="Respuesta" /><div className="row g8"><Btn sm kind="dark" onClick={() => A.act('STATEMENT_CLAIM_DECIDE', { statementId: id, accept: true, note }, { ok: 'Reclamo aceptado: cargo anulado con nota de crédito.' })}>Aceptar y anular</Btn><Btn sm kind="sec" onClick={() => A.act('STATEMENT_CLAIM_DECIDE', { statementId: id, accept: false, note }, { ok: 'Reclamo respondido.' })}>No procede</Btn></div></div>}
      {st.status === 'PAYMENT_REGISTERED' && st.payment && <div className="stack tight" style={{ marginTop: "12px" }}><div className="sect">Pago registrado</div><p className="bodym" style={{ margin: "0" }}>{PAY_LABEL[st.payment.method]} · op. <b>{st.payment.operation}</b> · {dateShort(st.payment.at)} {hhmm(st.payment.at)} · {money(st.total)}</p><Inp value={note} onInput={setNote} placeholder="Si no coincide: qué falta (el usuario lo lee)" label="Nota" /><div className="row g8 wrap"><Btn sm kind="dark" onClick={() => A.act('BILLING_RECONCILE', { kind: 'STATEMENT', id, ok: true }, { ok: 'Conciliado: se emitió el comprobante de Mesagri.' })}>Coincide: emitir comprobante</Btn><Btn sm kind="secd" onClick={() => A.act('BILLING_RECONCILE', { kind: 'STATEMENT', id, ok: false, note }, { ok: 'Pago observado: avisamos al usuario.' })}>No coincide</Btn></div></div>}
      {st.receiptNumber && <p className="wnote">Comprobante de Mesagri: {st.receiptNumber}.</p>}
    </div>
  );
}
function Memberships({ period }: { period: string }) {
  const A = useApp();
  const w = A.w;
  const list = Object.values(w.invoices).filter(i => i.period === period).sort((a, b) => b.issuedAt - a.issuedAt);
  const buyers = Object.values(w.orgs).filter(o => o.subscription);
  const sum = (f: (i: SubInvoice) => boolean) => r2(list.filter(f).reduce((a, i) => a + i.amount, 0));
  return (
    <>
      <div className="kpis">
        <Kpi l="Membresías facturadas" n={money(sum(i => i.status !== 'VOID')).replace(',00', '')} s={`${list.length} cobros en ${periodLabel(period).split(' ')[0]}`} />
        <Kpi l="Conciliadas" n={money(sum(i => i.status === 'RECONCILED')).replace(',00', '')} tone="ok" s="con factura de Mesagri" />
        <Kpi l="Por conciliar" n={money(sum(i => i.status === 'PAID')).replace(',00', '')} s="pagadas, falta revisar la operación" />
        <Kpi l="MYPE en gracia o sin membresía" n={buyers.filter(o => o.subscription!.status === 'GRACE' || o.subscription!.status === 'INACTIVE').length} tone="terra" s={`${buyers.filter(o => o.subscription!.status === 'TRIAL').length} en el mes gratis`} />
      </div>
      <div className="wcard"><table className="wtable resp"><thead><tr><th>MYPE</th><th>Concepto</th><th className="r">Monto</th><th>Pago</th><th>Estado</th><th>Comprobante</th><th /></tr></thead>
        <tbody>{list.map(i => <tr key={i.id}><td data-l="MYPE"><b>{orgName(w, i.orgId)}</b></td><td data-l="Concepto">{i.concept}</td><td data-l="Monto" className="r tnum">{money(i.amount)}</td><td data-l="Pago">{i.payment ? `${PAY_LABEL[i.payment.method]} · op. ${i.payment.operation}` : '—'}</td><td data-l="Estado"><Pill tone={i.status === 'RECONCILED' ? '' : i.status === 'PAID' ? 'info' : i.status === 'VOID' ? 'gray' : 'warn'}>{({ ISSUED: 'Por pagar', PAID: 'Por conciliar', RECONCILED: 'Conciliado', VOID: 'Anulado' } as any)[i.status]}</Pill></td><td data-l="Comprobante">{i.receiptNumber ? `Factura ${i.receiptNumber}` : '—'}</td><td data-l="">{i.status === 'PAID' && <Btn sm kind="dark" onClick={() => A.act('BILLING_RECONCILE', { kind: 'INVOICE', id: i.id }, { ok: 'Conciliado: se emitió la factura de la membresía.' })}>Conciliar</Btn>}</td></tr>)}</tbody></table>
        {list.length === 0 && <p className="wnote">Sin cobros de membresía en {periodLabel(period)}: las MYPE nuevas tienen el primer mes gratis.</p>}</div>
    </>
  );
}
function Reconcile() {
  const A = useApp();
  const w = A.w;
  const sts = Object.values(w.statements).filter(s => s.status === 'PAYMENT_REGISTERED' || s.claim?.status === 'OPEN');
  const invs = Object.values(w.invoices).filter(i => i.status === 'PAID');
  const [sel, setSel] = useState<string | undefined>(sts[0]?.id);
  return (
    <div className="split">
      <div className="wcard"><h2>Pagos por conciliar</h2>
        <table className="wtable resp"><thead><tr><th>Cuenta</th><th>Concepto</th><th className="r">Monto</th><th>Operación</th><th /></tr></thead>
          <tbody>
            {sts.map(s => <Row key={s.id} sel={s.id === sel} onOpen={() => setSel(s.id)}><td data-l="Cuenta"><b>{orgName(w, s.orgId)}</b></td><td data-l="Concepto">{s.code}{s.claim?.status === 'OPEN' ? ' · reclamo de un cargo' : ''}</td><td data-l="Monto" className="r tnum">{money(s.total)}</td><td data-l="Operación">{s.payment ? `${PAY_LABEL[s.payment.method]} · ${s.payment.operation}` : '—'}</td><td data-l=""><Btn sm kind="sec" onClick={(e: any) => { e.stopPropagation(); setSel(s.id); }}>Revisar</Btn></td></Row>)}
            {invs.map(i => <tr key={i.id}><td data-l="Cuenta"><b>{orgName(w, i.orgId)}</b></td><td data-l="Concepto">{i.concept}</td><td data-l="Monto" className="r tnum">{money(i.amount)}</td><td data-l="Operación">{i.payment ? `${PAY_LABEL[i.payment.method]} · ${i.payment.operation}` : '—'}</td><td data-l=""><Btn sm kind="dark" onClick={() => A.act('BILLING_RECONCILE', { kind: 'INVOICE', id: i.id }, { ok: 'Conciliado: se emitió la factura.' })}>Conciliar</Btn></td></tr>)}
          </tbody></table>
        {sts.length + invs.length === 0 && <p className="wnote">No hay pagos por conciliar.</p>}
      </div>
      {sel && w.statements[sel] && <StatementPanel id={sel} key={sel} onClose={() => setSel(undefined)} />}
    </div>
  );
}

reg('W-09', Catalog);
reg('W-10', Settings);
reg('W-11', Reports);
reg('W-13', () => <VerifyPartner kind="WAREHOUSE" />);
reg('W-14', Billing);
reg('W-15', WarehouseNet);
reg('W-16', () => <VerifyPartner kind="CARRIER" />);
reg('W-17', CarrierNet);
reg('W-18', Rates);

void Meter; void relDay; void lima; void HOUR; void startOfDay; void Icon; void ({} as AppCtx);
