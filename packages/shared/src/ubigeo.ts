/*
 * Ubigeo de la zona del piloto (INEI). Solo los distritos que usa el MVP:
 * provincias de Arequipa, Camaná y Caylloma (valle del Colca y Majes).
 * geo: posición aproximada en el mapa esquemático (0–100), no coordenadas reales.
 */

export interface District { code: string; name: string; province: 'AREQUIPA' | 'CAMANA' | 'CAYLLOMA'; geo: { x: number; y: number }; city?: boolean }

export const PROVINCES: Record<District['province'], { name: string; geo: { x: number; y: number } }> = {
  AREQUIPA: { name: 'Arequipa', geo: { x: 74, y: 62 } },
  CAMANA: { name: 'Camaná', geo: { x: 16, y: 82 } },
  CAYLLOMA: { name: 'Caylloma', geo: { x: 58, y: 18 } },
};

export const DISTRICTS: District[] = [
  { code: '040101', name: 'Cercado', province: 'AREQUIPA', geo: { x: 75, y: 63 }, city: true },
  { code: '040102', name: 'Alto Selva Alegre', province: 'AREQUIPA', geo: { x: 77, y: 60 }, city: true },
  { code: '040103', name: 'Cayma', province: 'AREQUIPA', geo: { x: 73, y: 59 }, city: true },
  { code: '040104', name: 'Cerro Colorado', province: 'AREQUIPA', geo: { x: 70, y: 59 }, city: true },
  { code: '040109', name: 'Mariano Melgar', province: 'AREQUIPA', geo: { x: 78, y: 63 }, city: true },
  { code: '040110', name: 'Miraflores', province: 'AREQUIPA', geo: { x: 77, y: 62 }, city: true },
  { code: '040112', name: 'Paucarpata', province: 'AREQUIPA', geo: { x: 78, y: 65 }, city: true },
  { code: '040117', name: 'Sachaca', province: 'AREQUIPA', geo: { x: 72, y: 64 }, city: true },
  { code: '040122', name: 'Socabaya', province: 'AREQUIPA', geo: { x: 76, y: 67 }, city: true },
  { code: '040126', name: 'Yanahuara', province: 'AREQUIPA', geo: { x: 73, y: 62 }, city: true },
  { code: '040129', name: 'José Luis Bustamante y Rivero', province: 'AREQUIPA', geo: { x: 76, y: 65 }, city: true },
  { code: '040201', name: 'Camaná', province: 'CAMANA', geo: { x: 16, y: 82 } },
  { code: '040202', name: 'José María Quimper', province: 'CAMANA', geo: { x: 18, y: 80 } },
  { code: '040203', name: 'Mariano Nicolás Valcárcel', province: 'CAMANA', geo: { x: 12, y: 74 } },
  { code: '040205', name: 'Nicolás de Piérola', province: 'CAMANA', geo: { x: 19, y: 78 } },
  { code: '040208', name: 'Samuel Pastor', province: 'CAMANA', geo: { x: 17, y: 84 } },
  { code: '040501', name: 'Chivay', province: 'CAYLLOMA', geo: { x: 60, y: 18 } },
  { code: '040502', name: 'Achoma', province: 'CAYLLOMA', geo: { x: 56, y: 20 } },
  { code: '040503', name: 'Cabanaconde', province: 'CAYLLOMA', geo: { x: 44, y: 22 } },
  { code: '040506', name: 'Coporaque', province: 'CAYLLOMA', geo: { x: 59, y: 15 } },
  { code: '040519', name: 'Yanque', province: 'CAYLLOMA', geo: { x: 57, y: 19 } },
  { code: '040520', name: 'Majes', province: 'CAYLLOMA', geo: { x: 40, y: 56 } },
];

export const DISTRICT_BY_CODE: Record<string, District> = Object.fromEntries(DISTRICTS.map(d => [d.code, d]));

export function districtName(code: string | undefined): string {
  if (!code) return '';
  return DISTRICT_BY_CODE[code]?.name ?? code;
}

export function provinceOf(code: string | undefined): District['province'] | undefined {
  return code ? DISTRICT_BY_CODE[code]?.province : undefined;
}

export function provinceName(p: string | undefined): string {
  return p && (PROVINCES as any)[p] ? (PROVINCES as any)[p].name : (p ?? '');
}

export function placeLabel(code: string | undefined): string {
  const d = code ? DISTRICT_BY_CODE[code] : undefined;
  if (!d) return code ?? '';
  if (d.province === 'AREQUIPA') return d.name;
  return d.name === PROVINCES[d.province].name ? d.name : `${d.name}, ${PROVINCES[d.province].name}`;
}

export const CITY_DISTRICTS = DISTRICTS.filter(d => d.city);
