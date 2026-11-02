import { describe, it, expect } from 'vitest';
import { seedWorld, applySafe, structuredCloneSafe } from '../src/engine/index';
import { SEED_ANCHOR } from '../src/seed';
import type { MEvent, World } from '../src/types';
import { rucWithCheck } from '../src/rules';
import { MIN, DAY } from '../src/time';
import { codeMatches, CODE_SALT, isSealed } from '../src/ids';
import { maskWorld, ANON, TEAM, relatedOrgs, type Viewer } from '../src/privacy';
import { WorldTracker, patchFor, applyPatch } from '../src/patch';

/** JSON con llaves ordenadas (para comparar mundos sin importar el orden de inserción). */
function canon(x: unknown): string {
  return JSON.stringify(x, (_k, v) => {
    if (v === Infinity) return '∞';
    if (v && typeof v === 'object' && !Array.isArray(v)) return Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]]));
    return v;
  });
}
const clone = <T>(x: T): T => structuredCloneSafe(x);

const RUC = rucWithCheck('2061234567');
const BUYER: Viewer = { kind: 'user', userId: 'u-real-b', orgId: 'org-real-b' };
const WILBER: Viewer = { kind: 'user', userId: 'u-wilber', orgId: 'org-wilber' };
const CHARO: Viewer = { kind: 'user', userId: 'u-charo', orgId: 'org-geranios' };
const ADMIN: Viewer = { kind: 'admin', userId: 'u-majo' };
const ANALYST: Viewer = { kind: 'admin', userId: 'u-ana', analyst: true };
const VIEWERS: [string, Viewer][] = [['anon', ANON], ['comprador real', BUYER], ['Wilber', WILBER], ['Charo', CHARO], ['panel', ADMIN], ['analista', ANALYST], ['equipo', TEAM]];

/** Un servidor y un celular por perfil: cada celular arranca con su copia y recibe solo cambios. */
function harness() {
  const w = clone(seedWorld());
  const tracker = new WorldTracker();
  tracker.reset(w);
  const phones = new Map<string, { v: Viewer; w: World; rel?: Set<string> }>();
  for (const [name, v] of VIEWERS) phones.set(name, { v, w: clone(maskWorld(w, v)), rel: v.kind === 'user' ? relatedOrgs(w, v.orgId) : undefined });
  let n = 0;
  const broadcast = (meta?: { id: string; type: string; actor: string; t: number }) => {
    const ch = tracker.diff(w);
    for (const ph of phones.values()) {
      const { patch, related } = patchFor(ch, w, ph.v, n, meta, ph.rel);
      ph.rel = related;
      applyPatch(ph.w, JSON.parse(JSON.stringify(patch, (_k, v) => (v === Infinity ? '__inf__' : v)), (_k, v) => (v === '__inf__' ? Infinity : v)));
    }
  };
  const act = (actor: string, type: string, p: any, dt = MIN) => {
    const e: MEvent = { id: `p-${++n}`, type, actor, t: w.now + dt, lamport: 0, p };
    const r = applySafe(w, e);
    w.rejected = {};
    if (!r.ok) return r;
    broadcast({ id: e.id, type, actor, t: e.t });
    return r;
  };
  /** cambio directo en el servidor (como lo haría el equipo al verificar una cuenta) */
  const poke = (fn: (w: World) => void) => { fn(w); n++; broadcast(); };
  /** cada celular quedó igual a lo que su perfil puede ver del mundo del servidor */
  const check = () => {
    for (const [name, ph] of phones) expect(canon(ph.w), `copia de ${name}`).toBe(canon(maskWorld(w, ph.v)));
  };
  return { w, phones, act, poke, check, phone: (name: string) => phones.get(name)!.w };
}

