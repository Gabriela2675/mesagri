/*
 * Equipo de Mesagri: la administración general crea las cuentas del panel y decide el rol de cada
 * persona; cada persona personaliza sus datos.
 */
import { describe, it, expect } from 'vitest';
import { seedWorld, applySafe, structuredCloneSafe } from '../src/engine/index';
import type { World } from '../src/types';
import { MIN } from '../src/time';
import { passwordProblem } from '../src/rules';

let n = 0;
const fresh = () => structuredCloneSafe(seedWorld());
const run = (w: World, actor: string, type: string, p: any) => applySafe(w, { id: `tm-${++n}`, type, actor, t: w.now + MIN, lamport: 0, p });

describe('equipo de Mesagri', () => {
  it('la administración general es el equipo del proyecto', () => {
    const w = seedWorld();
    const generals = Object.values(w.users).filter(u => u.role === 'ADMIN' && u.adminRole === 'GENERAL').map(u => u.name).sort();
    expect(generals).toEqual(['Dayis', 'Gaby', 'Kevin', 'Majo']);
    expect(w.orgs['org-mesagri'].memberIds).toEqual(expect.arrayContaining(['u-majo', 'u-gaby', 'u-dayis', 'u-kevin']));
  });

  it('solo la administración general agrega personas, con datos válidos y sin repetir', () => {
    const w = fresh();
    const p = { userId: 'u-rosa-equipo', name: 'Rosa Quispe', email: 'Rosa@Mesagri.pe', phone: '900000010', adminRole: 'SUPPORT' };
    expect(run(w, 'u-lucia', 'STAFF_ADD', p).error?.code).toBe('FORBIDDEN');
    expect(run(w, 'u-majo', 'STAFF_ADD', { ...p, name: 'Rosa' }).error?.code).toBe('BAD_NAME');
    expect(run(w, 'u-majo', 'STAFF_ADD', { ...p, email: 'gaby@mesagri.pe' }).error?.code).toBe('EMAIL_TAKEN');
    expect(run(w, 'u-majo', 'STAFF_ADD', { ...p, phone: '900000002' }).error?.code).toBe('PHONE_TAKEN');
    expect(run(w, 'u-majo', 'STAFF_ADD', { ...p, adminRole: 'DUEÑO' }).error?.code).toBe('BAD_ROLE');
    const r = run(w, 'u-majo', 'STAFF_ADD', p);
    expect(r.ok, r.error?.message).toBe(true);
    const u = w.users['u-rosa-equipo'];
    expect(u).toMatchObject({ role: 'ADMIN', adminRole: 'SUPPORT', email: 'rosa@mesagri.pe', status: 'ACTIVE', orgId: 'org-mesagri' });
    expect(w.orgs['org-mesagri'].memberIds).toContain('u-rosa-equipo');
    expect(w.audit.at(-1)).toMatchObject({ actor: 'u-majo', action: 'EQUIPO: NUEVA CUENTA', entity: 'u-rosa-equipo' });
    // ya puede atender con su rol (soporte), pero no hacer lo de la administración general
    expect(run(w, 'u-rosa-equipo', 'STAFF_ADD', { ...p, userId: 'u-otro-equipo', email: 'otro@mesagri.pe', phone: '900000011' }).error?.code).toBe('FORBIDDEN');
  });

  it('cambia roles y pausa accesos, sin quedarse sin administración general', () => {
    const w = fresh();
    expect(run(w, 'u-majo', 'STAFF_ROLE_SET', { userId: 'u-ana', adminRole: 'SUPPORT' }).ok).toBe(true);
    expect(w.users['u-ana'].adminRole).toBe('SUPPORT');
    expect(run(w, 'u-majo', 'STAFF_ROLE_SET', { userId: 'u-ana', adminRole: 'SUPPORT' }).error?.code).toBe('SAME');
    expect(run(w, 'u-majo', 'STAFF_ROLE_SET', { userId: 'u-wilber', adminRole: 'SUPPORT' }).error?.code).toBe('NOT_TEAM');
    // nadie puede pausarse a sí mismo
    expect(run(w, 'u-majo', 'STAFF_STATUS_SET', { userId: 'u-majo', active: false }).error?.code).toBe('SELF');
    // Gaby pausa a Diana: Diana ya no puede actuar
    expect(run(w, 'u-gaby', 'STAFF_STATUS_SET', { userId: 'u-diana', active: false }).ok).toBe(true);
    const blocked = run(w, 'u-diana', 'TICKET_REPLY', { ticketId: 'x', text: 'hola' });
    expect(blocked.error?.code).toBe('SUSPENDED');
    expect(blocked.error?.message).toMatch(/pausó tu acceso al panel/);
    expect(run(w, 'u-gaby', 'STAFF_STATUS_SET', { userId: 'u-diana', active: true }).ok).toBe(true);
    // tres de los cuatro pasan a otro rol: la última administración general no puede dejar de serlo
    for (const id of ['u-gaby', 'u-dayis', 'u-kevin']) expect(run(w, 'u-majo', 'STAFF_ROLE_SET', { userId: id, adminRole: 'VERIFIER' }).ok).toBe(true);
    expect(run(w, 'u-majo', 'STAFF_ROLE_SET', { userId: 'u-majo', adminRole: 'ANALYST' }).error?.code).toBe('LAST_GENERAL');
    expect(w.audit.filter(a => a.action === 'EQUIPO: ROL').length).toBe(4);
  });

  it('cada persona personaliza sus datos; en la app el nombre completo es el del DNI', () => {
    const w = fresh();
    const r = run(w, 'u-gaby', 'PROFILE_SET', { name: 'Gabriela Moreno', shortName: 'Gaby', email: 'gaby.moreno@mesagri.pe', phone: '900000020' });
    expect(r.ok, r.error?.message).toBe(true);
    expect(w.users['u-gaby']).toMatchObject({ name: 'Gabriela Moreno', email: 'gaby.moreno@mesagri.pe', phone: '900000020' });
    expect(w.audit.at(-1)).toMatchObject({ action: 'EQUIPO: MIS DATOS', actor: 'u-gaby' });
    expect(run(w, 'u-gaby', 'PROFILE_SET', { name: 'Gabriela Moreno' }).error?.code).toBe('SAME');
    expect(run(w, 'u-kevin', 'PROFILE_SET', { email: 'gaby.moreno@mesagri.pe' }).error?.code).toBe('EMAIL_TAKEN');
    expect(run(w, 'u-kevin', 'PROFILE_SET', { name: 'K3vin <script>' }).error?.code).toBe('BAD_NAME');
    // en la app: cómo lo llamamos sí; el nombre del DNI y el celular, con Soporte
    expect(run(w, 'u-wilber', 'PROFILE_SET', { shortName: "Don Wilber" }).ok).toBe(true);
    expect(w.users['u-wilber'].shortName).toBe('Don Wilber');
    expect(run(w, 'u-wilber', 'PROFILE_SET', { name: 'Otro Nombre' }).error?.code).toBe('NAME_LOCKED');
    expect(run(w, 'u-wilber', 'PROFILE_SET', { phone: '911111111' }).error?.code).toBe('PHONE_LOCKED');
    expect(run(w, 'u-wilber', 'PROFILE_SET', { shortName: 'W' }).error?.code).toBe('BAD_NAME');
  });

  it('el agricultor cambia las fotos de su publicación (hasta 5, la primera es la portada)', () => {
    const w = fresh();
    expect(run(w, 'u-wilber', 'LISTING_EDIT', { listingId: 'l-w-papa', photoIds: ['ph-cam-a1', 'ph-gal-b2'] }).ok).toBe(true);
    expect(w.listings['l-w-papa'].photoIds).toEqual(['ph-cam-a1', 'ph-gal-b2']);
    expect(run(w, 'u-wilber', 'LISTING_EDIT', { listingId: 'l-w-papa', photoIds: ['a1', 'b2', 'c3', 'd4', 'e5', 'f6'] }).error?.code).toBe('BAD_PHOTOS');
    expect(run(w, 'u-wilber', 'LISTING_EDIT', { listingId: 'l-w-papa', photoIds: ['<script>'] }).error?.code).toBe('BAD_PHOTOS');
    expect(run(w, 'u-charo', 'LISTING_EDIT', { listingId: 'l-w-papa', photoIds: [] }).ok).toBe(false);
  });

  it('contraseñas del panel: largas y con letras y números', () => {
    expect(passwordProblem('corta1')).toMatch(/10 caracteres/);
    expect(passwordProblem('solamenteletras')).toMatch(/letras y números/);
    expect(passwordProblem('1234567890')).toMatch(/letras y números/);
    expect(passwordProblem('chacra-2026-mesagri')).toBe('');
  });
});
