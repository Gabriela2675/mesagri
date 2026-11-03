/*
 * Identidad: dígito de verificación del DNI, nombre como en RENIEC, lectura del código del reverso
 * del DNI (MRZ), ángulos del rostro y el expediente con su revisión automática.
 */
import { describe, it, expect } from 'vitest';
import { seedWorld, applySafe, structuredCloneSafe } from '../src/engine/index';
import type { World } from '../src/types';
import { MIN } from '../src/time';
import { dniCheck, dniDigitOk, compareNames, mrzDigit, parseMrz, mrzDate, ageOn, poseOk, facesConsistent, identityAlerts, registryFor, testDni, ID_ALERTS, faceMatchLevel } from '../src/identity';
import { maskWorld } from '../src/privacy';

let n = 0;
const fresh = () => structuredCloneSafe(seedWorld());
const run = (w: World, actor: string, type: string, p: any) => applySafe(w, { id: `id-${++n}`, type, actor, t: w.now + MIN, lamport: 0, p });

/** Las 3 líneas del código del reverso para una persona de prueba (con sus dígitos de control). */
function mrzFor(p: { dni: string; ninth?: string; birth: string; sex: string; expiry: string; surnames: string[]; given: string[] }) {
  const doc = p.dni + (p.ninth ?? '<');
  const l1 = ('I<PER' + doc + mrzDigit(doc)).padEnd(30, '<');
  const b = p.birth + mrzDigit(p.birth), e = p.expiry + mrzDigit(p.expiry);
  const opt2 = '<'.repeat(11);
  const l2 = b + p.sex + e + 'PER' + opt2 + mrzDigit(l1.slice(5, 30) + b + e + opt2);
  const l3 = (p.surnames.join('<') + '<<' + p.given.join('<')).padEnd(30, '<').slice(0, 30);
  return [l1, l2, l3];
}
const TEODORA = { dni: '41235876', birth: '840512', sex: 'F', expiry: '310820', surnames: ['QUISPE', 'MAMANI'], given: ['TEODORA'] };

describe('DNI y nombre', () => {
  it('el dígito de verificación sale del número (y se acepta la letra equivalente)', () => {
    for (const dni of ['41235876', '45218736', '00000001', '99999999']) {
      const c = dniCheck(dni)!;
      expect(c.num).toMatch(/^\d$/);
      expect(dniDigitOk(dni, c.num)).toBe(true);
      expect(dniDigitOk(dni, c.letter)).toBe(true);
      expect(dniDigitOk(dni, String((Number(c.num) + 1) % 10))).toBe(false);
    }
    expect(dniCheck('1234567')).toBeNull();
    expect(dniDigitOk('41235876', '')).toBeNull();
  });

  it('compara el nombre sin importar el orden, las tildes ni una letra mal escrita', () => {
    const o = { surnames: 'QUISPE MAMANI', given: 'TEODORA' };
    expect(compareNames('Teodora Quispe Mamani', o).status).toBe('MATCH');
    expect(compareNames('QUISPE MAMANI, Teodora', o).status).toBe('MATCH');
    expect(compareNames('Teodora Quispe Mamany', o).status).toBe('MATCH');
    expect(compareNames('Teodora Quispe', o).status).toBe('PARTIAL');
    expect(compareNames('Teodora Quispe Mamani Ruiz', o).status).toBe('MISMATCH');
    expect(compareNames('Juana Pérez Rojas', o).status).toBe('MISMATCH');
    expect(compareNames('Rubén Darío Huamaní Condori', { surnames: 'HUAMANI CONDORI', given: 'RUBEN DARIO' }).status).toBe('MATCH');
    expect(compareNames('José Peña de la Cruz', { surnames: 'PEÑA DE LA CRUZ', given: 'JOSE' }).status).toBe('MATCH');
  });

  it('el padrón de prueba responde sin inventar: coincide, no coincide, fallecido o no figura', () => {
    expect(registryFor(testDni('41235876'), '41235876', 'Teodora Quispe Mamani', dniCheck('41235876')!.num, 1, 'PADRON_PRUEBA')).toMatchObject({ status: 'MATCH', digitOk: true, deceased: false });
    expect(registryFor(testDni('41235876'), '41235876', 'Rosa Quispe Mamani', undefined, 1, 'PADRON_PRUEBA').status).toBe('NAME_MISMATCH');
    expect(registryFor(testDni('40817263'), '40817263', 'Mario Ccapa Huamaní', undefined, 1, 'PADRON_PRUEBA')).toMatchObject({ status: 'DECEASED', deceased: true });
    expect(registryFor(undefined, '12345678', 'Ana Ruiz', undefined, 1, 'PADRON_PRUEBA')).toMatchObject({ status: 'NOT_FOUND', deceased: null });
  });
});

