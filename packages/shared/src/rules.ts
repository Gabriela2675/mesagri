/*
 * Reglas de negocio puras (14.3: «las reglas viven en packages/shared y se prueban ahí;
 * la app las usa para orientar al usuario; el servidor las impone»). Aquí las usan
 * la interfaz (para explicar antes de confirmar) y el engine (para imponerlas).
 */
import type { Settings, LevelLimit, ShippingRoute } from './settings';
import type { Org, TaxDocType, Vehicle, CarrierInfo } from './types';

export const r2 = (n: number) => Math.round(n * 100) / 100;
export const r3 = (n: number) => Math.round(n * 1000) / 1000;

/* ---------- Identidad ---------- */
/** RUC peruano: 11 dígitos, prefijo 10/15/16/17/20 y dígito verificador (módulo 11). */
export function isRucValid(ruc: string): boolean {
  if (!/^(10|15|16|17|20)\d{9}$/.test(ruc)) return false;
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(ruc[i]) * w[i];
  let dv = 11 - (sum % 11);
  if (dv === 10) dv = 0;
  if (dv === 11) dv = 1;
  return dv === Number(ruc[10]);
}

/** Completa un RUC de 10 dígitos con su dígito verificador (útil para datos de ejemplo). */
export function rucWithCheck(first10: string): string {
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(first10[i]) * w[i];
  let dv = 11 - (sum % 11);
  if (dv === 10) dv = 0;
  if (dv === 11) dv = 1;
  return first10 + dv;
}

export const isDniValid = (dni: string) => /^\d{8}$/.test(dni);
export const isPhoneValid = (p: string) => /^9\d{8}$/.test(p.replace(/\s/g, ''));
export const maskDni = (dni?: string) => (dni && dni.length === 8 ? `${dni[0]}•••••${dni.slice(6)}` : '—');
export const maskPhone = (p?: string) => (p && p.length >= 9 ? `${p.slice(0, 1)}•• ••• ${p.slice(6)}` : '—');

/* ---------- Niveles y topes (10.6) ---------- */
export function farmerLimit(s: Settings, level: number): LevelLimit { return s.farmerLimits[Math.max(0, Math.min(3, level))]; }
export function buyerLimit(s: Settings, level: number): LevelLimit { return s.buyerLimits[Math.max(0, Math.min(3, level))]; }

export const LEVEL_NAME = ['Registrado', 'Identidad', 'Verificado', 'Formal'];
export const CARRIER_LEVEL_NAME: Record<string, string> = { T0: 'Registrado', T1: 'Documentos', T2: 'Verificado', T3: 'Destacado' };
export const WAREHOUSE_LEVEL_NAME: Record<string, string> = { A0: 'Registrado', A1: 'Documentos', A2: 'Verificado', A3: 'Destacado' };

/* ---------- Comprobantes (RN-34, RF-CAT-15) ---------- */
export function taxDocsFor(seller: Org): TaxDocType[] {
  switch (seller.taxRegime) {
    case 'RER':
    case 'GENERAL': return ['BOLETA', 'FACTURA'];
    case 'NRUS': return ['BOLETA'];
    default: return ['LIQUIDACION'];
  }
}
export const TAXDOC_LABEL: Record<TaxDocType, string> = { BOLETA: 'Boleta', FACTURA: 'Factura', LIQUIDACION: 'Liquidación de compra' };
export function sellerInvoiceLabel(seller: Org): string {
  const d = taxDocsFor(seller);
  if (d.includes('FACTURA')) return 'Emite factura';
  if (d.includes('BOLETA')) return 'Solo boleta';
  return 'Liquidación de compra';
}

