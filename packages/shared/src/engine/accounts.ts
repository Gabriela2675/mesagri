/*
 * Cuentas, verificación por niveles y perfiles (6.1, 6.2, 10, RN-01, RN-02, RN-16, RN-18, RN-19, RN-28).
 */
import type { Org, User, Evidence, VerifCase, PayoutAccount, Prefs } from '../types';
import { on, fail, audit, notify, requireMember, requireAdmin, getOrg, must, Ctx } from './core';
import { isRucValid, isDniValid, isPhoneValid, initials, licenseMatches, VCLASS_INFO } from '../rules';
import { DISTRICT_BY_CODE } from '../ubigeo';
import { addMonths } from '../time';
import { PRODUCT_BY_ID } from '../catalog';
import type { DocItem, CarrierRoute, StorageRate } from '../types';

const ORG_COLORS = ['#A66633', '#2C5F2D', '#8E3B5E', '#1F5FA8', '#6E5F58', '#4F7A26', '#A0452E', '#8A6236'];

export function defaultPrefs(lang: Prefs['lang'] = 'es'): Prefs {
  return { lang, audioGuide: true, bilingual: false, textScale: 1, dataSaver: false, numFmt: 'coma' };
}

/* ---------- Limpieza de lo que llega del celular (solo campos conocidos, tipos correctos) ---------- */
const DOC_STATUS = ['OK', 'PENDING', 'OBSERVED', 'MISSING'];
export function cleanDocs(list: unknown): DocItem[] {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 20).map((d: any) => ({
    kind: String(d?.kind ?? 'OTRO').slice(0, 20), label: String(d?.label ?? d?.kind ?? '').slice(0, 120),
    number: d?.number ? String(d.number).slice(0, 40) : undefined,
    expiresOn: Number.isFinite(Number(d?.expiresOn)) && d?.expiresOn !== undefined && d?.expiresOn !== null ? Number(d.expiresOn) : undefined,
    status: (DOC_STATUS.includes(d?.status) ? d.status : 'PENDING') as DocItem['status'],
    note: d?.note ? String(d.note).slice(0, 200) : undefined,
  }));
}
/** '7:00' → '07:00' (la base guarda la hora como TIME). */
export function cleanHour(x: unknown): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(x ?? ''));
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) fail('BAD_TIME', 'Escribe la hora como 15:00.');
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}
export function cleanRoutes(w: { settings: { routes: { id: string }[] } }, list: unknown): CarrierRoute[] {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 10).map((r: any) => {
    if (!w.settings.routes.some(x => x.id === r?.routeId)) fail('BAD_ROUTE', 'Esa ruta no existe en Mesagri.');
    const days = [...new Set((Array.isArray(r.days) ? r.days : []).map(Number).filter((d: number) => d >= 1 && d <= 7))] as number[];
    return { routeId: String(r.routeId), days, departs: cleanHour(r.departs), arrives: cleanHour(r.arrives) };
  });
}
export function cleanRates(list: unknown): StorageRate[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: StorageRate[] = [];
  for (const r of list as any[]) {
    const id = String(r?.productId ?? '');
    const v = Number(r?.perSackMonth);
    if (!PRODUCT_BY_ID[id] || seen.has(id) || !(v > 0)) continue;
    seen.add(id);
    out.push({ productId: id, perSackMonth: v });
  }
  return out;
}

export function emptyCounters(): Org['counters'] {
  return { completedSales: 0, freeSalesUsed: 0, completedPurchases: 0, lateCancels: 0, sellerCancels: 0, expiredOrders: 0, responseMinutesTotal: 0, responses: 0, onTime: 0, deliveries: 0, disputesLost: 0 };
}

export function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ORG_COLORS[h % ORG_COLORS.length];
}

