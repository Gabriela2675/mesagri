import { describe, it, expect } from 'vitest';
import { seedWorld, applySafe, structuredCloneSafe } from '../src/engine/index';
import type { MEvent, World } from '../src/types';
import { MIN } from '../src/time';
import { DISTRICTS, DISTRICT_BY_CODE, PROVINCES, PROVINCE_CODES, AREQUIPA_BOX, inBox, kmBetween, placeLabel, fold, mapsLink } from '../src/ubigeo';
import { searchPlaces, locatePoint, sound, editDistance, placeSub } from '../src/places';
import { placeData } from '../src/places-data';
import { maskWorld, type Viewer } from '../src/privacy';

let n = 0;
const fresh = () => structuredCloneSafe(seedWorld());
const run = (w: World, actor: string, type: string, p: any) => applySafe(w, { id: `pl-${++n}`, type, actor, t: w.now + MIN, lamport: 0, p } as MEvent);

describe('ubigeo de Arequipa (INEI)', () => {
  it('tiene las 8 provincias y los 109 distritos, con nombres oficiales y coordenadas dentro de su distrito', () => {
    expect(DISTRICTS).toHaveLength(109);
    expect(new Set(DISTRICTS.map(d => d.code)).size).toBe(109);
    expect(PROVINCE_CODES).toHaveLength(8);
    const per = Object.fromEntries(PROVINCE_CODES.map(p => [p, DISTRICTS.filter(d => d.province === p).length]));
    expect(per).toEqual({ AREQUIPA: 29, CAMANA: 8, CARAVELI: 13, CASTILLA: 14, CAYLLOMA: 20, CONDESUYOS: 8, ISLAY: 6, LA_UNION: 11 });
    for (const d of DISTRICTS) {
      expect(d.code).toMatch(/^04\d{4}$/);
      expect(inBox(d.lat, d.lng, AREQUIPA_BOX)).toBe(true);
      expect(inBox(d.lat, d.lng, d.box)).toBe(true);
      expect(PROVINCES[d.province].capital.slice(0, 4)).toBe(d.code.slice(0, 4));
    }
    // códigos que antes estaban mal o faltaban
    expect(DISTRICT_BY_CODE['040520'].name).toBe('Majes');
    expect(DISTRICT_BY_CODE['040520'].capital).toBe('El Pedregal');
    expect(DISTRICT_BY_CODE['040129'].name).toBe('José Luis Bustamante y Rivero');
    expect(DISTRICT_BY_CODE['040116'].name).toBe('Sabandía');
    expect(DISTRICT_BY_CODE['040401'].name).toBe('Aplao');
    expect(DISTRICT_BY_CODE['040801'].name).toBe('Cotahuasi');
    expect(placeLabel('040519')).toBe('Yanque, Caylloma');
    expect(placeLabel('040116')).toBe('Sabandía');
  });
  it('mide distancias reales por carretera (aproximadas)', () => {
    expect(kmBetween('040201', '040101')).toBeGreaterThan(160);  // Camaná–Arequipa: 176 km por la Panamericana
    expect(kmBetween('040201', '040101')).toBeLessThan(190);
    expect(kmBetween('040520', '040101')).toBeGreaterThan(90);   // El Pedregal–Arequipa: ~100 km
    expect(kmBetween('040520', '040101')).toBeLessThan(115);
    expect(kmBetween('040519', '040501')).toBeLessThan(12);      // Yanque–Chivay
    expect(kmBetween('040101', '040101')).toBe(0);
    expect(mapsLink(-16.39333, -71.52889)).toBe('https://www.google.com/maps/search/?api=1&query=-16.393330,-71.528890');
  });
  it('compara sin tildes ni mayúsculas y por cómo suena', () => {
    expect(fold('Sabandía')).toBe('sabandia');
    expect(fold('PEÑA Blanca')).toBe('pena blanca');
    expect(sound('Yanke')).toBe(sound('Yanque'));
    expect(sound('Wambo')).toBe(sound('Huambo'));
    expect(sound('Chivai')).toBe(sound('Chivay'));
    expect(sound('Cabana')).toBe(sound('Kabana'));
    expect(editDistance('chiguata', 'chiguta')).toBe(1);
  });
});

