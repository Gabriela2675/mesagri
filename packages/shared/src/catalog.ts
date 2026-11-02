/*
 * Catálogo maestro (catalog_products, catalog_product_aliases y crop_references).
 * - Precios de referencia por kg: papa = Midagri, promedio nacional de enero de 2023 (Miñán, 2023).
 *   El resto son valores de ejemplo para la demo: se reemplazan con los del piloto (RF-CAT-14).
 * - Rendimiento alto por hectárea: sirve para la regla de verosimilitud (RN-23).
 * - Los nombres en quechua son BORRADORES sin revisión de hablantes (RN-32): no se activan solos.
 */
import type { Unit } from './types';

export interface Product {
  id: string;
  name: string;
  short: string;            // nombre corto para la ficha
  letter: string;
  color: string;            // color del ícono con letra (contraste ≥ 3:1 con blanco)
  category: 'TUBERCULOS' | 'HORTALIZAS' | 'GRANOS' | 'MENESTRAS' | 'FRUTOS';
  units: Unit[];
  sackKg: number;           // kilos por saco habituales
  jabaKg?: number;
  perishDays: number;       // vigencia de la publicación (RF-CAT-06)
  yieldHigh: number;        // t/ha (RN-23)
  ref: { chacra: number; mayorista: number; source: string };
  storable: boolean;        // se guarda en almacén seco (4.4)
  merma: 'TUBERCULO' | 'GRANO' | 'NO';
  synonyms: string[];       // para buscar y para el intérprete de voz
  varieties?: string[];
}

const MIDAGRI = 'Midagri, promedio nacional de enero de 2023 (Miñán, 2023)';
const EJEMPLO = 'valor de ejemplo de la demo (por validar en el piloto)';

