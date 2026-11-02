/*
 * App del transportista aliado: registro (T-01 a T-05), revisión y capacitación (T-06), niveles (T-07),
 * inicio (T-08), ofertas (T-09), mis envíos (T-10), ruta de hoy (T-11), recojo con QR (T-12), en camino
 * (T-13), entrega con código y cobro del flete (T-14), problemas en ruta (T-15), cobros (T-16), estado de
 * cuenta (T-17), reputación (T-18), vehículo y documentos (T-19) y perfil.
 */
import { useRef, useState } from 'react';
import { reg } from './registry';
import { useApp, type AppCtx } from '../ctx';
import { Screen, Btn, Icon, Field, Inp, Sel, Card, Chip, ChipBtn, Seg, Kv, ICirc, Empty, Note, SheetBody, Prog, Stat, Stars, PhotoPick, Timeline, Tog, BarAct, QR, Spk, Av } from '../ui/kit';
import { MapSketch } from '../ui/map';
import { product } from '@mesagri/shared/catalog';
import { carrierStats, carrierBlockers, currentOffer, kgAssignedOnDay, expiringDocs, expiredDocs, sameDay } from '@mesagri/shared/queries';
import { r2, VCLASS_INFO, licenseMatches, isRucValid, CARRIER_LEVEL_NAME, maskPhone } from '@mesagri/shared/rules';
import { money, moneyShort, kg as fkg, dateShort, hhmm, relDay, ago, pct, dateNum, numTrim, duration } from '@mesagri/shared/format';
import { periodOf, periodLabel, prevPeriod, nextPeriod, periodStart, startOfDay, lima, limaTime, DAY, HOUR, MIN, DOW_CHIP, DOW_LONG } from '@mesagri/shared/time';
import { uid, isSealed, codeMatches, CODE_SALT } from '@mesagri/shared/ids';
import { orgName, userOfOrg, notifsFor, itemsShort, PAY_LABEL, sacos, withDistrict } from '../helpers';
import { placeLabel, districtName } from '@mesagri/shared/ubigeo';
import { regGet, regSet, RoleHead, RucLookup, CodeInput, districtOptions } from './onboarding';
import { StatementView } from './farmer2';
import { RenewDoc } from './storage';
import { callPhone, openMap } from '../platform';
import { readQrFromFile } from '../media';
import { PrefsSheet, PrivacySheet, NameSheet, PermsSheet } from './common';
import { canAskPermissions } from '../platform';
import type { Org, Shipment, World, DocItem, Evidence, PayMethod } from '@mesagri/shared/types';

const net = (sh: Shipment) => r2(sh.freight * (1 - sh.commissionRate));
const ACTIVE: Shipment['status'][] = ['ASSIGNED', 'GOING_TO_PICKUP', 'PICKED_UP', 'ARRIVED'];
const initialsOf = (name?: string) => (name ?? '··').split(' ').filter(Boolean).slice(0, 2).map(x => x[0]).join('');
function mine(w: World, orgId: string) { return Object.values(w.shipments).filter(s => s.carrierOrgId === orgId); }
function offersFor(w: World, orgId: string) { return Object.values(w.shipments).filter(s => s.status === 'OFFERING' && currentOffer(s)?.carrierOrgId === orgId); }
function pickupLabel(w: World, sh: Shipment): { title: string; sub: string } {
  const s = w.subOrders[sh.subOrderId];
  const seller = w.orgs[sh.sellerOrgId];
  const rel = s?.fromLot ? Object.values(w.releases).find(r => r.subOrderId === s.id && r.status !== 'EXPIRED') : undefined;
  const lot = rel ? w.lots[rel.lotId] : undefined;
  const wh = lot ? w.orgs[lot.facilityOrgId] : undefined;
  if (wh) return { title: wh.name, sub: `${placeLabel(wh.district)} · orden de salida ${rel!.code}` };
  return { title: `Chacra de ${seller?.name ?? ''}`, sub: placeLabel(seller?.district) };
}
function destLabel(w: World, sh: Shipment, full = false): { title: string; sub: string } {
  const b = w.orgs[sh.buyerOrgId];
  const s = w.subOrders[sh.subOrderId];
  return { title: b?.name ?? '', sub: full && s ? `${withDistrict(s.address, districtName(s.district))}${b?.receiver ? ` · recibe ${b.receiver}` : ''}` : placeLabel(b?.district) };
}
const cargoText = (w: World, sh: Shipment) => { const s = w.subOrders[sh.subOrderId]; return `${s ? product(s.items[0].productId).name : 'Carga'} · ${sacos(sh.sacks)} (${fkg(sh.weightKg)})`; };

/* ================= Registro ================= */

/* ---------- T-01 · Tus datos ---------- */
function CarrierData() {
  const A = useApp();
  const R = regGet(A);
  const C = R.car ?? {};
  const [kind, setKind] = useState<'PERSONA' | 'EMPRESA'>(C.kind ?? 'PERSONA');
  const [ruc, setRuc] = useState<string>(R.ruc ?? '');
  const [legal, setLegal] = useState<string>(R.legalName ?? '');
  const [vclass, setVclass] = useState<'V1' | 'V2' | 'V3'>(C.vclass ?? 'V2');
  const [district, setDistrict] = useState<string>(R.district ?? '040201');
  const [err, setErr] = useState('');
  const next = () => {
    if (!(ruc.length === 11 && isRucValid(ruc))) { setErr('Escribe un RUC válido de 11 dígitos.'); return; }
    if (kind === 'PERSONA' && !ruc.startsWith('10')) { setErr('Una persona con negocio tiene un RUC que empieza con 10.'); return; }
    if (kind === 'EMPRESA' && !ruc.startsWith('20')) { setErr('El RUC de una empresa empieza con 20.'); return; }
    const pad = A.w.padron[ruc];
    if (pad && (pad.estado !== 'ACTIVO' || pad.condicion !== 'HABIDO')) { setErr('La SUNAT muestra este RUC como no habido o de baja: regularízalo y vuelve (RN-19).'); return; }
    if (Object.values(A.w.orgs).some(o => o.ruc === ruc)) { setErr('Ese RUC ya tiene una cuenta en Mesagri.'); return; }
    const name = pad?.name ?? legal;
    if (!name.trim()) { setErr('Escribe la razón social o tu nombre como figura en la SUNAT.'); return; }
    regSet(A, { ruc, legalName: name, bizName: name.replace(/\s\(persona con RUC\)$/i, ''), district, car: { ...C, kind, vclass } });
    A.go('A-02');
  };
  return (
    <Screen title="Crear cuenta" foot={<><Btn full onClick={next}>Continuar</Btn><div className="why">No se aceptan autos, mototaxis, trimotos ni camiones de más de 12 toneladas.</div></>}>
      <div className="stack">
        <RoleHead role="CARRIER" step={1} label="Tus datos" />
        <Seg value={kind} onChange={(v) => { setKind(v); setErr(''); }} options={[{ v: 'PERSONA', l: 'Persona con RUC' }, { v: 'EMPRESA', l: 'Empresa' }]} />
        <RucLookup ruc={ruc} setRuc={(v) => { setRuc(v); setErr(''); }} onFound={setLegal} />
        {ruc.length === 11 && !A.w.padron[ruc] && <Field label={kind === 'PERSONA' ? 'Tu nombre como figura en la SUNAT' : 'Razón social'}><Inp value={legal} onInput={setLegal} label="Razón social" /></Field>}
        <div className="lbl">¿Qué vehículo tienes?</div>
        <div className="chips">{(['V1', 'V2', 'V3'] as const).map(v => <ChipBtn key={v} on={vclass === v} onClick={() => setVclass(v)}>{VCLASS_INFO[v].label}</ChipBtn>)}</div>
        <p className="cap" style={{ margin: "-.2em 0 0" }}>{VCLASS_INFO[vclass].label}: hasta {numTrim(VCLASS_INFO[vclass].maxKg)} kg · {VCLASS_INFO[vclass].where.toLowerCase()} · licencia {VCLASS_INFO[vclass].license}.</p>
        <Field label="¿Dónde guardas tu vehículo?"><Sel value={district} onChange={setDistrict} options={districtOptions(() => true)} label="Distrito" /></Field>
        <Card tone="soft"><div className="row top"><Icon n="percent" /><span className="bodym">Registrarte y verificarte es gratis. Mesagri cobra el 10 % de cada flete que hagas por la app, una vez al mes. Nada más.</span></div></Card>
        {err && <Note icon="circle-alert" tone="danger">{err}</Note>}
      </div>
    </Screen>
  );
}

/* ---------- T-02 · Conductor y licencia ---------- */
function CarrierDriver() {
  const A = useApp();
  const R = regGet(A);
  const C = R.car ?? {};
  const [name, setName] = useState<string>(C.driverName ?? (C.kind === 'PERSONA' ? (R.legalName ?? '') : ''));
  const [dni, setDni] = useState<string>(C.dni ?? '');
  const [dniPh, setDniPh] = useState<string | undefined>(C.dniPhoto);
  const [selfie, setSelfie] = useState<string | undefined>(C.selfie);
  const [cls, setCls] = useState<string>(C.licenseCls ?? VCLASS_INFO[(C.vclass ?? 'V2') as 'V2'].license);
  const [exp, setExp] = useState<string>(C.licenseExp ?? '');
  const [licPh, setLicPh] = useState<string | undefined>(C.licPhoto);
  const [record, setRecord] = useState<string | undefined>(C.record);
  const [err, setErr] = useState('');
  const vclass = (C.vclass ?? 'V2') as 'V1' | 'V2' | 'V3';
  const next = () => {
    if (name.trim().split(' ').length < 2) { setErr('Escribe el nombre completo de quien maneja.'); return; }
    if (!/^\d{8}$/.test(dni)) { setErr('El DNI tiene 8 números.'); return; }
    if (Object.values(A.w.users).some(u => u.dni === dni)) { setErr('Ese DNI ya pertenece a otra cuenta (RN-18).'); return; }
    if (!dniPh || !selfie) { setErr('Sube la foto del DNI y tómate una selfie en la app.'); return; }
    if (!licenseMatches(vclass, cls)) { setErr(`Tu licencia ${cls} no sirve para ${VCLASS_INFO[vclass].label.toLowerCase()}: pide ${VCLASS_INFO[vclass].license}.`); return; }
    if (!exp || new Date(exp + 'T12:00:00-05:00').getTime() < A.now) { setErr('Escribe la fecha de vencimiento de tu licencia (vigente).'); return; }
    if (!licPh) { setErr('Sube la foto de tu licencia.'); return; }
    regSet(A, { name: name.trim(), car: { ...C, driverName: name.trim(), dni, dniPhoto: dniPh, selfie, licenseCls: cls, licenseExp: exp, licPhoto: licPh, record } });
    A.go('T-03');
  };
  const row = (ok: boolean, title: string, sub: string, picker: any) => (
    <div className="stack tight" style={{ padding: ".55em 0" }}>
      <div className="row top"><span className={'icirc ' + (ok ? 'dark' : '')} style={{ width: "1.9em", height: "1.9em" }}>{ok ? <Icon n="check" s="1em" w={3} /> : <Icon n="upload" s="1em" />}</span><div className="grow"><b className="bodym">{title}</b><div className="cap">{sub}</div></div></div>
      <div style={{ paddingLeft: "2.6em" }}>{picker}</div>
    </div>
  );
  return (
    <Screen title="Conductor" sub="Cuenta de transportista aliado" foot={<Btn full onClick={next}>Continuar</Btn>}>
      <div className="stack">
        <RoleHead role="CARRIER" step={2} label="Quién maneja" />
        <div className="grid2">
          <Field label="Nombre completo"><Inp value={name} onInput={setName} label="Nombre completo" /></Field>
          <Field label="DNI"><Inp value={dni} onInput={(v) => setDni(v.replace(/\D/g, '').slice(0, 8))} mode="numeric" label="DNI" /></Field>
        </div>
        <Card><div className="list">
          {row(!!dniPh, 'DNI por ambos lados', 'Coincide con el RUC · RENIEC', <PhotoPick value={dniPh} onChange={setDniPh} label="DNI" kind="dni" />)}
          {row(!!selfie, 'Selfie de comprobación', 'Tomada hoy en la app', <PhotoPick value={selfie} onChange={setSelfie} label="Selfie" kind="selfie" />)}
          <div className="stack tight" style={{ padding: ".55em 0" }}>
            <div className="row top"><span className={'icirc ' + (licPh && exp ? 'dark' : '')} style={{ width: "1.9em", height: "1.9em" }}>{licPh && exp ? <Icon n="check" s="1em" w={3} /> : <Icon n="upload" s="1em" />}</span><div className="grow"><b className="bodym">Licencia de conducir</b><div className="cap">{exp ? `Vence el ${dateNum(new Date(exp + 'T12:00:00-05:00').getTime())} · ` : ''}{licenseMatches(vclass, cls) ? `sirve para tu ${VCLASS_INFO[vclass].label.toLowerCase()} (${VCLASS_INFO[vclass].category})` : 'no corresponde a tu vehículo'}</div></div></div>
            <div className="grid2" style={{ paddingLeft: "2.6em" }}><Sel value={cls} onChange={setCls} options={['B-IIb', 'A-I', 'A-IIa', 'A-IIb'].map(x => ({ v: x, l: x }))} label="Clase de licencia" /><input className="inp" type="date" value={exp} onChange={(e: any) => setExp(e.currentTarget.value)} aria-label="Vencimiento de la licencia" /></div>
            <div style={{ paddingLeft: "2.6em" }}><PhotoPick value={licPh} onChange={setLicPh} label="Licencia" kind="licencia" /></div>
          </div>
          {row(!!record, 'Récord de conductor (opcional)', 'Sin faltas graves en 12 meses · súbelo desde el MTC', <PhotoPick value={record} onChange={setRecord} label="Récord de conductor" kind="dni" />)}
        </div></Card>
        <div className="sect">Qué licencia pide cada vehículo</div>
        <Card><Kv rows={[['Moto con cajuela (L3)', 'B-IIb'], ['Camioneta o furgón (N1)', 'A-I'], ['Camión ligero (N2)', 'A-IIb']]} /></Card>
        <Note icon="users">Si otra persona va a manejar tu vehículo, agrégala después como conductor: también se verifica.</Note>
        {err && <Note icon="circle-alert" tone="danger">{err}</Note>}
      </div>
    </Screen>
  );
}