describe('privacidad por perfil y cambios por entidad', () => {
  it('cada celular recibe lo que su perfil puede ver, y nada más, también al aparecer una contraparte', () => {
    const h = harness();
    const reg = h.act('u-real-b', 'USER_REGISTER', { userId: 'u-real-b', orgId: 'org-real-b', role: 'BUYER', phone: '912345670', name: 'Rosa Prueba Real', dni: '41234560', org: { district: '040101', name: 'Picantería Prueba', ruc: RUC, address: 'Calle Secreta 123', receiver: 'Rosa', businessType: 'RESTAURANTE' } });
    expect(reg.ok, reg.error?.message).toBe(true);
    h.check();
    // nadie fuera de la cuenta ve su celular, DNI ni dirección
    for (const name of ['anon', 'Wilber', 'Charo']) {
      const u = h.phone(name).users['u-real-b'];
      expect(u.phone).not.toBe('912345670');
      expect(u.dni).toBeUndefined();
      expect(h.phone(name).orgs['org-real-b'].address).toBeUndefined();
      expect(h.phone(name).orgs['org-real-b'].name).toBe('Picantería Prueba'); // lo público sí
    }
    expect(h.phone('comprador real').users['u-real-b'].phone).toBe('912345670');
    expect(h.phone('panel').users['u-real-b'].dni).toBe('41234560');
    // avisos y auditoría: cada cuenta los suyos, el equipo todos
    expect(h.phone('anon').notifs).toEqual([]);
    expect(h.phone('anon').audit).toEqual([]);
    expect(h.phone('comprador real').notifs.every(n => n.to === 'org-real-b')).toBe(true);
    expect(h.phone('comprador real').notifs.length).toBeGreaterThan(0);
    expect(h.phone('panel').notifs.length).toBe(h.w.notifs.length);
    // quien es analista ve indicadores sin datos personales: ni celular ni DNI de las cuentas reales, ni la auditoría
    expect(h.phone('analista').users['u-real-b'].dni).toBeUndefined();
    expect(h.phone('analista').users['u-real-b'].phone).not.toBe('912345670');
    expect(h.phone('analista').audit).toEqual([]);
    expect(h.phone('analista').notifs.every(n => n.to === 'ADMIN')).toBe(true);
    expect(h.phone('panel').audit.length).toBeGreaterThan(0);

    // el equipo verifica el negocio (nivel 2) y pide a Wilber: desde ese momento Wilber ve sus datos de contacto
    h.poke(w => { w.orgs['org-real-b'].level = 2; });
    h.check();
    expect(h.phone('anon').orgs['org-real-b'].level).toBe(2);
    const place = h.act('u-real-b', 'ORDER_PLACE', { orderId: 'o-real', subs: [{ subOrderId: 'so-real', sellerOrgId: 'org-wilber', items: [{ listingId: 'l-w-papa', qty: 20 }], deliveryMode: 'FARMER', deliveryDate: SEED_ANCHOR + DAY, taxDoc: 'LIQUIDACION', payMethod: 'YAPE' }], address: 'Calle Secreta 123', district: '040101' });
    expect(place.ok, place.error?.message).toBe(true);
    h.check();
    expect(h.phone('Wilber').users['u-real-b'].phone).toBe('912345670');
    expect(h.phone('Wilber').orgs['org-real-b'].address).toBe('Calle Secreta 123');
    expect(h.phone('Wilber').subOrders['so-real'].address).toBe('Calle Secreta 123');
    expect(h.phone('Charo').subOrders['so-real'].address).toBe('');
    expect(h.phone('Charo').users['u-real-b'].phone).not.toBe('912345670');

    // el código de entrega: el comprador lo ve; Wilber solo su huella, que sirve para comprobarlo
    const code = h.w.subOrders['so-real'].deliveryCode;
    expect(h.phone('comprador real').subOrders['so-real'].deliveryCode).toBe(code);
    for (const name of ['Wilber', 'Charo', 'anon', 'panel']) expect(isSealed(h.phone(name).subOrders['so-real'].deliveryCode)).toBe(true);
    expect(codeMatches(h.phone('Wilber').subOrders['so-real'].deliveryCode, code, CODE_SALT.delivery('so-real'))).toBe(true);
    expect(codeMatches(h.phone('Wilber').subOrders['so-real'].deliveryCode, code === '0000' ? '1111' : '0000', CODE_SALT.delivery('so-real'))).toBe(false);
    // el QR de recojo lo conoce el agricultor
    expect(h.phone('Wilber').subOrders['so-real'].pickupQr).toBe(h.w.subOrders['so-real'].pickupQr);
    expect(isSealed(h.phone('comprador real').subOrders['so-real'].pickupQr)).toBe(true);

    // chat: solo las partes
    expect(h.act('u-real-b', 'MSG_SEND', { conv: 'so-real', msgId: 'm-real-1', text: 'Mi celular es 912345670' }).ok).toBe(true);
    expect(h.act('u-wilber', 'SUBORDER_ACCEPT', { subOrderId: 'so-real' }).ok).toBe(true);
    expect(h.act('u-wilber', 'SUBORDER_READY', { subOrderId: 'so-real' }).ok).toBe(true);
    h.check();
    expect(h.phone('Wilber').messages['so-real'].map(m => m.text)).toContain('Mi celular es 912345670');
    expect(h.phone('Charo').messages['so-real']).toEqual([]);
    expect(h.phone('anon').messages['so-real']).toEqual([]);

    // Wilber entrega: en su celular (con la huella) un código equivocado se rechaza al instante y el correcto pasa
    const wil = h.phone('Wilber');
    const wrong = applySafe(clone(wil), { id: 'x1', type: 'SUBORDER_DELIVER', actor: 'u-wilber', t: wil.now + MIN, lamport: 0, p: { subOrderId: 'so-real', code: code === '0000' ? '1111' : '0000' } });
    expect(wrong.ok).toBe(false);
    expect(wrong.error?.code).toBe('BAD_CODE');
    const right = applySafe(clone(wil), { id: 'x2', type: 'SUBORDER_DELIVER', actor: 'u-wilber', t: wil.now + MIN, lamport: 0, p: { subOrderId: 'so-real', code } });
    expect(right.ok, right.error?.message).toBe(true);
    expect(h.act('u-wilber', 'SUBORDER_DELIVER', { subOrderId: 'so-real', code }).ok).toBe(true);
    h.check();
    expect(h.phone('comprador real').subOrders['so-real'].status).toBe('DELIVERED');
    expect(h.phone('anon').subOrders['so-real'].status).toBe('DELIVERED'); // los estados y montos sí son de todos (calificaciones, totales)
  });

  it('las cuentas y la historia de ejemplo se ven completas (se entra con ellas desde «Ver cuentas de prueba»)', () => {
    const w = seedWorld();
    const anon = maskWorld(w, ANON);
    expect(anon.users['u-wilber'].phone).toBe(w.users['u-wilber'].phone);
    expect(anon.orgs['org-geranios'].address).toBe(w.orgs['org-geranios'].address);
    expect(Object.keys(anon.subOrders)).toEqual(Object.keys(w.subOrders));
    // pero los códigos y los avisos de cada cuenta no
    expect(Object.values(anon.subOrders).every(s => isSealed(s.deliveryCode))).toBe(true);
    expect(anon.notifs).toEqual([]);
    expect(maskWorld(w, TEAM)).toBe(w);
  });
});