/* ---------- Registro (RF-AUT-01, CU-01, CU-60, CU-90) ---------- */
on('USER_REGISTER', (c: Ctx) => {
  const { w, t } = c;
  const p = c.e.p;
  const role = p.role as User['role'];
  if (!['FARMER', 'BUYER', 'CARRIER', 'WAREHOUSE'].includes(role)) fail('BAD_ROLE', 'Elige si eres agricultor, comprador, almacén o transportista.');
  const phone = String(p.phone ?? '').replace(/\s/g, '');
  if (!isPhoneValid(phone)) fail('BAD_PHONE', 'Ese número no parece correcto (9 dígitos, empieza con 9).');
  if (Object.values(w.users).some(u => u.phone === phone)) fail('PHONE_TAKEN', 'Ese celular ya tiene una cuenta. Ingresa con «Ya tengo cuenta».');
  const name = String(p.name ?? '').trim();
  if (name.length < 3) fail('BAD_NAME', 'Escribe tu nombre completo.');
  if (w.users[p.userId] || w.orgs[p.orgId]) fail('DUPLICATE', 'Esta cuenta ya se creó.');
  if (p.dni) {
    if (!isDniValid(p.dni)) fail('BAD_DNI', 'El DNI tiene 8 números.');
    if (Object.values(w.users).some(u => u.dni === p.dni)) fail('DNI_TAKEN', 'Ese DNI ya pertenece a otra cuenta (RN-18). Escríbele a Soporte si es un error.');
  }
  const o = p.org ?? {};
  const district = String(o.district ?? '');
  if (!DISTRICT_BY_CODE[district]) fail('BAD_DISTRICT', 'Elige tu distrito.');
  let ruc: string | undefined = o.ruc ? String(o.ruc) : undefined;
  let legalName: string | undefined = o.legalName;
  if (role !== 'FARMER' || ruc) {
    if (!ruc) fail('NO_RUC', 'Escribe el RUC de tu negocio (11 dígitos).');
    if (!isRucValid(ruc)) fail('BAD_RUC', 'Ese RUC no es válido: revisa los 11 dígitos.');
    if (Object.values(w.orgs).some(x => x.ruc === ruc)) fail('RUC_TAKEN', 'Ese RUC ya tiene una cuenta en Mesagri (RN-18).');
    const pad = w.padron[ruc];
    if (pad && (pad.estado !== 'ACTIVO' || pad.condicion !== 'HABIDO')) {
      fail('RUC_NO_HABIDO', `La SUNAT muestra este RUC como ${pad.estado === 'ACTIVO' ? 'no habido' : 'de baja'}. Regulariza tu RUC en la SUNAT y vuelve a intentarlo.`);
    }
    if (pad) legalName = pad.name;
  }
  if (role === 'CARRIER') {
    const v = p.carrier;
    if (!v || !['V1', 'V2', 'V3'].includes(v.vclass)) fail('BAD_VEHICLE', 'Mesagri solo admite moto con cajuela, camioneta o furgón y camión ligero (RN-53).');
    if (!/^[A-Z0-9]{3}-?[A-Z0-9]{3}$/i.test(String(v.plate ?? ''))) fail('BAD_PLATE', 'Escribe la placa como V7K-812.');
    if (v.licenseCls !== undefined && !['B-IIb', 'A-I', 'A-IIb'].includes(v.licenseCls)) fail('BAD_LICENSE', 'Elige la clase de tu licencia de conducir.');
    const plate = String(v.plate).toUpperCase().replace('-', '');
    if (Object.values(w.orgs).some(x => x.carrier && x.carrier.vehicle.plate.replace('-', '') === plate)) fail('PLATE_TAKEN', 'Esa placa ya está registrada en Mesagri (RN-18). Escríbele a Soporte si es un error.');
  }
  const u: User = {
    id: p.userId, name, shortName: name.split(' ')[0], phone, role, orgId: p.orgId, dni: p.dni, createdAt: t,
    prefs: defaultPrefs(p.lang ?? 'es'), status: 'ACTIVE',
  };
  const org: Org = {
    id: p.orgId, type: role as Org['type'], name: o.name || name, legalName, ruc, dni: role === 'FARMER' ? p.dni : undefined,
    district, province: DISTRICT_BY_CODE[district].province, address: o.address, receiver: o.receiver,
    businessType: o.businessType, level: 0, status: 'ACTIVE', createdAt: t,
    taxRegime: role === 'FARMER' ? (o.taxRegime ?? (ruc ? 'NRUS' : 'SIN_RUC')) : 'GENERAL',
    payout: [], acceptsCash: false, serviceAreas: [], deliveryDays: [], memberIds: [p.userId],
    counters: emptyCounters(), initials: initials(o.name || name), color: colorFor(p.orgId),
  };
  if (role === 'BUYER') {
    const trialDays = w.settings.membership.trialDays;
    org.subscription = {
      plan: 'BASICO', status: 'TRIAL', trialEndsOn: t + trialDays * 86400000, paidUntil: t + trialDays * 86400000,
      monthsBelow: 0, history: [{ at: t, text: 'Plan Básico con el primer mes gratis (RN-35).' }],
    };
  }
  if (role === 'CARRIER') {
    const v = p.carrier;
    org.carrier = {
      level: 'T0', available: false,
      vehicle: { plate: String(v.plate).toUpperCase(), vclass: v.vclass, category: VCLASS_INFO[v.vclass as 'V1'].category as any, body: String(v.body ?? '').slice(0, 60), payloadKg: Math.min(Math.round(Number(v.payloadKg)) || VCLASS_INFO[v.vclass as 'V1'].maxKg, 6000), year: Math.round(Number(v.year)) || 2018, docs: cleanDocs(v.docs) },
      driverLicense: { cls: v.licenseCls ?? 'A-I', expiresOn: Number(v.licenseExpires) || addMonths(t, 36) },
      routes: cleanRoutes(w, v.routes), training: { done: 0, total: 3 }, agreementSigned: !!v.agreement, insurance: false, noShows: 0,
    };
  }
  if (role === 'WAREHOUSE') {
    const h = p.warehouse ?? {};
    org.warehouse = {
      level: 'A0', facilityType: (['MOLINO', 'SECO', 'ACOPIO'].includes(h.facilityType) ? h.facilityType : 'SECO'), capacitySacks: Math.max(0, Math.round(Number(h.capacitySacks))) || 500, rates: cleanRates(h.rates),
      defaultRate: Number(h.defaultRate) > 0 ? Number(h.defaultRate) : 1.8,
      products: (Array.isArray(h.products) ? h.products : []).map(String).filter((id: string) => !!PRODUCT_BY_ID[id]),
      services: (Array.isArray(h.services) ? h.services : []).map((x: unknown) => String(x).slice(0, 120)),
      optional: (Array.isArray(h.optional) ? h.optional : []).map((x: any) => ({ label: String(x?.label ?? '').slice(0, 120), price: Math.max(0, Number(x?.price) || 0) })),
      docs: cleanDocs(h.docs), agreementSigned: !!h.agreement, location: district, geo: DISTRICT_BY_CODE[district].geo,
      visitScheduled: h.visitAt,
    };
  }
  w.users[u.id] = u;
  w.orgs[org.id] = org;
  audit(c, u.id, 'REGISTRO', org.id, `Cuenta nueva de ${roleLabel(role)}: ${org.name}`);
  notify(c, org.id, 'SYSTEM', 'Bienvenida a Mesagri', role === 'BUYER' ? 'Tu plan Básico tiene el primer mes gratis.' : 'Registrarte y verificarte es gratis.');
  return { userId: u.id, orgId: org.id };
});