describe('código del reverso del DNI (MRZ)', () => {
  it('lee número, nombres, fechas y sexo con todos los dígitos de control', () => {
    const r = parseMrz(mrzFor(TEODORA).join('\n'))!;
    expect(r).toMatchObject({ dni: '41235876', ninth: '', birth: '840512', sex: 'F', expiry: '310820', nationality: 'PER', surnames: ['QUISPE', 'MAMANI'], given: ['TEODORA'], ok: true });
    expect(mrzDate(r.birth, 'birth', Date.parse('2026-11-03'))).toBe('1984-05-12');
    expect(mrzDate(r.expiry, 'expiry')).toBe('2031-08-20');
    expect(ageOn('1984-05-12', Date.parse('2026-11-03'))).toBe(42);
    expect(ageOn('2010-11-04', Date.parse('2026-11-03'))).toBe(15);
  });

  it('corrige las confusiones de una foto (O por 0, « por <, espacios) y el número con su dígito al final', () => {
    const [l1, l2, l3] = mrzFor({ ...TEODORA, ninth: dniCheck('41235876')!.num });
    const noisy = ['ruido de arriba', l1.replace('4123', 'A1Z3').replace(/<<<</, '« <<'), l2.replace('8405', '84O5'), l3.replace('QUISPE', 'QUI5PE'), ''].join('\n');
    const r = parseMrz(noisy)!;
    expect(r.ok).toBe(true);
    expect(r.dni).toBe('41235876');
    expect(r.ninth).toBe(dniCheck('41235876')!.num);
    expect(r.surnames).toEqual(['QUISPE', 'MAMANI']);
  });

  it('la Ñ va como NXX; un dígito de control que no cuadra se nota', () => {
    const r = parseMrz(mrzFor({ ...TEODORA, surnames: ['PENXXA', 'ROJAS'], given: ['ANA'] }).join('\n'))!;
    expect(r.surnames).toEqual(['PEÑA', 'ROJAS']);
    const [l1, l2, l3] = mrzFor(TEODORA);
    const bad = parseMrz([l1.replace('41235876', '41235877'), l2, l3].join('\n'))!;
    expect(bad.docOk).toBe(false);
    expect(bad.ok).toBe(false);
    expect(parseMrz('nada que leer')).toBeNull();
  });
});

describe('rostro en tres ángulos', () => {
  it('de frente hasta 12°, girado desde 18°; con la cámara en vivo se sabe el lado', () => {
    expect(poseOk('FRONT', 4, true)).toBe(true);
    expect(poseOk('FRONT', 20, true)).toBe(false);
    expect(poseOk('LEFT', 30, true)).toBe(true);
    expect(poseOk('LEFT', -30, true)).toBe(false);
    expect(poseOk('RIGHT', -30, true)).toBe(true);
    expect(poseOk('RIGHT', 30, false)).toBe(true);
    expect(poseOk('RIGHT', 10, false)).toBe(false);
    expect(poseOk('RIGHT', undefined, true)).toBe(false);
    const f = (pose: any, yaw: number, ok = true) => ({ pose, auto: { ok, faces: 1, yaw } });
    expect(facesConsistent([f('FRONT', 2), f('RIGHT', -28), f('LEFT', 31)])).toBe(true);
    expect(facesConsistent([f('FRONT', 2), f('RIGHT', 28), f('LEFT', 31)])).toBe(false);
    expect(facesConsistent([f('FRONT', 2), f('RIGHT', -28)])).toBe(false);
    expect(faceMatchLevel(0.3)).toBe('ALTA');
    expect(faceMatchLevel(0.7)).toBe('BAJA');
  });
});