describe('buscador de lugares (sin internet)', () => {
  const data = placeData();
  const first = (q: string) => searchPlaces(data, q, { limit: 5 })[0]?.place;
  it('tiene los distritos y los centros poblados del INEI', () => {
    expect(data.places.filter(p => p.kind === 'DISTRITO')).toHaveLength(109);
    expect(data.places.length).toBeGreaterThan(4500);
    for (const p of data.places) expect(DISTRICT_BY_CODE[p.district]).toBeTruthy();
  });
  it('encuentra el lugar aunque se escriba sin tildes, con errores o con el distrito', () => {
    expect(first('yanque')).toMatchObject({ kind: 'DISTRITO', district: '040519' });
    expect(first('yanke')).toMatchObject({ district: '040519' });
    expect(first('chivai')).toMatchObject({ district: '040501' });
    expect(first('sabandia')).toMatchObject({ district: '040116' });
    expect(first('cabana conde')).toMatchObject({ district: '040503' });
    expect(first('pedregal majes')?.district).toBe('040520');
    expect(first('seccion b2')).toMatchObject({ name: 'Sección B2 (Pampa de Majes)', district: '040520', kind: 'CCPP_U' });
    expect(first('charcani')).toMatchObject({ district: '040103' });
    expect(first('aplao')).toMatchObject({ district: '040401' });
    expect(searchPlaces(data, 'xyzabc')).toEqual([]);
    expect(searchPlaces(data, 'a')).toEqual([]);
    expect(placeSub(first('charcani')!)).toBe('Centro poblado · Cayma, Arequipa');
  });
  it('dice en qué distrito cae un punto del GPS y pide confirmar cerca de los límites', () => {
    const plaza = locatePoint(data, -16.3988, -71.5369);
    expect(plaza).toMatchObject({ inside: true, district: '040101' });
    const pedregal = locatePoint(data, -16.35333, -72.24722);
    expect(pedregal).toMatchObject({ inside: true, district: '040520', ambiguous: false });
    const camana = locatePoint(data, -16.6247, -72.7114);
    expect(camana.candidates).toContain('040201');
    expect(camana.ambiguous).toBe(true);
    expect(locatePoint(data, -13.52, -71.97)).toMatchObject({ inside: false }); // Cusco
    expect(locatePoint(data, -16.5, -73.5).inside).toBe(false);              // en el mar
  });
  it('acierta el distrito de los centros poblados (dejando cada uno fuera del índice)', () => {
    let total = 0, top1 = 0, inCand = 0, sureWrong = 0;
    for (let i = 0; i < data.places.length; i += 3) {
      const p = data.places[i];
      if (p.kind === 'DISTRITO') continue;
      const key = `${Math.floor(p.lat / 0.05)}:${Math.floor(p.lng / 0.05)}`;
      const cell = data.grid.get(key)!;
      const at = cell.indexOf(i);
      cell.splice(at, 1);
      const l = locatePoint(data, p.lat, p.lng);
      cell.splice(at, 0, i);
      total++;
      if (l.district === p.district) top1++;
      if (l.candidates.includes(p.district)) inCand++;
      if (!l.ambiguous && l.district !== p.district) sureWrong++;
    }
    expect(top1 / total).toBeGreaterThan(0.95);
    expect(inCand / total).toBeGreaterThan(0.99);
    expect(sureWrong / total).toBeLessThan(0.01);
  });
});

