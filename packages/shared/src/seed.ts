/*
 * Mundo de ejemplo. Personas, negocios, almacenes y transportistas de la sección 5 del documento
 * (ficticios y compuestos). La historia (ventas, envíos, estados de cuenta, disputas, expedientes)
 * se crea pasando eventos por el mismo motor: así cada número es coherente con las reglas.
 *
 * El reloj de la demo arranca siempre el martes 3 de noviembre de 2026 a las 8:30 (hora de Lima),
 * dos días después del cierre de octubre: hay estados de cuenta por pagar, un pedido en camino,
 * un envío asignado, una disputa abierta y expedientes en la bandeja del verificador.
 */
import type { World, MEvent, Org, User, Farm, DocItem, Prefs } from './types';
import { emptyWorld } from './engine/core';
import { emptyCounters, defaultPrefs } from './engine/accounts';
import { limaTime, DAY, HOUR, MIN, startOfDay, addMonths } from './time';
import { rucWithCheck, initials } from './rules';
import { DISTRICT_BY_CODE } from './ubigeo';
import { codeFrom, digitsFrom } from './ids';
import { QU_PRODUCT_DRAFTS } from './catalog';

export const SEED_ANCHOR = limaTime(2026, 11, 3, 8, 30);
const T = (m: number, d: number, hh = 9, mm = 0) => limaTime(2026, m, d, hh, mm);

/* ---------- RUC de ejemplo (con dígito verificador real) ---------- */
export const RUC = {
  hector: rucWithCheck('1029456781'),
  lapunta: rucWithCheck('2045678912'),
  lucio: rucWithCheck('1029845610'),
  geranios: rucWithCheck('2060123456'),
  hotel: rucWithCheck('2045566778'),
  elena: rucWithCheck('1040871236'),
  santarosa: rucWithCheck('2049887766'),
  tambo: rucWithCheck('2051234567'),
  julio: rucWithCheck('1042964012'),
  edgar: rucWithCheck('1043561278'),
  moto: rucWithCheck('1072311409'),
  colca: rucWithCheck('2060998877'),
  pampa: rucWithCheck('2060445566'),
  yanque: rucWithCheck('2045889900'),
  valleverde: rucWithCheck('2060778899'),
  test1: rucWithCheck('2061111222'),
  test2: rucWithCheck('2061333444'),
  test3: rucWithCheck('1046655443'),
  test4: rucWithCheck('2061555666'),
};

/** RUC para probar el registro (el padrón de prueba los conoce). */
export const TEST_RUCS = [
  { ruc: RUC.test1, name: 'Restaurante Nuevo Sabor S.A.C.', note: 'activo y habido' },
  { ruc: RUC.test2, name: 'Bodega Don Lucho E.I.R.L.', note: 'no habido: no se puede registrar' },
  { ruc: RUC.test3, name: 'Transportes Quispe (persona con RUC)', note: 'activo y habido' },
  { ruc: RUC.test4, name: 'Acopio Santa Isabel S.A.C.', note: 'activo y habido' },
];

/* ---------- Personas para el selector de la demo ---------- */
export interface Persona { userId: string; label: string; sub: string; role: User['role']; group: string }
export const PERSONAS: Persona[] = [
  { userId: 'u-hector', label: 'Don Héctor Mendoza', sub: 'Agricultor · Camaná · nivel 3', role: 'FARMER', group: 'Agricultores' },
  { userId: 'u-wilber', label: 'Wilber Huamaní', sub: 'Agricultor · Yanque · nivel 2', role: 'FARMER', group: 'Agricultores' },
  { userId: 'u-justina', label: 'Doña Justina Mamani', sub: 'Agricultora · Yanque · nivel 1', role: 'FARMER', group: 'Agricultores' },
  { userId: 'u-nayeli', label: 'Nayeli · hija de Wilber', sub: 'Publica y atiende pedidos por su papá', role: 'FARMER', group: 'Agricultores' },
  { userId: 'u-charo', label: 'Doña Charo · Los Geranios', sub: 'MYPE · Yanahuara · plan Básico', role: 'BUYER', group: 'Compradores MYPE' },
  { userId: 'u-andres', label: 'Andrés · Hotel Los Andes', sub: 'MYPE · Cercado · plan Pro', role: 'BUYER', group: 'Compradores MYPE' },
  { userId: 'u-rosaq', label: 'Rosa · cocina del Hotel Los Andes', sub: 'Equipo de la MYPE · solo hace pedidos', role: 'BUYER', group: 'Compradores MYPE' },
  { userId: 'u-elena', label: 'Elena · Sabor Paucarpata', sub: 'MYPE · Paucarpata · plan Básico', role: 'BUYER', group: 'Compradores MYPE' },
  { userId: 'u-julio', label: 'Julio Apaza · Transportes Majes', sub: 'Transportista · furgón · T2', role: 'CARRIER', group: 'Transportistas aliados' },
  { userId: 'u-ronald', label: 'Ronald · Rápidos Yanahuara', sub: 'Transportista · moto · T2', role: 'CARRIER', group: 'Transportistas aliados' },
  { userId: 'u-ernesto', label: 'Don Ernesto · Molinera La Pampa', sub: 'Almacén aliado · Camaná · A2', role: 'WAREHOUSE', group: 'Almacenes aliados' },
  { userId: 'u-elmer', label: 'Elmer · Centro de acopio Yanque', sub: 'Almacén aliado · Colca · A2', role: 'WAREHOUSE', group: 'Almacenes aliados' },
  { userId: 'u-carlos', label: 'Carlos Ríos', sub: 'Panel web · administrador general', role: 'ADMIN', group: 'Equipo Mesagri' },
  { userId: 'u-monica', label: 'Mónica Torres', sub: 'Panel web · administradora general', role: 'ADMIN', group: 'Equipo Mesagri' },
  { userId: 'u-lucia', label: 'Lucía Paredes', sub: 'Panel web · verificadora', role: 'ADMIN', group: 'Equipo Mesagri' },
  { userId: 'u-diana', label: 'Diana Salas', sub: 'Panel web · soporte', role: 'ADMIN', group: 'Equipo Mesagri' },
  { userId: 'u-ana', label: 'Ana Pinto', sub: 'Panel web · analista (sin datos personales)', role: 'ADMIN', group: 'Equipo Mesagri' },
];

/* ---------- Construcción del mundo base ---------- */
function mkUser(w: World, u: Partial<User> & { id: string; name: string; phone: string; role: User['role']; orgId: string }, prefs?: Partial<Prefs>) {
  const full: User = { shortName: u.name.split(' ')[0], createdAt: T(9, 1), prefs: { ...defaultPrefs(), ...(prefs ?? {}) }, status: 'ACTIVE', ...u } as User;
  full.consents = { version: '1.0', at: full.createdAt, items: { distrito: true, dni: true, whatsapp: true, precios: false } };
  w.users[full.id] = full;
  return full;
}

function mkOrg(w: World, o: Partial<Org> & { id: string; type: Org['type']; name: string; district: string }) {
  const d = DISTRICT_BY_CODE[o.district];
  const full: Org = {
    level: 0, status: 'ACTIVE', createdAt: T(9, 1), payout: [], acceptsCash: false, serviceAreas: [], deliveryDays: [], memberIds: [],
    counters: emptyCounters(), initials: initials(o.name), color: '#2C5F2D', province: d?.province ?? 'AREQUIPA', ...o,
  } as Org;
  w.orgs[full.id] = full;
  return full;
}

function areas(list: [string, number][]) { return list.map(([district, fee]) => ({ district, fee })); }
const doc = (kind: string, label: string, expiresOn?: number, status: DocItem['status'] = 'OK', number?: string, note?: string): DocItem => ({ kind, label, expiresOn, status, number, note });

const AQP_CORE = ['040101', '040126', '040103', '040112', '040129', '040104'];