describe('expediente con identidad', () => {
  const faces = [
    { pose: 'FRONT', photoId: 'ph-f1', live: true, auto: { ok: true, faces: 1, yaw: 3, light: 140, sharp: 30 } },
    { pose: 'RIGHT', photoId: 'ph-f2', live: true, auto: { ok: true, faces: 1, yaw: -27 } },
    { pose: 'LEFT', photoId: 'ph-f3', live: true, auto: { ok: true, faces: 1, yaw: 29 } },
  ];
  const identity = { dni: '41235876', digit: dniCheck('41235876')!.num, name: 'Teodora Quispe Mamani', dniFront: 'ph-d1', dniBack: 'ph-d2', faces };

  function newFarmer(w: World) {
    expect(run(w, 'u-teo', 'USER_REGISTER', { userId: 'u-teo', orgId: 'org-teo', role: 'FARMER', phone: '987111222', name: 'Teodora Quispe Mamani', dni: '41235876', lang: 'es', org: { district: '040519', name: 'Teodora Quispe Mamani' } }).ok).toBe(true);
  }

  it('las fotos van como evidencias, la consulta del DNI la pone el servidor y la revisión el panel', () => {
    const w = fresh();
    newFarmer(w);
    const r = run(w, 'u-teo', 'VERIF_SUBMIT', { caseId: 'case-teo', orgId: 'org-teo', targetLevel: 1, identity, evidence: [{ key: 'selfie', label: 'Selfie vieja', photoId: 'ph-x' }, { key: 'cobro', label: 'Yape propio' }] });
    expect(r.ok, r.error?.message).toBe(true);
    const k = w.cases['case-teo'];
    expect(k.identity).toMatchObject({ dni: '41235876', name: 'Teodora Quispe Mamani', dniFront: 'ph-d1' });
    expect(k.evidence.map(e => e.key)).toEqual(['dni', 'dni2', 'rostro', 'rostro-der', 'rostro-izq', 'cobro']);
    expect(k.alerts.filter(a => Object.values(ID_ALERTS).includes(a))).toEqual([]);
    // la consulta solo la registra el servidor
    expect(run(w, 'u-teo', 'VERIF_IDCHECK', { caseId: 'case-teo', dni: '41235876', registry: { status: 'MATCH', source: 'PROVEEDOR' } }).error?.code).toBe('FORBIDDEN');
    expect(run(w, 'system', 'VERIF_IDCHECK', { caseId: 'case-teo', dni: '99999999', registry: { status: 'MATCH', source: 'PROVEEDOR' } }).error?.code).toBe('STALE');
    expect(run(w, 'system', 'VERIF_IDCHECK', { caseId: 'case-teo', dni: '41235876', registry: { status: 'NAME_MISMATCH', source: 'PROVEEDOR', officialName: 'TEODORA QUISPE MAMANI', score: 0.4, digitOk: true, deceased: null } }).ok).toBe(true);
    expect(k.identity!.registry).toMatchObject({ status: 'NAME_MISMATCH', source: 'PROVEEDOR', officialName: 'TEODORA QUISPE MAMANI', deceased: null });
    expect(k.alerts).toContain(ID_ALERTS.name);
    expect(run(w, 'system', 'VERIF_IDCHECK', { caseId: 'case-teo', dni: '41235876', registry: { status: 'MATCH', source: 'PROVEEDOR', officialName: 'TEODORA QUISPE MAMANI', deceased: false } }).ok).toBe(true);
    expect(k.alerts).not.toContain(ID_ALERTS.name);
    // el panel guarda lo que leyó: el DNI de la foto venció y el rostro no se parece
    expect(run(w, 'u-teo', 'VERIF_AUTOCHECK', { caseId: 'case-teo', review: {} }).error?.code).toBe('FORBIDDEN');
    const review = { mrz: { read: true, checks: true, dni: '41235876', surnames: 'QUISPE MAMANI', given: 'TEODORA', birth: '840512', expiry: '240820', sex: 'F' }, frontDni: true, faceMatch: { distance: 0.71 } };
    expect(run(w, 'u-lucia', 'VERIF_AUTOCHECK', { caseId: 'case-teo', review }).ok).toBe(true);
    expect(k.identity!.review).toMatchObject({ by: 'u-lucia', frontDni: true, faceMatch: { level: 'BAJA' } });
    expect(k.alerts).toEqual(expect.arrayContaining([ID_ALERTS.expired, ID_ALERTS.faceMatch]));
    expect(w.audit.at(-1)).toMatchObject({ actor: 'u-lucia', action: 'REVISIÓN AUTOMÁTICA DE IDENTIDAD' });
    // la persona ve su expediente sin el nombre oficial; los demás no ven su identidad; el equipo, todo
    const mine = maskWorld(w, { kind: 'user', userId: 'u-teo', orgId: 'org-teo' }).cases['case-teo'];
    expect(mine.identity?.registry?.status).toBe('MATCH');
    expect(mine.identity?.registry?.officialName).toBeUndefined();
    expect(maskWorld(w, { kind: 'user', userId: 'u-wilber', orgId: 'org-wilber' }).cases['case-teo'].identity).toBeUndefined();
    expect(maskWorld(w, { kind: 'anon' }).cases['case-teo'].identity).toBeUndefined();
    expect(maskWorld(w, { kind: 'admin', userId: 'u-ana', analyst: true }).cases['case-teo'].identity).toBeUndefined();
    expect(maskWorld(w, { kind: 'admin', userId: 'u-lucia' }).cases['case-teo'].identity?.registry?.officialName).toBe('TEODORA QUISPE MAMANI');
  });

  it('marca lo que no cuadra: dígito, fotos del rostro y DNI distinto al de la cuenta', () => {
    const w = fresh();
    newFarmer(w);
    const bad = { ...identity, dni: '41235877', digit: '0', faces: [faces[0], { ...faces[1], auto: { ok: true, faces: 1, yaw: 28 } }, faces[2]] };
    const r = run(w, 'u-teo', 'VERIF_SUBMIT', { caseId: 'case-teo2', orgId: 'org-teo', targetLevel: 1, identity: bad });
    expect(r.ok, r.error?.message).toBe(true);
    const alerts = w.cases['case-teo2'].alerts;
    expect(alerts).toEqual(expect.arrayContaining([ID_ALERTS.faces, ID_ALERTS.account]));
    expect(alerts.includes(ID_ALERTS.digit)).toBe(dniDigitOk('41235877', '0') === false);
    expect(run(w, 'u-teo', 'VERIF_SUBMIT', { caseId: 'case-x', orgId: 'org-teo', targetLevel: 2, identity: { ...identity, dni: '123' } }).error?.code).toBe('BAD_DNI');
    expect(run(w, 'u-teo', 'VERIF_SUBMIT', { caseId: 'case-x', orgId: 'org-teo', targetLevel: 2, identity: { ...identity, name: 'Teo' } }).error?.code).toBe('BAD_NAME');
  });

  it('al responder lo que falta, la identidad nueva reemplaza a la anterior', () => {
    const w = fresh();
    newFarmer(w);
    expect(run(w, 'u-teo', 'VERIF_SUBMIT', { caseId: 'case-teo3', orgId: 'org-teo', targetLevel: 1, identity: { ...identity, faces: [faces[0]] } }).ok).toBe(true);
    expect(w.cases['case-teo3'].alerts).toContain(ID_ALERTS.faces);
    expect(run(w, 'u-lucia', 'VERIF_DECIDE', { caseId: 'case-teo3', result: 'NEEDS_INFO', reason: 'Faltan las fotos de tu rostro girando a cada lado.' }).ok).toBe(true);
    expect(run(w, 'u-teo', 'VERIF_RESPOND', { caseId: 'case-teo3', identity, text: 'Mandé las tres fotos' }).ok).toBe(true);
    const k = w.cases['case-teo3'];
    expect(k.identity!.faces.length).toBe(3);
    expect(k.evidence.filter(e => e.key.startsWith('rostro')).length).toBe(3);
    expect(k.alerts).not.toContain(ID_ALERTS.faces);
    expect(identityAlerts(k.identity!, w.now, '41235876')).toEqual([]);
  });
});