export const PRODUCTS: Product[] = [
  { id: 'papa_amarilla', name: 'Papa amarilla', short: 'Papa amarilla', letter: 'P', color: '#A57A12', category: 'TUBERCULOS', units: ['kg', 'saco', 'arroba'], sackKg: 50, perishDays: 30, yieldHigh: 30, ref: { chacra: 2.01, mayorista: 3.36, source: MIDAGRI }, storable: true, merma: 'TUBERCULO', synonyms: ['papa amarilla', 'amarilla', 'papa', 'papas'], varieties: ['Tumbay', 'Peruanita', 'Amarilla del Colca'] },
  { id: 'papa_blanca', name: 'Papa blanca', short: 'Papa blanca', letter: 'P', color: '#8C7350', category: 'TUBERCULOS', units: ['kg', 'saco', 'arroba'], sackKg: 50, perishDays: 30, yieldHigh: 35, ref: { chacra: 1.20, mayorista: 2.10, source: EJEMPLO }, storable: true, merma: 'TUBERCULO', synonyms: ['papa blanca', 'blanca', 'canchan', 'canchán', 'yungay', 'unica', 'única'], varieties: ['Canchán', 'Yungay', 'Única'] },
  { id: 'papa_nativa', name: 'Papa nativa', short: 'Papa nativa', letter: 'P', color: '#6E3D63', category: 'TUBERCULOS', units: ['kg', 'saco', 'arroba'], sackKg: 50, perishDays: 30, yieldHigh: 18, ref: { chacra: 2.40, mayorista: 4.20, source: EJEMPLO }, storable: true, merma: 'TUBERCULO', synonyms: ['papa nativa', 'nativa', 'huayro', 'huayru', 'wayru', 'peruanita'], varieties: ['Huayro', 'Peruanita', 'Qompis'] },
  { id: 'cebolla_roja', name: 'Cebolla roja', short: 'Cebolla roja', letter: 'C', color: '#8E3B5E', category: 'HORTALIZAS', units: ['kg', 'saco', 'arroba'], sackKg: 50, perishDays: 25, yieldHigh: 50, ref: { chacra: 1.05, mayorista: 2.52, source: 'valor de ejemplo con la brecha de +140 % que reporta Miñán (2023)' }, storable: false, merma: 'NO', synonyms: ['cebolla roja', 'cebolla', 'cebollas', 'siwulla'] },
  { id: 'tomate', name: 'Tomate', short: 'Tomate', letter: 'T', color: '#B8402C', category: 'FRUTOS', units: ['kg', 'jaba'], sackKg: 25, jabaKg: 25, perishDays: 10, yieldHigh: 60, ref: { chacra: 1.40, mayorista: 2.60, source: EJEMPLO }, storable: false, merma: 'NO', synonyms: ['tomate', 'tomates', 'tomatito'] },
  { id: 'frejol_canario', name: 'Frejol canario', short: 'Frejol canario', letter: 'F', color: '#A0452E', category: 'MENESTRAS', units: ['kg', 'saco'], sackKg: 50, perishDays: 120, yieldHigh: 2.5, ref: { chacra: 6.20, mayorista: 9.40, source: EJEMPLO }, storable: true, merma: 'GRANO', synonyms: ['frejol canario', 'frijol canario', 'canario', 'frejol', 'frijol', 'frejoles', 'frijoles'] },
  { id: 'arroz_cascara', name: 'Arroz cáscara', short: 'Arroz cáscara', letter: 'A', color: '#8A6236', category: 'GRANOS', units: ['kg', 'saco'], sackKg: 50, perishDays: 180, yieldHigh: 12, ref: { chacra: 1.10, mayorista: 1.70, source: EJEMPLO }, storable: true, merma: 'GRANO', synonyms: ['arroz cascara', 'arroz cáscara', 'cascara', 'cáscara', 'arroz en cascara', 'arroz en cáscara'] },
  { id: 'arroz_pilado', name: 'Arroz pilado', short: 'Arroz pilado', letter: 'A', color: '#76695A', category: 'GRANOS', units: ['kg', 'saco'], sackKg: 50, perishDays: 180, yieldHigh: 8, ref: { chacra: 2.60, mayorista: 3.90, source: EJEMPLO }, storable: true, merma: 'GRANO', synonyms: ['arroz pilado', 'pilado', 'arroz'] },
  { id: 'maiz_choclo', name: 'Choclo', short: 'Choclo', letter: 'M', color: '#9C7A10', category: 'GRANOS', units: ['kg', 'saco'], sackKg: 40, perishDays: 7, yieldHigh: 15, ref: { chacra: 1.50, mayorista: 2.80, source: EJEMPLO }, storable: false, merma: 'NO', synonyms: ['choclo', 'choclos', 'maiz choclo', 'maíz choclo', 'sara', 'maiz', 'maíz'] },
  { id: 'haba_verde', name: 'Haba verde', short: 'Haba verde', letter: 'H', color: '#4F7A26', category: 'MENESTRAS', units: ['kg', 'saco', 'arroba'], sackKg: 40, perishDays: 10, yieldHigh: 10, ref: { chacra: 1.80, mayorista: 3.20, source: EJEMPLO }, storable: false, merma: 'NO', synonyms: ['haba verde', 'haba', 'habas', 'hawas'] },
  { id: 'haba_seca', name: 'Haba seca', short: 'Haba seca', letter: 'H', color: '#6E5F58', category: 'MENESTRAS', units: ['kg', 'saco'], sackKg: 50, perishDays: 180, yieldHigh: 3, ref: { chacra: 3.60, mayorista: 5.40, source: EJEMPLO }, storable: true, merma: 'GRANO', synonyms: ['haba seca', 'habas secas'] },
  { id: 'quinua', name: 'Quinua', short: 'Quinua', letter: 'Q', color: '#8A6236', category: 'GRANOS', units: ['kg', 'saco', 'arroba'], sackKg: 50, perishDays: 365, yieldHigh: 3, ref: { chacra: 5.20, mayorista: 7.40, source: EJEMPLO }, storable: true, merma: 'GRANO', synonyms: ['quinua', 'quinoa', 'kinwa', 'quinua blanca'] },
  { id: 'zanahoria', name: 'Zanahoria', short: 'Zanahoria', letter: 'Z', color: '#B5561C', category: 'HORTALIZAS', units: ['kg', 'saco'], sackKg: 50, perishDays: 20, yieldHigh: 40, ref: { chacra: 0.90, mayorista: 1.80, source: EJEMPLO }, storable: false, merma: 'NO', synonyms: ['zanahoria', 'zanahorias'] },
  { id: 'olluco', name: 'Olluco', short: 'Olluco', letter: 'O', color: '#A04C6E', category: 'TUBERCULOS', units: ['kg', 'saco', 'arroba'], sackKg: 50, perishDays: 20, yieldHigh: 12, ref: { chacra: 1.70, mayorista: 3.00, source: EJEMPLO }, storable: false, merma: 'TUBERCULO', synonyms: ['olluco', 'ollucos', 'ulluku', 'ulluco'] },
  { id: 'oca', name: 'Oca', short: 'Oca', letter: 'O', color: '#A85A3C', category: 'TUBERCULOS', units: ['kg', 'saco', 'arroba'], sackKg: 50, perishDays: 20, yieldHigh: 12, ref: { chacra: 1.60, mayorista: 2.90, source: EJEMPLO }, storable: false, merma: 'TUBERCULO', synonyms: ['oca', 'ocas', 'uqa'] },
  { id: 'ajo', name: 'Ajo', short: 'Ajo', letter: 'A', color: '#76695A', category: 'HORTALIZAS', units: ['kg', 'saco'], sackKg: 25, perishDays: 60, yieldHigh: 15, ref: { chacra: 4.50, mayorista: 7.20, source: EJEMPLO }, storable: true, merma: 'GRANO', synonyms: ['ajo', 'ajos'] },
  { id: 'rocoto', name: 'Rocoto', short: 'Rocoto', letter: 'R', color: '#A8332A', category: 'FRUTOS', units: ['kg', 'jaba'], sackKg: 20, jabaKg: 20, perishDays: 12, yieldHigh: 25, ref: { chacra: 2.20, mayorista: 4.50, source: EJEMPLO }, storable: false, merma: 'NO', synonyms: ['rocoto', 'rocotos'] },
  { id: 'zapallo', name: 'Zapallo', short: 'Zapallo', letter: 'Z', color: '#A8641C', category: 'FRUTOS', units: ['kg'], sackKg: 50, perishDays: 40, yieldHigh: 40, ref: { chacra: 0.80, mayorista: 1.60, source: EJEMPLO }, storable: false, merma: 'NO', synonyms: ['zapallo', 'zapallos', 'loche'] },
  { id: 'chuno', name: 'Chuño', short: 'Chuño', letter: 'C', color: '#6E5F58', category: 'TUBERCULOS', units: ['kg', 'saco', 'arroba'], sackKg: 50, perishDays: 365, yieldHigh: 6, ref: { chacra: 6.00, mayorista: 9.00, source: EJEMPLO }, storable: true, merma: 'GRANO', synonyms: ['chuño', 'chuno', 'ch\'uñu', 'moraya', 'tunta'] },
];