describe('ubicación de la chacra en las reglas', () => {
  const reg = (w: World, id: string, location: unknown, district = '040519') => run(w, 'u-' + id, 'USER_REGISTER', {
    userId: 'u-' + id, orgId: 'org-' + id, role: 'FARMER', phone: '9' + String(10_000_000 + n * 7919).slice(-8), name: 'Prueba Ubicación ' + id, lang: 'es',
    org: { district, name: 'Prueba ' + id, location },
  });
  it('guarda el punto si está en el distrito y rechaza uno de otro distrito o de fuera de Arequipa', () => {
    const w = fresh();
    const ok = reg(w, 'u1', { lat: -15.6483, lng: -71.6608, label: 'Yanque', source: 'CCPP', ccpp: '0405190001', ref: 'Frente a la plaza' });
    expect(ok.ok).toBe(true);
    expect(w.orgs['org-u1'].location).toMatchObject({ lat: -15.6483, lng: -71.6608, label: 'Yanque', source: 'CCPP', ref: 'Frente a la plaza' });
    const far = reg(w, 'u2', { lat: -16.62, lng: -72.71, label: 'Camaná', source: 'GPS' });
    expect(far.ok).toBe(false);
    expect(far.error?.code).toBe('BAD_LOCATION');
    const cusco = reg(w, 'u3', { lat: -13.52, lng: -71.97, label: 'Cusco', source: 'GPS' });
    expect(cusco.error?.code).toBe('BAD_LOCATION');
    const otherCcpp = reg(w, 'u4', { lat: -15.6483, lng: -71.6608, label: 'Champi Chico', source: 'CCPP', ccpp: '0401030004' });
    expect(otherCcpp.error?.code).toBe('BAD_LOCATION');
    // sin ubicación (solo el distrito) se sigue pudiendo
    expect(reg(w, 'u5', undefined).ok).toBe(true);
  });
  it('la chacra se registra con su lugar, el dueño lo corrige y otro agricultor no', () => {
    const w = fresh();
    const r = run(w, 'u-wilber', 'FARM_ADD', { farmId: 'farm-p1', orgId: 'org-wilber', name: 'La Pampa', district: '040201', areaHa: 2, tenure: 'PROPIA', crops: ['arroz_cascara', 'no-existe'],
      place: { lat: -16.6247, lng: -72.7114, label: 'Camaná (distrito)', source: 'DISTRITO' } });
    expect(r.ok).toBe(true);
    expect(w.farms['farm-p1'].crops).toEqual(['arroz_cascara']);
    expect(w.farms['farm-p1'].place?.source).toBe('DISTRITO');
    const fix = run(w, 'u-wilber', 'FARM_LOCATE', { farmId: 'farm-p1', district: '040208', place: { lat: -16.6136, lng: -72.6992, label: 'A 300 m de La Pampa', source: 'GPS', accuracy: 12.4 } });
    expect(fix.ok).toBe(true);
    expect(w.farms['farm-p1']).toMatchObject({ district: '040208', gps: 'APP', place: { source: 'GPS', accuracy: 12 } });
    const other = run(w, 'u-justina', 'FARM_LOCATE', { farmId: 'farm-p1', district: '040201', place: { lat: -16.6247, lng: -72.7114, label: 'Camaná', source: 'DISTRITO' } });
    expect(other.ok).toBe(false);
  });
  it('nadie más ve el punto exacto: ni los compradores ni otros agricultores (RN-17)', () => {
    const w = fresh();
    expect(reg(w, 'u6', { lat: -15.6483, lng: -71.6608, label: 'Yanque', source: 'CCPP', ccpp: '0405190001' }).ok).toBe(true);
    expect(run(w, 'u-u6', 'FARM_ADD', { farmId: 'farm-u6', orgId: 'org-u6', name: 'Chacra Yanque', district: '040519', areaHa: 1, tenure: 'PROPIA', crops: [], place: { lat: -15.6483, lng: -71.6608, label: 'Yanque', source: 'CCPP', ccpp: '0405190001' } }).ok).toBe(true);
    const buyer: Viewer = { kind: 'user', userId: 'u-charo', orgId: 'org-geranios' };
    const owner: Viewer = { kind: 'user', userId: 'u-u6', orgId: 'org-u6' };
    const admin: Viewer = { kind: 'admin', userId: 'u-majo' };
    expect(maskWorld(w, buyer).orgs['org-u6'].location).toBeUndefined();
    expect(maskWorld(w, buyer).farms['farm-u6'].place).toBeUndefined();
    expect(maskWorld(w, buyer).orgs['org-u6'].district).toBe('040519');
    expect(maskWorld(w, owner).orgs['org-u6'].location?.label).toBe('Yanque');
    expect(maskWorld(w, owner).farms['farm-u6'].place?.label).toBe('Yanque');
    expect(maskWorld(w, admin).farms['farm-u6'].place?.lat).toBe(-15.6483);
  });
});
