/*
 * Configuración editable sin redeploy (platform_settings, plans, verification_level_limits,
 * shipping_routes y shipping_rates). Valores iniciales = propuesta del documento v5.
 * Todo cambio pasa por doble aprobación (RN-50) en el panel W-10.
 */

export interface PlanDef {
  code: 'BASICO' | 'PRO' | 'EMPRESA';
  name: string;
  price: number;          // S/ al mes, con IGV
  purchaseCap: number | null; // compras al mes
  users: number | null;
  locations: number | null;
  features: string[];
}

export interface LevelLimit {
  listings: number | null;   // publicaciones activas (agricultor)
  perOrder: number;          // tope por pedido
  monthly: number | null;    // volumen mensual
  cash: boolean;             // puede aceptar (agricultor) o pagar (comprador) en efectivo
  prepay: boolean;           // pago anticipado (comprador)
}

export interface ShippingRoute {
  id: string;
  scope: 'RUTA' | 'CIUDAD';
  name: string;
  origin: string;            // provincia de origen
  destination: string;
  distanceKm: number;
  pricePerKg: number;
  minFee: number;
  cityMoto: number;          // reparto en la ciudad (V1)
  cityVan: number;           // reparto en la ciudad (V2)
  offerMinutes: number;      // plazo para aceptar una oferta
}

export interface Settings {
  commission: { freeSales: number; rate: number; issueDay: number; dueDay: number };
  cashThreshold: number;               // RN-04
  orderResponseHours: number;          // RN-08
  autoCompleteHours: number;           // RN-11
  claimHours: number;                  // RN-11 / RN-60
  reviewPublishDays: number;           // RN-12
  priceDeviation: number;              // RN-29 (0.5 = 50 %)
  plausibilityFactor: number;          // RN-23
  membership: { trialDays: number; graceDays: number; downgradeMonths: number };
  plans: Record<'BASICO' | 'PRO' | 'EMPRESA', PlanDef>;
  farmerLimits: LevelLimit[];
  buyerLimits: LevelLimit[];
  carrier: {
    commission: number;                // RN-63
    noCarrierHours: number;            // RN-56
    weightTolerance: number;           // RN-60
    falseFreight: number;              // RN-61
    capT2: number;                     // RN-57
    capT3: number;
    minScore: number;                  // RN-52
    t3Shipments: number; t3Rating: number; t3OnTime: number; // RN-65
  };
  storage: {
    commission: number;                // RN-48
    bookingHours: number;              // RN-43
    lotArrivalDays: number;
    intakeTolerance: number;           // RN-44 (2 %)
    mermaPapa: number; mermaGranos: number;
    releaseDays: number;               // RN-46
    minScore: number;
  };
  routes: ShippingRoute[];
  languages: { enabled: string[] };
}