export const PRODUCT_BY_ID: Record<string, Product> = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));

/** Productos que el equipo agrega al catálogo (W-09). Viven en el mundo (catalogExtra) y se registran aquí. */
const EXTRA: Record<string, Product> = {};
export function registerProducts(list: Product[] | Record<string, Product> | undefined) {
  for (const p of Array.isArray(list) ? list : Object.values(list ?? {})) if (p && p.id && !PRODUCT_BY_ID[p.id]) EXTRA[p.id] = p;
}
/** Catálogo completo: el maestro más lo que agregó el equipo. */
export function allProducts(): Product[] { return [...PRODUCTS, ...Object.values(EXTRA)]; }

export function product(id: string): Product {
  return PRODUCT_BY_ID[id] ?? EXTRA[id] ?? { ...PRODUCTS[0], id, name: id, short: id, letter: id.slice(0, 1).toUpperCase() };
}

/** Precio sugerido por kg: punto medio entre chacra y mayorista (4.1). */
export function suggestedPricePerKg(productId: string): number {
  const p = product(productId);
  return Math.round(((p.ref.chacra + p.ref.mayorista) / 2) * 10) / 10;
}

export const UNIT_LABEL: Record<Unit, { one: string; many: string; short: string }> = {
  kg: { one: 'kilo', many: 'kilos', short: 'kg' },
  saco: { one: 'saco', many: 'sacos', short: 'saco' },
  arroba: { one: 'arroba', many: 'arrobas', short: '@' },
  jaba: { one: 'jaba', many: 'jabas', short: 'jaba' },
  atado: { one: 'atado', many: 'atados', short: 'atado' },
};

export const ARROBA_KG = 11.5;

export function unitKgFor(productId: string, unit: Unit): number {
  const p = product(productId);
  if (unit === 'kg') return 1;
  if (unit === 'saco') return p.sackKg;
  if (unit === 'arroba') return ARROBA_KG;
  if (unit === 'jaba') return p.jabaKg ?? 25;
  return 1;
}

export const CATEGORY_LABEL: Record<Product['category'], string> = {
  TUBERCULOS: 'Tubérculos', HORTALIZAS: 'Hortalizas', GRANOS: 'Granos', MENESTRAS: 'Menestras', FRUTOS: 'Frutos',
};

/** Borradores de nombres en quechua sureño (para revisar con hablantes del Colca en W-09). */
export const QU_PRODUCT_DRAFTS: Record<string, string> = {
  papa_amarilla: 'Q\'illu papa', papa_blanca: 'Yuraq papa', papa_nativa: 'Papa', haba_verde: 'Hawas', haba_seca: 'Ch\'aki hawas',
  quinua: 'Kinwa', maiz_choclo: 'Choqllo', olluco: 'Ulluku', oca: 'Uqa', chuno: 'Ch\'uñu',
};