function base(w: World) {
  w.t0 = SEED_ANCHOR;
  w.now = T(9, 1, 0, 0);
  w.lastMonthClosed = '2026-08';
  w.seq = { complaint: 229, dispute: 30, shipment: 26, booking: 200, lot: 28, release: 198, incident: 11, ticket: 116, receiptB: 409, receiptF: 1016, stmt: 0, creditNote: 40 };

  // Padrón reducido de la SUNAT de prueba (RF-VER-03)
  const P = (ruc: string, name: string, district: string, condicion: 'HABIDO' | 'NO HABIDO' = 'HABIDO') => { w.padron[ruc] = { name, estado: 'ACTIVO', condicion, district }; };
  P(RUC.hector, 'MENDOZA SALAS HECTOR', '040201'); P(RUC.lapunta, 'ASOCIACIÓN DE AGRICULTORES LA PUNTA', '040201'); P(RUC.lucio, 'CHAMBI MAMANI LUCIO', '040520');
  P(RUC.geranios, 'PICANTERÍA LOS GERANIOS E.I.R.L.', '040126'); P(RUC.hotel, 'HOTEL LOS ANDES S.A.C.', '040101'); P(RUC.elena, 'CONDORI ROJAS ELENA', '040112');
  P(RUC.santarosa, 'COMEDOR POPULAR SANTA ROSA', '040101'); P(RUC.tambo, 'RESTAURANTE EL TAMBO S.A.C.', '040126', 'NO HABIDO');
  P(RUC.julio, 'APAZA QUISPE JULIO CESAR', '040201'); P(RUC.edgar, 'LAYME CCAMA EDGAR', '040201'); P(RUC.moto, 'QUISPE HUAMAN RONALD', '040126');
  P(RUC.colca, 'TRANSPORTES COLCA S.R.L.', '040501'); P(RUC.pampa, 'MOLINERA LA PAMPA S.A.C.', '040201'); P(RUC.yanque, 'COOPERATIVA AGRARIA YANQUE', '040519');
  P(RUC.valleverde, 'ALMACÉN VALLE VERDE S.A.C.', '040520');
  P(RUC.test1, 'RESTAURANTE NUEVO SABOR S.A.C.', '040103'); P(RUC.test2, 'BODEGA DON LUCHO E.I.R.L.', '040112', 'NO HABIDO');
  P(RUC.test3, 'QUISPE MAMANI NESTOR', '040201'); P(RUC.test4, 'ACOPIO SANTA ISABEL S.A.C.', '040520');

  /* Equipo de Mesagri (panel web) */
  mkOrg(w, { id: 'org-mesagri', type: 'MESAGRI', name: 'Mesagri S.A.C.', district: '040101', level: 3, initials: 'ME', color: '#1E3F20' });
  mkUser(w, { id: 'u-carlos', name: 'Carlos Ríos', phone: '900000001', role: 'ADMIN', adminRole: 'GENERAL', orgId: 'org-mesagri', email: 'carlos@mesagri.pe' });
  mkUser(w, { id: 'u-monica', name: 'Mónica Torres', phone: '900000002', role: 'ADMIN', adminRole: 'GENERAL', orgId: 'org-mesagri', email: 'monica@mesagri.pe' });
  mkUser(w, { id: 'u-lucia', name: 'Lucía Paredes', phone: '900000003', role: 'ADMIN', adminRole: 'VERIFIER', orgId: 'org-mesagri', email: 'lucia@mesagri.pe' });
  mkUser(w, { id: 'u-marco', name: 'Marco Rivas', phone: '900000004', role: 'ADMIN', adminRole: 'VERIFIER', orgId: 'org-mesagri', email: 'marco@mesagri.pe' });
  mkUser(w, { id: 'u-diana', name: 'Diana Salas', phone: '900000005', role: 'ADMIN', adminRole: 'SUPPORT', orgId: 'org-mesagri', email: 'diana@mesagri.pe' });
  mkUser(w, { id: 'u-ana', name: 'Ana Pinto', phone: '900000006', role: 'ADMIN', adminRole: 'ANALYST', orgId: 'org-mesagri', email: 'ana@mesagri.pe' });
  w.orgs['org-mesagri'].memberIds = ['u-carlos', 'u-monica', 'u-lucia', 'u-marco', 'u-diana', 'u-ana'];

  /* Agricultores */
  const hector = mkOrg(w, {
    id: 'org-hector', type: 'FARMER', name: 'Héctor Mendoza Salas', district: '040201', level: 3, ruc: RUC.hector, dni: '29456781', taxRegime: 'RER',
    payout: [{ id: 'pa-h1', kind: 'YAPE', number: '951234678', holder: 'Héctor Mendoza Salas', relation: 'PROPIA', verified: true }, { id: 'pa-h2', kind: 'BANK', number: '00221500123456789012', holder: 'Héctor Mendoza Salas', relation: 'PROPIA', verified: true }],
    acceptsCash: true, serviceAreas: areas([['040201', 0], ['040208', 0], ['040101', 10], ['040126', 10], ['040103', 10], ['040112', 10], ['040129', 10]]),
    deliveryDays: [2, 4, 6], pickupPoint: 'Chacra La Pampa, Camaná', memberIds: ['u-hector'], color: '#A66633', createdAt: T(8, 20),
  });
  hector.seedRating = { avg: 4.7, count: 28 };
  mkUser(w, { id: 'u-hector', name: 'Héctor Mendoza Salas', shortName: 'Héctor', title: 'Don Héctor', persona: 'F4', phone: '951234678', role: 'FARMER', orgId: 'org-hector', dni: '29456781', createdAt: T(8, 20) });

  const wilber = mkOrg(w, {
    id: 'org-wilber', type: 'FARMER', name: 'Wilber Huamaní Ch.', legalName: 'Wilber Huamaní Choquehuanca', district: '040519', level: 2, dni: '45218736', taxRegime: 'SIN_RUC',
    payout: [{ id: 'pa-w1', kind: 'YAPE', number: '987654321', holder: 'Wilber Huamaní', relation: 'PROPIA', verified: true }],
    acceptsCash: true, serviceAreas: areas([['040519', 0], ['040501', 0], ['040101', 0], ['040126', 0], ['040103', 0], ['040112', 0]]),
    deliveryDays: [2, 4, 6], pickupPoint: 'Pampa Alta, Yanque', memberIds: ['u-wilber'], color: '#2C5F2D', createdAt: T(8, 15),
  });
  wilber.seedRating = { avg: 4.8, count: 20 };
  mkUser(w, { id: 'u-wilber', name: 'Wilber Huamaní Choquehuanca', shortName: 'Wilber', persona: 'F2', phone: '987654321', role: 'FARMER', orgId: 'org-wilber', dni: '45218736', createdAt: T(8, 15) });

  const justina = mkOrg(w, {
    id: 'org-justina', type: 'FARMER', name: 'Justina Mamani Quispe', district: '040519', level: 1, dni: '23810941', taxRegime: 'SIN_RUC',
    payout: [{ id: 'pa-j1', kind: 'YAPE', number: '958771204', holder: 'Mayra Mamani (hija)', relation: 'FAMILIAR', authorization: 'Autorización firmada por Justina Mamani Quispe el 02/10/2026', verified: true }],
    acceptsCash: true, serviceAreas: areas([['040519', 0], ['040501', 0], ['040101', 15]]), deliveryDays: [5, 6], pickupPoint: 'Plaza de Yanque',
    memberIds: ['u-justina'], color: '#8E3B5E', createdAt: T(9, 28),
  });
  justina.seedRating = { avg: 4.5, count: 2 };
  mkUser(w, { id: 'u-justina', name: 'Justina Mamani Quispe', shortName: 'Justina', title: 'Doña Justina', persona: 'F1', phone: '974112358', role: 'FARMER', orgId: 'org-justina', dni: '23810941', createdAt: T(9, 28) }, { lang: 'qu', textScale: 1.25 });

  const lapunta = mkOrg(w, {
    id: 'org-lapunta', type: 'FARMER', name: 'Asoc. Agricultores La Punta', legalName: 'Asociación de Agricultores La Punta', district: '040201', level: 2, ruc: RUC.lapunta, taxRegime: 'GENERAL',
    payout: [{ id: 'pa-p1', kind: 'BANK', number: '00221500987654321098', holder: 'Asoc. Agricultores La Punta', relation: 'PROPIA', verified: true }, { id: 'pa-p2', kind: 'YAPE', number: '945778120', holder: 'Asoc. Agricultores La Punta', relation: 'PROPIA', verified: true }],
    acceptsCash: false, serviceAreas: areas([['040201', 0], ['040101', 25], ['040126', 25], ['040112', 25]]), deliveryDays: [1, 3, 5], pickupPoint: 'Local de la asociación, La Punta',
    memberIds: ['u-teodoro'], color: '#4F7A26', createdAt: T(7, 1),
  });
  lapunta.counters.completedSales = 10; lapunta.counters.freeSalesUsed = 5;
  lapunta.seedRating = { avg: 4.6, count: 15 };
  mkUser(w, { id: 'u-teodoro', name: 'Teodoro Llerena Paz', phone: '945778120', role: 'FARMER', orgId: 'org-lapunta', dni: '29330871', createdAt: T(7, 1) });

  const lucio = mkOrg(w, {
    id: 'org-lucio', type: 'FARMER', name: 'Lucio Chambi Mamani', district: '040520', level: 2, ruc: RUC.lucio, dni: '29845610', taxRegime: 'NRUS',
    payout: [{ id: 'pa-l1', kind: 'YAPE', number: '966209734', holder: 'Lucio Chambi Mamani', relation: 'PROPIA', verified: true }],
    acceptsCash: true, serviceAreas: areas([['040520', 0], ['040101', 15], ['040126', 15], ['040112', 15]]), deliveryDays: [1, 4], memberIds: ['u-lucio'], color: '#6E5F58', createdAt: T(6, 10),
  });
  lucio.counters.completedSales = 5; lucio.counters.freeSalesUsed = 5;
  lucio.seedRating = { avg: 4.3, count: 9 };
  mkUser(w, { id: 'u-lucio', name: 'Lucio Chambi Mamani', phone: '966209734', role: 'FARMER', orgId: 'org-lucio', dni: '29845610', createdAt: T(6, 10) });

  // Agricultores con el expediente en revisión (bandeja W-03)
  mkOrg(w, { id: 'org-rosa', type: 'FARMER', name: 'Rosa Ccalla Huamán', district: '040201', level: 0, dni: '70412358', taxRegime: 'SIN_RUC', memberIds: ['u-rosa'], color: '#A0452E', createdAt: T(11, 2, 10),
    payout: [{ id: 'pa-r1', kind: 'YAPE', number: '958441207', holder: 'Rosa Ccalla Huamán', relation: 'PROPIA', verified: false }], acceptsCash: true, serviceAreas: areas([['040201', 0]]) });
  mkUser(w, { id: 'u-rosa', name: 'Rosa Ccalla Huamán', phone: '958441207', role: 'FARMER', orgId: 'org-rosa', dni: '70412358', createdAt: T(11, 2, 10) });
  mkOrg(w, { id: 'org-faustino', type: 'FARMER', name: 'Faustino Apaza Ticona', district: '040519', level: 0, dni: '01478523', taxRegime: 'SIN_RUC', memberIds: ['u-faustino'], color: '#8A6236', createdAt: T(11, 1, 15),
    payout: [{ id: 'pa-f1', kind: 'YAPE', number: '962330990', holder: 'Nely Apaza (hija)', relation: 'FAMILIAR', authorization: 'Autorización firmada (foto)', verified: false }], acceptsCash: true, serviceAreas: areas([['040519', 0]]) });
  mkUser(w, { id: 'u-faustino', name: 'Faustino Apaza Ticona', phone: '962330118', role: 'FARMER', orgId: 'org-faustino', dni: '01478523', createdAt: T(11, 1, 15) }, { lang: 'ay' });
  mkOrg(w, { id: 'org-juancarlos', type: 'FARMER', name: 'Juan Carlos Quispe', district: '040520', level: 0, dni: '46780123', taxRegime: 'SIN_RUC', memberIds: ['u-juancarlos'], color: '#1F5FA8', createdAt: T(11, 3, 5),
    payout: [{ id: 'pa-jc', kind: 'YAPE', number: '962330118', holder: 'Juan Carlos Quispe', relation: 'PROPIA', verified: false }], acceptsCash: true, serviceAreas: areas([['040520', 0]]) });
  // Su Yape es el celular de Faustino, otro agricultor registrado: alerta TELÉFONO REPETIDO en la bandeja (10.4)
  mkUser(w, { id: 'u-juancarlos', name: 'Juan Carlos Quispe', phone: '962330511', role: 'FARMER', orgId: 'org-juancarlos', dni: '46780123', createdAt: T(11, 3, 5) });

  /* Chacras */
  const farm = (f: Farm) => { w.farms[f.id] = f; };
  farm({ id: 'farm-hector', orgId: 'org-hector', name: 'La Pampa', district: '040208', areaHa: 4, tenure: 'PROPIA', crops: ['arroz_cascara', 'cebolla_roja', 'tomate', 'frejol_canario'], gps: 'APP', photos: [], createdAt: T(8, 20) });
  farm({ id: 'farm-wilber', orgId: 'org-wilber', name: 'Pampa Alta', district: '040519', areaHa: 1.5, tenure: 'COMUNAL', crops: ['papa_amarilla', 'papa_blanca', 'haba_verde', 'cebolla_roja'], gps: 'APP', photos: [], createdAt: T(8, 15) });
  farm({ id: 'farm-wilber2', orgId: 'org-wilber', name: 'Coporaque', district: '040506', areaHa: 1.5, tenure: 'ALQUILADA', crops: ['papa_amarilla', 'maiz_choclo'], gps: 'APP', photos: [], createdAt: T(8, 15) });
  farm({ id: 'farm-justina', orgId: 'org-justina', name: 'Chacra de la loma', district: '040519', areaHa: 0.8, tenure: 'COMUNAL', crops: ['papa_nativa', 'haba_verde', 'quinua'], gps: 'APP', photos: [], createdAt: T(9, 28) });
  farm({ id: 'farm-lapunta', orgId: 'org-lapunta', name: 'Parcelas de la asociación', district: '040201', areaHa: 60, tenure: 'PROPIA', crops: ['arroz_cascara', 'arroz_pilado', 'frejol_canario'], gps: 'APP', photos: [], createdAt: T(7, 1) });
  farm({ id: 'farm-lucio', orgId: 'org-lucio', name: 'Lote 14, Majes', district: '040520', areaHa: 5, tenure: 'PROPIA', crops: ['frejol_canario', 'cebolla_roja', 'ajo'], gps: 'APP', photos: [], createdAt: T(6, 10) });

  /* Compradores MYPE */
  const geranios = mkOrg(w, {
    id: 'org-geranios', type: 'BUYER', name: 'Picantería Los Geranios', legalName: 'Picantería Los Geranios E.I.R.L.', ruc: RUC.geranios, district: '040126', level: 1,
    address: 'Av. Ejército 512, Yanahuara', receiver: 'Luis Quispe (cocina)', businessType: 'RESTAURANTE', memberIds: ['u-charo'], color: '#A66633', createdAt: T(10, 14, 11),
    subscription: { plan: 'BASICO', status: 'TRIAL', trialEndsOn: T(11, 13, 11), paidUntil: T(11, 13, 11), monthsBelow: 0, history: [{ at: T(10, 14, 11), text: 'Plan Básico con el primer mes gratis (RN-35).' }] },
  });
  geranios.seedRating = { avg: 4.9, count: 6 };
  mkUser(w, { id: 'u-charo', name: 'Rosario Valdivia Cárdenas', shortName: 'Charo', title: 'Doña Charo', persona: 'B1', phone: '959300412', role: 'BUYER', orgId: 'org-geranios', dni: '29337412', createdAt: T(10, 14, 11) }, { textScale: 1.25 });

  const hotel = mkOrg(w, {
    id: 'org-hotel', type: 'BUYER', name: 'Hotel Los Andes', legalName: 'Hotel Los Andes S.A.C.', ruc: RUC.hotel, district: '040101', level: 2,
    address: 'Calle Santa Catalina 210, Cercado', receiver: 'Carmen Rojas (almacén)', businessType: 'HOTEL', memberIds: ['u-andres'], color: '#1F5FA8', createdAt: T(7, 20),
    subscription: { plan: 'PRO', status: 'ACTIVE', trialEndsOn: T(8, 20), paidUntil: T(12, 1), monthsBelow: 0, history: [{ at: T(8, 20), text: 'Pasó a Pro por volumen de compras.' }] },
  });
  hotel.seedRating = { avg: 5.0, count: 12 };
  mkUser(w, { id: 'u-andres', name: 'Andrés Zegarra Bedoya', persona: 'B2', phone: '984551230', role: 'BUYER', orgId: 'org-hotel', dni: '44120987', createdAt: T(7, 20) });

  const elena = mkOrg(w, {
    id: 'org-elena', type: 'BUYER', name: 'Sabor Paucarpata', legalName: 'Elena Condori Rojas', ruc: RUC.elena, district: '040112', level: 2,
    address: 'Av. Kennedy 1450, Paucarpata', receiver: 'Elena Condori', businessType: 'RESTAURANTE', memberIds: ['u-elena'], color: '#4F7A26', createdAt: T(8, 12),
    subscription: { plan: 'BASICO', status: 'ACTIVE', trialEndsOn: T(9, 12), paidUntil: T(11, 12), monthsBelow: 0, history: [] },
  });
  elena.seedRating = { avg: 4.8, count: 9 };
  mkUser(w, { id: 'u-elena', name: 'Elena Condori Rojas', persona: 'B3', phone: '913772506', role: 'BUYER', orgId: 'org-elena', dni: '40871236', createdAt: T(8, 12) });

  const santarosa = mkOrg(w, {
    id: 'org-santarosa', type: 'BUYER', name: 'Comedor Santa Rosa', legalName: 'Comedor Popular Santa Rosa', ruc: RUC.santarosa, district: '040101', level: 1,
    address: 'Jr. Ayacucho 315, Cercado', receiver: 'Gladys Mamani', businessType: 'COMEDOR', memberIds: ['u-gladys'], color: '#8E3B5E', createdAt: T(9, 20),
    subscription: { plan: 'BASICO', status: 'ACTIVE', trialEndsOn: T(10, 20), paidUntil: T(11, 20), monthsBelow: 0, history: [] },
  });
  santarosa.seedRating = { avg: 4.6, count: 5 };
  mkUser(w, { id: 'u-gladys', name: 'Gladys Mamani Torres', phone: '925118640', role: 'BUYER', orgId: 'org-santarosa', dni: '29660134', createdAt: T(9, 20) });

  mkOrg(w, {
    id: 'org-tambo', type: 'BUYER', name: 'Restaurante El Tambo', legalName: 'Restaurante El Tambo S.A.C.', ruc: RUC.tambo, district: '040126', level: 0,
    address: 'Calle Misti 140, Yanahuara', receiver: 'Martín Sánchez', businessType: 'RESTAURANTE', memberIds: ['u-martin'], color: '#6E5F58', createdAt: T(11, 2, 14),
    subscription: { plan: 'BASICO', status: 'TRIAL', trialEndsOn: T(12, 2), paidUntil: T(12, 2), monthsBelow: 0, history: [] },
  });
  mkUser(w, { id: 'u-martin', name: 'Martín Sánchez Prado', phone: '938004512', role: 'BUYER', orgId: 'org-tambo', dni: '41239087', createdAt: T(11, 2, 14) });

  /* Transportistas aliados (4.5, 10.8) */
  const julio = mkOrg(w, {
    id: 'org-julio', type: 'CARRIER', name: 'Transportes Majes', legalName: 'Julio César Apaza Quispe', ruc: RUC.julio, district: '040201', memberIds: ['u-julio'], color: '#1E3F20', createdAt: T(8, 25),
    payout: [{ id: 'pa-ju', kind: 'YAPE', number: '942615418', holder: 'Julio Apaza Q.', relation: 'PROPIA', verified: true }], acceptsCash: true,
    carrier: {
      level: 'T2', available: true,
      vehicle: { plate: 'V7K-812', vclass: 'V2', category: 'N1', body: 'Furgón cerrado', payloadKg: 1500, year: 2019, docs: [
        doc('SOAT', 'SOAT', limaTime(2028, 4, 3), 'OK', 'SOAT-88123456'),
        doc('CITV', 'Inspección técnica (CITV)', limaTime(2026, 12, 7), 'OK', 'CITV-0451288', 'anual desde el 3.er año'),
        doc('MTC', 'Autorización del MTC y TUC', limaTime(2029, 8, 31), 'OK', 'TUC-1599021'),
        doc('SEGURO', 'Seguro de carga', undefined, 'MISSING', undefined, 'Opcional · te acerca al nivel T3'),
      ] },
      driverLicense: { cls: 'A-I', expiresOn: limaTime(2030, 8, 12) },
      routes: [{ routeId: 'camana-aqp', days: [1, 3, 5], departs: '15:00', arrives: '18:30' }],
      training: { done: 3, total: 3 }, inspection: { at: T(9, 2, 9), score: 88, criticalFails: 0, by: 'u-marco', checklist: {} }, agreementSigned: true, insurance: false, noShows: 0,
    },
  });
  julio.seedCarrier = { rating: 4.9, count: 3, punctuality: 5, care: 5, treatment: 4.7, onTimePct: 1, shipments: 2, recommends: 3 };
  mkUser(w, { id: 'u-julio', name: 'Julio César Apaza Quispe', shortName: 'Julio', persona: 'T1', phone: '942615418', role: 'CARRIER', orgId: 'org-julio', dni: '42964012', createdAt: T(8, 25) });

  const edgar = mkOrg(w, {
    id: 'org-edgar', type: 'CARRIER', name: 'Transportes Layme', legalName: 'Edgar Layme Ccama', ruc: RUC.edgar, district: '040201', memberIds: ['u-edgar'], color: '#6E5F58', createdAt: T(9, 5),
    payout: [{ id: 'pa-ed', kind: 'YAPE', number: '951803377', holder: 'Edgar Layme', relation: 'PROPIA', verified: true }], acceptsCash: true,
    carrier: {
      level: 'T2', available: true,
      vehicle: { plate: 'V2M-455', vclass: 'V3', category: 'N2', body: 'Camión ligero con toldo', payloadKg: 6000, year: 2016, docs: [
        doc('SOAT', 'SOAT', limaTime(2027, 6, 30)), doc('CITV', 'Inspección técnica (CITV)', limaTime(2027, 3, 15)), doc('MTC', 'Autorización del MTC y TUC', limaTime(2028, 11, 1)),
        doc('SEGURO', 'Seguro de carga', undefined, 'MISSING'),
      ] },
      driverLicense: { cls: 'A-IIb', expiresOn: limaTime(2029, 1, 20) },
      routes: [{ routeId: 'camana-aqp', days: [2, 4, 6], departs: '16:00', arrives: '19:30' }, { routeId: 'colca-aqp', days: [2, 4, 6], departs: '13:00', arrives: '17:00' }],
      training: { done: 3, total: 3 }, inspection: { at: T(9, 10, 9), score: 84, criticalFails: 0, by: 'u-lucia', checklist: {} }, agreementSigned: true, insurance: false, noShows: 0,
    },
  });
  edgar.seedCarrier = { rating: 4.6, count: 8, punctuality: 4.5, care: 4.7, treatment: 4.6, onTimePct: 0.88, shipments: 8, recommends: 4 };
  mkUser(w, { id: 'u-edgar', name: 'Edgar Layme Ccama', phone: '951803377', role: 'CARRIER', orgId: 'org-edgar', dni: '43561278', createdAt: T(9, 5) });

  const moto = mkOrg(w, {
    id: 'org-moto', type: 'CARRIER', name: 'Rápidos Yanahuara', legalName: 'Ronald Quispe Huamán', ruc: RUC.moto, district: '040126', memberIds: ['u-ronald'], color: '#A0452E', createdAt: T(9, 15),
    payout: [{ id: 'pa-ro', kind: 'YAPE', number: '917445902', holder: 'Ronald Quispe', relation: 'PROPIA', verified: true }], acceptsCash: true,
    carrier: {
      level: 'T2', available: true,
      vehicle: { plate: '8812-4A', vclass: 'V1', category: 'L3', body: 'Moto con cajuela', payloadKg: 20, year: 2022, docs: [
        doc('SOAT', 'SOAT', limaTime(2027, 2, 14)), doc('CITV', 'Inspección técnica (CITV)', limaTime(2027, 5, 2)), doc('MUNI', 'Registro municipal de entrega rápida', limaTime(2027, 9, 30)),
      ] },
      driverLicense: { cls: 'B-IIb', expiresOn: limaTime(2031, 3, 3) },
      routes: [{ routeId: 'aqp-ciudad', days: [1, 2, 3, 4, 5, 6], departs: '08:00', arrives: '13:00' }],
      training: { done: 3, total: 3 }, inspection: { at: T(9, 18, 10), score: 91, criticalFails: 0, by: 'u-lucia', checklist: {} }, agreementSigned: true, insurance: false, noShows: 0,
    },
  });
  moto.seedCarrier = { rating: 4.7, count: 14, punctuality: 4.8, care: 4.6, treatment: 4.8, onTimePct: 0.93, shipments: 15, recommends: 6 };
  mkUser(w, { id: 'u-ronald', name: 'Ronald Quispe Huamán', phone: '917445902', role: 'CARRIER', orgId: 'org-moto', dni: '72311409', createdAt: T(9, 15) });

  mkOrg(w, {
    id: 'org-colcatrans', type: 'CARRIER', name: 'Transportes Colca', legalName: 'Transportes Colca S.R.L.', ruc: RUC.colca, district: '040501', memberIds: ['u-nestor'], color: '#4F7A26', createdAt: T(10, 20),
    payout: [{ id: 'pa-co', kind: 'BANK', number: '00221500555444333222', holder: 'Transportes Colca S.R.L.', relation: 'PROPIA', verified: true }], acceptsCash: false,
    carrier: {
      level: 'T1', available: false,
      vehicle: { plate: 'V9C-221', vclass: 'V2', category: 'N1', body: 'Camioneta con toldo', payloadKg: 1200, year: 2017, docs: [
        doc('SOAT', 'SOAT', limaTime(2027, 4, 11)), doc('CITV', 'Inspección técnica (CITV)', limaTime(2027, 1, 22)), doc('MTC', 'Autorización del MTC y TUC', limaTime(2028, 5, 9)),
      ] },
      driverLicense: { cls: 'A-I', expiresOn: limaTime(2028, 10, 2) },
      routes: [{ routeId: 'colca-aqp', days: [1, 4], departs: '06:00', arrives: '10:00' }],
      training: { done: 2, total: 3 }, agreementSigned: true, insurance: false, noShows: 0,
    },
  });
  mkUser(w, { id: 'u-nestor', name: 'Néstor Huarca Ccori', phone: '973228561', role: 'CARRIER', orgId: 'org-colcatrans', dni: '30458127', createdAt: T(10, 20) });

  /* Almacenes aliados (4.4, 10.7) */
  mkOrg(w, {
    id: 'org-pampa', type: 'WAREHOUSE', name: 'Molinera La Pampa', legalName: 'Molinera La Pampa S.A.C.', ruc: RUC.pampa, district: '040201', memberIds: ['u-ernesto'], color: '#8A6236', createdAt: T(8, 1),
    payout: [{ id: 'pa-mp', kind: 'BANK', number: '00221500482100000021', holder: 'Molinera La Pampa S.A.C.', relation: 'PROPIA', verified: true }],
    warehouse: {
      level: 'A2', facilityType: 'MOLINO', capacitySacks: 1500, defaultRate: 1.80,
      rates: [{ productId: 'arroz_cascara', perSackMonth: 1.8 }, { productId: 'arroz_pilado', perSackMonth: 1.8 }, { productId: 'frejol_canario', perSackMonth: 1.8 }, { productId: 'haba_seca', perSackMonth: 1.8 }],
      products: ['arroz_cascara', 'arroz_pilado', 'frejol_canario', 'haba_seca'], services: ['Recepción y pesaje', 'Control de plagas', 'Constancia con QR'],
      optional: [{ label: 'Secado de arroz', price: 2 }],
      docs: [
        doc('LICENCIA', 'Licencia de funcionamiento', undefined, 'OK', 'N.º 0482-2025', 'Municipalidad Provincial de Camaná'),
        doc('ITSE', 'Certificado ITSE', limaTime(2027, 3, 14)),
        doc('FUMIGACION', 'Constancia de fumigación', limaTime(2027, 5, 2)),
        doc('SENASA', 'Autorización sanitaria SENASA', limaTime(2027, 8, 30), 'OK', undefined, 'Hace pilado'),
        doc('BALANZA', 'Calibración de la balanza', limaTime(2026, 12, 15)),
        doc('SEGURO', 'Seguro de mercadería de terceros', undefined, 'MISSING', undefined, 'Opcional · con él y 3 meses sin reclamos graves pasas a A3'),
      ],
      visit: { at: T(8, 25, 10), score: 86, criticalFails: 0, by: 'u-marco' }, agreementSigned: true, location: '040201', geo: DISTRICT_BY_CODE['040201'].geo,
    },
  });
  mkUser(w, { id: 'u-ernesto', name: 'Ernesto Salas Cornejo', shortName: 'Ernesto', title: 'Don Ernesto', persona: 'A1', phone: '954109870', role: 'WAREHOUSE', orgId: 'org-pampa', dni: '29110458', createdAt: T(8, 1) });

  mkOrg(w, {
    id: 'org-yanque', type: 'WAREHOUSE', name: 'Centro de acopio Yanque', legalName: 'Cooperativa Agraria Yanque', ruc: RUC.yanque, district: '040519', memberIds: ['u-elmer'], color: '#4F7A26', createdAt: T(8, 5),
    payout: [{ id: 'pa-ya', kind: 'YAPE', number: '976330245', holder: 'Cooperativa Agraria Yanque', relation: 'PROPIA', verified: true }],
    warehouse: {
      level: 'A2', facilityType: 'ACOPIO', capacitySacks: 1200, defaultRate: 1.50,
      rates: [{ productId: 'papa_amarilla', perSackMonth: 1.5 }, { productId: 'papa_blanca', perSackMonth: 1.5 }, { productId: 'papa_nativa', perSackMonth: 1.5 }, { productId: 'haba_seca', perSackMonth: 1.5 }, { productId: 'quinua', perSackMonth: 1.5 }, { productId: 'chuno', perSackMonth: 1.5 }],
      products: ['papa_amarilla', 'papa_blanca', 'papa_nativa', 'haba_seca', 'quinua', 'chuno'], services: ['Recepción y pesaje', 'Control de plagas', 'Constancia con QR'], optional: [],
      docs: [doc('LICENCIA', 'Licencia de funcionamiento', undefined), doc('ITSE', 'Certificado ITSE', limaTime(2027, 6, 1)), doc('FUMIGACION', 'Constancia de fumigación', limaTime(2027, 2, 20)), doc('BALANZA', 'Calibración de la balanza', limaTime(2027, 4, 9))],
      visit: { at: T(8, 28, 10), score: 82, criticalFails: 0, by: 'u-lucia' }, agreementSigned: true, location: '040519', geo: DISTRICT_BY_CODE['040519'].geo,
    },
  });
  mkUser(w, { id: 'u-elmer', name: 'Elmer Cutipa Suni', phone: '976330245', role: 'WAREHOUSE', orgId: 'org-yanque', dni: '30227716', createdAt: T(8, 5) });

  mkOrg(w, {
    id: 'org-valleverde', type: 'WAREHOUSE', name: 'Almacén Valle Verde', legalName: 'Almacén Valle Verde S.A.C.', ruc: RUC.valleverde, district: '040520', memberIds: ['u-patricia'], color: '#2C5F2D', createdAt: T(10, 25),
    payout: [{ id: 'pa-vv', kind: 'BANK', number: '00221500111222333444', holder: 'Almacén Valle Verde S.A.C.', relation: 'PROPIA', verified: true }],
    warehouse: {
      level: 'A1', facilityType: 'SECO', capacitySacks: 800, defaultRate: 1.80, rates: [], products: ['papa_blanca', 'quinua', 'frejol_canario', 'arroz_pilado'], services: ['Recepción y pesaje', 'Constancia con QR'], optional: [],
      docs: [doc('LICENCIA', 'Licencia de funcionamiento', undefined), doc('ITSE', 'Certificado ITSE', limaTime(2027, 9, 1)), doc('FUMIGACION', 'Constancia de fumigación', limaTime(2027, 3, 1)), doc('SENASA', 'Autorización sanitaria SENASA', undefined, 'PENDING', undefined, 'En revisión')],
      visitScheduled: T(11, 6, 10), agreementSigned: false, location: '040520', geo: DISTRICT_BY_CODE['040520'].geo,
    },
  });
  mkUser(w, { id: 'u-patricia', name: 'Patricia Ríos Vera', phone: '948557013', role: 'WAREHOUSE', orgId: 'org-valleverde', dni: '41008832', createdAt: T(10, 25) });

  /* Membresías ya cobradas y conciliadas (W-14, pestaña MYPE) */
  const inv = (org: string, period: string, plan: 'BASICO' | 'PRO', amount: number, paidAt: number, rec: string) => {
    w.invoices[`inv-${org}-${period}`] = { id: `inv-${org}-${period}`, orgId: org, period, plan, concept: `Membresía ${plan === 'PRO' ? 'Pro' : 'Básico'}`, amount, issuedAt: paidAt - 4 * DAY, dueAt: paidAt + DAY, status: 'RECONCILED', payment: { method: 'YAPE', operation: '0' + String(4400000 + amount * 1000 + paidAt % 997), at: paidAt }, receiptNumber: rec };
  };
  inv('org-hotel', '2026-09', 'PRO', 99, T(8, 29), 'F001-0981'); inv('org-hotel', '2026-10', 'PRO', 99, T(9, 29), 'F001-0997'); inv('org-hotel', '2026-11', 'PRO', 99, T(10, 29), 'F001-1012');
  inv('org-elena', '2026-09', 'BASICO', 49, T(9, 11), 'F001-0989'); inv('org-elena', '2026-10', 'BASICO', 49, T(10, 11), 'F001-1003');
  inv('org-santarosa', '2026-10', 'BASICO', 49, T(10, 19), 'F001-1006');

  /* Borradores de traducción (W-09): nunca se activan solos (RN-32) */
  for (const [pid, text] of Object.entries(QU_PRODUCT_DRAFTS)) w.translations[`product.${pid}`] = { qu: { text, status: 'MACHINE_DRAFT' } };
  w.translations['welcome.choose_language'] = { qu: { text: 'Simiykita akllay', status: 'DRAFT' } };
  w.translations['welcome.continue'] = { qu: { text: 'Qatiy', status: 'DRAFT' } };
  w.translations['nav.home'] = { qu: { text: 'Qallariy', status: 'DRAFT' } };

  w.favorites['org-hotel'] = { listings: [], sellers: ['org-hector'], carriers: ['org-julio'] };
  w.favorites['org-geranios'] = { listings: [], sellers: ['org-wilber'], carriers: [] };
}