/* ---------- T-03 · Tu vehículo ---------- */
function CarrierVehicle() {
  const A = useApp();
  const R = regGet(A);
  const C = R.car ?? {};
  const vclass = (C.vclass ?? 'V2') as 'V1' | 'V2' | 'V3';
  const info = VCLASS_INFO[vclass];
  const [plate, setPlate] = useState<string>(C.plate ?? '');
  const [payload, setPayload] = useState<string>(String(C.payloadKg ?? info.maxKg));
  const [body, setBody] = useState<string>(C.body ?? (vclass === 'V1' ? 'Moto con cajuela' : vclass === 'V3' ? 'Camión ligero con toldo' : 'Furgón cerrado'));
  const [year, setYear] = useState<string>(String(C.year ?? 2019));
  const [docs, setDocs] = useState<Record<string, string>>(C.docs ?? {});
  const [ph, setPh] = useState<(string | undefined)[]>(C.photos ?? [undefined, undefined, undefined, undefined]);
  const [err, setErr] = useState('');
  const habil = vclass === 'V1' ? { k: 'MUNI', l: 'Registro municipal de entrega rápida', s: 'De la municipalidad · en vez del TUC' } : { k: 'MTC', l: 'Autorización del MTC y TUC', s: 'Habilita tu vehículo para llevar carga de otros' };
  const list = [{ k: 'SOAT', l: 'SOAT', s: 'Vigente' }, { k: 'CITV', l: 'Inspección técnica (CITV)', s: 'Anual desde el 3.er año' }, habil];
  const next = () => {
    if (!/^[A-Z0-9]{3}-?[A-Z0-9]{3}$/i.test(plate.trim())) { setErr('Escribe la placa como V7K-812.'); return; }
    const kgv = Number(payload);
    if (!(kgv > 0) || kgv > info.maxKg) { setErr(`La carga útil para ${info.label.toLowerCase()} es de hasta ${numTrim(info.maxKg)} kg.`); return; }
    for (const d of list) if (!docs[d.k] || new Date(docs[d.k] + 'T12:00:00-05:00').getTime() < A.now) { setErr(`Escribe la fecha de vencimiento vigente de: ${d.l}.`); return; }
    if (ph.filter(Boolean).length < 4) { setErr('Toma las 4 fotos del vehículo: frente, costado, placa y zona de carga.'); return; }
    regSet(A, { car: { ...C, plate: plate.trim().toUpperCase(), payloadKg: kgv, body, year: Number(year) || 2018, docs, photos: ph } });
    A.go('T-04');
  };
  return (
    <Screen title="Tu vehículo" sub="Cuenta de transportista aliado" foot={<><Btn full onClick={next}>Continuar</Btn>{vclass === 'V1' && <div className="why">Moto con cajuela: en vez de TUC se pide tu registro municipal de entrega rápida.</div>}</>}>
      <div className="stack">
        <RoleHead role="CARRIER" step={3} label="Vehículo y papeles" />
        <div className="grid2">
          <Field label="Placa"><Inp value={plate} onInput={(v) => setPlate(v.toUpperCase())} placeholder="V7K-812" label="Placa" /></Field>
          <Field label="Carga útil"><Inp value={payload} onInput={(v) => setPayload(v.replace(/\D/g, ''))} mode="numeric" suffix="kg" label="Carga útil en kg" /></Field>
        </div>
        <div className="chips">{(vclass === 'V1' ? ['Moto con cajuela'] : vclass === 'V3' ? ['Camión ligero con toldo', 'Camión furgón'] : ['Furgón cerrado', 'Camioneta con toldo']).map(b => <ChipBtn key={b} on={body === b} onClick={() => setBody(b)}>{b}</ChipBtn>)}</div>
        <Card tone="soft"><div className="row top"><Icon n="circle-check" /><div className="bodym">{body} · categoría {info.category} · {year}<div className="cap">A tu nombre en la tarjeta de identificación vehicular</div></div><div style={{ width: "5em" }}><Inp value={year} onInput={(v) => setYear(v.replace(/\D/g, '').slice(0, 4))} mode="numeric" label="Año" /></div></div></Card>
        <Card><div className="list">
          {list.map(d => (
            <div key={d.k} className="row top" style={{ padding: ".55em 0" }}>
              <span className={'icirc ' + (docs[d.k] ? 'dark' : 'warn')} style={{ width: "1.9em", height: "1.9em" }}>{docs[d.k] ? <Icon n="check" s="1em" w={3} /> : <Icon n="triangle-alert" s="1em" />}</span>
              <div className="grow"><b className="bodym">{d.l}</b><div className="cap">{docs[d.k] ? `Vence el ${dateNum(new Date(docs[d.k] + 'T12:00:00-05:00').getTime())}` : d.s}</div></div>
              <input className="inp" type="date" style={{ maxWidth: "9.5em", minHeight: "2.6em", fontSize: ".85em" }} value={docs[d.k] ?? ''} onChange={(e: any) => setDocs({ ...docs, [d.k]: e.currentTarget.value })} aria-label={`Vencimiento de ${d.l}`} />
            </div>
          ))}
        </div></Card>
        <div className="photos" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>{['Frente', 'Costado', 'Placa', 'Zona de carga'].map((l, i) => <PhotoPick key={l} value={ph[i]} onChange={(v) => { const n = [...ph]; n[i] = v; setPh(n); }} label={l} kind="vehiculo" sample={{ value: plate || 'V7K-812' }} />)}</div>
        {err && <Note icon="circle-alert" tone="danger">{err}</Note>}
      </div>
    </Screen>
  );
}

/* ---------- T-04 · Rutas y horarios ---------- */
function CarrierRoutes() {
  const A = useApp();
  const R = regGet(A);
  const C = R.car ?? {};
  const vclass = (C.vclass ?? 'V2') as 'V1' | 'V2' | 'V3';
  const city = A.w.settings.routes.find(r => r.scope === 'CIUDAD')!;
  const inter = A.w.settings.routes.filter(r => r.scope === 'RUTA');
  const [scope, setScope] = useState<'CIUDAD' | 'RUTA'>(vclass === 'V1' ? 'CIUDAD' : C.scope ?? 'RUTA');
  const [routeId, setRouteId] = useState<string>(C.routeId ?? (vclass === 'V1' ? city.id : inter[0].id));
  const [days, setDays] = useState<number[]>(C.days ?? [1, 3, 5]);
  const [dep, setDep] = useState<string>(C.departs ?? (scope === 'CIUDAD' ? '08:00' : '15:00'));
  const [arr, setArr] = useState<string>(C.arrives ?? (scope === 'CIUDAD' ? '13:00' : '18:30'));
  const [err, setErr] = useState('');
  const route = A.w.settings.routes.find(r => r.id === (scope === 'CIUDAD' ? city.id : routeId))!;
  const origin = route.origin === 'CAMANA' ? '040201' : route.origin === 'CAYLLOMA' ? '040501' : '040126';
  const next = () => {
    if (!days.length) { setErr('Elige al menos un día.'); return; }
    if (!/^\d{1,2}:\d{2}$/.test(dep) || !/^\d{1,2}:\d{2}$/.test(arr)) { setErr('Escribe las horas como 15:00.'); return; }
    regSet(A, { car: { ...C, scope, routeId: route.id, days: [...days].sort(), departs: dep, arrives: arr } });
    A.go('T-05');
  };
  return (
    <Screen title="Rutas y horarios" sub="Cuenta de transportista aliado" foot={<><Btn full onClick={next}>Continuar</Btn><div className="why">La tarifa es la misma para todos en la ruta: así el negocio sabe cuánto paga antes de pedir.</div></>}>
      <div className="stack">
        <RoleHead role="CARRIER" step={4} label="Dónde y cuándo trabajas" />
        <Seg value={scope} onChange={(v) => { if (v === 'RUTA' && vclass === 'V1') { A.toast('La moto con cajuela solo reparte dentro de Arequipa (RN-53).', 'info'); return; } if (v === 'CIUDAD' && vclass === 'V3') { A.toast('El camión ligero solo hace rutas entre provincias.', 'info'); return; } setScope(v); setDep(v === 'CIUDAD' ? '08:00' : '15:00'); setArr(v === 'CIUDAD' ? '13:00' : '18:30'); }} options={[{ v: 'CIUDAD', l: 'Dentro de Arequipa' }, { v: 'RUTA', l: 'Entre provincias' }]} />
        {scope === 'RUTA' && <div className="chips">{inter.map(r => <ChipBtn key={r.id} on={routeId === r.id} onClick={() => setRouteId(r.id)}>{r.name}</ChipBtn>)}</div>}
        <MapSketch from={origin} to="040101" progress={0} km={route.distanceKm} fromLabel={districtName(origin)} toLabel="Arequipa" truck={false} height="8.5em" />
        <div className="lbl">Días que haces la ruta</div>
        <div className="chips">{[1, 2, 3, 4, 5, 6, 7].map(d => <ChipBtn key={d} on={days.includes(d)} onClick={() => setDays(days.includes(d) ? days.filter(x => x !== d) : [...days, d])}>{DOW_CHIP[d]}</ChipBtn>)}</div>
        <div className="grid2">
          <Field label={scope === 'CIUDAD' ? 'Empiezas' : `Sales de ${districtName(origin)}`}><Inp value={dep} onInput={setDep} placeholder="15:00" suffix={<Icon n="clock" />} label="Hora de salida" /></Field>
          <Field label={scope === 'CIUDAD' ? 'Terminas' : 'Llegas a Arequipa'}><Inp value={arr} onInput={setArr} placeholder="18:30" suffix={<Icon n="clock" />} label="Hora de llegada" /></Field>
        </div>
        <Card><Kv rows={scope === 'CIUDAD' ? [['Reparto en moto (hasta 20 kg)', money(route.cityMoto)], ['Reparto en camioneta', money(route.cityVan)], ['De cada flete te quedas con', pct(1 - A.w.settings.carrier.commission)]] : [['Tarifa de referencia', `${money(route.pricePerKg)} por kg`], ['Mínimo por pedido', money(route.minFee)], ['De cada flete te quedas con', pct(1 - A.w.settings.carrier.commission)]]} /></Card>
        {err && <Note icon="circle-alert" tone="danger">{err}</Note>}
      </div>
    </Screen>
  );
}