export function roleLabel(r: string): string {
  return ({ FARMER: 'agricultor', BUYER: 'comprador MYPE', CARRIER: 'transportista aliado', WAREHOUSE: 'almacén aliado', ADMIN: 'administración' } as any)[r] ?? r;
}

on('CONSENTS_ACCEPT', (c) => {
  const raw = (c.e.p.items ?? {}) as Record<string, unknown>;
  const items: Record<string, boolean> = Object.fromEntries(Object.entries(raw).slice(0, 20).map(([k, v]) => [String(k).slice(0, 40), v === true]));
  for (const k of ['distrito', 'dni']) if (items[k] !== true) fail('CONSENT_REQUIRED', 'Para continuar necesitamos que aceptes mostrar tu distrito y guardar la foto de tu DNI. Te explicamos por qué en el resumen.');
  c.a.consents = { version: String(c.e.p.version ?? '1.0'), at: c.t, items };
  audit(c, c.a.id, 'CONSENTIMIENTO', c.a.id, `Aceptó términos v${c.a.consents.version}`);
});

on('PREFS_SET', (c) => {
  const p = c.e.p.prefs ?? {};
  const pr = c.a.prefs;
  if ('lang' in p) { if (!['es', 'qu', 'ay'].includes(p.lang)) fail('BAD_PREFS', 'Ese idioma todavía no está disponible.'); pr.lang = p.lang; }
  if ('textScale' in p) { const v = Number(p.textScale); if (![1, 1.25, 1.5].includes(v)) fail('BAD_PREFS', 'Ese tamaño de letra no está disponible.'); pr.textScale = v as Prefs['textScale']; }
  if ('numFmt' in p) { if (!['coma', 'punto'].includes(p.numFmt)) fail('BAD_PREFS', 'Formato de números no válido.'); pr.numFmt = p.numFmt; }
  for (const k of ['audioGuide', 'bilingual', 'dataSaver'] as const) if (k in p) pr[k] = !!p[k];
});