/* ---------- Guion de la historia ---------- */
interface Item { listingId: string; qty: number }
interface SaleSpec {
  id: string; buyer: string; seller: string; items: Item[]; mode: 'FARMER' | 'PICKUP' | 'CARRIER'; taxDoc: 'BOLETA' | 'FACTURA' | 'LIQUIDACION';
  pay: 'YAPE' | 'TRANSFER' | 'CASH'; placeAt: number; day: number; stop?: 'PENDING' | 'ACCEPTED' | 'PAID' | 'READY' | 'IN_TRANSIT' | 'DELIVERED' | 'DISPUTE' | 'COMPLETED' | 'REVIEWED';
  reviews?: { b: [number, string[], string?]; s: [number, string[]] }; carrier?: string; carrierRate?: [number, number, number, boolean, boolean, string[], string?];
  cancelAt?: number; kgPerSack?: number; slot?: string;
}

const ORG_OF: Record<string, string> = {
  'u-hector': 'org-hector', 'u-wilber': 'org-wilber', 'u-justina': 'org-justina', 'u-teodoro': 'org-lapunta', 'u-lucio': 'org-lucio',
  'u-charo': 'org-geranios', 'u-andres': 'org-hotel', 'u-elena': 'org-elena', 'u-gladys': 'org-santarosa',
  'u-julio': 'org-julio', 'u-ernesto': 'org-pampa', 'u-elmer': 'org-yanque',
};
const DISTRICT_OF: Record<string, string> = { 'u-charo': '040126', 'u-andres': '040101', 'u-elena': '040112', 'u-gladys': '040101' };
const ADDRESS_OF: Record<string, string> = { 'u-charo': 'Av. Ejército 512, Yanahuara', 'u-andres': 'Calle Santa Catalina 210, Cercado', 'u-elena': 'Av. Kennedy 1450, Paucarpata', 'u-gladys': 'Jr. Ayacucho 315, Cercado' };