/* ---------- Pagos (RN-04, RN-24, RN-28) ---------- */
/** Efectivo contra entrega: solo bajo el umbral (con el envío incluido: corrige D-02), si el agricultor lo acepta y ambos niveles lo permiten. */
export function cashCheck(s: Settings, totalWithDelivery: number, buyer: Org, seller: Org): { ok: boolean; reason?: string } {
  if (totalWithDelivery >= s.cashThreshold) return { ok: false, reason: `Pedidos de S/ ${s.cashThreshold.toLocaleString('es-PE')} o más se pagan por Yape, Plin o transferencia (ley de bancarización).` };
  if (!seller.acceptsCash) return { ok: false, reason: `${seller.name} no recibe efectivo.` };
  if (!farmerLimit(s, seller.level).cash) return { ok: false, reason: 'El nivel del agricultor no permite efectivo.' };
  if (!buyerLimit(s, buyer.level).cash) return { ok: false, reason: 'Desde el nivel 2 puedes pagar en efectivo al recibir.' };
  return { ok: true };
}

export function digitalMethods(seller: Org): ('YAPE' | 'PLIN' | 'TRANSFER')[] {
  const out: ('YAPE' | 'PLIN' | 'TRANSFER')[] = [];
  const v = seller.payout.filter(a => a.verified && (a.relation === 'PROPIA' || !!a.authorization));
  if (v.some(a => a.kind === 'YAPE')) out.push('YAPE');
  if (v.some(a => a.kind === 'PLIN')) out.push('PLIN');
  if (v.some(a => a.kind === 'BANK')) out.push('TRANSFER');
  return out;
}

export function prepayRequired(s: Settings, buyerLevel: number): boolean { return buyerLimit(s, buyerLevel).prepay; }

/* ---------- Comisión del agricultor (RN-14) ---------- */
/**
 * Vista previa de la comisión antes de aceptar (RF-CMS-02).
 * Las 5 ventas sin comisión se asignan en el orden en que el agricultor ACEPTA los pedidos
 * (se reserva el cupo). Así lo que se ve al aceptar es lo que se cobra (corrige D-01).
 */
export function commissionPreview(s: Settings, seller: Org, reservedPending: number, subtotal: number, frozenRate: number) {
  const free = s.commission.freeSales;
  const used = seller.counters.freeSalesUsed;
  const slotsLeft = Math.max(0, free - used - reservedPending);
  const isFree = slotsLeft > 0;
  const saleNumber = seller.counters.completedSales + reservedPending + 1;
  return {
    isFree,
    saleNumber,
    freeNumber: isFree ? used + reservedPending + 1 : undefined,
    rate: isFree ? 0 : frozenRate,
    amount: isFree ? 0 : r2(subtotal * frozenRate),
    slotsLeft,
  };
}

/* ---------- Precio y verosimilitud ---------- */
/** RN-29: pide confirmar solo si se aparta MÁS de 50 % (con +50 % exacto no pide: corrige D-03). */
export function priceDeviation(pricePerKg: number, suggested: number, limit: number): { ask: boolean; dev: number } {
  if (!suggested) return { ask: false, dev: 0 };
  const dev = (pricePerKg - suggested) / suggested;
  return { ask: Math.abs(dev) > limit + 1e-9, dev };
}

/** RN-23: la cantidad no debe pasar de 1,5 veces el rendimiento alto para el área de la chacra. */
export function plausibility(qtyKg: number, areaHa: number, yieldHighTonHa: number, factor: number) {
  const maxKg = areaHa * yieldHighTonHa * 1000 * factor;
  return { ok: qtyKg <= maxKg, maxKg };
}

/* ---------- Membresía (RN-35 a RN-38) ---------- */
export function planNeededFor(s: Settings, monthPurchases: number): 'BASICO' | 'PRO' | 'EMPRESA' {
  const b = s.plans.BASICO.purchaseCap ?? Infinity;
  const p = s.plans.PRO.purchaseCap ?? Infinity;
  if (monthPurchases <= b) return 'BASICO';
  if (monthPurchases <= p) return 'PRO';
  return 'EMPRESA';
}
export const PLAN_ORDER = ['BASICO', 'PRO', 'EMPRESA'] as const;