/* ---------- Cuenta de cobro y zonas (A-06, A-07, RF-VER-12, RN-27, RN-28) ---------- */
on('PAYOUT_SET', (c) => {
  const o = getOrg(c.w, c.e.p.orgId);
  requireMember(c.a, o.id);
  const accounts = (c.e.p.accounts ?? []) as PayoutAccount[];
  for (const a of accounts) {
    if (!a.number || String(a.number).replace(/\s/g, '').length < 6) fail('BAD_ACCOUNT', 'Escribe el número de Yape, Plin o la cuenta (CCI).');
    if (a.relation !== 'PROPIA' && !String(a.authorization ?? '').trim()) fail('NEEDS_AUTH', 'Una cuenta de un familiar o de tu asociación necesita la autorización firmada del titular (RN-28).');
  }
  const acceptsCash = !!c.e.p.acceptsCash;
  if (!accounts.length && !acceptsCash) fail('NO_PAYOUT', 'Elige cómo te pagan: Yape o Plin, una cuenta, o solo efectivo al entregar.');
  o.payout = accounts.map(a => ({ id: String(a.id), kind: a.kind, number: String(a.number).replace(/\s/g, ''), holder: String(a.holder ?? ''), relation: a.relation ?? 'PROPIA', authorization: a.authorization, verified: o.level >= 1 ? a.verified ?? false : false }));
  o.acceptsCash = acceptsCash;
  // Si tiene un expediente abierto, la cuenta de cobro entra como evidencia y se recalculan las alertas (RN-28)
  for (const k of Object.values(c.w.cases)) {
    if (k.orgId !== o.id || !['SUBMITTED', 'IN_REVIEW', 'NEEDS_INFO', 'APPEALED'].includes(k.status)) continue;
    const a = accounts[0];
    const label = !a ? 'Solo efectivo al entregar' : a.relation !== 'PROPIA' ? `${a.kind === 'PLIN' ? 'Plin' : 'Yape'} de ${a.relation === 'ASOCIACION' ? 'su asociación' : 'un familiar'} con autorización firmada` : a.kind === 'BANK' ? 'Cuenta bancaria propia' : `${a.kind === 'PLIN' ? 'Plin' : 'Yape'} propio`;
    const ev: Evidence = { key: 'cobro', label, detail: a ? `${a.holder} · ${String(a.number).slice(0, 3)}…${String(a.number).slice(-3)}` : undefined };
    k.evidence = [...k.evidence.filter(e => e.key !== 'cobro'), ev];
    k.alerts = [...new Set([...k.alerts.filter(x => x !== 'CUENTA DE TERCERO'), ...computeAlerts(c.w, o)])];
  }
});

on('ZONES_SET', (c) => {
  const o = getOrg(c.w, c.e.p.orgId);
  requireMember(c.a, o.id);
  const areas = (c.e.p.areas ?? []) as { district: string; fee: number }[];
  for (const a of areas) if (!DISTRICT_BY_CODE[a.district]) fail('BAD_DISTRICT', 'Una de las zonas no es válida.');
  const seen = new Set<string>();
  o.serviceAreas = areas.filter(a => !seen.has(a.district) && !!seen.add(a.district)).map(a => ({ district: a.district, fee: Math.max(0, Number(a.fee) || 0) }));
  o.deliveryDays = (c.e.p.days ?? []).map(Number).filter((d: number) => d >= 1 && d <= 7);
  if (c.e.p.pickupPoint !== undefined) o.pickupPoint = c.e.p.pickupPoint;
});

on('ORG_UPDATE', (c) => {
  const o = getOrg(c.w, c.e.p.orgId);
  requireMember(c.a, o.id);
  const p = c.e.p;
  if (p.address !== undefined) o.address = String(p.address).slice(0, 200);
  if (p.receiver !== undefined && o.type === 'BUYER') o.receiver = String(p.receiver).slice(0, 120);
  if (p.district !== undefined && o.type === 'BUYER') {
    if (!DISTRICT_BY_CODE[p.district]) fail('BAD_DISTRICT', 'Elige un distrito válido.');
    o.district = p.district; o.province = DISTRICT_BY_CODE[p.district].province;
  }
});

on('FARM_ADD', (c) => {
  const p = c.e.p;
  const o = getOrg(c.w, p.orgId);
  requireMember(c.a, o.id);
  if (o.type !== 'FARMER') fail('FORBIDDEN', 'Solo los agricultores registran chacras.');
  if (!String(p.name ?? '').trim()) fail('BAD_NAME', 'Ponle un nombre a tu chacra.');
  const area = Number(p.areaHa);
  if (!(area > 0 && area < 500)) fail('BAD_AREA', 'Escribe el área en hectáreas (por ejemplo 1,5).');
  if (!DISTRICT_BY_CODE[p.district]) fail('BAD_DISTRICT', 'Elige el distrito de la chacra.');
  c.w.farms[p.farmId] = {
    id: p.farmId, orgId: o.id, name: String(p.name).trim(), district: p.district, areaHa: area, tenure: p.tenure ?? 'PROPIA',
    crops: p.crops ?? [], gps: p.gps ?? 'MANUAL', photos: p.photoIds ?? [], createdAt: c.t,
  };
});