/* ---------- T-05 · Cobro y convenio ---------- */
const AGREEMENT = [
  'El negocio te paga el flete directo cuando recibe. Mesagri no guarda tu dinero.',
  'Pagas a Mesagri el 10 % de tus fletes una vez al mes (vence el día 10).',
  'Respondes por la carga desde que la recoges hasta que la entregas.',
  'Llevas alimentos limpios y secos: nunca junto a químicos, combustible o animales.',
  'Emites tu guía de remisión cuando la SUNAT la exige.',
];
function CarrierAgreement() {
  const A = useApp();
  const R = regGet(A);
  const C = R.car ?? {};
  const [kind, setKind] = useState<'YAPE' | 'BANK' | 'CASH'>('YAPE');
  const [acct, setAcct] = useState<string>(R.phone ?? '');
  const [agree, setAgree] = useState(false);
  const slots = [2, 3, 4, 5].map(n => startOfDay(A.now) + n * DAY + 9 * HOUR);
  const [visit, setVisit] = useState<number>(slots[1]);
  const [err, setErr] = useState('');
  const send = () => {
    if (kind !== 'CASH' && acct.replace(/\D/g, '').length < 9) { setErr(kind === 'BANK' ? 'Escribe tu CCI de 20 dígitos.' : 'Escribe tu número de Yape o Plin.'); return; }
    if (!agree) { setErr('Lee y acepta el convenio para continuar.'); return; }
    const userId = 'u-' + uid(), orgId = 'org-' + uid();
    const iso = (s?: string) => (s ? new Date(s + 'T12:00:00-05:00').getTime() : undefined);
    const docLabel: Record<string, string> = { SOAT: 'SOAT', CITV: 'Inspección técnica (CITV)', MTC: 'Autorización del MTC y TUC', MUNI: 'Registro municipal de entrega rápida' };
    const docs: DocItem[] = Object.entries(C.docs ?? {}).map(([k, v]) => ({ kind: k, label: docLabel[k] ?? k, expiresOn: iso(v as string), status: 'PENDING', note: 'Por revisar' }));
    docs.push({ kind: 'SEGURO', label: 'Seguro de carga', status: 'MISSING', note: 'Opcional · te acerca al nivel T3' });
    const r = A.act('USER_REGISTER', {
      userId, orgId, role: 'CARRIER', phone: R.phone, name: C.driverName ?? R.legalName, dni: C.dni, lang: 'es',
      org: { ruc: R.ruc, legalName: R.legalName, name: C.kind === 'EMPRESA' ? R.bizName : `Transportes ${String(C.driverName ?? R.legalName).split(' ').slice(-2, -1)[0] ?? ''}`.trim(), district: R.district },
      carrier: { vclass: C.vclass, plate: C.plate, payloadKg: C.payloadKg, body: C.body, year: C.year, docs, licenseCls: C.licenseCls, licenseExpires: iso(C.licenseExp), routes: [{ routeId: C.routeId, days: C.days, departs: C.departs, arrives: C.arrives }], agreement: true },
    }, { as: userId, quiet: true });
    if (!r.ok) { setErr(r.error!.message); return; }
    A.act('CONSENTS_ACCEPT', { version: '1.0', items: R.consents ?? { distrito: true, dni: true } }, { as: userId, quiet: true });
    A.act('PAYOUT_SET', { orgId, accounts: kind === 'CASH' ? [] : [{ id: 'pa-' + uid(), kind, number: acct.replace(/\D/g, ''), holder: C.driverName ?? R.legalName, relation: 'PROPIA' }], acceptsCash: true }, { as: userId, quiet: true });
    A.act('CARRIER_AGREEMENT', {}, { as: userId, quiet: true });
    const evidence: Evidence[] = [
      { key: 'dni', label: 'DNI (ambas caras)', photoId: C.dniPhoto }, { key: 'selfie', label: 'Selfie', photoId: C.selfie },
      { key: 'licencia', label: `Licencia ${C.licenseCls}`, photoId: C.licPhoto, detail: `Vence ${C.licenseExp}` },
      ...Object.entries(C.docs ?? {}).map(([k, v]) => ({ key: k.toLowerCase(), label: docLabel[k] ?? k, detail: `Vence ${v}` })),
      { key: 'fotos', label: '4 fotos del vehículo', photoId: (C.photos ?? []).find(Boolean) },
      { key: 'cita', label: `Revisión del vehículo agendada para el ${dateShort(visit)} ${hhmm(visit)}` },
    ];
    if (C.record) evidence.push({ key: 'record', label: 'Récord de conductor', photoId: C.record });
    A.act('VERIF_SUBMIT', { caseId: 'case-' + uid(), orgId, targetLevel: 2, evidence }, { as: userId, quiet: true });
    A.patch(d => { d.userId = userId; d.stack = [{ s: 'T-08' }, { s: 'T-06' }]; d.flow = { visitAt: visit }; });
    A.toast('Enviamos tu cuenta a revisión. Ahora agenda la revisión del vehículo y haz la capacitación.');
  };
  return (
    <Screen title="Cobro y convenio" sub="Cuenta de transportista aliado" foot={<Btn full kind="forest" onClick={send}>Firmar y enviar a revisión</Btn>}>
      <div className="stack">
        <RoleHead role="CARRIER" step={5} label="Cómo cobras y qué aceptas" />
        <div className="lbl">¿Dónde te pagan el flete?</div>
        <Seg value={kind} onChange={setKind} options={[{ v: 'YAPE', l: 'Yape o Plin' }, { v: 'BANK', l: 'Cuenta bancaria' }, { v: 'CASH', l: 'Efectivo' }]} />
        {kind !== 'CASH' && <Field label={kind === 'BANK' ? 'CCI (20 dígitos)' : 'Número de Yape'}><Inp value={acct} onInput={setAcct} mode="numeric" suffix={<Icon n="smartphone" />} label="Número de cobro" /></Field>}
        <Card>
          <div className="row between"><b className="bodym">Convenio de transportista aliado</b><Spk text={AGREEMENT.join(' ')} label="Oír el convenio" /></div>
          <div className="stack tight mt">{AGREEMENT.map(t => <div key={t} className="row top g8"><Icon n="check" s="1.05em" /><span className="bodym" style={{ fontSize: ".86em" }}>{t}</span></div>)}</div>
          <div className="mt"><Tog on={agree} onChange={setAgree} label="Leí y acepto el convenio (versión 1.0)" /></div>
        </Card>
        <div className="lbl">Agenda la revisión del vehículo (20 puntos)</div>
        <div className="chips">{slots.map(d => <ChipBtn key={d} on={visit === d} onClick={() => setVisit(d)}>{dateShort(d)} · {hhmm(d)}</ChipBtn>)}</div>
        <p className="cap" style={{ margin: "-.2em 0 0" }}>Con el promotor de Mesagri en {districtName(R.district)}. Dura unos 30 minutos.</p>
        {err && <Note icon="circle-alert" tone="danger">{err}</Note>}
      </div>
    </Screen>
  );
}

/* ---------- T-06 · Revisión y capacitación ---------- */
export const TRAINING = [
  { t: 'Cuidar los alimentos en el camino', min: 4, body: ['Lleva la carga seca y tapada: lona o toldo que cubra todo.', 'Los sacos van sobre parihuelas, nunca directo al piso.', 'Nunca junto a químicos, combustible, plaguicidas ni animales.', 'Si llueve, avisa y protege la carga antes de seguir.'] },
  { t: 'Recojo con QR y entrega con código', min: 4, body: ['En el recojo escaneas el QR del agricultor o la orden de salida del almacén.', 'Cuenta los sacos y pesa con la balanza: anota y toma fotos.', 'Desde que recoges, la carga está a tu cargo hasta entregarla (RN-59).', 'Al entregar, el negocio te dicta su código de 4 dígitos. Sin código no hay entrega (RN-58).'] },
  { t: 'Guía de remisión y controles en ruta', min: 4, body: ['En camioneta, furgón o camión, la guía del transportista es obligatoria.', 'Lleva la guía del remitente cuando el agricultor tiene RUC.', 'En un control, muestra tus papeles con calma y avisa en la app si te demoras.', 'Ante un accidente o robo: primero tu seguridad. Llama al 105 y avisa en la app.'] },
];
function ReviewTraining() {
  const A = useApp();
  const org = A.org!;
  const c = org.carrier!;
  const kase = Object.values(A.w.cases).filter(k => k.orgId === org.id).sort((a, b) => b.submittedAt - a.submittedAt)[0];
  const citaTxt = kase?.evidence.find(e => e.key === 'cita')?.label.replace('Revisión del vehículo agendada para el ', '') ?? (A.dev.flow.visitAt ? `${dateShort(A.dev.flow.visitAt)} ${hhmm(A.dev.flow.visitAt)}` : '');
  const ins = c.inspection;
  const POINTS = ['Zona de carga limpia, seca y sin olores', 'Sin restos de químicos, combustible ni plaguicidas', 'Lona o parihuela: los sacos no van directo al piso', 'Furgón cerrado o toldo que cubra toda la carga', 'Sogas o fajas, luces y llantas en buen estado', 'Extintor vigente, botiquín y triángulos'];
  const nextMod = TRAINING[c.training.done];
  return (
    <Screen title="Revisión del vehículo" sub="Último paso para recibir envíos" foot={c.training.done < c.training.total ? <Btn full onClick={() => A.sheet(<TrainingSheet i={c.training.done} />)}>Seguir la capacitación ({TRAINING.slice(c.training.done).reduce((a, m) => a + m.min, 0)} min)</Btn> : c.level === 'T2' || c.level === 'T3' ? <Btn full kind="forest" onClick={() => A.reset('T-08')}>Ir a mi inicio</Btn> : undefined}>
      <div className="stack">
        <Card tone="dark">
          {ins ? <><div className="cap b" style={{ letterSpacing: ".1em", color: "var(--leaf)" }}>REVISIÓN HECHA</div><div className="row between"><b className="h3" style={{ color: "#fff" }}>{ins.score} de 100 · {ins.criticalFails ? `${ins.criticalFails} fallas críticas` : 'sin fallas críticas'}</b><Icon n="clipboard-check" s="1.6em" /></div><div className="cap">{dateShort(ins.at)} · con el promotor de Mesagri · se repite cada 6 meses</div></>
            : <><div className="cap b" style={{ letterSpacing: ".1em", color: "var(--leaf)" }}>TU CITA</div><div className="row between"><b className="h3" style={{ color: "#fff" }}>{citaTxt || 'Por agendar'}</b><Icon n="calendar" s="1.6em" /></div><div className="cap">{districtName(org.district)} · con el promotor de Mesagri</div></>}
        </Card>
        <div className="sect">Se revisan 20 puntos · mínimo {A.w.settings.carrier.minScore} de 100</div>
        <Card><div className="stack tight">{POINTS.map(p => <div key={p} className="row top g8"><span className={'icirc ' + (ins ? 'dark' : '')} style={{ width: "1.5em", height: "1.5em" }}>{ins ? <Icon n="check" s=".85em" w={3} /> : null}</span><span className="bodym" style={{ fontSize: ".88em" }}>{p}</span></div>)}</div></Card>
        <Card>
          <div className="row between"><b className="bodym">Capacitación en el celular</b><Chip tone={c.training.done >= c.training.total ? 'leaf' : 'warn'}>{c.training.done} de {c.training.total}</Chip></div>
          <div className="mt"><Prog v={c.training.done / c.training.total} /></div>
          <div className="list mt">{TRAINING.map((m, i) => <button key={m.t} className="li" onClick={() => A.sheet(<TrainingSheet i={i} />)}><ICirc n={i < c.training.done ? 'circle-check' : 'circle-play'} tone={i < c.training.done ? '' : 'terra'} /><div className="grow"><b className="bodym">{m.t}</b><div className="cap">{m.min} min{i < c.training.done ? ' · hecho' : i === c.training.done ? ' · sigue aquí' : ''}</div></div><Icon n="chevron-right" s="1.1em" /></button>)}</div>
        </Card>
        {nextMod === undefined && !ins && <Note icon="info">Terminaste la capacitación. Cuando el promotor apruebe tu vehículo, verificación decide tu nivel T2.</Note>}
        {kase && <Note icon="clipboard-list" tone={kase.status === 'NEEDS_INFO' || kase.status === 'REJECTED' ? 'danger' : 'soft'}>Expediente {kase.status === 'APPROVED' ? 'aprobado' : kase.status === 'NEEDS_INFO' ? `observado: ${kase.decision?.reason}` : kase.status === 'REJECTED' ? `rechazado: ${kase.decision?.reason}` : 'en revisión'} · enviado el {dateShort(kase.submittedAt)}.</Note>}
      </div>
    </Screen>
  );
}
function TrainingSheet({ i }: { i: number }) {
  const A = useApp();
  const m = TRAINING[i];
  const c = A.org!.carrier!;
  const done = i < c.training.done;
  return (
    <SheetBody title={m.t} sub={`Módulo ${i + 1} de ${TRAINING.length} · ${m.min} min`}>
      <div className="row g8"><Spk text={`${m.t}. ${m.body.join(' ')}`} label="Escuchar el módulo" /><span className="cap">Escúchalo o léelo</span></div>
      <Card><ol className="bodym" style={{ margin: "0", paddingLeft: "1.2em", display: "grid", gap: ".45em" }}>{m.body.map(b => <li key={b}>{b}</li>)}</ol></Card>
      {done ? <Btn full kind="sec" onClick={() => A.sheet(null)}>Cerrar</Btn>
        : <Btn full onClick={() => { if (i > c.training.done) { A.toast('Primero termina el módulo anterior.', 'info'); return; } if (A.act('CARRIER_TRAINING', { done: i + 1 }, { ok: i + 1 >= TRAINING.length ? '¡Terminaste la capacitación!' : 'Módulo terminado.' }).ok) A.sheet(null); }}>Terminé este módulo</Btn>}
    </SheetBody>
  );
}

/* ---------- T-07 · Niveles de verificación ---------- */
function CarrierLevels() {
  const A = useApp();
  const org = A.org!;
  const c = org.carrier!;
  const cs = carrierStats(A.w, org.id);
  const n = Number(c.level.slice(1));
  const s = A.w.settings.carrier;
  const blockers = carrierBlockers(A.w, org, A.now);
  const lv = [
    { k: 'T0', t: 'Registrado', d: 'Celular y RUC validados con la SUNAT' },
    { k: 'T1', t: 'Documentos validados', d: `DNI, licencia ${c.driverLicense.cls}, SOAT, CITV y ${c.vehicle.vclass === 'V1' ? 'registro municipal' : 'TUC'} vigentes` },
    { k: 'T2', t: 'Verificado', d: `Revisión del vehículo${c.inspection ? ` ${c.inspection.score} de 100` : ''}, convenio firmado y capacitación completa` },
    { k: 'T3', t: 'Destacado', d: `${s.t3Shipments} envíos · ${String(s.t3Rating).replace('.', ',')} estrellas o más · ${pct(s.t3OnTime)} a tiempo · seguro de carga` },
  ];
  return (
    <Screen title="Tu verificación" sub={`${A.me!.shortName} · ${c.vehicle.body.toLowerCase()} ${c.vehicle.plate}`} foot={<Btn full kind="sec" onClick={() => A.go('T-18')}>Ver qué me falta para T3</Btn>}>
      <div className="stack">
        <Card><div className="list">{lv.map((l, i) => (
          <div key={l.k} className="row top" style={{ padding: ".6em 0" }}>
            <span className={'icirc ' + (i < n ? 'dark' : i === n ? '' : '')} style={i === n ? { background: "var(--terra)", color: "#fff" } : undefined}><b>{l.k}</b></span>
            <div className="grow"><div className="row between"><b className="bodym">{l.t}</b>{i < n ? <Chip tone="leaf">Listo</Chip> : i === n ? <Chip tone="field">Estás aquí</Chip> : null}</div><div className="cap">{l.d}</div></div>
          </div>
        ))}</div></Card>
        <div className="sect">Lo que puedes hacer hoy</div>
        <Card><Kv rows={[['Recibes ofertas de envío', blockers.length ? 'Todavía no' : 'Sí'], ['Valor de la carga por viaje', n >= 3 ? `hasta ${moneyShort(s.capT3)}` : n >= 2 ? `hasta ${moneyShort(s.capT2)}` : '—'], ['Con T3 y seguro de carga', `hasta ${moneyShort(s.capT3)}`], ['Orden en las ofertas', 'favoritos y luego calificación']]} /></Card>
        {blockers.length > 0 && <Note icon="circle-alert" tone="warn">{blockers.join(' · ')}</Note>}
        <Note icon="triangle-alert" tone="warn">Con un documento vencido, 3 inasistencias o la comisión sin pagar, la cuenta deja de recibir ofertas hasta regularizar (RN-52).</Note>
        {n < 2 && <Btn full kind="dark" onClick={() => A.go('T-06')}>Revisión del vehículo y capacitación</Btn>}
        <p className="cap center" style={{ margin: "0" }}>{cs.shipments} envíos hechos · {cs.rating ? `${String(cs.rating).replace('.', ',')} estrellas` : 'sin calificaciones todavía'}</p>
      </div>
    </Screen>
  );
}