export const DEFAULT_SETTINGS: Settings = {
  commission: { freeSales: 5, rate: 0.03, issueDay: 1, dueDay: 10 },
  cashThreshold: 2000,
  orderResponseHours: 12,
  autoCompleteHours: 48,
  claimHours: 24,
  reviewPublishDays: 7,
  priceDeviation: 0.5,
  plausibilityFactor: 1.5,
  membership: { trialDays: 30, graceDays: 5, downgradeMonths: 2 },
  plans: {
    BASICO: {
      code: 'BASICO', name: 'Básico', price: 49, purchaseCap: 2500, users: 1, locations: 1,
      features: ['Compras hasta S/ 2 500 al mes', '1 usuario y 1 local', 'Boleta o factura, repetir pedido'],
    },
    PRO: {
      code: 'PRO', name: 'Pro', price: 99, purchaseCap: 8000, users: 5, locations: 3,
      features: ['Compras hasta S/ 8 000 al mes', 'Hasta 5 usuarios y 3 locales', 'Reporte de ahorro y pedidos programados', 'Comprobantes del mes en un archivo'],
    },
    EMPRESA: {
      code: 'EMPRESA', name: 'Empresa', price: 199, purchaseCap: null, users: null, locations: null,
      features: ['Compras sin tope', 'Usuarios y locales ilimitados', 'Ejecutivo de cuenta'],
    },
  },
  // Sección 10.6 (valores iniciales, propuesta)
  farmerLimits: [
    { listings: 0, perOrder: 0, monthly: 0, cash: false, prepay: false },
    { listings: 5, perOrder: 1000, monthly: 5000, cash: true, prepay: false },
    { listings: 30, perOrder: 5000, monthly: 30000, cash: true, prepay: false },
    { listings: null, perOrder: 20000, monthly: null, cash: true, prepay: false },
  ],
  buyerLimits: [
    { listings: null, perOrder: 0, monthly: 0, cash: false, prepay: true },
    { listings: null, perOrder: 1500, monthly: 6000, cash: false, prepay: true },
    { listings: null, perOrder: 8000, monthly: 40000, cash: true, prepay: false },
    { listings: null, perOrder: 20000, monthly: null, cash: true, prepay: false },
  ],
  carrier: {
    commission: 0.10, noCarrierHours: 6, weightTolerance: 0.01, falseFreight: 0.30,
    capT2: 5000, capT3: 20000, minScore: 80, t3Shipments: 50, t3Rating: 4.7, t3OnTime: 0.95,
  },
  storage: {
    commission: 0.10, bookingHours: 24, lotArrivalDays: 3, intakeTolerance: 0.02,
    mermaPapa: 0.02, mermaGranos: 0.005, releaseDays: 3, minScore: 80,
  },
  routes: [
    {
      id: 'camana-aqp', scope: 'RUTA', name: 'Camaná → Arequipa', origin: 'CAMANA', destination: 'AREQUIPA',
      distanceKm: 176, pricePerKg: 0.20, minFee: 20, cityMoto: 0, cityVan: 0, offerMinutes: 120,
    },
    {
      id: 'colca-aqp', scope: 'RUTA', name: 'Colca (Caylloma) → Arequipa', origin: 'CAYLLOMA', destination: 'AREQUIPA',
      distanceKm: 160, pricePerKg: 0.20, minFee: 20, cityMoto: 0, cityVan: 0, offerMinutes: 120,
    },
    {
      id: 'aqp-ciudad', scope: 'CIUDAD', name: 'Reparto en Arequipa', origin: 'AREQUIPA', destination: 'AREQUIPA',
      distanceKm: 12, pricePerKg: 0, minFee: 0, cityMoto: 8, cityVan: 35, offerMinutes: 15,
    },
  ],
  languages: { enabled: ['es'] },
};

/** Claves que el panel W-10 permite proponer, con su etiqueta y cómo se leen/escriben. */
export interface SettingKeyDef { key: string; label: string; group: 'MYPE' | 'AGRICULTOR' | 'ALMACEN' | 'TRANSPORTE' | 'GENERAL'; unit: 'S/' | '%' | 'h' | 'días' | 'n' | 'S/ por kg'; get: (s: Settings) => number; set: (s: Settings, v: number) => void; increaseNotice: boolean }