/* ---------- Expedientes de verificación (RF-VER-01 a RF-VER-16, CU-41) ---------- */
function openCaseFor(w: Ctx['w'], orgId: string, target: number) {
  return Object.values(w.cases).find(k => k.orgId === orgId && k.targetLevel === target && ['SUBMITTED', 'IN_REVIEW', 'NEEDS_INFO', 'APPEALED'].includes(k.status));
}

export function computeAlerts(w: Ctx['w'], org: Org): string[] {
  const alerts: string[] = [];
  const users = Object.values(w.users);
  const me = users.filter(u => u.orgId === org.id);
  for (const u of me) {
    if (u.dni && users.some(x => x.id !== u.id && x.dni === u.dni)) alerts.push('DNI REPETIDO');
    if (users.some(x => x.id !== u.id && x.phone === u.phone)) alerts.push('TELÉFONO REPETIDO');
    // otra organización cobra en el número de este celular
    if (Object.values(w.orgs).some(o => o.id !== org.id && o.payout.some(a => a.kind !== 'BANK' && a.number === u.phone))) alerts.push('TELÉFONO REPETIDO');
  }
  // cobra en un número que es el celular de otra persona registrada (10.4, antifraude)
  if (org.payout.some(a => a.kind !== 'BANK' && users.some(x => x.orgId !== org.id && x.phone === a.number))) alerts.push('TELÉFONO REPETIDO');
  if (org.payout.some(a => a.relation !== 'PROPIA')) alerts.push('CUENTA DE TERCERO');
  if (org.ruc && w.padron[org.ruc] && w.padron[org.ruc].condicion !== 'HABIDO') alerts.push('RUC NO HABIDO');
  if (org.carrier && !licenseMatches(org.carrier.vehicle.vclass, org.carrier.driverLicense.cls)) alerts.push('LICENCIA NO CORRESPONDE');
  return [...new Set(alerts)];
}

on('VERIF_SUBMIT', (c) => {
  const p = c.e.p;
  const o = getOrg(c.w, p.orgId);
  requireMember(c.a, o.id);
  const target = Number(p.targetLevel);
  const current = levelNumber(o);
  if (!(target >= 1 && target <= 3)) fail('BAD_LEVEL', 'Nivel no válido.');
  if (target <= current) fail('ALREADY', 'Ya tienes ese nivel.');
  if (openCaseFor(c.w, o.id, target)) fail('OPEN_CASE', 'Ya enviaste este expediente: lo estamos revisando.');
  const raw = (p.evidence ?? []) as (Evidence & { flag?: string })[];
  if (!raw.length) fail('NO_EVIDENCE', 'Agrega al menos un documento.');
  const evidence: Evidence[] = raw.map(x => ({ key: String(x.key), label: String(x.label ?? ''), detail: x.detail, photoId: x.photoId, ok: x.ok }));
  const kase: VerifCase = {
    id: p.caseId, orgId: o.id, kind: o.type === 'MESAGRI' ? 'FARMER' : (o.type as any), targetLevel: target, status: 'SUBMITTED',
    submittedAt: c.t, evidence, alerts: [...new Set([...computeAlerts(c.w, o), ...raw.map(x => x.flag).filter((f): f is string => !!f)])], history: [{ at: c.t, by: c.a.id, text: 'Envió el expediente' }],
  };
  c.w.cases[kase.id] = kase;
  notify(c, 'ADMIN', 'VERIFICATION', 'Expediente nuevo', `${o.name} pide ${levelLabel(o, target)}`, { screen: 'W-04', params: { id: kase.id } });
  notify(c, o.id, 'VERIFICATION', 'Recibimos tus documentos', 'Una persona del equipo los revisa y responde en 48 h.');
  return { caseId: kase.id };
});

export function levelNumber(o: Org): number {
  if (o.carrier) return Number(o.carrier.level.slice(1));
  if (o.warehouse) return Number(o.warehouse.level.slice(1));
  return o.level;
}

export function levelLabel(o: Org, n: number): string {
  if (o.type === 'CARRIER') return `el nivel T${n}`;
  if (o.type === 'WAREHOUSE') return `el nivel A${n}`;
  return `el nivel ${n}`;
}

on('VERIF_TAKE', (c) => {
  requireAdmin(c.a, 'VERIFIER', 'GENERAL');
  const k = must(c.w.cases[c.e.p.caseId], 'NOT_FOUND', 'No encontramos el expediente.');
  if (!['SUBMITTED', 'IN_REVIEW', 'APPEALED'].includes(k.status)) fail('CLOSED', 'Este expediente ya se decidió.');
  if (k.status === 'APPEALED' && k.decision?.by === c.a.id) fail('SAME_REVIEWER', 'Una apelación la revisa otra persona (RF-VER-16).');
  k.assignedTo = c.a.id;
  if (k.status === 'SUBMITTED') k.status = 'IN_REVIEW';
  k.history.push({ at: c.t, by: c.a.id, text: `Asignado a ${c.a.name}` });
});