/* ================= Operación ================= */

/* ---------- T-08 · Inicio ---------- */
function CarrierHome() {
  const A = useApp();
  const org = A.org!, me = A.me!, w = A.w;
  const c = org.carrier!;
  const cs = carrierStats(w, org.id);
  const offers = offersFor(w, org.id);
  const today = mine(w, org.id).filter(s => ACTIVE.includes(s.status) && sameDay(s.pickupAt, A.now) || (['PICKED_UP', 'ARRIVED'].includes(s.status)));
  const kgToday = today.reduce((a, s) => a + s.weightKg, 0);
  const route = c.routes[0];
  let nextDay: number | undefined;
  for (let i = 0; i < 14 && route; i++) { const t = startOfDay(A.now) + i * DAY; if (route.days.includes(lima(t).dow)) { nextDay = t; break; } }
  const weekStart = startOfDay(A.now) - (lima(A.now).dow - 1) * DAY;
  const week = mine(w, org.id).filter(s => s.delivery && s.delivery.at >= weekStart);
  const weekSum = r2(week.reduce((a, s) => a + s.freight, 0));
  const st = Object.values(w.statements).filter(s => s.orgId === org.id && ['ISSUED', 'OVERDUE', 'PAYMENT_REGISTERED'].includes(s.status)).sort((a, b) => b.period.localeCompare(a.period))[0];
  const blockers = carrierBlockers(w, org, A.now);
  const soon = [...expiringDocs(c.vehicle.docs, A.now, 45), ...expiredDocs(c.vehicle.docs, A.now)];
  const unread = notifsFor(w, org.id).filter(n => n.at > (Number(A.dev.flow.seenNotifs) || 0)).length;
  const p = lima(A.now);
  return (
    <Screen bar={
      <header className="bar home" style={{ flexDirection: "column", alignItems: "stretch", gap: ".35em" }}>
        <div className="row between top"><div><div className="cap" style={{ color: "#E7F0DC" }}>{dateShort(A.now)} · {districtName(org.district)}</div><h1 style={{ margin: "0", fontSize: "1.45em", fontWeight: "800" }}>Hola, {me.shortName}</h1></div>
          <div className="row g8"><BarAct icon="bell" label="Avisos" onClick={() => A.go('A-29')} dot={unread > 0} /></div></div>
        <div className="row between wrap">
          <div className="chips"><span className="chip terra"><Icon n="shield-check" s="1.05em" />{c.level} · {CARRIER_LEVEL_NAME[c.level]}</span><span className="chip" style={{ background: "rgba(255,255,255,.15)", color: "#fff" }}>★ {cs.rating ? String(cs.rating).replace('.', ',') : '—'} · {cs.shipments} envíos</span></div>
          <label className="row g8" style={{ color: "#fff", fontWeight: "800", fontSize: ".85em" }}>{c.available ? 'Disponible' : 'No disponible'}<button className={'tog' + (c.available ? ' on' : '')} role="switch" aria-checked={c.available ? 'true' : 'false'} aria-label="Disponible para recibir ofertas" onClick={() => A.act('CARRIER_AVAILABLE', { available: !c.available }, { ok: c.available ? 'Ya no recibes ofertas nuevas.' : 'Listo: recibes ofertas de tu ruta.' })} /></label>
        </div>
      </header>
    }>
      <div className="stack">
        {blockers.length > 0 && <button className="card warn" onClick={() => A.go(Number(c.level.slice(1)) < 2 ? 'T-06' : 'T-07')}><div className="row"><Icon n="shield-check" /><div className="grow"><b className="bodym">Todavía no recibes ofertas</b><div className="cap" style={{ color: "inherit" }}>{blockers.join(' · ')}</div></div><Icon n="chevron-right" s="1.1em" /></div></button>}
        <Card>
          <div className="row between top"><div><div className="cap b" style={{ letterSpacing: ".1em" }}>TU RUTA DE HOY</div>{today.length ? <><b className="h3">{today.length} {today.length === 1 ? 'envío' : 'envíos'} · {fkg(kgToday)}</b><div className="cap">Sales {hhmm(Math.min(...today.map(s => s.pickupAt)))} · llegas a Arequipa {hhmm(Math.max(...today.map(s => s.deliverFrom)))}</div></> : <><b className="h3">Hoy no tienes envíos</b><div className="cap">{route ? `Tu ruta: ${A.w.settings.routes.find(r => r.id === route.routeId)?.name} · ${route.days.map(d => DOW_CHIP[d]).join(', ')}` : 'Sin ruta registrada'}{nextDay && !sameDay(nextDay, A.now) ? ` · próxima: ${dateShort(nextDay)}` : ''}</div></>}</div>
            {today.length > 0 && <Btn xs kind="dark" onClick={() => A.reset('T-11')}>Ver ruta</Btn>}</div>
          {today.length > 0 && <><div className="mt"><Prog v={kgToday / c.vehicle.payloadKg} tone="terra" /></div><div className="cap mt">Llevas {fkg(kgToday)} de {numTrim(c.vehicle.payloadKg)} kg: te quedan {fkg(Math.max(0, c.vehicle.payloadKg - kgToday))} libres</div></>}
        </Card>
        {offers.map(sh => { const o = currentOffer(sh)!; return (
          <button key={sh.id} className="card" style={{ border: "2.5px solid var(--terra3)", boxShadow: "none", textAlign: "left" }} onClick={() => A.go('T-09', { id: sh.id })}>
            <div className="row between"><span className="chip terra">OFERTA NUEVA</span><span className="chip warn"><Icon n="clock" s="1em" />{duration(Math.max(0, o.expiresAt - A.now))}</span></div>
            <div className="row between top mt"><div><b className="bodym">{cargoText(w, sh)}</b><div className="cap">{districtName(w.orgs[sh.sellerOrgId]?.district)} → {districtName(w.orgs[sh.buyerOrgId]?.district)} · {dateShort(sh.pickupAt)}</div></div><div className="right"><b className="price">{money(sh.freight)}</b><div className="cap">recibes {money(net(sh))}</div></div></div>
          </button>
        ); })}
        <div className="grid2">
          <Stat n={money(weekSum)} l={`Fletes de la semana · ${week.length} ${week.length === 1 ? 'cobrado' : 'cobrados'}`} onClick={() => A.reset('T-16')} />
          <Stat n={money(r2(weekSum * (1 - A.w.settings.carrier.commission)))} l={`Te quedas con · ${pct(1 - A.w.settings.carrier.commission)}`} tone="terra" onClick={() => A.reset('T-16')} />
        </div>
        {st && <button className="card" onClick={() => A.go('T-17', { id: st.id })}><div className="row"><ICirc n="receipt" tone="terra" /><div className="grow"><b className="bodym">Estado de cuenta de {periodLabel(st.period).split(' ')[0]}</b><div className="cap">{money(st.total)} · {st.status === 'PAYMENT_REGISTERED' ? 'pago por conciliar' : st.status === 'OVERDUE' ? 'vencido' : `vence el ${dateShort(st.dueAt)}`}</div></div>{st.status !== 'PAYMENT_REGISTERED' && <span className="linkbtn" style={{ textDecoration: "none" }}>Pagar</span>}</div></button>}
        {soon.map(d => <button key={d.kind} className={'card ' + (d.expiresOn! < A.now ? 'danger' : 'warn')} onClick={() => A.go('T-19')}><div className="row"><Icon n="calendar-clock" /><div className="grow"><b className="bodym">{d.expiresOn! < A.now ? `Venció tu ${d.label}` : `Tu ${d.label} vence en ${Math.ceil((d.expiresOn! - A.now) / DAY)} días`}</b><div className="cap" style={{ color: "inherit" }}>Renuévala para seguir recibiendo ofertas.</div></div></div></button>)}
        {p.hh < 5 && <span />}
      </div>
    </Screen>
  );
}

/* ---------- T-09 · Oferta de envío ---------- */
function Offer() {
  const A = useApp();
  const sh = A.w.shipments[A.top.p?.id as string];
  if (!sh) return <Screen title="Oferta de envío"><Empty title="No encontramos la oferta" /></Screen>;
  const org = A.org!;
  const o = currentOffer(sh);
  const forMe = sh.status === 'OFFERING' && o?.carrierOrgId === org.id;
  const mineNow = sh.carrierOrgId === org.id;
  const pu = pickupLabel(A.w, sh), de = destLabel(A.w, sh);
  const route = A.w.settings.routes.find(r => r.id === sh.routeId);
  const kgDay = kgAssignedOnDay(A.w, org.id, sh.pickupAt);
  const free = org.carrier!.vehicle.payloadKg - kgDay;
  const accept = () => { if (A.act('SHIP_OFFER_RESPOND', { shipmentId: sh.id, accept: true }, { ok: `Aceptaste ${sh.code}. Recoges ${relDay(sh.pickupAt, A.now)} a las ${hhmm(sh.pickupAt)}.` }).ok) A.replace('T-10', { tab: 'next' }); };
  return (
    <Screen title="Oferta de envío" sub={`${sh.code}${forMe && o ? ` · responde en ${duration(Math.max(0, o.expiresAt - A.now))}` : ''}`}
      foot={forMe ? <><div className="btnrow"><Btn kind="sec" onClick={() => A.sheet(<RejectOffer id={sh.id} />)}>Rechazar</Btn><Btn kind="dark" onClick={accept}>Aceptar envío</Btn></div><div className="why">El negocio te paga al recibir. Si aceptas y no vas, cuenta como inasistencia.</div></> : undefined}>
      <div className="stack">
        {!forMe && <Note icon="info" tone={mineNow ? 'soft' : 'warn'}>{mineNow ? 'Este envío ya es tuyo.' : sh.status === 'ASSIGNED' ? 'Otro transportista ya aceptó este envío.' : 'Esta oferta ya no está disponible para ti.'}</Note>}
        <MapSketch from={A.w.orgs[sh.sellerOrgId]?.district} to={A.w.orgs[sh.buyerOrgId]?.district} progress={0} km={sh.distanceKm} truck={false} height="8.5em" />
        <Card><div className="stack tight">
          <div className="row top"><ICirc n="map-pin" /><div><b className="bodym">Recoges {relDay(sh.pickupAt, A.now)} a las {hhmm(sh.pickupAt)}</b><div className="cap">{pu.title} · {pu.sub}</div></div></div>
          <div className="row top"><ICirc n="flag" tone="terra" /><div><b className="bodym">Entregas {relDay(sh.deliverFrom, A.now)} entre {hhmm(sh.deliverFrom)} y {hhmm(sh.deliverTo)}</b><div className="cap">{de.title} · {de.sub}</div></div></div>
        </div></Card>
        <Card><Kv total rows={[['Carga', cargoText(A.w, sh)], ['Valor de la carga', money(sh.cargoValue)], [route?.scope === 'CIUDAD' ? 'Flete (reparto en la ciudad)' : `Flete: ${fkg(sh.weightKg)} × ${money(route?.pricePerKg ?? 0)}`, money(sh.freight)], [`Comisión Mesagri (${pct(sh.commissionRate)})`, `– ${money(r2(sh.freight * sh.commissionRate))}`], ['Tú recibes', money(net(sh))]]} /></Card>
        {forMe && <Note icon="route">{kgDay ? `Va en tu ruta de ese día: ya llevas ${fkg(kgDay)} y te quedan ${fkg(Math.max(0, free))} libres.` : `Tienes libre toda tu carga útil (${numTrim(org.carrier!.vehicle.payloadKg)} kg) ese día.`}</Note>}
      </div>
    </Screen>
  );
}
function RejectOffer({ id }: { id: string }) {
  const A = useApp();
  const [reason, setReason] = useState('No llego a esa hora');
  return (
    <SheetBody title="¿Por qué no puedes?" sub="Pasamos la oferta al siguiente transportista. Rechazar no afecta tu reputación.">
      <div className="chips">{['No llego a esa hora', 'Ya voy lleno', 'Mi vehículo está en el taller', 'Otro'].map(r => <ChipBtn key={r} on={reason === r} onClick={() => setReason(r)}>{r}</ChipBtn>)}</div>
      <Btn full kind="dark" onClick={() => { if (A.act('SHIP_OFFER_RESPOND', { shipmentId: id, accept: false, reason }, { ok: 'Rechazaste la oferta.' }).ok) { A.sheet(null); A.back(); } }}>Rechazar la oferta</Btn>
    </SheetBody>
  );
}