export const SETTING_KEYS: SettingKeyDef[] = [
  { key: 'plans.BASICO.price', label: 'Básico · precio al mes', group: 'MYPE', unit: 'S/', get: s => s.plans.BASICO.price, set: (s, v) => { s.plans.BASICO.price = v; }, increaseNotice: true },
  { key: 'plans.BASICO.purchaseCap', label: 'Básico · compras hasta', group: 'MYPE', unit: 'S/', get: s => s.plans.BASICO.purchaseCap ?? 0, set: (s, v) => { s.plans.BASICO.purchaseCap = v; }, increaseNotice: false },
  { key: 'plans.PRO.price', label: 'Pro · precio al mes', group: 'MYPE', unit: 'S/', get: s => s.plans.PRO.price, set: (s, v) => { s.plans.PRO.price = v; }, increaseNotice: true },
  { key: 'plans.PRO.purchaseCap', label: 'Pro · compras hasta', group: 'MYPE', unit: 'S/', get: s => s.plans.PRO.purchaseCap ?? 0, set: (s, v) => { s.plans.PRO.purchaseCap = v; }, increaseNotice: false },
  { key: 'plans.EMPRESA.price', label: 'Empresa · precio al mes', group: 'MYPE', unit: 'S/', get: s => s.plans.EMPRESA.price, set: (s, v) => { s.plans.EMPRESA.price = v; }, increaseNotice: true },
  { key: 'membership.graceDays', label: 'Días de gracia', group: 'MYPE', unit: 'días', get: s => s.membership.graceDays, set: (s, v) => { s.membership.graceDays = v; }, increaseNotice: false },
  { key: 'commission.freeSales', label: 'Ventas sin comisión', group: 'AGRICULTOR', unit: 'n', get: s => s.commission.freeSales, set: (s, v) => { s.commission.freeSales = v; }, increaseNotice: false },
  { key: 'commission.rate', label: 'Comisión desde la 6.ª venta', group: 'AGRICULTOR', unit: '%', get: s => s.commission.rate, set: (s, v) => { s.commission.rate = v; }, increaseNotice: true },
  { key: 'commission.dueDay', label: 'Vence el día', group: 'AGRICULTOR', unit: 'n', get: s => s.commission.dueDay, set: (s, v) => { s.commission.dueDay = v; }, increaseNotice: false },
  { key: 'orderResponseHours', label: 'Plazo para aceptar un pedido', group: 'GENERAL', unit: 'h', get: s => s.orderResponseHours, set: (s, v) => { s.orderResponseHours = v; }, increaseNotice: false },
  { key: 'cashThreshold', label: 'Efectivo solo por debajo de', group: 'GENERAL', unit: 'S/', get: s => s.cashThreshold, set: (s, v) => { s.cashThreshold = v; }, increaseNotice: false },
  { key: 'storage.commission', label: 'Comisión del alquiler', group: 'ALMACEN', unit: '%', get: s => s.storage.commission, set: (s, v) => { s.storage.commission = v; }, increaseNotice: true },
  { key: 'storage.bookingHours', label: 'Reserva sin respuesta vence', group: 'ALMACEN', unit: 'h', get: s => s.storage.bookingHours, set: (s, v) => { s.storage.bookingHours = v; }, increaseNotice: false },
  { key: 'storage.intakeTolerance', label: 'Diferencia de peso al ingresar', group: 'ALMACEN', unit: '%', get: s => s.storage.intakeTolerance, set: (s, v) => { s.storage.intakeTolerance = v; }, increaseNotice: false },
  { key: 'carrier.commission', label: 'Comisión del flete', group: 'TRANSPORTE', unit: '%', get: s => s.carrier.commission, set: (s, v) => { s.carrier.commission = v; }, increaseNotice: true },
  { key: 'routes.camana-aqp.pricePerKg', label: 'Ruta Camaná-Arequipa · por kg', group: 'TRANSPORTE', unit: 'S/ por kg', get: s => s.routes.find(r => r.id === 'camana-aqp')!.pricePerKg, set: (s, v) => { s.routes.find(r => r.id === 'camana-aqp')!.pricePerKg = v; }, increaseNotice: true },
  { key: 'routes.camana-aqp.minFee', label: 'Mínimo por pedido', group: 'TRANSPORTE', unit: 'S/', get: s => s.routes.find(r => r.id === 'camana-aqp')!.minFee, set: (s, v) => { s.routes.find(r => r.id === 'camana-aqp')!.minFee = v; }, increaseNotice: true },
  { key: 'carrier.noCarrierHours', label: 'Oferta sin respuesta', group: 'TRANSPORTE', unit: 'h', get: s => s.carrier.noCarrierHours, set: (s, v) => { s.carrier.noCarrierHours = v; }, increaseNotice: false },
  { key: 'carrier.falseFreight', label: 'Falso flete', group: 'TRANSPORTE', unit: '%', get: s => s.carrier.falseFreight, set: (s, v) => { s.carrier.falseFreight = v; }, increaseNotice: true },
];

export function settingDef(key: string) { return SETTING_KEYS.find(k => k.key === key); }