on('VERIF_DECIDE', (c) => {
  requireAdmin(c.a, 'VERIFIER', 'GENERAL');
  const p = c.e.p;
  const k = must(c.w.cases[p.caseId], 'NOT_FOUND', 'No encontramos el expediente.');
  if (!['SUBMITTED', 'IN_REVIEW', 'APPEALED'].includes(k.status)) fail('CLOSED', 'Este expediente ya se decidió.');
  if (k.status === 'APPEALED' && k.decision?.by === c.a.id) fail('SAME_REVIEWER', 'Una apelación la decide otra persona (RF-VER-16).');
  const result = p.result as 'APPROVE' | 'NEEDS_INFO' | 'REJECT';
  const reason = String(p.reason ?? '').trim();
  if ((result === 'REJECT' || result === 'NEEDS_INFO') && reason.length < 5) fail('REASON_REQUIRED', 'Escribe el motivo: el usuario lo va a leer (RN-16).');
  if (result === 'APPROVE' && k.alerts.length && reason.length < 5) fail('JUSTIFY', 'Este expediente tiene alertas: anota por qué lo apruebas.');
  const o = getOrg(c.w, k.orgId);
  const before = levelText(o);
  if (result === 'APPROVE') {
    if (o.carrier) {
      if (k.targetLevel >= 2) {
        const ins = o.carrier.inspection;
        if (!ins || ins.score < c.w.settings.carrier.minScore || ins.criticalFails > 0) fail('INSPECTION', 'Para T2 hace falta la revisión del vehículo con 80 puntos o más y sin fallas críticas (RN-52).');
        if (!o.carrier.agreementSigned) fail('AGREEMENT', 'Falta el convenio firmado.');
        if (o.carrier.training.done < o.carrier.training.total) fail('TRAINING', 'Falta terminar la capacitación en el celular.');
        o.carrier.level = 'T2';
      } else o.carrier.level = 'T1';
    } else if (o.warehouse) {
      if (k.targetLevel >= 2) {
        const v = o.warehouse.visit;
        if (!v || v.score < c.w.settings.storage.minScore || v.criticalFails > 0) fail('VISIT', 'Para A2 hace falta la visita con 80 puntos o más y sin fallas críticas (RN-42).');
        if (!o.warehouse.agreementSigned) fail('AGREEMENT', 'Falta el convenio de almacén aliado firmado.');
        o.warehouse.level = 'A2';
      } else o.warehouse.level = 'A1';
    } else {
      o.level = Math.max(o.level, k.targetLevel);
      if (o.type === 'FARMER') o.payout.forEach(a => { if (a.relation === 'PROPIA' || a.authorization) a.verified = true; });
      if (k.targetLevel >= 2) Object.values(c.w.farms).filter(f => f.orgId === o.id).forEach(f => { f.gps = 'APP'; });
    }
  }
  k.status = result === 'APPROVE' ? 'APPROVED' : result === 'REJECT' ? 'REJECTED' : 'NEEDS_INFO';
  k.decision = { by: c.a.id, at: c.t, result, reason };
  k.assignedTo = k.assignedTo ?? c.a.id;
  k.history.push({ at: c.t, by: c.a.id, text: result === 'APPROVE' ? `Aprobó ${levelLabel(o, k.targetLevel)}` : result === 'REJECT' ? `Rechazó: ${reason}` : `Pidió más datos: ${reason}` });
  audit(c, c.a.id, 'DECISIÓN DE VERIFICACIÓN', o.id, `${result} · ${o.name} · ${levelLabel(o, k.targetLevel)}${reason ? ' · ' + reason : ''}`, before, levelText(o));
  const msg = result === 'APPROVE' ? `¡Listo! Ya tienes ${levelLabel(o, k.targetLevel)}.` : result === 'REJECT' ? `No pudimos aprobar: ${reason}. Puedes apelar una vez.` : `Necesitamos algo más: ${reason}`;
  notify(c, o.id, 'VERIFICATION', 'Tu verificación', msg, { screen: 'VERIF' });
});

function levelText(o: Org) { return o.carrier ? o.carrier.level : o.warehouse ? o.warehouse.level : `nivel ${o.level}`; }