/* ---------- T-10 · Mis envíos ---------- */
function MyShipments() {
  const A = useApp();
  const org = A.org!, w = A.w;
  const offers = offersFor(w, org.id);
  const all = mine(w, org.id);
  const today = all.filter(s => ACTIVE.includes(s.status) && (sameDay(s.pickupAt, A.now) || ['PICKED_UP', 'ARRIVED'].includes(s.status)));
  const next = all.filter(s => ACTIVE.includes(s.status) && !today.includes(s)).sort((a, b) => a.pickupAt - b.pickupAt);
  const done = all.filter(s => ['DELIVERED', 'CLOSED'].includes(s.status)).sort((a, b) => (b.delivery?.at ?? 0) - (a.delivery?.at ?? 0));
  const [tab, setTab] = useState<'offers' | 'today' | 'next' | 'done'>(A.top.p?.tab ?? (offers.length ? 'offers' : today.length ? 'today' : next.length ? 'next' : 'done'));
  const list = tab === 'offers' ? offers : tab === 'today' ? today : tab === 'next' ? next : done;
  const card = (sh: Shipment) => {
    const isOffer = tab === 'offers';
    const chip = isOffer ? <Chip tone="warn">Por aceptar</Chip> : ['DELIVERED', 'CLOSED'].includes(sh.status) ? <Chip tone="leaf">Entregado {sh.delivery ? dateShort(sh.delivery.at) : ''}</Chip> : sh.status === 'PICKED_UP' ? <Chip tone="field">En camino</Chip> : sh.status === 'ARRIVED' ? <Chip tone="terra">En la entrega</Chip> : <Chip tone="terra">Recojo {hhmm(sh.pickupAt)}</Chip>;
    const target = isOffer ? 'T-09' : sh.status === 'PICKED_UP' ? 'T-13' : sh.status === 'ARRIVED' ? 'T-14' : ['ASSIGNED', 'GOING_TO_PICKUP'].includes(sh.status) ? 'T-12' : 'T-14';
    return (
      <button key={sh.id} className="card" style={{ textAlign: "left" }} onClick={() => A.go(target, { id: sh.id })}>
        <div className="row between top"><b className="bodym">{orgName(w, sh.buyerOrgId)}</b>{chip}</div>
        <div className="cap">{sh.code} · {cargoText(w, sh).toLowerCase()}</div>
        <div className="row between mt"><span className="cap"><Icon n="route" s="1em" /> {districtName(w.orgs[sh.sellerOrgId]?.district)} → {districtName(w.orgs[sh.buyerOrgId]?.district)}</span><b className="price">{money(sh.freight)}</b></div>
        {sh.rating && <div className="cap mt">★ {Math.round((sh.rating.punctuality + sh.rating.care + sh.rating.treatment) / 3 * 10) / 10}{sh.rating.recommends ? ' · te recomienda' : ''}</div>}
        {sh.claim && sh.claim.status === 'OPEN' && <div className="errt mt"><Icon n="circle-alert" s="1em" />Reclamo abierto: envía tu descargo</div>}
      </button>
    );
  };
  const groupsByDay = (arr: Shipment[]) => { const m = new Map<number, Shipment[]>(); for (const s of arr) { const d = startOfDay(s.pickupAt); m.set(d, [...(m.get(d) ?? []), s]); } return [...m.entries()].sort((a, b) => a[0] - b[0]); };
  return (
    <Screen title="Mis envíos" sub={`${A.me!.shortName} · ${org.carrier!.vehicle.body.toLowerCase()} ${org.carrier!.vehicle.plate}`} back={false}>
      <div className="stack">
        <Seg value={tab} onChange={setTab} options={[{ v: 'offers', l: `Ofertas ${offers.length}` }, { v: 'today', l: `Hoy ${today.length}` }, { v: 'next', l: `Próximos ${next.length}` }, { v: 'done', l: `Hechos ${done.length}` }]} />
        {list.length === 0 && <Card><Empty icon="truck" title={tab === 'offers' ? 'Sin ofertas por ahora' : 'Nada por aquí'} text={tab === 'offers' ? 'Te avisamos cuando un negocio pida un envío en tu ruta y en tus días.' : undefined} /></Card>}
        {tab === 'next' ? groupsByDay(list).map(([d, arr]) => <div key={d} className="stack tight"><div className="sect">{relDay(d, A.now)} · {dateShort(d)}</div>{arr.map(card)}</div>) : list.slice(0, 25).map(card)}
        {tab === 'done' && done.some(s => s.claim?.status === 'OPEN') && <ClaimReplyList />}
        <p className="cap center" style={{ margin: "0" }}>Los envíos de un mismo día se juntan en una sola ruta. El orden de recojos y entregas lo propone la app.</p>
      </div>
    </Screen>
  );
}
function ClaimReplyList() {
  const A = useApp();
  const open = mine(A.w, A.org!.id).filter(s => s.claim?.status === 'OPEN');
  const [txt, setTxt] = useState('');
  return (
    <Card tone="warn">
      <b className="bodym">Reclamos por responder</b>
      {open.map(sh => (
        <div key={sh.id} className="stack tight mt">
          <div className="cap" style={{ color: "inherit" }}>{sh.code} · {sh.claim!.kind}: {sh.claim!.text}</div>
          <Inp area value={txt} onInput={setTxt} placeholder="Tu descargo: qué pasó en el camino" label="Descargo" />
          <Btn sm kind="dark" onClick={() => { if (A.act('SHIP_CLAIM_RESPOND', { shipmentId: sh.id, text: txt }, { ok: 'Enviamos tu descargo. Soporte media.' }).ok) setTxt(''); }}>Enviar descargo</Btn>
        </div>
      ))}
    </Card>
  );
}

/* ---------- T-11 · Ruta de hoy ---------- */
function TodayRoute() {
  const A = useApp();
  const org = A.org!, w = A.w;
  const c = org.carrier!;
  const ships = mine(w, org.id).filter(s => (ACTIVE.includes(s.status) && sameDay(s.pickupAt, A.now)) || ['PICKED_UP', 'ARRIVED'].includes(s.status) || (['DELIVERED', 'CLOSED'].includes(s.status) && s.delivery && sameDay(s.delivery.at, A.now)));
  const stops = ships.flatMap(sh => {
    const pu = pickupLabel(w, sh), de = destLabel(w, sh);
    return [
      { at: sh.pickup?.at ?? sh.pickupAt, kind: 'P' as const, sh, title: `Recoger ${sacos(sh.sacks)} de ${(w.subOrders[sh.subOrderId] ? product(w.subOrders[sh.subOrderId].items[0].productId).name : '').toLowerCase()}`, sub: `${pu.title} · ${pu.sub}`, done: !!sh.pickup },
      { at: sh.delivery?.at ?? sh.deliverFrom, kind: 'D' as const, sh, title: `Entregar ${sacos(sh.sacks)}`, sub: `${de.title} · ${districtName(w.orgs[sh.buyerOrgId]?.district)} · cobras ${money(sh.freight)}`, done: !!sh.delivery },
    ];
  }).sort((a, b) => a.at - b.at);
  const load = ships.filter(s => !s.delivery).reduce((a, s) => a + s.weightKg, 0);
  const sum = r2(ships.reduce((a, s) => a + s.freight, 0));
  const next = stops.find(s => !s.done);
  const cercado = ships.some(s => w.orgs[s.buyerOrgId]?.district === '040101');
  const go = () => { if (!next) return; A.go(next.kind === 'P' ? 'T-12' : next.sh.status === 'ARRIVED' ? 'T-14' : 'T-13', { id: next.sh.id }); };
  if (!ships.length) return <Screen title="Ruta de hoy" sub={dateShort(A.now)} back={false}><Card><Empty icon="route" title="Hoy no tienes recojos ni entregas" text="Cuando aceptes envíos para hoy, aquí verás el orden de la ruta."><Btn kind="dark" onClick={() => A.reset('T-10')}>Ver mis envíos</Btn></Empty></Card></Screen>;
  const routeName = A.w.settings.routes.find(r => r.id === ships[0].routeId)?.name ?? '';
  return (
    <Screen title="Ruta de hoy" sub={`${dateShort(A.now)} · ${routeName} · ${ships[0].distanceKm} km`} back={false} foot={next ? <Btn full kind="dark" onClick={go}>{next.kind === 'P' ? (stops.every(s => !s.done) ? 'Ir al primer recojo' : 'Ir al siguiente recojo') : 'Ir a la siguiente entrega'}</Btn> : undefined}>
      <div className="stack">
        <Card><div className="row between"><b className="bodym">Carga del {c.vehicle.body.split(' ')[0].toLowerCase()}</b><span className="bodym">{fkg(load)} de {numTrim(c.vehicle.payloadKg)} kg</span></div><div className="mt"><Prog v={load / c.vehicle.payloadKg} tone="terra" /></div></Card>
        <Card><Timeline steps={stops.map(s => ({ t: `${hhmm(s.at)} · ${s.title}`, s: s.sub, state: s.done ? 'done' : s === next ? 'cur' : 'pend' }))} /></Card>
        {cercado && <Note icon="triangle-alert" tone="warn">Una entrega queda en el Centro Histórico de Arequipa: revisa si hay restricción para vehículos de carga a esa hora y confirma que tu placa puede entrar.</Note>}
        <Card><Kv total rows={[['Fletes de hoy', money(sum)], ['Te quedas con', money(r2(sum * (1 - A.w.settings.carrier.commission)))]]} /></Card>
        {ships.some(s => s.status === 'ASSIGNED') && <Btn full kind="sec" icon="navigation" onClick={() => { for (const s of ships.filter(x => x.status === 'ASSIGNED')) A.act('SHIP_DEPART', { shipmentId: s.id }, { quiet: true }); A.toast('Avisamos al agricultor y al negocio que saliste a recoger.'); }}>Salgo a recoger: avisar a todos</Btn>}
      </div>
    </Screen>
  );
}

/* ---------- T-12 · Recojo ---------- */
function Pickup() {
  const A = useApp();
  const sh = A.w.shipments[A.top.p?.id as string];
  const s = sh ? A.w.subOrders[sh.subOrderId] : undefined;
  const rel = s?.fromLot ? Object.values(A.w.releases).find(r => r.subOrderId === s.id && r.status !== 'EXPIRED') : undefined;
  // el QR del agricultor llega sellado (solo su huella): se comprueba lo escaneado sin poder leerlo
  const expected = rel ? rel.code : s?.pickupQr ?? '';
  const sealed = !rel && isSealed(expected);
  const [qr, setQr] = useState('');
  const [scanAt, setScanAt] = useState<number | undefined>();
  const [sacks, setSacks] = useState(sh ? String(sh.sacks) : '');
  const [kgv, setKg] = useState(sh ? String(sh.weightKg).replace('.', ',') : '');
  const [ph, setPh] = useState<(string | undefined)[]>([undefined, undefined, undefined]);
  const [gs, setGs] = useState('');
  const [gc, setGc] = useState('');
  const [err, setErr] = useState('');
  if (!sh || !s) return <Screen title="Recojo"><Empty title="No encontramos el envío" /></Screen>;
  const pu = pickupLabel(A.w, sh);
  const lot = rel ? A.w.lots[rel.lotId] : undefined;
  const ok = !!qr.trim() && (rel ? qr.trim().toUpperCase() === expected.toUpperCase() : !!s && codeMatches(s.pickupQr, qr, CODE_SALT.qr(s.id)));
  const v1 = A.org!.carrier!.vehicle.vclass === 'V1';
  const picked = !!sh.pickup;
  const confirm = () => {
    setErr('');
    const r = A.act('SHIP_PICKUP', { shipmentId: sh.id, qr, sacks: Number(sacks), kg: Number(kgv.replace(',', '.')), photoIds: ph.filter(Boolean), waybillSender: gs, waybillCarrier: gc }, { quiet: true });
    if (!r.ok) { setErr(r.error!.message); return; }
    A.toast(`Recogiste ${sacos(Number(sacks) || 0)}. Desde ahora la carga está a tu cargo hasta entregarla.`);
    A.replace('T-13', { id: sh.id });
  };
  if (picked) return <Screen title="Recojo" sub={`${sh.code} · ${pu.title}`}><div className="stack"><Card tone="soft"><div className="row top"><Icon n="circle-check" /><div className="bodym"><b>Recogido a las {hhmm(sh.pickup!.at)}</b> · {sacos(sh.pickup!.sacks)} · {fkg(sh.pickup!.kg)} · guía {sh.pickup!.waybillCarrier || '—'}</div></div></Card><Btn full kind="dark" onClick={() => A.replace(sh.status === 'ARRIVED' ? 'T-14' : 'T-13', { id: sh.id })}>Seguir con la entrega</Btn></div></Screen>;
  return (
    <Screen title="Recojo" sub={`${sh.code} · ${pu.title}`} foot={<><Btn full kind="dark" onClick={confirm} disabled={!ok} why={!ok ? 'Escanea el QR del agricultor o la orden de salida' : undefined}>Confirmar recojo</Btn><div className="why">Desde ahora respondes por la carga hasta entregarla.</div></>}>
      <div className="stack">
        {sh.status === 'ASSIGNED' && <Btn full kind="sec" icon="navigation" onClick={() => A.act('SHIP_DEPART', { shipmentId: sh.id }, { ok: 'Avisamos que saliste a recoger.' })}>Salgo a recoger: avisar</Btn>}
        <Card tone="dark">
          <div className="row">
            <span className="icirc" style={{ background: "#fff", color: "var(--forest)", width: "2.6em", height: "2.6em" }}><Icon n="qr-code" s="1.4em" /></span>
            <div className="grow">{ok ? <><b>{sealed ? qr.trim().toUpperCase() : expected} · válida</b><div className="cap">Escaneada a las {hhmm(scanAt ?? A.now)}{rel ? ' en el almacén' : ' en la chacra'}</div></> : <><b>{rel ? 'Escanea la orden de salida' : 'Escanea el QR del agricultor'}</b><div className="cap">{rel ? 'La muestra el almacén o el agricultor' : 'Lo muestra en su celular, en «Entrega al transportista»'}</div></>}</div>
          </div>
          {!ok && <>
            <div className="row g8 mt"><div className="grow"><Inp value={qr} onInput={(v) => setQr(v.toUpperCase())} placeholder={rel ? 'OS-0201' : 'QR-XXXXXXXX'} label="Código del QR" /></div><QrScanButton onCode={(v) => { setQr(v.toUpperCase()); setScanAt(A.now); }} /></div>
            {qr && !ok && <div className="cap" style={{ color: '#ffd9cc', marginTop: '.4em' }}>Ese código no es el de este recojo. Revisa que sea el QR de {rel ? 'la orden de salida' : 'este agricultor'}.</div>}
            {A.store.mode === 'stage' && !sealed && <button className="linkbtn" style={{ color: '#E7F0DC', fontSize: '.85em' }} onClick={() => { setQr(expected); setScanAt(A.now); }}>Completar con el QR del agricultor (demo)</button>}
          </>}
        </Card>
        <Card><Kv rows={[['Para', orgName(A.w, sh.buyerOrgId)], ['Producto', itemsShort(s)], ...(lot ? [['Lote', lot.code] as [string, string]] : []), ['Recojo', `${pu.title} · ${pu.sub}`]]} /></Card>
        <div className="grid2">
          <Field label="Sacos contados"><Inp value={sacks} onInput={setSacks} mode="numeric" suffix={`de ${sh.sacks}`} label="Sacos contados" /></Field>
          <Field label="Peso en balanza"><Inp value={kgv} onInput={setKg} mode="decimal" suffix="kg" label="Peso en balanza" /></Field>
        </div>
        <div className="photos">{['Sacos', 'Balanza', 'Carga acomodada'].map((l, i) => <PhotoPick key={l} value={ph[i]} onChange={(v) => { const n = [...ph]; n[i] = v; setPh(n); }} label={l} kind={i === 1 ? 'balanza' : i === 2 ? 'carga' : 'sacos'} sample={i === 1 ? { value: `${kgv} kg` } : { stamp: `${sh.code} · ${hhmm(A.now)}` }} />)}</div>
        <div className="grid2">
          <Field label="Guía del remitente"><Inp value={gs} onInput={setGs} placeholder="T001-00123" label="Guía del remitente" /></Field>
          <Field label="Tu guía de transportista"><Inp value={gc} onInput={setGc} placeholder="V001-00045" label="Guía del transportista" /></Field>
        </div>
        <p className="cap" style={{ margin: "-.2em 0 0" }}>{v1 ? 'En moto basta la guía del remitente si el agricultor tiene RUC.' : 'La guía de transportista es obligatoria en camioneta, furgón o camión.'}</p>
        {err && <Note icon="circle-alert" tone="danger">{err}</Note>}
      </div>
    </Screen>
  );
}