function script(): MEvent[] {
  const E: MEvent[] = [];
  let n = 0, op = 5_120_000, wb = 100;
  const ev = (t: number, actor: string, type: string, p: any) => { E.push({ id: `seed-${String(++n).padStart(4, '0')}`, type, actor, t, lamport: 0, p }); };
  const opn = () => String(++op).padStart(8, '0');
  const pub = (t: number, actor: string, id: string, productId: string, unit: string, qty: number, price: number, harvestDays = 1, extra: any = {}) =>
    ev(t, actor, 'LISTING_PUBLISH', { orgId: ORG_OF[actor], listingId: id, productId, unit, unitKg: unit === 'saco' ? (extra.unitKg ?? 50) : 1, qty, price, harvestDate: t - harvestDays * DAY, quality: 'PRIMERA', farmId: extra.farmId, photoIds: extra.photoIds ?? [], harvestSeal: !!extra.seal, confirmPrice: true, fromLotId: extra.fromLotId });

  const sale = (s: SaleSpec) => {
    const subId = s.id;
    const day = startOfDay(s.day);
    ev(s.placeAt, s.buyer, 'ORDER_PLACE', {
      orderId: `o-${subId}`, address: ADDRESS_OF[s.buyer], district: DISTRICT_OF[s.buyer],
      subs: [{ subOrderId: subId, sellerOrgId: ORG_OF[s.seller], items: s.items, deliveryMode: s.mode, deliveryDate: day, slot: s.slot ?? '7:00 a 9:00', taxDoc: s.taxDoc, payMethod: s.pay, shipmentId: s.mode === 'CARRIER' ? `sh-${subId}` : undefined }],
    });
    if (s.stop === 'PENDING') return;
    const acc = s.placeAt + 35 * MIN;
    ev(acc, s.seller, 'SUBORDER_ACCEPT', { subOrderId: subId });
    if (s.mode === 'CARRIER' && s.carrier) ev(acc + 20 * MIN, s.carrier, 'SHIP_OFFER_RESPOND', { shipmentId: `sh-${subId}`, accept: true });
    if (s.cancelAt) { ev(s.cancelAt, s.buyer, 'SUBORDER_CANCEL', { subOrderId: subId, reason: 'Ya no lo necesito esta semana' }); return; }
    if (s.stop === 'ACCEPTED') return;
    if (s.pay !== 'CASH') {
      ev(acc + 25 * MIN, s.buyer, 'PAYMENT_UPLOAD', { subOrderId: subId, method: s.pay, operation: opn(), paidAt: acc + 24 * MIN });
      ev(acc + 50 * MIN, s.seller, 'PAYMENT_CONFIRM', { subOrderId: subId });
    }
    if (s.stop === 'PAID') return;
    const prep = Math.max(acc + 70 * MIN, day + 5 * HOUR);
    ev(prep, s.seller, 'SUBORDER_PREPARE', { subOrderId: subId });
    const readyAt = s.mode === 'CARRIER' ? day + 13 * HOUR : Math.max(prep + 30 * MIN, day + 5 * HOUR + 30 * MIN);
    ev(readyAt, s.seller, 'SUBORDER_READY', { subOrderId: subId });
    if (s.stop === 'READY') return;
    let deliveredAt: number;
    if (s.mode === 'FARMER') {
      ev(readyAt + 10 * MIN, s.seller, 'SUBORDER_DISPATCH', { subOrderId: subId });
      if (s.stop === 'IN_TRANSIT') return;
      deliveredAt = Math.max(readyAt + 2 * HOUR, day + 7 * HOUR + 40 * MIN);
      ev(deliveredAt, s.seller, 'SUBORDER_DELIVER', { subOrderId: subId, code: digitsFrom(subId + ':entrega'), cashCollected: s.pay === 'CASH' });
    } else if (s.mode === 'PICKUP') {
      deliveredAt = readyAt + 3 * HOUR;
      ev(deliveredAt, s.seller, 'SUBORDER_DELIVER', { subOrderId: subId, code: digitsFrom(subId + ':recojo'), cashCollected: s.pay === 'CASH' });
    } else {
      const c = s.carrier!;
      ev(day + 13 * HOUR + 35 * MIN, c, 'SHIP_DEPART', { shipmentId: `sh-${subId}` });
      const sacks = s.items.reduce((a, it) => a + it.qty, 0);
      const kg = sacks * (s.kgPerSack ?? 50);
      ev(day + 14 * HOUR + 20 * MIN, c, 'SHIP_PICKUP', { shipmentId: `sh-${subId}`, qr: 'QR-' + codeFrom(subId + ':qr', 8), sacks, kg, photoIds: [], waybillSender: `T001-00${++wb}`, waybillCarrier: `V001-000${wb}` });
      if (s.stop === 'IN_TRANSIT') return;
      ev(day + 18 * HOUR + 5 * MIN, c, 'SHIP_ARRIVE', { shipmentId: `sh-${subId}` });
      ev(day + 18 * HOUR + 10 * MIN, s.buyer, 'SHIP_BUYER_PAID', { shipmentId: `sh-${subId}`, method: 'YAPE' });
      deliveredAt = day + 18 * HOUR + 15 * MIN;
      ev(deliveredAt, c, 'SHIP_DELIVER', { shipmentId: `sh-${subId}`, code: digitsFrom(subId + ':entrega'), sacks, kg: kg - 0.4, collected: true, method: 'YAPE' });
    }
    if (s.stop === 'DELIVERED') return;
    if (s.stop === 'DISPUTE') return;
    ev(deliveredAt + 70 * MIN, s.buyer, 'RECEIPT_CONFIRM', { subOrderId: subId, lines: s.items.map(it => ({ listingId: it.listingId, acceptedQty: it.qty, quality: 'OK' })) });
    if (s.stop === 'COMPLETED') return;
    const rv = s.reviews ?? { b: [5, ['Puntual', 'Peso exacto']], s: [5, ['Pago puntual']] };
    ev(deliveredAt + 2 * HOUR, s.buyer, 'REVIEW_SUBMIT', { reviewId: `rv-b-${subId}`, subOrderId: subId, side: 'BUYER', stars: rv.b[0], tags: rv.b[1], comment: rv.b[2] });
    ev(deliveredAt + 3 * HOUR, s.seller, 'REVIEW_SUBMIT', { reviewId: `rv-s-${subId}`, subOrderId: subId, side: 'SELLER', stars: rv.s[0], tags: rv.s[1] });
    if (s.mode === 'CARRIER' && s.carrierRate) {
      const r = s.carrierRate;
      ev(deliveredAt + 2 * HOUR + 10 * MIN, s.buyer, 'SHIP_RATE', { shipmentId: `sh-${subId}`, punctuality: r[0], care: r[1], treatment: r[2], recommends: r[3], favorite: r[4], tags: r[5], comment: r[6] });
    }
  };

  /* ===== Septiembre ===== */
  // Almacén: el arroz pilado de Héctor entra a Molinera La Pampa (constancia ALM-2026-0029)
  ev(T(9, 21, 9), 'u-hector', 'STO_BOOK', { bookingId: 'bk-hector-arroz', facilityOrgId: 'org-pampa', productId: 'arroz_pilado', sacks: 40, kgPerSack: 50, months: 3, arrivalDate: T(9, 24) });
  ev(T(9, 21, 15), 'u-ernesto', 'STO_BOOK_RESPOND', { bookingId: 'bk-hector-arroz', accept: true });
  ev(T(9, 24, 10, 15), 'u-ernesto', 'STO_INTAKE', { bookingId: 'bk-hector-arroz', lotId: 'lot-hector-arroz', weightKg: 2001.5, sacks: 40, quality: 'A', photoIds: [], scaleOk: true });

  // Héctor: ventas 1 y 2 (sin comisión)
  pub(T(9, 7, 7), 'u-hector', 'l-h-s1', 'frejol_canario', 'kg', 30, 8.0, 3, { farmId: 'farm-hector' });
  sale({ id: 'so-h01', buyer: 'u-andres', seller: 'u-hector', items: [{ listingId: 'l-h-s1', qty: 30 }], mode: 'FARMER', taxDoc: 'FACTURA', pay: 'TRANSFER', placeAt: T(9, 7, 10), day: T(9, 10), reviews: { b: [5, ['Puntual', 'Buena calidad'], 'Frejol parejo y limpio.'], s: [5, ['Pago puntual']] } });
  pub(T(9, 21, 7), 'u-hector', 'l-h-s2', 'cebolla_roja', 'kg', 120, 1.5, 1, { farmId: 'farm-hector' });
  sale({ id: 'so-h02', buyer: 'u-elena', seller: 'u-hector', items: [{ listingId: 'l-h-s2', qty: 120 }], mode: 'FARMER', taxDoc: 'BOLETA', pay: 'CASH', placeAt: T(9, 21, 11), day: T(9, 24), reviews: { b: [4, ['Peso exacto'], 'Llegó a media mañana, todo bien.'], s: [5, ['Pago puntual']] } });

  // Wilber: ventas 1 a 3 (sin comisión)
  pub(T(9, 6, 7), 'u-wilber', 'l-w-s1', 'cebolla_roja', 'kg', 100, 1.5, 1, { farmId: 'farm-wilber' });
  sale({ id: 'so-w01', buyer: 'u-andres', seller: 'u-wilber', items: [{ listingId: 'l-w-s1', qty: 100 }], mode: 'FARMER', taxDoc: 'LIQUIDACION', pay: 'YAPE', placeAt: T(9, 6, 10), day: T(9, 8), reviews: { b: [5, ['Bien empacado']], s: [5, ['Pago puntual']] } });
  pub(T(9, 15, 7), 'u-wilber', 'l-w-s2', 'papa_amarilla', 'kg', 150, 2.7, 1, { farmId: 'farm-wilber' });
  sale({ id: 'so-w02', buyer: 'u-elena', seller: 'u-wilber', items: [{ listingId: 'l-w-s2', qty: 150 }], mode: 'FARMER', taxDoc: 'LIQUIDACION', pay: 'YAPE', placeAt: T(9, 15, 9), day: T(9, 17), reviews: { b: [5, ['Puntual', 'Buena calidad'], 'Papa limpia y pesada al kilo justo. Llegó a la hora.'], s: [5, ['Pago puntual']] } });
  pub(T(9, 27, 7), 'u-wilber', 'l-w-s3', 'haba_verde', 'kg', 50, 3.2, 1, { farmId: 'farm-wilber' });
  sale({ id: 'so-w03', buyer: 'u-andres', seller: 'u-wilber', items: [{ listingId: 'l-w-s3', qty: 50 }], mode: 'FARMER', taxDoc: 'LIQUIDACION', pay: 'YAPE', placeAt: T(9, 27, 10), day: T(9, 29), reviews: { b: [5, ['Buena calidad']], s: [5, ['Pago puntual']] } });

  // Lucio: dos ventas con comisión que no paga (estado de cuenta vencido)
  pub(T(9, 8, 7), 'u-lucio', 'l-l-s1', 'cebolla_roja', 'kg', 220, 1.5, 2, { farmId: 'farm-lucio' });
  sale({ id: 'so-l01', buyer: 'u-andres', seller: 'u-lucio', items: [{ listingId: 'l-l-s1', qty: 220 }], mode: 'FARMER', taxDoc: 'BOLETA', pay: 'YAPE', placeAt: T(9, 8, 10), day: T(9, 10), reviews: { b: [4, ['Peso exacto']], s: [5, ['Pago puntual']] } });
  pub(T(9, 16, 7), 'u-lucio', 'l-l-s2', 'ajo', 'kg', 40, 7.5, 2, { farmId: 'farm-lucio' });
  sale({ id: 'so-l02', buyer: 'u-elena', seller: 'u-lucio', items: [{ listingId: 'l-l-s2', qty: 40 }], mode: 'FARMER', taxDoc: 'BOLETA', pay: 'YAPE', placeAt: T(9, 16, 10), day: T(9, 18), reviews: { b: [4, []], s: [4, []] } });

  // La Punta con Julio (ruta Camaná–Arequipa: lunes, miércoles y viernes)
  pub(T(9, 11, 7), 'u-teodoro', 'l-p-s1', 'arroz_pilado', 'saco', 6, 175, 5, { farmId: 'farm-lapunta' });
  sale({ id: 'so-p01', buyer: 'u-andres', seller: 'u-teodoro', items: [{ listingId: 'l-p-s1', qty: 6 }], mode: 'CARRIER', taxDoc: 'FACTURA', pay: 'TRANSFER', placeAt: T(9, 11, 9), day: T(9, 14), carrier: 'u-julio', carrierRate: [5, 5, 5, true, true, ['Llegó a la hora', 'Sacos secos y completos']] });
  pub(T(9, 21, 7), 'u-teodoro', 'l-p-s2', 'arroz_pilado', 'saco', 8, 175, 5, { farmId: 'farm-lapunta' });
  sale({ id: 'so-p02', buyer: 'u-andres', seller: 'u-teodoro', items: [{ listingId: 'l-p-s2', qty: 8 }], mode: 'CARRIER', taxDoc: 'FACTURA', pay: 'TRANSFER', placeAt: T(9, 21, 9), day: T(9, 23), carrier: 'u-julio', carrierRate: [5, 5, 4, true, false, ['Ayudó a descargar']] });

  /* ===== Octubre (se cierra el 1 de noviembre) ===== */
  // pagos de los estados de cuenta de septiembre (el de Lucio queda sin pagar)
  ev(T(10, 4, 9), 'u-ernesto', 'STATEMENT_PAY', { statementId: 'st-WAREHOUSE-org-pampa-2026-09', method: 'TRANSFER', operation: opn() });
  ev(T(10, 5, 9), 'u-julio', 'STATEMENT_PAY', { statementId: 'st-CARRIER-org-julio-2026-09', method: 'YAPE', operation: opn() });
  ev(T(10, 7, 9), 'u-teodoro', 'STATEMENT_PAY', { statementId: 'st-FARMER-org-lapunta-2026-09', method: 'TRANSFER', operation: opn() });
  ev(T(10, 6, 10), 'u-carlos', 'BILLING_RECONCILE', { kind: 'STATEMENT', id: 'st-WAREHOUSE-org-pampa-2026-09', ok: true });
  ev(T(10, 6, 10, 5), 'u-carlos', 'BILLING_RECONCILE', { kind: 'STATEMENT', id: 'st-CARRIER-org-julio-2026-09', ok: true });
  ev(T(10, 8, 10), 'u-monica', 'BILLING_RECONCILE', { kind: 'STATEMENT', id: 'st-FARMER-org-lapunta-2026-09', ok: true });

  // La Punta: el lote de arroz cáscara en el molino (vence el 8 de noviembre)
  ev(T(10, 6, 9), 'u-teodoro', 'STO_BOOK', { bookingId: 'bk-lapunta-cascara', facilityOrgId: 'org-pampa', productId: 'arroz_cascara', sacks: 80, kgPerSack: 50, months: 1, arrivalDate: T(10, 8) });
  ev(T(10, 6, 16), 'u-ernesto', 'STO_BOOK_RESPOND', { bookingId: 'bk-lapunta-cascara', accept: true });
  ev(T(10, 8, 9, 40), 'u-ernesto', 'STO_INTAKE', { bookingId: 'bk-lapunta-cascara', lotId: 'lot-lapunta-cascara', weightKg: 3987, sacks: 80, quality: 'B', photoIds: [], scaleOk: true });
  // Wilber guarda papa blanca en el centro de acopio Yanque
  ev(T(10, 14, 8), 'u-wilber', 'STO_BOOK', { bookingId: 'bk-wilber-papa', facilityOrgId: 'org-yanque', productId: 'papa_blanca', sacks: 10, kgPerSack: 50, months: 2, arrivalDate: T(10, 16) });
  ev(T(10, 14, 12), 'u-elmer', 'STO_BOOK_RESPOND', { bookingId: 'bk-wilber-papa', accept: true });
  ev(T(10, 16, 10, 42), 'u-elmer', 'STO_INTAKE', { bookingId: 'bk-wilber-papa', lotId: 'lot-wilber-papa', weightKg: 498, sacks: 10, quality: 'A', photoIds: [], scaleOk: true });

  // La Punta: 8 envíos con Julio
  const pShips: [number, number, string, number][] = [[10, 5, 'u-elena', 4], [10, 7, 'u-andres', 10], [10, 9, 'u-andres', 11], [10, 12, 'u-andres', 10], [10, 14, 'u-elena', 6], [10, 16, 'u-andres', 12], [10, 19, 'u-gladys', 8], [10, 21, 'u-charo', 8]];
  pShips.forEach(([m, d, buyer, sacks], i) => {
    const lid = `l-p-o${i + 1}`;
    pub(T(m, d - 2, 7), 'u-teodoro', lid, 'arroz_pilado', 'saco', sacks, 175, 4, { farmId: 'farm-lapunta' });
    const rate: [number, number, number, boolean, boolean, string[], string?][] = [
      [5, 5, 5, true, false, ['Llegó a la hora']], [5, 5, 5, true, true, ['Sacos secos y completos'], 'Llegó a la hora, con los sacos secos y completos.'], [5, 5, 5, true, true, ['Llegó a la hora']],
      [5, 5, 4, true, true, ['Avisó por el chat']], [4, 5, 5, false, false, ['Ayudó a descargar'], 'Buen trato. Avisó que llegaba 20 minutos tarde.'], [5, 5, 5, true, true, ['Llegó a la hora', 'Sacos secos y completos']],
      [5, 5, 5, true, false, []], [5, 5, 5, false, false, ['Llegó a la hora']]];
    sale({ id: `so-p1${i}`, buyer, seller: 'u-teodoro', items: [{ listingId: lid, qty: sacks }], mode: 'CARRIER', taxDoc: buyer === 'u-elena' ? 'BOLETA' : 'FACTURA', pay: buyer === 'u-andres' ? 'TRANSFER' : 'YAPE', placeAt: T(m, d - 2, 10), day: T(m, d), carrier: 'u-julio', carrierRate: rate[i] });
  });

  // Héctor: venta 3 (sin comisión)
  pub(T(10, 11, 7), 'u-hector', 'l-h-s3', 'frejol_canario', 'kg', 20, 8.0, 4, { farmId: 'farm-hector' });
  sale({ id: 'so-h03', buyer: 'u-elena', seller: 'u-hector', items: [{ listingId: 'l-h-s3', qty: 20 }], mode: 'FARMER', taxDoc: 'BOLETA', pay: 'YAPE', placeAt: T(10, 11, 10), day: T(10, 13), reviews: { b: [5, ['Puntual', 'Peso exacto']], s: [5, ['Pago puntual', 'Buen trato']] } });

  // Wilber: ventas 4 a 9 y un pedido cancelado
  pub(T(10, 4, 7), 'u-wilber', 'l-w-o4', 'cebolla_roja', 'kg', 60, 1.5, 1, { farmId: 'farm-wilber' });
  sale({ id: 'so-w04', buyer: 'u-gladys', seller: 'u-wilber', items: [{ listingId: 'l-w-o4', qty: 60 }], mode: 'FARMER', taxDoc: 'LIQUIDACION', pay: 'YAPE', placeAt: T(10, 4, 10), day: T(10, 6) });
  pub(T(10, 11, 7), 'u-wilber', 'l-w-o5', 'papa_amarilla', 'kg', 100, 2.7, 1, { farmId: 'farm-wilber' });
  sale({ id: 'so-w05', buyer: 'u-elena', seller: 'u-wilber', items: [{ listingId: 'l-w-o5', qty: 100 }], mode: 'FARMER', taxDoc: 'LIQUIDACION', pay: 'YAPE', placeAt: T(10, 11, 10), day: T(10, 13) });
  pub(T(10, 17, 7), 'u-wilber', 'l-w-o6', 'papa_amarilla', 'kg', 150, 2.7, 1, { farmId: 'farm-wilber' });
  sale({ id: 'so-w06', buyer: 'u-charo', seller: 'u-wilber', items: [{ listingId: 'l-w-o6', qty: 150 }], mode: 'FARMER', taxDoc: 'LIQUIDACION', pay: 'YAPE', placeAt: T(10, 17, 10), day: T(10, 20), reviews: { b: [5, ['Puntual', 'Buena calidad'], 'Papa limpia y pesada al kilo justo. Llegó a la hora.'], s: [5, ['Pago puntual']] } });
  pub(T(10, 20, 7), 'u-wilber', 'l-w-o7', 'papa_amarilla', 'kg', 100, 2.7, 1, { farmId: 'farm-wilber' });
  sale({ id: 'so-w07', buyer: 'u-andres', seller: 'u-wilber', items: [{ listingId: 'l-w-o7', qty: 100 }], mode: 'FARMER', taxDoc: 'LIQUIDACION', pay: 'YAPE', placeAt: T(10, 20, 10), day: T(10, 22) });
  pub(T(10, 22, 7), 'u-wilber', 'l-w-oc', 'cebolla_roja', 'kg', 80, 1.5, 1, { farmId: 'farm-wilber' });
  sale({ id: 'so-wcx', buyer: 'u-elena', seller: 'u-wilber', items: [{ listingId: 'l-w-oc', qty: 80 }], mode: 'FARMER', taxDoc: 'LIQUIDACION', pay: 'YAPE', placeAt: T(10, 22, 11), day: T(10, 24), cancelAt: T(10, 23, 8) });
  pub(T(10, 24, 7), 'u-wilber', 'l-w-o8', 'cebolla_roja', 'kg', 200, 1.5, 1, { farmId: 'farm-wilber' });
  sale({ id: 'so-w08', buyer: 'u-elena', seller: 'u-wilber', items: [{ listingId: 'l-w-o8', qty: 200 }], mode: 'FARMER', taxDoc: 'LIQUIDACION', pay: 'YAPE', placeAt: T(10, 24, 10), day: T(10, 26) });
  pub(T(10, 27, 7), 'u-wilber', 'l-w-o9', 'papa_amarilla', 'kg', 150, 2.7, 1, { farmId: 'farm-wilber' });
  sale({ id: 'so-w09', buyer: 'u-gladys', seller: 'u-wilber', items: [{ listingId: 'l-w-o9', qty: 150 }], mode: 'FARMER', taxDoc: 'LIQUIDACION', pay: 'YAPE', placeAt: T(10, 27, 10), day: T(10, 29), reviews: { b: [5, ['Puntual'], 'Llegó a la hora.'], s: [5, ['Pago puntual']] } });

  // Héctor publica su arroz desde el almacén y su cosecha actual
  pub(T(10, 30, 9), 'u-hector', 'l-h-arroz', 'arroz_pilado', 'saco', 40, 175, 36, { fromLotId: 'lot-hector-arroz' });
  pub(T(11, 1, 7), 'u-hector', 'l-h-frejol', 'frejol_canario', 'kg', 200, 8.0, 5, { farmId: 'farm-hector' });
  pub(T(11, 2, 6, 30), 'u-hector', 'l-h-cebolla', 'cebolla_roja', 'kg', 300, 1.5, 1, { farmId: 'farm-hector' });
  pub(T(11, 3, 7, 10), 'u-hector', 'l-h-tomate', 'tomate', 'kg', 150, 2.2, 0, { farmId: 'farm-hector', photoIds: ['seed-photo-tomate'], seal: true });

  // Wilber: cosecha actual
  pub(T(11, 1, 6, 30), 'u-wilber', 'l-w-papa', 'papa_amarilla', 'kg', 500, 2.7, 0, { farmId: 'farm-wilber' });
  pub(T(11, 2, 6, 40), 'u-wilber', 'l-w-cebolla', 'cebolla_roja', 'kg', 200, 1.5, 1, { farmId: 'farm-wilber' });
  pub(T(10, 30, 7), 'u-wilber', 'l-w-haba', 'haba_verde', 'kg', 80, 3.2, 1, { farmId: 'farm-wilber' });
  ev(T(11, 1, 18), 'u-wilber', 'LISTING_PAUSE', { listingId: 'l-w-haba' });

  // Justina, Lucio y La Punta: publicaciones vigentes
  pub(T(11, 2, 8), 'u-justina', 'l-j-papa', 'papa_nativa', 'kg', 120, 3.5, 1, { farmId: 'farm-justina' });
  pub(T(11, 2, 8, 10), 'u-justina', 'l-j-quinua', 'quinua', 'kg', 50, 7.8, 20, { farmId: 'farm-justina' });
  pub(T(10, 28, 7), 'u-justina', 'l-j-haba', 'haba_verde', 'kg', 50, 3.0, 1, { farmId: 'farm-justina' });
  pub(T(10, 2, 7), 'u-lucio', 'l-l-frejol', 'frejol_canario', 'kg', 300, 8.0, 10, { farmId: 'farm-lucio' });
  pub(T(11, 2, 7), 'u-teodoro', 'l-p-arroz', 'arroz_pilado', 'saco', 60, 175, 6, { farmId: 'farm-lapunta' });
  pub(T(11, 2, 7, 5), 'u-teodoro', 'l-p-frejol', 'frejol_canario', 'kg', 400, 7.7, 8, { farmId: 'farm-lapunta' });

  /* ===== Noviembre: lo que está en curso al abrir la demo ===== */
  // Doña Charo: compras de la semana (cuentan para el límite del plan Básico)
  sale({ id: 'so-c01', buyer: 'u-charo', seller: 'u-wilber', items: [{ listingId: 'l-w-papa', qty: 180 }], mode: 'FARMER', taxDoc: 'LIQUIDACION', pay: 'YAPE', placeAt: T(11, 1, 8), day: T(11, 2), stop: 'COMPLETED' });
  sale({ id: 'so-c02', buyer: 'u-charo', seller: 'u-lucio', items: [{ listingId: 'l-l-frejol', qty: 100 }], mode: 'FARMER', taxDoc: 'BOLETA', pay: 'YAPE', placeAt: T(11, 1, 9), day: T(11, 2), reviews: { b: [5, ['Puntual']], s: [5, ['Pago puntual']] } });
  // Pedido de cebolla de Wilber a Doña Charo: en camino, con código de entrega
  sale({ id: 'so-c03', buyer: 'u-charo', seller: 'u-wilber', items: [{ listingId: 'l-w-cebolla', qty: 40 }], mode: 'FARMER', taxDoc: 'LIQUIDACION', pay: 'YAPE', placeAt: T(11, 2, 18, 20), day: T(11, 3), stop: 'IN_TRANSIT' });

  // Hotel Los Andes compra 10 sacos del arroz de Héctor guardado en el molino, con Julio (miércoles)
  ev(T(11, 2, 10), 'u-andres', 'ORDER_PLACE', { orderId: 'o-so-a01', address: ADDRESS_OF['u-andres'], district: '040101', subs: [{ subOrderId: 'so-a01', sellerOrgId: 'org-hector', items: [{ listingId: 'l-h-arroz', qty: 10 }], deliveryMode: 'CARRIER', deliveryDate: T(11, 4, 0), slot: '18:00 a 19:30', taxDoc: 'FACTURA', payMethod: 'TRANSFER', shipmentId: 'sh-so-a01' }] });
  ev(T(11, 2, 10, 30), 'u-hector', 'SUBORDER_ACCEPT', { subOrderId: 'so-a01' });
  ev(T(11, 2, 11), 'u-julio', 'SHIP_OFFER_RESPOND', { shipmentId: 'sh-so-a01', accept: true });
  ev(T(11, 2, 11, 30), 'u-hector', 'STO_RELEASE_CREATE', { releaseId: 'rel-a01', lotId: 'lot-hector-arroz', sacks: 10, picker: 'CARRIER', pickerName: 'Transportes Majes · Julio Apaza', subOrderId: 'so-a01' });
  ev(T(11, 2, 12), 'u-hector', 'STO_RENT_DECLARE', { releaseId: 'rel-a01', method: 'YAPE' });
  ev(T(11, 2, 15), 'u-andres', 'PAYMENT_UPLOAD', { subOrderId: 'so-a01', method: 'TRANSFER', operation: opn(), paidAt: T(11, 2, 14, 50) });
  ev(T(11, 2, 16), 'u-hector', 'PAYMENT_CONFIRM', { subOrderId: 'so-a01' });
  ev(T(11, 3, 8), 'u-ernesto', 'STO_RENT_CONFIRM', { releaseId: 'rel-a01' });
  ev(T(11, 2, 16, 30), 'u-andres', 'MSG_SEND', { msgId: 'm-a01-1', conv: 'so-a01', text: '¿El arroz es de la campaña de setiembre?' });
  ev(T(11, 2, 17), 'u-hector', 'MSG_SEND', { msgId: 'm-a01-2', conv: 'so-a01', text: 'Sí, pilado y guardado en el molino. Calidad A.' });

  // Hotel Los Andes: pedido nuevo de frejol para Héctor (por responder)
  sale({ id: 'so-a02', buyer: 'u-andres', seller: 'u-hector', items: [{ listingId: 'l-h-frejol', qty: 20 }], mode: 'CARRIER', taxDoc: 'FACTURA', pay: 'TRANSFER', placeAt: T(11, 3, 7, 45), day: T(11, 4), stop: 'PENDING' });

  // Comedor Santa Rosa ↔ Justina: disputa por peso (DSP-0031)
  sale({ id: 'so-j01', buyer: 'u-gladys', seller: 'u-justina', items: [{ listingId: 'l-j-haba', qty: 50 }], mode: 'FARMER', taxDoc: 'LIQUIDACION', pay: 'YAPE', placeAt: T(10, 30, 10), day: T(11, 2), stop: 'DISPUTE' });
  ev(T(11, 2, 9, 15), 'u-gladys', 'RECEIPT_CONFIRM', { subOrderId: 'so-j01', disputeId: 'dsp-j01', lines: [{ listingId: 'l-j-haba', acceptedQty: 45, quality: 'OK' }], note: 'Llegaron 45 kg, no 50. Adjunto la foto de mi balanza.' });
  ev(T(11, 2, 10), 'u-justina', 'MSG_SEND', { msgId: 'm-j01-1', conv: 'so-j01', text: 'Pesé 50 en la chacra, puede ser la humedad.' });

  // Pedido de Elena a Wilber pendiente de pago (nivel 2: paga al recibir)
  sale({ id: 'so-e01', buyer: 'u-elena', seller: 'u-wilber', items: [{ listingId: 'l-w-papa', qty: 60 }], mode: 'FARMER', taxDoc: 'LIQUIDACION', pay: 'YAPE', placeAt: T(11, 2, 20), day: T(11, 5), stop: 'ACCEPTED' });

  // Chat del pedido en camino
  ev(T(11, 2, 19, 10), 'u-charo', 'MSG_SEND', { msgId: 'm-c03-1', conv: 'so-c03', quick: 'q.hora', text: '¿A qué hora puedes entregar?' });
  ev(T(11, 2, 19, 15), 'u-wilber', 'MSG_SEND', { msgId: 'm-c03-2', conv: 'so-c03', quick: 'q.llego7', text: 'Llego mañana a las 7.' });
  ev(T(11, 2, 19, 20), 'u-charo', 'MSG_SEND', { msgId: 'm-c03-3', conv: 'so-c03', text: 'Perfecto. ¿La cebolla viene en sacos de 20 kg?' });
  ev(T(11, 2, 19, 26), 'u-wilber', 'MSG_SEND', { msgId: 'm-c03-4', conv: 'so-c03', text: 'Sí, dos sacos de 20 kg.' });

  // Reservas de almacén por confirmar (C-07)
  ev(T(11, 3, 2, 30), 'u-teodoro', 'STO_BOOK', { bookingId: 'bk-p2', facilityOrgId: 'org-pampa', productId: 'arroz_cascara', sacks: 120, kgPerSack: 50, months: 2, arrivalDate: T(11, 5) });
  ev(T(11, 3, 5, 30), 'u-lucio', 'STO_BOOK', { bookingId: 'bk-l1', facilityOrgId: 'org-pampa', productId: 'frejol_canario', sacks: 15, kgPerSack: 50, months: 1, arrivalDate: T(11, 6) });
  ev(T(11, 3, 7, 30), 'u-hector', 'STO_BOOK', { bookingId: 'bk-h2', facilityOrgId: 'org-pampa', productId: 'arroz_pilado', sacks: 30, kgPerSack: 50, months: 3, arrivalDate: T(11, 7) });

  // Expedientes en la bandeja del verificador (W-03)
  const ev1 = (t: number, u: string, org: string, target: number, evidence: any[]) => ev(t, u, 'VERIF_SUBMIT', { caseId: `case-${org}-${target}`, orgId: org, targetLevel: target, evidence });
  ev1(T(11, 1, 9, 30), 'u-justina', 'org-justina', 2, [{ key: 'padron', label: 'Constancia del Padrón de Productores Agrarios', detail: 'N.º 04-0519-00871' }, { key: 'chacra1', label: 'Chacra · foto 1 · GPS dentro del área' }, { key: 'chacra2', label: 'Chacra · foto 2 · tomada en la app' }, { key: 'chacra3', label: 'Chacra · foto 3 · tomada en la app' }, { key: 'tenencia', label: 'Constancia de la comunidad campesina de Yanque' }]);
  ev1(T(11, 1, 15, 30), 'u-faustino', 'org-faustino', 1, [{ key: 'dni', label: 'DNI (ambas caras)' }, { key: 'selfie', label: 'Selfie' }, { key: 'cobro', label: 'Yape de su hija Nely con autorización firmada' }]);
  ev1(T(11, 2, 2, 30), 'u-gladys', 'org-santarosa', 2, [{ key: 'licencia', label: 'Licencia de funcionamiento' }, { key: 'local', label: 'Foto del local con ubicación' }, { key: 'ficha', label: 'Ficha RUC: actividad 5610 (restaurantes)' }]);
  ev1(T(11, 2, 10, 30), 'u-rosa', 'org-rosa', 1, [{ key: 'dni', label: 'DNI (ambas caras)' }, { key: 'selfie', label: 'Selfie', detail: 'Se ve borrosa', flag: 'SELFIE BORROSA' }, { key: 'cobro', label: 'Yape propio' }]);
  ev1(T(11, 2, 14, 30), 'u-martin', 'org-tambo', 1, [{ key: 'ruc', label: 'RUC del negocio' }, { key: 'dni', label: 'DNI del representante y selfie' }]);
  ev1(T(11, 2, 23, 30), 'u-teodoro', 'org-lapunta', 3, [{ key: 'ruc', label: 'Ficha RUC y régimen general' }, { key: 'acta', label: 'Acta de la asociación y vigencia de poder' }]);
  ev1(T(11, 3, 5, 30), 'u-juancarlos', 'org-juancarlos', 1, [{ key: 'dni', label: 'DNI (ambas caras)' }, { key: 'selfie', label: 'Selfie' }, { key: 'cobro', label: 'Yape propio' }]);
  ev1(T(11, 1, 11), 'u-nestor', 'org-colcatrans', 2, [{ key: 'docs', label: 'Licencia A-I, SOAT, CITV, autorización del MTC y TUC' }, { key: 'fotos', label: '4 fotos del vehículo' }, { key: 'cita', label: 'Revisión del vehículo agendada' }]);
  ev1(T(10, 30, 16), 'u-patricia', 'org-valleverde', 2, [{ key: 'docs', label: 'Licencia, ITSE y fumigación vigentes' }, { key: 'fotos', label: '5 fotos del local con GPS' }, { key: 'visita', label: 'Visita agendada para el vie 6 nov 10:00' }]);
  ev(T(11, 2, 8), 'u-lucia', 'VERIF_TAKE', { caseId: 'case-org-justina-2' });
  ev(T(11, 2, 8, 5), 'u-lucia', 'VERIF_TAKE', { caseId: 'case-org-faustino-1' });
  ev(T(11, 2, 9), 'u-marco', 'VERIF_TAKE', { caseId: 'case-org-santarosa-2' });

  // Libro de Reclamaciones y consultas
  ev(T(10, 26, 10), 'u-teodoro', 'COMPLAINT_FILE', { complaintId: 'cmp-1', type: 'RECLAMO', related: 'Estado de cuenta de septiembre', amount: 4.5, detail: 'Me cobraron comisión por un pedido que el comprador canceló y nunca se entregó.', request: 'Que me descuenten ese monto.' });
  ev(T(11, 2, 12), 'u-charo', 'COMPLAINT_FILE', { complaintId: 'cmp-2', type: 'QUEJA', related: 'Atención de Soporte', detail: 'Escribí por el chat de ayuda y me respondieron al día siguiente.', request: 'Que respondan más rápido en la mañana.' });
  ev(T(10, 20, 9), 'u-hector', 'TICKET_OPEN', { ticketId: 'tk-1', topic: 'Cobros y pagos', text: '¿Cómo cambio mi número de Yape?' });
  ev(T(10, 20, 11), 'u-diana', 'TICKET_REPLY', { ticketId: 'tk-1', text: 'Desde Perfil › Cuentas de cobro. La cuenta nueva se verifica con tu DNI.', close: true });

  // R2 · Equipo y locales del Hotel Los Andes (plan Pro, B-23)
  ev(T(10, 26, 10), 'u-andres', 'TEAM_ADD', { userId: 'u-rosaq', name: 'Rosa Quispe Mamani', phone: '958741236', perms: ['PEDIR'], note: 'Jefa de cocina' });
  ev(T(10, 26, 10, 5), 'u-andres', 'TEAM_ADD', { userId: 'u-dario', name: 'Darío Flores Zegarra', phone: '965412378', perms: ['APROBAR', 'PAGAR'], note: 'Administración' });
  ev(T(10, 26, 10, 20), 'u-andres', 'LOCAL_SAVE', { local: { id: 'mirador', name: 'Restaurante Mirador', district: '040126', address: 'Av. Ejército 1020, Yanahuara', receiver: 'Rosa Quispe', days: [2, 4, 6] } });

  // R2 · Quién publica por mí (A-28): la hija de Wilber y el promotor de la asociación de Justina
  ev(T(10, 25, 18), 'u-wilber', 'DELEGATE_ADD', { userId: 'u-nayeli', name: 'Nayeli Huamaní Ccama', phone: '973214568', kind: 'FAMILIAR', perms: ['PUBLICAR', 'PEDIDOS'], note: 'Hija' });
  ev(T(10, 27, 11), 'u-justina', 'DELEGATE_ADD', { userId: 'u-ruben', name: 'Rubén Ccama Quispe', phone: '984563217', kind: 'PROMOTOR', perms: ['PUBLICAR'], note: 'Promotor de la asociación' });

  // R2 · Pedidos programados del Hotel Los Andes (B-22): papa cada jueves y haba cada viernes
  ev(T(10, 29, 9), 'u-andres', 'SCHEDULE_CREATE', { scheduleId: 'prg-a02', name: 'Papa amarilla de cada jueves', fromSubOrderId: 'so-w07', frequency: 'SEMANAL', weekday: 4, maxIncrease: 0.1 });
  ev(T(10, 30, 12), 'u-andres', 'SCHEDULE_CREATE', { scheduleId: 'prg-a01', name: 'Haba verde de los viernes', fromSubOrderId: 'so-w03', frequency: 'QUINCENAL', weekday: 5, maxIncrease: 0.1 });

  // R2 · Solicitudes de compra (B-17, A-27): el hotel pide papa y recibe dos ofertas; Doña Charo pide cebolla
  ev(T(11, 2, 9), 'u-andres', 'REQUEST_CREATE', { requestId: 'req-a01', productId: 'papa_amarilla', kg: 300, maxPricePerKg: 3.2, neededOn: T(11, 6), note: 'Para el buffet del fin de semana: papa mediana, sin brotes.' });
  ev(T(11, 2, 11), 'u-wilber', 'REQUEST_OFFER', { requestId: 'req-a01', offerId: 'ofr-a01-w', pricePerKg: 2.85, kg: 300, harvestDate: T(11, 4), quality: 'PRIMERA', note: 'Cosecho el miércoles: papa Tumbay seleccionada.' });
  ev(T(11, 2, 16), 'u-justina', 'REQUEST_OFFER', { requestId: 'req-a01', offerId: 'ofr-a01-j', pricePerKg: 2.75, kg: 150, harvestDate: T(11, 5), quality: 'SEGUNDA', note: 'Tengo 150 kg; la entrego en Yanque o la mando con transportista.' });
  ev(T(11, 3, 7), 'u-charo', 'REQUEST_CREATE', { requestId: 'req-c01', productId: 'cebolla_roja', kg: 80, maxPricePerKg: 2.4, neededOn: T(11, 7), note: 'Cebolla roja mediana para el cebiche.' });
  return E.sort((a, b) => a.t - b.t);
}

export interface SeedReport { applied: number; rejected: { id: string; type: string; code: string; message: string }[] }
export let LAST_SEED_REPORT: SeedReport = { applied: 0, rejected: [] };

/** Construye el mundo de ejemplo. Recibe el aplicador del motor para no crear un ciclo de imports. */
export function buildSeedWith(apply: (w: World, e: MEvent) => { ok: boolean; error?: { code: string; message: string } }, tick: (w: World, t: number) => void): World {
  const w = emptyWorld();
  base(w);
  const report: SeedReport = { applied: 0, rejected: [] };
  for (const e of script()) {
    const r = apply(w, e);
    if (r.ok) report.applied++;
    else report.rejected.push({ id: e.id, type: e.type, code: r.error!.code, message: r.error!.message });
  }
  tick(w, SEED_ANCHOR);
  w.now = SEED_ANCHOR;
  w.rejected = {};
  LAST_SEED_REPORT = report;
  return w;
}

void addMonths;