on('VERIF_APPEAL', (c) => {
  const k = must(c.w.cases[c.e.p.caseId], 'NOT_FOUND', 'No encontramos el expediente.');
  requireMember(c.a, k.orgId);
  if (k.status !== 'REJECTED') fail('NOT_REJECTED', 'Solo se apela una decisión de rechazo.');
  if (k.appealed) fail('ONE_APPEAL', 'Ya usaste tu apelación (RF-VER-16).');
  k.status = 'APPEALED';
  k.appealed = true;
  k.history.push({ at: c.t, by: c.a.id, text: `Apeló: ${String(c.e.p.text ?? '').slice(0, 200)}` });
  notify(c, 'ADMIN', 'VERIFICATION', 'Apelación', `${c.w.orgs[k.orgId]?.name} apeló una decisión`, { screen: 'W-04', params: { id: k.id } });
});

on('VERIF_RESPOND', (c) => {
  const k = must(c.w.cases[c.e.p.caseId], 'NOT_FOUND', 'No encontramos el expediente.');
  requireMember(c.a, k.orgId);
  if (k.status !== 'NEEDS_INFO') fail('NOT_WAITING', 'Este expediente no espera respuesta.');
  const ev = (c.e.p.evidence ?? []) as Evidence[];
  k.evidence.push(...ev);
  k.status = 'SUBMITTED';
  k.history.push({ at: c.t, by: c.a.id, text: `Respondió: ${String(c.e.p.text ?? 'envió lo pedido').slice(0, 200)}` });
});

/* ---------- Transportista y almacén: revisión, capacitación, disponibilidad ---------- */
on('CARRIER_INSPECTION', (c) => {
  requireAdmin(c.a, 'VERIFIER', 'GENERAL');
  const o = getOrg(c.w, c.e.p.orgId);
  if (!o.carrier) fail('NOT_CARRIER', 'No es transportista.');
  const score = Math.round(Number(c.e.p.score));
  if (!(score >= 0 && score <= 100)) fail('BAD_SCORE', 'El puntaje va de 0 a 100.');
  const checklist = Object.fromEntries(Object.entries((c.e.p.checklist ?? {}) as Record<string, unknown>).slice(0, 40).map(([k, v]) => [String(k).slice(0, 60), !!v]));
  o.carrier.inspection = { at: c.t, score, criticalFails: Math.max(0, Math.round(Number(c.e.p.criticalFails) || 0)), by: c.a.id, checklist };
  audit(c, c.a.id, 'REVISIÓN DEL VEHÍCULO', o.id, `${o.carrier.vehicle.plate}: ${score}/100, fallas críticas ${o.carrier.inspection.criticalFails}`);
});

on('WAREHOUSE_VISIT', (c) => {
  requireAdmin(c.a, 'VERIFIER', 'GENERAL');
  const o = getOrg(c.w, c.e.p.orgId);
  if (!o.warehouse) fail('NOT_WAREHOUSE', 'No es almacén.');
  const score = Math.round(Number(c.e.p.score));
  if (!(score >= 0 && score <= 100)) fail('BAD_SCORE', 'El puntaje va de 0 a 100.');
  o.warehouse.visit = { at: c.t, score, criticalFails: Math.max(0, Math.round(Number(c.e.p.criticalFails) || 0)), by: c.a.id };
  audit(c, c.a.id, 'VISITA DE CAMPO', o.id, `${o.name}: ${score}/100`);
});

on('CARRIER_TRAINING', (c) => {
  const o = getOrg(c.w, c.a.orgId);
  if (!o.carrier) fail('NOT_CARRIER', 'No es transportista.');
  o.carrier.training.done = Math.min(o.carrier.training.total, Math.max(o.carrier.training.done, Number(c.e.p.done) || 0));
});

on('CARRIER_AGREEMENT', (c) => {
  const o = getOrg(c.w, c.a.orgId);
  if (o.carrier) o.carrier.agreementSigned = true;
  else if (o.warehouse) o.warehouse.agreementSigned = true;
  else fail('FORBIDDEN', 'No aplica a tu cuenta.');
  audit(c, c.a.id, 'CONVENIO FIRMADO', o.id, `Convenio v1.0 aceptado por ${c.a.name}`);
});

on('CARRIER_AVAILABLE', (c) => {
  const o = getOrg(c.w, c.a.orgId);
  if (!o.carrier) fail('NOT_CARRIER', 'No es transportista.');
  if (c.e.p.available && o.carrier.level !== 'T2' && o.carrier.level !== 'T3') fail('LEVEL', 'Podrás ponerte disponible cuando llegues al nivel T2.');
  o.carrier.available = !!c.e.p.available;
});