/** Toma una foto del QR con la cámara del celular y lo lee (o deja escribir el código). */
function QrScanButton({ onCode }: { onCode: (v: string) => void }) {
  const A = useApp();
  const inp = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const read = async (f?: File | null) => {
    if (!f) return;
    setBusy(true);
    try {
      const v = await readQrFromFile(f);
      if (v) { onCode(v.trim()); A.toast('Leímos el QR.', 'ok'); }
      else A.toast('No encontramos un QR en la foto: acércate, que se vea entero y con luz, o escribe el código.', 'warn');
    } catch { A.toast('No pudimos leer esa foto. Escribe el código que aparece debajo del QR.', 'warn'); }
    setBusy(false);
  };
  return (
    <>
      <Btn sm kind="light" icon="scan-line" onClick={() => inp.current?.click()} loading={busy}>Escanear</Btn>
      <input ref={inp} type="file" accept="image/*" capture="environment" className="sr" tabIndex={-1} aria-hidden="true" onChange={(e: any) => { void read(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
    </>
  );
}

/* ---------- T-13 · En camino ---------- */
function OnTheWay() {
  const A = useApp();
  const org = A.org!, w = A.w;
  const going = mine(w, org.id).filter(s => ['PICKED_UP', 'ARRIVED'].includes(s.status)).sort((a, b) => a.deliverFrom - b.deliverFrom);
  const sh = (A.top.p?.id ? w.shipments[A.top.p.id as string] : undefined) ?? going[0];
  if (!sh || !['PICKED_UP', 'ARRIVED'].includes(sh.status)) return <Screen title="En camino" back={false}><Card><Empty icon="truck" title="No llevas carga ahora" text="Después del recojo verás aquí la siguiente parada.">{sh && ['DELIVERED', 'CLOSED'].includes(sh.status) ? null : <Btn kind="dark" onClick={() => A.reset('T-11')}>Ver ruta de hoy</Btn>}</Empty></Card></Screen>;
  const b = w.orgs[sh.buyerOrgId];
  const s = w.subOrders[sh.subOrderId];
  const prog = Math.max(0.08, Math.min(0.95, sh.pickup ? (A.now - sh.pickup.at) / Math.max(1, sh.deliverFrom - sh.pickup.at) : 0.1));
  const left = Math.max(0, Math.round(sh.distanceKm * (1 - prog)));
  const eta = sh.pickup ? sh.pickup.at + (sh.deliverFrom - sh.pickup.at) * 1.02 : sh.deliverFrom;
  const load = going.reduce((a, x) => a + (x.pickup?.kg ?? x.weightKg), 0);
  const sacks = going.reduce((a, x) => a + (x.pickup?.sacks ?? x.sacks), 0);
  const toCollect = r2(going.filter(x => !x.buyerPaid).reduce((a, x) => a + x.freight, 0));
  const person = s ? userOfOrg(w, b?.id) : undefined;
  return (
    <Screen title="En camino" sub={`${going.length} ${going.length === 1 ? 'entrega' : 'entregas'} · el negocio ve tu avance`} back={false}
      foot={<div className="btnrow"><Btn kind="sec" icon="triangle-alert" onClick={() => A.go('T-15', { id: sh.id })}>Problema</Btn><Btn kind="dark" onClick={() => { if (sh.status === 'ARRIVED' || A.act('SHIP_ARRIVE', { shipmentId: sh.id }, { ok: `Avisamos a ${b?.name} que llegaste.` }).ok) A.go('T-14', { id: sh.id }); }}>{sh.status === 'ARRIVED' ? 'Registrar la entrega' : 'Llegué a la entrega'}</Btn></div>}>
      <div className="stack">
        <MapSketch from={w.orgs[sh.sellerOrgId]?.district} to={b?.district} progress={prog} km={sh.distanceKm} toLabel={districtName(b?.district)} height="10em" />
        <Card>
          <div className="row between top"><div><div className="cap b" style={{ letterSpacing: ".1em" }}>SIGUIENTE PARADA · {hhmm(sh.deliverFrom)}</div><b className="h3">{b?.name}</b><div className="cap">{districtName(s?.district)} · {s?.address}{b?.receiver ? ` · recibe ${b.receiver}` : ''}</div></div><div className="right"><b className="h2" style={{ fontSize: "1.4em" }}>{left} km</b><div className="cap">llegas {hhmm(eta)}</div></div></div>
          <div className="btnrow mt">
            <Btn sm kind="sec" icon="phone" onClick={() => { if (!callPhone(person?.phone)) A.toast('No tenemos el número de quien recibe: escríbele por el chat.', 'warn'); }}>Llamar</Btn>
            <Btn sm kind="sec" icon="send" onClick={() => s && A.go('CHAT', { id: s.id })}>Mensaje</Btn>
            <Btn sm kind="sec" icon="map" onClick={() => openMap(`${s?.address || b?.address || ''}, ${districtName(s?.district ?? b?.district)}, Arequipa, Perú`)}>Mapa</Btn>
          </div>
        </Card>
        <Card><Kv rows={[['Llevas', `${sacos(sacks)} · ${fkg(load)}`], ['Por cobrar al entregar', money(toCollect)]]} /></Card>
        {sh.incidents.length > 0 && <Note icon="info" tone="warn">Avisaste: {sh.incidents[sh.incidents.length - 1].kind}{sh.incidents[sh.incidents.length - 1].newEta ? ` · nueva hora ${sh.incidents[sh.incidents.length - 1].newEta}` : ''}.</Note>}
      </div>
    </Screen>
  );
}

/* ---------- T-14 · Entrega y cobro ---------- */
function DeliverShipment() {
  const A = useApp();
  const sh = A.w.shipments[A.top.p?.id as string];
  const [code, setCode] = useState('');
  const [ph, setPh] = useState<(string | undefined)[]>([undefined, undefined]);
  const [sacks, setSacks] = useState(sh ? String(sh.pickup?.sacks ?? sh.sacks) : '');
  const [kgv, setKg] = useState(sh ? String(sh.pickup?.kg ?? sh.weightKg).replace('.', ',') : '');
  const [collected, setCollected] = useState<boolean>(!!sh?.buyerPaid);
  const [method, setMethod] = useState<PayMethod>(sh?.buyerPaid?.method ?? 'YAPE');
  const [err, setErr] = useState('');
  if (!sh) return <Screen title="Entrega"><Empty title="No encontramos el envío" /></Screen>;
  const s = A.w.subOrders[sh.subOrderId];
  const b = A.w.orgs[sh.buyerOrgId];
  if (['DELIVERED', 'CLOSED'].includes(sh.status)) return (
    <Screen title="Entrega" sub={`${sh.code} · ${b?.name}`}><div className="stack">
      <Card tone="soft"><div className="row top"><Icon n="circle-check" /><div className="bodym"><b>Entregado a las {sh.delivery ? hhmm(sh.delivery.at) : ''}</b> · {sacos(sh.delivery?.sacks ?? 0)} · {fkg(sh.delivery?.kg ?? 0)} · flete cobrado {money(sh.freight)} ({PAY_LABEL[sh.delivery?.method ?? 'YAPE']}).</div></div></Card>
      {sh.rating ? <Card><Stars v={Math.round((sh.rating.punctuality + sh.rating.care + sh.rating.treatment) / 3)} /><div className="bodym mt">{sh.rating.comment ? `«${sh.rating.comment}»` : 'Sin comentario'}</div></Card> : <Note icon="star">El negocio tiene 24 h para calificar y reclamar.</Note>}
      <Btn full kind="dark" onClick={() => A.reset('T-11')}>Volver a la ruta</Btn>
    </div></Screen>
  );
  const kNum = Number(kgv.replace(',', '.')) || 0;
  const base = sh.pickup?.kg ?? sh.weightKg;
  const diff = base ? Math.abs(kNum - base) / base : 0;
  const confirm = () => {
    setErr('');
    if (code.length < 4) { setErr('Escribe los 4 dígitos que te dicta el negocio.'); return; }
    if (!collected) { setErr(`Confirma que cobraste el flete (${money(sh.freight)}). Mesagri no lo cobra por ti.`); return; }
    const r = A.act('SHIP_DELIVER', { shipmentId: sh.id, code, collected, kg: kNum, sacks: Number(sacks), method, photoIds: ph.filter(Boolean) }, { quiet: true });
    if (!r.ok) { setErr(r.error!.message); setCode(''); return; }
    A.toast(!A.dev.online ? 'Entrega guardada: se envía sola cuando vuelva la señal.' : `¡Entregado! Cobraste ${money(sh.freight)}: te quedas con ${money(net(sh))}.`);
    A.reset('T-11');
  };
  return (
    <Screen title="Entrega" sub={`${sh.code} · ${b?.name}`} foot={<><Btn full kind="dark" onClick={confirm}>Confirmar entrega</Btn><div className="why">Sin código no hay entrega: es tu prueba de que recibieron conforme (RN-58).</div></>}>
      <div className="stack">
        <Card><div className="row top"><Icon n="map-pin" /><div><b className="bodym">{b?.name} · {districtName(s?.district)}</b><div className="cap">{s?.address}{b?.receiver ? ` · recibe ${b.receiver}` : ''}</div></div></div></Card>
        <div className="grid2">
          <Field label="Sacos entregados"><Inp value={sacks} onInput={setSacks} mode="numeric" suffix={`de ${sh.pickup?.sacks ?? sh.sacks}`} label="Sacos entregados" /></Field>
          <Field label="Peso"><Inp value={kgv} onInput={setKg} mode="decimal" suffix="kg" label="Peso entregado" /></Field>
        </div>
        {diff > A.w.settings.carrier.weightTolerance && <div className="errt"><Icon n="circle-alert" s="1.1em" />Diferencia de {pct(diff)} con el recojo: más del 1 % (RN-60). El negocio puede reclamar.</div>}
        <div className="photos" style={{ gridTemplateColumns: "1fr 1fr" }}>{['Sacos entregados', 'Quien recibe'].map((l, i) => <PhotoPick key={l} value={ph[i]} onChange={(v) => { const n = [...ph]; n[i] = v; setPh(n); }} label={l} kind="sacos" sample={{ stamp: `${sh.code} · ${hhmm(A.now)}` }} />)}</div>
        <Card tone="dark">
          <div className="row between"><span className="cap b" style={{ letterSpacing: ".1em", color: "var(--leaf)" }}>COBRA EL FLETE</span>{sh.buyerPaid && <span className="chip leaf"><Icon n="check" s="1em" />{PAY_LABEL[sh.buyerPaid.method]} recibido</span>}</div>
          <div className="display" style={{ fontSize: "2em", margin: ".1em 0" }}>{money(sh.freight)}</div>
          <div className="cap">De este flete te quedas con {money(net(sh))}.</div>
          {!sh.buyerPaid && <div className="mt"><Seg dark value={method} onChange={setMethod} options={[{ v: 'YAPE', l: 'Yape' }, { v: 'PLIN', l: 'Plin' }, { v: 'CASH', l: 'Efectivo' }]} /></div>}
          <div className="mt" style={{ color: "#fff" }}><Tog on={collected} onChange={setCollected} label={`Cobré ${money(sh.freight)}`} sub={<span style={{ color: "#cfe0c1" }}>Mesagri no cobra el flete por ti (RN-55)</span>} /></div>
        </Card>
        <Field label="Código que te dicta el negocio" error={err}><CodeInput value={code} onChange={(v) => { setCode(v); setErr(''); }} n={4} err={!!err} /></Field>
      </div>
    </Screen>
  );
}

/* ---------- T-15 · Problema en ruta ---------- */
const INCIDENTS = ['Demora', 'Avería', 'Accidente', 'Carga dañada o mojada', 'No hay quien reciba', 'Control en la vía', 'Robo'];
function RouteProblem() {
  const A = useApp();
  const going = mine(A.w, A.org!.id).filter(s => ['ASSIGNED', 'GOING_TO_PICKUP', 'PICKED_UP', 'ARRIVED'].includes(s.status));
  const [id, setId] = useState<string>((A.top.p?.id as string) ?? going[0]?.id ?? '');
  const [kind, setKind] = useState('Demora');
  const [eta, setEta] = useState(hhmm(A.now + 45 * MIN));
  const [where, setWhere] = useState('');
  const [text, setText] = useState('');
  const [ph, setPh] = useState<(string | undefined)[]>([undefined, undefined]);
  const sh = A.w.shipments[id];
  if (!sh) return <Screen title="Reportar un problema"><Card><Empty icon="truck" title="No tienes envíos en curso" /></Card></Screen>;
  const send = () => { if (A.act('SHIP_INCIDENT', { shipmentId: sh.id, incidentId: 'inc-' + uid(), kind, newEta: ['Demora', 'Avería', 'Control en la vía'].includes(kind) ? eta : undefined, where, text, photoIds: ph.filter(Boolean) }, { ok: 'Avisamos al negocio y al agricultor.' }).ok) A.back(); };
  return (
    <Screen title="Reportar un problema" sub={`${A.me!.shortName} · ${A.org!.carrier!.vehicle.plate}`} foot={<><Btn full kind="dark" onClick={send}>Enviar aviso</Btn><div className="why">Emergencias: Policía 105 · Bomberos 116 · SAMU 106</div></>}>
      <div className="stack">
        {going.length > 1 ? <Sel value={id} onChange={setId} options={going.map(s => ({ v: s.id, l: `${s.code} · ${orgName(A.w, s.buyerOrgId)}` }))} label="Envío" />
          : <Card><b className="bodym">{sh.code} · {orgName(A.w, sh.buyerOrgId)}</b><div className="cap">{cargoText(A.w, sh).toLowerCase()} · entrega prevista {hhmm(sh.deliverFrom)}</div></Card>}
        <div className="lbl">¿Qué pasó?</div>
        <div className="chips">{INCIDENTS.map(k => <ChipBtn key={k} on={kind === k} onClick={() => setKind(k)}>{k}</ChipBtn>)}</div>
        <div className="grid2">
          {['Demora', 'Avería', 'Control en la vía'].includes(kind) && <Field label="Nueva hora de llegada"><Inp value={eta} onInput={setEta} suffix={<Icon n="clock" />} label="Nueva hora de llegada" /></Field>}
          <Field label="Dónde estás"><Inp value={where} onInput={setWhere} placeholder="La Joya" suffix={<Icon n="map-pin" />} label="Dónde estás" /></Field>
        </div>
        <Field label="Cuéntalo"><Inp area value={text} onInput={setText} placeholder="Desvío por obras en la carretera. Llego 45 minutos tarde." label="Qué pasó" /></Field>
        <div className="photos" style={{ gridTemplateColumns: "1fr 1fr" }}>{['Foto del lugar', 'Foto de la carga'].map((l, i) => <PhotoPick key={l} value={ph[i]} onChange={(v) => { const n = [...ph]; n[i] = v; setPh(n); }} label={l} kind={i ? 'carga' : 'vehiculo'} />)}</div>
        <Note icon="triangle-alert" tone="warn">Avisamos ahora al negocio y al agricultor. Si la carga se dañó, se abre un caso y tienes 24 h para enviar tus fotos.</Note>
      </div>
    </Screen>
  );
}

/* ---------- T-16 · Cobros ---------- */
function Earnings() {
  const A = useApp();
  const org = A.org!, w = A.w;
  const [range, setRange] = useState<'week' | 'month' | 'year'>('month');
  const p = lima(A.now);
  const from = range === 'week' ? startOfDay(A.now) - (p.dow - 1) * DAY : range === 'month' ? periodStart(periodOf(A.now)) : periodStart(`${p.y}-01`);
  const done = mine(w, org.id).filter(s => s.delivery && s.delivery.at >= from).sort((a, b) => b.delivery!.at - a.delivery!.at);
  const sum = r2(done.reduce((a, s) => a + s.freight, 0));
  const kgs = done.reduce((a, s) => a + (s.delivery?.kg ?? s.weightKg), 0);
  const monthDone = mine(w, org.id).filter(s => s.delivery && periodOf(s.delivery.at) === periodOf(A.now));
  const com = r2(monthDone.reduce((a, s) => a + s.freight * s.commissionRate, 0));
  const prevSt = Object.values(w.statements).filter(s => s.orgId === org.id).sort((a, b) => b.period.localeCompare(a.period))[0];
  return (
    <Screen title="Cobros" sub={`${A.me!.shortName} · ${periodLabel(periodOf(A.now))}`} back={false}>
      <div className="stack">
        <Seg value={range} onChange={setRange} options={[{ v: 'week', l: 'Semana' }, { v: 'month', l: 'Mes' }, { v: 'year', l: 'Año' }]} />
        <div className="grid2">
          <Stat n={money(sum)} l={`Fletes · ${done.length} envíos · ${fkg(kgs)}`} />
          <Stat n={money(r2(sum * (1 - w.settings.carrier.commission)))} l={`Te quedas con · ${pct(1 - w.settings.carrier.commission)}`} tone="terra" />
        </div>
        <Card>{done.length === 0 ? <Empty icon="wallet" title="Sin fletes cobrados en este periodo" /> : <div className="list">{done.slice(0, 20).map(sh => (
          <div key={sh.id} className="li"><ICirc n="circle-check" /><div className="grow"><b className="bodym">{orgName(w, sh.buyerOrgId)}</b><div className="cap">{sh.code} · {relDay(sh.delivery!.at, A.now)} · {fkg(sh.delivery!.kg)} · {PAY_LABEL[sh.delivery!.method]}</div></div><b className="bodym">{money(sh.freight)}</b></div>
        ))}</div>}</Card>
        <Card tone="soft"><div className="row between"><b className="bodym">Comisión de Mesagri acumulada ({pct(w.settings.carrier.commission)})</b><b>{money(com)}</b></div><div className="cap">Se suma en tu estado de cuenta del 1 de {periodLabel(nextPeriod(periodOf(A.now))).split(' ')[0]}.</div></Card>
        {prevSt && <Btn full kind="sec" onClick={() => A.go('T-17', { id: prevSt.id })}>Ver estado de cuenta de {periodLabel(prevSt.period).split(' ')[0]}</Btn>}
        <p className="cap center" style={{ margin: "0" }}>Los fletes te los pagan directo los negocios. Mesagri solo cobra su comisión una vez al mes.</p>
      </div>
    </Screen>
  );
}

/* ---------- T-18 · Reputación y nivel ---------- */
function CarrierReputation() {
  const A = useApp();
  const org = A.org!, w = A.w;
  const c = org.carrier!;
  const cs = carrierStats(w, org.id);
  const s = w.settings.carrier;
  const rated = mine(w, org.id).filter(x => x.rating).sort((a, b) => b.rating!.at - a.rating!.at);
  const seguro = c.vehicle.docs.find(d => d.kind === 'SEGURO');
  const hasIns = !!seguro && seguro.status === 'OK';
  const goals: [boolean, string, string, number | undefined][] = [
    [cs.shipments >= s.t3Shipments, `${s.t3Shipments} envíos`, `${cs.shipments} de ${s.t3Shipments}`, Math.min(1, cs.shipments / s.t3Shipments)],
    [hasIns, 'Seguro de carga vigente', hasIns ? 'Vigente' : 'Falta', undefined],
    [cs.rating >= s.t3Rating, `${String(s.t3Rating).replace('.', ',')} estrellas o más`, cs.rating ? String(cs.rating).replace('.', ',') : '—', undefined],
    [cs.onTimePct >= s.t3OnTime, `${pct(s.t3OnTime)} de entregas a tiempo`, cs.shipments ? pct(cs.onTimePct) : '—', undefined],
  ];
  return (
    <Screen title="Mi reputación" sub={`${A.me!.shortName} · ${c.vehicle.body.toLowerCase()} ${c.vehicle.plate}`}>
      <div className="stack">
        <Card><div className="row"><span className="av lg" style={{ background: "#1E3F20" }}>{initialsOf(A.me!.name)}</span><div className="grow"><div className="row g8"><b className="display" style={{ fontSize: "1.8em" }}>{cs.rating ? String(cs.rating).replace('.', ',') : '—'}</b><Stars v={cs.rating} /></div><div className="cap">{cs.count} calificaciones de negocios</div></div><Chip tone="leaf" icon="shield-check">{c.level}</Chip></div></Card>
        <div className="grid3"><Stat n={cs.shipments ? pct(cs.onTimePct) : '—'} l="A tiempo" /><Stat n={cs.shipments} l="Envíos" /><Stat n={cs.recommends} l="Te recomiendan" /></div>
        <Card><div className="stack tight">{([['Puntualidad', cs.punctuality], ['Cuidado de la carga', cs.care], ['Trato', cs.treatment]] as [string, number][]).map(([l, v]) => <div key={l} className="row g8"><span className="bodym" style={{ width: "8.5em", fontSize: ".86em" }}>{l}</span><div className="grow"><Prog v={v / 5} tone="terra" /></div><b className="bodym" style={{ width: "2em", textAlign: "right" }}>{v ? String(v).replace('.', ',') : '—'}</b></div>)}</div></Card>
        <Card>
          <b className="bodym">Para subir a T3 · Destacado</b>
          <div className="stack tight mt">{goals.map(([ok, l, v, prog]) => <div key={l}><div className="row g8"><span className={'icirc ' + (ok ? 'dark' : '')} style={{ width: "1.5em", height: "1.5em" }}>{ok ? <Icon n="check" s=".85em" w={3} /> : null}</span><span className="bodym grow" style={{ fontSize: ".88em" }}>{l}</span><b className="bodym" style={{ fontSize: ".88em" }}>{v}</b></div>{prog !== undefined && <div style={{ paddingLeft: "2em" }} className="mt"><Prog v={prog} /></div>}</div>)}</div>
        </Card>
        {rated.length === 0 && <Card><Empty icon="star" title="Todavía sin calificaciones" text="Los negocios califican puntualidad, cuidado de la carga y trato." /></Card>}
        {rated.slice(0, 8).map(sh => <RatingCard key={sh.id} sh={sh} />)}
      </div>
    </Screen>
  );
}
function RatingCard({ sh }: { sh: Shipment }) {
  const A = useApp();
  const [open, setOpen] = useState(false);
  const [txt, setTxt] = useState('');
  const r = sh.rating!;
  return (
    <Card>
      <Stars v={Math.round((r.punctuality + r.care + r.treatment) / 3)} />
      {r.comment && <div className="bodym mt">«{r.comment}»</div>}
      {r.tags.length > 0 && <div className="chips mt">{r.tags.map(t => <Chip key={t}>{t}</Chip>)}</div>}
      <div className="cap mt">{orgName(A.w, sh.buyerOrgId)} · {ago(r.at, A.now)}{r.recommends ? ' · te recomienda' : ''}</div>
      {r.reply ? <div className="card soft mt"><div className="cap b">Tu respuesta</div><div className="bodym">{r.reply}</div></div> : open
        ? <div className="row g8 mt"><div className="grow"><Inp value={txt} onInput={setTxt} placeholder="Responde con respeto" label="Respuesta" /></div><Btn sm kind="dark" onClick={() => { if (A.act('SHIP_RATING_REPLY', { shipmentId: sh.id, text: txt }, { ok: 'Respuesta publicada.' }).ok) setOpen(false); }}>Enviar</Btn></div>
        : <button className="linkbtn" style={{ paddingLeft: "0" }} onClick={() => setOpen(true)}>Responder</button>}
    </Card>
  );
}

/* ---------- T-19 · Mi vehículo y documentos ---------- */
function Vehicle() {
  const A = useApp();
  const org = A.org!;
  const c = org.carrier!;
  const v = c.vehicle;
  const routes = c.routes.map(r => `${A.w.settings.routes.find(x => x.id === r.routeId)?.name ?? r.routeId} · ${r.days.map(d => DOW_CHIP[d].toLowerCase()).join(', ')}`);
  const row = (key: string, ok: boolean, warn: boolean, title: string, sub: string, action?: any) => (
    <div key={key} className="row top" style={{ padding: ".55em 0" }}>
      <span className={'icirc ' + (ok ? 'dark' : warn ? 'warn' : '')} style={{ width: "1.9em", height: "1.9em" }}>{ok ? <Icon n="check" s="1em" w={3} /> : warn ? <Icon n="triangle-alert" s="1em" /> : <Icon n="circle" s="1em" />}</span>
      <div className="grow"><b className="bodym">{title}</b><div className="cap">{sub}</div></div>{action}
    </div>
  );
  return (
    <Screen title="Mi vehículo" sub={`${A.me!.shortName} · ${org.name}`}>
      <div className="stack">
        <Card>
          <div className="row between"><b className="h3">{v.body} · {v.plate}</b><Chip tone="leaf" icon="shield-check">{c.level} · {CARRIER_LEVEL_NAME[c.level]}</Chip></div>
          <div className="mt"><Kv rows={[['Clase en Mesagri', `${v.vclass} · hasta ${numTrim(v.payloadKg)} kg`], ['Categoría', `${v.category} · licencia ${c.driverLicense.cls}`], ['Ruta', routes.join(' · ') || '—']]} /></div>
        </Card>
        <div className="sect">Documentos y vencimientos</div>
        <Card><div className="list">
          {row('lic', c.driverLicense.expiresOn > A.now + 30 * DAY, c.driverLicense.expiresOn <= A.now + 30 * DAY, `Licencia de conducir ${c.driverLicense.cls}`, `Vence el ${dateNum(c.driverLicense.expiresOn)}`)}
          {v.docs.map(d => {
            const expired = !!d.expiresOn && d.expiresOn < A.now;
            const soon = !!d.expiresOn && !expired && d.expiresOn < A.now + 45 * DAY;
            const ok = d.status === 'OK' && !expired && !soon;
            return row(d.kind, ok, expired || soon || d.status === 'PENDING', d.label, d.status === 'MISSING' ? (d.note ?? 'Opcional') : d.expiresOn ? `${expired ? 'Venció' : 'Vence'} el ${dateNum(d.expiresOn)}${d.note ? ` · ${d.note.toLowerCase()}` : ''}` : (d.note ?? 'Vigente'),
              d.status === 'MISSING' ? <button className="chip line" onClick={() => A.sheet(<RenewDoc kind={d.kind} label={d.label} />)}>Agregar</button> : (expired || soon) ? <button className="chip terra" onClick={() => A.sheet(<RenewDoc kind={d.kind} label={d.label} />)}>Subir</button> : null);
          })}
          {c.inspection && row('ins', c.inspection.score >= A.w.settings.carrier.minScore, false, 'Revisión de Mesagri', `${c.inspection.score} de 100 · se repite cada 6 meses`)}
        </div></Card>
        <div className="sect">Conductores</div>
        <Card><div className="row"><Av name={A.w.users[org.memberIds[0]]?.name ?? A.me!.name} color="#1E3F20" /><div className="grow"><b className="bodym">{A.w.users[org.memberIds[0]]?.name ?? A.me!.name}</b><div className="cap">Titular · licencia {c.driverLicense.cls}</div></div></div></Card>
        {(org.members ?? []).filter(m => m.kind === 'CONDUCTOR').map(m => <DriverRow key={m.userId} userId={m.userId} />)}
        <div className="btnrow"><Btn kind="sec" icon="truck" onClick={() => A.sheet(<VehicleSheet />)}>Cambiar de vehículo</Btn><Btn kind="sec" icon="plus" disabled={(org.members ?? []).filter(m => m.kind === 'CONDUCTOR').length >= 2} why="Hasta 2 conductores además de ti" onClick={() => A.sheet(<DriverSheet />)}>Agregar conductor</Btn></div>
      </div>
    </Screen>
  );
}

function DriverRow({ userId }: { userId: string }) {
  const A = useApp();
  const m = (A.org!.members ?? []).find(x => x.userId === userId)!;
  const u = A.w.users[userId];
  const remove = async () => {
    if (!await A.confirm({ title: `¿Quitar a ${u?.shortName ?? 'este conductor'}?`, text: 'Ya no podrá entrar ni hacer envíos por tu cuenta.', ok: 'Quitar', danger: true })) return;
    A.act('DRIVER_REMOVE', { userId }, { ok: 'Quitamos al conductor.' });
  };
  return (
    <Card>
      <div className="row top"><Av name={u?.name ?? '—'} color={m.active ? '#2C5F2D' : '#8A938A'} /><div className="grow">
        <div className="row between"><b className="bodym">{u?.name}</b>{!m.active && <Chip tone="ghost">Pausado</Chip>}</div>
        <div className="cap">{m.note} · {maskPhone(u?.phone)}</div>
        <div className="row g8 wrap mt"><Btn xs kind="sec" onClick={() => A.act('DRIVER_SET', { userId, active: !m.active }, { ok: m.active ? 'Conductor pausado.' : 'Conductor activo.' })}>{m.active ? 'Pausar' : 'Activar'}</Btn><Btn xs kind="secd" onClick={remove}>Quitar</Btn></div>
      </div></div>
    </Card>
  );
}

function DriverSheet() {
  const A = useApp();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [cls, setCls] = useState<'A-I' | 'A-IIb' | 'B-IIb'>(A.org!.carrier!.vehicle.vclass === 'V1' ? 'B-IIb' : 'A-I');
  const [exp, setExp] = useState('');
  const [err, setErr] = useState('');
  const save = () => {
    const [y, mo, d] = exp.split('-').map(Number);
    const r = A.act('DRIVER_ADD', { userId: 'u-' + uid(), name: name.trim(), phone: phone.replace(/\s/g, ''), licenseCls: cls, licenseExpires: y ? limaTime(y, mo, d) : 0 }, { quiet: true });
    if (!r.ok) { setErr(r.error!.message); return; }
    A.sheet(null);
    A.toast(`Registramos a ${name.trim().split(' ')[0]}: entra con su celular. Verificamos su licencia en la próxima revisión.`);
  };
  return (
    <SheetBody title="Agregar conductor" sub="Entra con su celular y puede hacer los envíos de tu cuenta. Los cobros siguen siendo tuyos.">
      <Field label="Nombre completo"><Inp value={name} onInput={setName} placeholder="Como figura en su DNI" label="Nombre completo" /></Field>
      <Field label="Celular"><Inp value={phone} onInput={setPhone} mode="tel" prefix="+51" placeholder="9__ ___ ___" label="Celular" /></Field>
      <div className="lbl">Licencia</div>
      <Seg value={cls} onChange={setCls} options={[{ v: 'B-IIb', l: 'B-IIb (moto)' }, { v: 'A-I', l: 'A-I' }, { v: 'A-IIb', l: 'A-IIb' }]} />
      <Field label="Vence el"><Inp type="date" value={exp} onInput={setExp} label="Vencimiento de la licencia" /></Field>
      {err && <Note icon="circle-alert" tone="danger">{err}</Note>}
      <Btn full kind="dark" onClick={save}>Agregar conductor</Btn>
    </SheetBody>
  );
}

function VehicleSheet() {
  const A = useApp();
  const v = A.org!.carrier!.vehicle;
  const [plate, setPlate] = useState('');
  const [vclass, setVclass] = useState<'V1' | 'V2' | 'V3'>(v.vclass);
  const [body, setBody] = useState('');
  const [payload, setPayload] = useState('');
  const [year, setYear] = useState('');
  const [err, setErr] = useState('');
  const save = async () => {
    if (!await A.confirm({ title: '¿Cambiar de vehículo?', text: 'El vehículo nuevo pasa por la revisión de Mesagri. Hasta entonces no recibes ofertas de envío (RN-52).', ok: 'Cambiar' })) return;
    const r = A.act('VEHICLE_CHANGE', { plate: plate.trim(), vclass, body: body.trim(), payloadKg: Number(payload), year: Number(year) }, { quiet: true });
    if (!r.ok) { setErr(r.error!.message); return; }
    A.sheet(null);
    A.toast('Registramos tu vehículo nuevo. Te avisamos la fecha de la revisión.');
  };
  return (
    <SheetBody title="Cambiar de vehículo" sub={`Hoy: ${v.body} · ${v.plate}`}>
      <Field label="Placa"><Inp value={plate} onInput={(x) => setPlate(x.toUpperCase())} placeholder="V7K-812" label="Placa" /></Field>
      <div className="lbl">Clase</div>
      <Seg value={vclass} onChange={setVclass} options={[{ v: 'V1', l: 'Moto con cajuela' }, { v: 'V2', l: 'Camioneta o furgón' }, { v: 'V3', l: 'Camión ligero' }]} />
      <Field label="Carrocería"><Inp value={body} onInput={setBody} placeholder="Furgón cerrado" label="Carrocería" /></Field>
      <div className="grid2">
        <Field label="Carga útil"><Inp value={payload} onInput={setPayload} mode="numeric" suffix="kg" label="Carga útil" /></Field>
        <Field label="Año"><Inp value={year} onInput={setYear} mode="numeric" placeholder="2019" label="Año" /></Field>
      </div>
      {err && <Note icon="circle-alert" tone="danger">{err}</Note>}
      <Btn full kind="dark" onClick={save}>Registrar vehículo nuevo</Btn>
    </SheetBody>
  );
}

/* ---------- Perfil del transportista ---------- */
function CarrierProfileMe() {
  const A = useApp();
  const org = A.org!, me = A.me!;
  const c = org.carrier!;
  const acct = org.payout[0];
  const item = (icon: string, title: string, sub: string, onClick: () => void, tone = '') => (
    <button className="li" onClick={onClick}><ICirc n={icon} tone={tone} /><div className="grow"><b className="bodym">{title}</b><div className="cap">{sub}</div></div><Icon n="chevron-right" s="1.1em" /></button>
  );
  return (
    <Screen bar={
      <header className="bar home" style={{ alignItems: "center" }}>
        <span className="av lg" style={{ background: "#C97C3E" }}>{initialsOf(me.name)}</span>
        <div className="tt"><h1>{me.name}</h1><p>{org.name} · {placeLabel(org.district)}</p><span className="chip terra" style={{ marginTop: ".35em" }}><Icon n="shield-check" s="1.05em" />{c.level} · {CARRIER_LEVEL_NAME[c.level]}</span></div>
      </header>
    }>
      <div className="stack">
        <Card><div className="list">
          {item('shield-check', 'Mi verificación', `${c.level} · qué puedes hacer y qué falta`, () => A.go('T-07'))}
          {item('star', 'Mi reputación', `${carrierStats(A.w, org.id).count} calificaciones`, () => A.go('T-18'))}
          {item('truck', 'Mi vehículo y documentos', `${c.vehicle.body} ${c.vehicle.plate}`, () => A.go('T-19'))}
          {item('book-open', 'Capacitación', `${c.training.done} de ${c.training.total} módulos`, () => A.go('T-06'))}
          {item('banknote', 'Dónde te pagan el flete', acct ? `${acct.kind === 'BANK' ? 'Cuenta' : acct.kind === 'PLIN' ? 'Plin' : 'Yape'} ···· ${acct.number.slice(-3)}${org.acceptsCash ? ' · y efectivo' : ''}` : 'Efectivo', () => A.toast('Para cambiar tu cuenta de cobro escríbele a Soporte: se vuelve a verificar.', 'info'))}
          {item('receipt', 'Estado de cuenta', 'Comisión de Mesagri: 10 % de tus fletes', () => A.go('T-17'))}
        </div></Card>
        <Card><div className="list">
          {item('message-circle', 'Mensajes', 'Conversaciones por envío', () => A.go('A-18'))}
          {item('bell', 'Avisos', 'Ofertas, cobros y vencimientos', () => A.go('A-29'))}
          {item('user', 'Tu nombre', `Te llamamos ${me.shortName}`, () => A.sheet(<NameSheet />))}
          {canAskPermissions() && item('smartphone', 'Permisos de la app', 'Cámara para las fotos y el QR', () => A.sheet(<PermsSheet />))}
          {item('globe', 'Idioma y letra', `Castellano · letra ${me.prefs.textScale > 1.1 ? 'grande' : 'normal'}`, () => A.sheet(<PrefsSheet />))}
          {item('lock', 'Privacidad y mis datos', 'Descargar o borrar mis datos', () => A.sheet(<PrivacySheet />))}
          {item('circle-question-mark', 'Ayuda', 'Preguntas, WhatsApp y libro de reclamaciones', () => A.go('A-19'))}
          {item('log-out', 'Cerrar sesión', me.phone.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3'), () => A.logout(), 'terra')}
        </div></Card>
      </div>
    </Screen>
  );
}

reg('T-01', CarrierData);
reg('T-02', CarrierDriver);
reg('T-03', CarrierVehicle);
reg('T-04', CarrierRoutes);
reg('T-05', CarrierAgreement);
reg('T-06', ReviewTraining, { nav: true, tab: 'T-PERFIL' });
reg('T-07', CarrierLevels, { nav: true, tab: 'T-PERFIL' });
reg('T-08', CarrierHome, { nav: true, tab: 'T-08' });
reg('T-09', Offer);
reg('T-10', MyShipments, { nav: true, tab: 'T-10' });
reg('T-11', TodayRoute, { nav: true, tab: 'T-11' });
reg('T-12', Pickup);
reg('T-13', OnTheWay, { nav: true, tab: 'T-11' });
reg('T-14', DeliverShipment);
reg('T-15', RouteProblem);
reg('T-16', Earnings, { nav: true, tab: 'T-16' });
reg('T-17', StatementView);
reg('T-18', CarrierReputation, { nav: true, tab: 'T-PERFIL' });
reg('T-19', Vehicle, { nav: true, tab: 'T-PERFIL' });
reg('T-PERFIL', CarrierProfileMe, { nav: true, tab: 'T-PERFIL' });

void QR; void prevPeriod; void DOW_LONG; void HOUR;
export type { AppCtx };