/* ---------- Envíos (RN-53, RN-54, RN-57) ---------- */
export const VCLASS_INFO = {
  V1: { label: 'Moto con cajuela', category: 'L3', maxKg: 20, license: 'B-IIb', where: 'Dentro de Arequipa', habilita: 'Registro municipal de entrega rápida' },
  V2: { label: 'Camioneta o furgón', category: 'N1', maxKg: 1500, license: 'A-I', where: 'Ciudad y rutas entre provincias', habilita: 'Autorización del MTC y TUC' },
  V3: { label: 'Camión ligero', category: 'N2', maxKg: 6000, license: 'A-IIb', where: 'Rutas entre provincias', habilita: 'Autorización del MTC y TUC' },
} as const;

const LICENSE_RANK: Record<string, number> = { 'B-IIb': 0, 'A-I': 1, 'A-IIa': 2, 'A-IIb': 3 };
export function licenseMatches(vclass: Vehicle['vclass'], license: string): boolean {
  if (vclass === 'V1') return license === 'B-IIb';
  const need = VCLASS_INFO[vclass].license;
  return (LICENSE_RANK[license] ?? -1) >= LICENSE_RANK[need] && license !== 'B-IIb';
}

export function freightFor(route: ShippingRoute, kgTotal: number, vclass?: Vehicle['vclass']) {
  if (route.scope === 'CIUDAD') {
    const cls = vclass ?? (kgTotal <= 20 ? 'V1' : 'V2');
    return { freight: cls === 'V1' ? route.cityMoto : route.cityVan, vclass: cls, perKg: false };
  }
  const raw = r2(route.pricePerKg * kgTotal);
  return { freight: Math.max(raw, route.minFee), vclass: (kgTotal <= 1500 ? 'V2' : 'V3') as Vehicle['vclass'], perKg: raw >= route.minFee };
}

export function carrierCap(s: Settings, info: CarrierInfo): number {
  if (info.level === 'T3') return s.carrier.capT3;
  if (info.level === 'T2') return s.carrier.capT2;
  return 0;
}

/** Elige la ruta para un envío según la provincia de origen y de destino. */
export function routeFor(s: Settings, originProvince: string, destProvince: string): ShippingRoute | undefined {
  if (originProvince === 'AREQUIPA' && destProvince === 'AREQUIPA') return s.routes.find(r => r.scope === 'CIUDAD');
  return s.routes.find(r => r.scope === 'RUTA' && r.origin === originProvince && r.destination === destProvince);
}

/* ---------- Almacenes (RF-STO-07) ---------- */
export interface StorageQuoteIn { sacks: number; kgPerSack: number; pricePerKg: number; rise: number; months: number; rate: number; freight: number; lossFarm: number; lossStore: number }
export function storageQuote(q: StorageQuoteIn) {
  const kgT = q.sacks * q.kgPerSack;
  const rent = r2(q.sacks * q.rate * q.months);
  const sellToday = r2(kgT * q.pricePerKg);
  const farmRise = r2(kgT * (1 - q.lossFarm) * q.pricePerKg * (1 + q.rise));
  const storeRise = r2(kgT * (1 - q.lossStore) * q.pricePerKg * (1 + q.rise) - rent - q.freight);
  const farmFlat = r2(kgT * (1 - q.lossFarm) * q.pricePerKg);
  const storeFlat = r2(kgT * (1 - q.lossStore) * q.pricePerKg - rent - q.freight);
  const breakEven = kgT > 0 && q.pricePerKg > 0 ? (sellToday + rent + q.freight) / (kgT * (1 - q.lossStore) * q.pricePerKg) - 1 : 0;
  return { kg: kgT, rent, sellToday, farmRise, storeRise, farmFlat, storeFlat, breakEven, best: storeRise > Math.max(sellToday, farmRise) ? 'ALMACEN' : sellToday >= farmRise ? 'HOY' : 'CHACRA' };
}

/* ---------- Varios ---------- */
export function sumBy<T>(arr: T[], f: (x: T) => number): number { let s = 0; for (const x of arr) s += f(x); return s; }
export function initials(name: string): string {
  const parts = name.replace(/[«»"().,]/g, ' ').split(/\s+/).filter(w => w && !/^(de|del|la|las|los|y|e\.i\.r\.l|s\.a\.c|sac|eirl)$/i.test(w));
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '·';
}