on('CARRIER_DOC_RENEW', (c) => {
  const o = getOrg(c.w, c.a.orgId);
  const docs = o.carrier?.vehicle.docs ?? o.warehouse?.docs;
  if (!docs) fail('FORBIDDEN', 'No aplica a tu cuenta.');
  const d = docs.find(x => x.kind === c.e.p.kind);
  if (!d) fail('NOT_FOUND', 'No encontramos ese documento.');
  const exp = Number(c.e.p.expiresOn);
  if (!(exp > c.t)) fail('BAD_DATE', 'La nueva fecha de vencimiento debe ser futura.');
  d.expiresOn = exp; d.status = 'OK'; d.note = 'Renovado · por revisar';
  if (c.e.p.kind === 'LICENCIA' && o.carrier) o.carrier.driverLicense.expiresOn = exp;
  notify(c, 'ADMIN', 'VERIFICATION', 'Documento renovado', `${o.name}: ${d.label}`);
});

on('WAREHOUSE_UPDATE', (c) => {
  const o = getOrg(c.w, c.a.orgId);
  if (!o.warehouse) fail('NOT_WAREHOUSE', 'No es almacén.');
  const p = c.e.p;
  if (p.capacitySacks !== undefined) {
    const cap = Number(p.capacitySacks);
    if (!(cap >= 10)) fail('BAD_CAP', 'La capacidad mínima es 10 sacos.');
    o.warehouse.capacitySacks = cap;
  }
  if (p.defaultRate !== undefined) {
    const r = Number(p.defaultRate);
    if (!(r > 0 && r < 20)) fail('BAD_RATE', 'Escribe una tarifa por saco al mes razonable.');
    o.warehouse.defaultRate = r;
    o.warehouse.rates = o.warehouse.rates.map(x => ({ ...x, perSackMonth: r }));
  }
});

/* ---------- Administración de cuentas (RF-ADM-01) ---------- */
on('ORG_SUSPEND', (c) => {
  requireAdmin(c.a, 'GENERAL', 'SUPPORT');
  const o = getOrg(c.w, c.e.p.orgId);
  const reason = String(c.e.p.reason ?? '').trim();
  if (reason.length < 5) fail('REASON_REQUIRED', 'Escribe el motivo de la suspensión.');
  o.status = 'SUSPENDED'; o.suspendedReason = reason;
  if (o.carrier) o.carrier.available = false;
  audit(c, c.a.id, 'SUSPENSIÓN', o.id, `${o.name}: ${reason}`, 'ACTIVA', 'SUSPENDIDA');
  notify(c, o.id, 'SYSTEM', 'Tu cuenta está suspendida', `${reason}. Tus pedidos en curso continúan. Escríbele a Soporte.`);
});

on('ORG_REACTIVATE', (c) => {
  requireAdmin(c.a, 'GENERAL', 'SUPPORT');
  const o = getOrg(c.w, c.e.p.orgId);
  o.status = 'ACTIVE'; o.suspendedReason = undefined;
  audit(c, c.a.id, 'REACTIVACIÓN', o.id, `${o.name}`, 'SUSPENDIDA', 'ACTIVA');
  notify(c, o.id, 'SYSTEM', 'Tu cuenta está activa otra vez', 'Ya puedes operar con normalidad.');
});

/* ---------- Favoritos (RF-CAT-08, RF-TRA-21) ---------- */
on('FAVORITE_TOGGLE', (c) => {
  const o = getOrg(c.w, c.a.orgId);
  if (o.type !== 'BUYER') fail('FORBIDDEN', 'Los favoritos son para compradores.');
  const f = c.w.favorites[o.id] ?? (c.w.favorites[o.id] = { listings: [], sellers: [], carriers: [] });
  const key = c.e.p.kind === 'carrier' ? 'carriers' : c.e.p.kind === 'seller' ? 'sellers' : 'listings';
  const list = f[key];
  const id = String(c.e.p.id);
  const i = list.indexOf(id);
  if (c.e.p.on && i === -1) list.push(id);
  if (!c.e.p.on && i !== -1) list.splice(i, 1);
});

/* ---------- Demo y auditoría ---------- */
on('CLOCK_ADVANCE', (c) => {
  const ms = Number(c.e.p.ms);
  if (!(ms > 0 && ms <= 120 * 86400000)) fail('BAD_CLOCK', 'Adelanto no válido.');
  c.w.clockOffset += ms;
});

/** Marca de reloj: el servidor la registra para procesar los plazos que vencieron (14.7) aunque nadie haga nada. */
on('CLOCK_TICK', () => undefined);

on('AUDIT_VIEW', (c) => {
  requireAdmin(c.a);
  audit(c, c.a.id, 'ACCESO A DOCUMENTOS', String(c.e.p.entity ?? ''), String(c.e.p.detail ?? 'Abrió el expediente'));
});
