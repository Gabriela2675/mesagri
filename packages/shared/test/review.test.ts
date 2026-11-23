import { describe, it, expect } from 'vitest';
import { seedWorld, applySafe, structuredCloneSafe } from '../src/engine/index';
import type { MEvent, World } from '../src/types';
import { MIN } from '../src/time';
import { visibleListing } from '../src/queries';
import { rulesReview, mergeReviews, photosUsedElsewhere, VERDICT_LABEL } from '../src/review';
import { maskWorld, type Viewer } from '../src/privacy';

let n = 0;
const fresh = () => structuredCloneSafe(seedWorld());
const run = (w: World, actor: string, type: string, p: any) => applySafe(w, { id: `rv-${++n}`, type, actor, t: w.now + MIN, lamport: 0, p } as MEvent);
const publish = (w: World, id: string, extra: any = {}) => run(w, 'u-wilber', 'LISTING_PUBLISH', {
  orgId: 'org-wilber', listingId: id, productId: 'papa_amarilla', unit: 'kg', unitKg: 1, qty: 120, price: 2.7, harvestDate: w.now, quality: 'PRIMERA',
  farmId: 'farm-wilber', photoIds: ['ph-cam-' + id], harvestSeal: true, ...extra,
});

describe('revisión de cada publicación antes de verse', () => {
  it('la publicación nueva queda en revisión, no la ven los compradores y avisa al equipo y al agricultor', () => {
    const w = fresh();
    const r = publish(w, 'l-rv1');
    expect(r.ok).toBe(true);
    expect(r.result).toMatchObject({ status: 'IN_REVIEW', verdict: 'OK' });
    const l = w.listings['l-rv1'];
    expect(l.status).toBe('IN_REVIEW');
    expect(visibleListing(w, l, w.now)).toBe(false);
    expect(l.review).toMatchObject({ cause: 'NUEVA', auto: { by: 'REGLAS', verdict: 'OK' } });
    expect(l.review!.ai).toBeUndefined();
    const notes = w.notifs.slice(-2);
    expect(notes.map(x => [x.to, x.title])).toEqual([['ADMIN', 'Publicación para revisar'], ['org-wilber', 'Tu publicación está en revisión']]);
  });

  it('el equipo la aprueba y recién se publica; un comprador o el agricultor no pueden aprobarla', () => {
    const w = fresh();
    publish(w, 'l-rv2');
    expect(run(w, 'u-wilber', 'LISTING_MODERATE', { listingId: 'l-rv2', decision: 'APPROVE' }).ok).toBe(false);
    expect(run(w, 'u-charo', 'LISTING_MODERATE', { listingId: 'l-rv2', decision: 'APPROVE' }).ok).toBe(false);
    expect(run(w, 'u-ana', 'LISTING_MODERATE', { listingId: 'l-rv2', decision: 'APPROVE' }).error?.code).toBe('FORBIDDEN');
    expect(run(w, 'u-lucia', 'LISTING_MODERATE', { listingId: 'l-rv2', decision: 'APPROVE' }).ok).toBe(true);
    const l = w.listings['l-rv2'];
    expect(l.status).toBe('ACTIVE');
    expect(visibleListing(w, l, w.now)).toBe(true);
    expect(l.review).toMatchObject({ approvedBy: 'u-lucia' });
    expect(w.notifs.at(-1)).toMatchObject({ to: 'org-wilber', title: '¡Tu publicación ya está publicada!' });
    expect(w.audit.at(-1)).toMatchObject({ action: 'MODERACIÓN', before: 'IN_REVIEW', after: 'ACTIVE' });
  });

  it('pedir cambios: el agricultor corrige, la envía otra vez y vuelve a la cola', () => {
    const w = fresh();
    publish(w, 'l-rv3', { photoIds: [] });
    expect(w.listings['l-rv3'].review!.auto.verdict).toBe('RECHAZAR');
    expect(run(w, 'u-lucia', 'LISTING_MODERATE', { listingId: 'l-rv3', decision: 'PAUSE', reason: 'Pon una foto de tu papa.' }).ok).toBe(true);
    expect(w.listings['l-rv3']).toMatchObject({ status: 'PAUSED', reviewReason: 'Pon una foto de tu papa.', review: { changesRequested: true } });
    expect(w.notifs.at(-1)).toMatchObject({ to: 'org-wilber', title: 'Corrige tu publicación' });
    expect(run(w, 'u-wilber', 'LISTING_EDIT', { listingId: 'l-rv3', photoIds: ['ph-cam-nueva'] }).ok).toBe(true);
    expect(w.listings['l-rv3'].status).toBe('PAUSED');
    const back = run(w, 'u-wilber', 'LISTING_RESUME', { listingId: 'l-rv3' });
    expect(back.result).toMatchObject({ status: 'IN_REVIEW', review: true });
    expect(w.listings['l-rv3'].review).toMatchObject({ cause: 'CORRECCION', auto: { verdict: 'OK' } });
    expect(w.listings['l-rv3'].reviewReason).toBeUndefined();
    expect(run(w, 'u-majo', 'LISTING_MODERATE', { listingId: 'l-rv3', decision: 'APPROVE' }).ok).toBe(true);
    expect(w.listings['l-rv3'].status).toBe('ACTIVE');
  });

  it('rechazada no se publica ni se puede reactivar', () => {
    const w = fresh();
    publish(w, 'l-rv4');
    expect(run(w, 'u-diana', 'LISTING_MODERATE', { listingId: 'l-rv4', decision: 'REJECT', reason: 'La foto es de internet' }).ok).toBe(true);
    expect(w.listings['l-rv4'].status).toBe('REJECTED');
    expect(run(w, 'u-wilber', 'LISTING_RESUME', { listingId: 'l-rv4' }).error?.code).toBe('STATE');
    expect(w.notifs.at(-1)).toMatchObject({ title: 'No pudimos publicar tu cosecha' });
  });

  it('una publicación ya aprobada vuelve a revisión si cambian las fotos o el precio sale de rango; si no, sigue activa', () => {
    const w = fresh();
    publish(w, 'l-rv5');
    run(w, 'u-lucia', 'LISTING_MODERATE', { listingId: 'l-rv5', decision: 'APPROVE' });
    expect(run(w, 'u-wilber', 'LISTING_EDIT', { listingId: 'l-rv5', price: 2.9 }).result).toMatchObject({ status: 'ACTIVE' });
    expect(run(w, 'u-wilber', 'LISTING_EDIT', { listingId: 'l-rv5', addQty: 30 }).result).toMatchObject({ status: 'ACTIVE' });
    const photos = run(w, 'u-wilber', 'LISTING_EDIT', { listingId: 'l-rv5', photoIds: ['ph-gal-otra'] });
    expect(photos.result).toMatchObject({ status: 'IN_REVIEW', review: true });
    expect(w.listings['l-rv5'].review).toMatchObject({ cause: 'CAMBIO', approvedBy: 'u-lucia' });
    run(w, 'u-lucia', 'LISTING_MODERATE', { listingId: 'l-rv5', decision: 'APPROVE' });
    const price = run(w, 'u-wilber', 'LISTING_EDIT', { listingId: 'l-rv5', price: 9, confirmPrice: true });
    expect(price.result).toMatchObject({ status: 'IN_REVIEW' });
    // pausada por el propio agricultor (ya aprobada): al activarla no vuelve a revisión
    run(w, 'u-lucia', 'LISTING_MODERATE', { listingId: 'l-rv5', decision: 'APPROVE' });
    run(w, 'u-wilber', 'LISTING_PAUSE', { listingId: 'l-rv5' });
    expect(run(w, 'u-wilber', 'LISTING_RESUME', { listingId: 'l-rv5' }).result).toMatchObject({ status: 'ACTIVE' });
  });

  it('la IA solo la anota el servidor, para la versión que se revisó', () => {
    const w = fresh();
    publish(w, 'l-rv6');
    const q = w.listings['l-rv6'].review!.queuedAt;
    expect(run(w, 'u-majo', 'LISTING_AI_REVIEW', { listingId: 'l-rv6', queuedAt: q, state: 'PENDIENTE' }).error?.code).toBe('FORBIDDEN');
    expect(run(w, 'system', 'LISTING_AI_REVIEW', { listingId: 'l-rv6', queuedAt: q, state: 'PENDIENTE' }).ok).toBe(true);
    expect(w.listings['l-rv6'].review!.ai).toBe('PENDIENTE');
    const auto = {
      model: 'claude-haiku-5-5', verdict: 'RECHAZAR', score: 22, summary: 'La foto muestra camotes, no papa amarilla.', farmerMessage: 'Pon una foto de tu papa amarilla.',
      checks: [{ key: 'foto1', label: 'Foto 1', ok: false, detail: 'Camotes en una caja' }, { key: 'precio', label: 'Precio', ok: null, detail: 'Precio normal.' }],
    };
    expect(run(w, 'system', 'LISTING_AI_REVIEW', { listingId: 'l-rv6', queuedAt: q - 1, state: 'LISTA', auto }).result).toMatchObject({ stale: true });
    const r = run(w, 'system', 'LISTING_AI_REVIEW', { listingId: 'l-rv6', queuedAt: q, state: 'LISTA', auto });
    expect(r.result).toMatchObject({ verdict: 'RECHAZAR' });
    const rv = w.listings['l-rv6'].review!;
    expect(rv).toMatchObject({ ai: 'LISTA', auto: { by: 'IA', model: 'claude-haiku-5-5', verdict: 'RECHAZAR', score: 22, farmerMessage: 'Pon una foto de tu papa amarilla.' } });
    expect(rv.auto.checks.map(c => c.key)).toEqual(['precio', 'cantidad', 'fotos', 'cosecha', 'agricultor', 'foto1']);
    // el precio y la cantidad siguen siendo de las reglas; la frase de la IA se suma
    expect(rv.auto.checks.find(c => c.key === 'precio')).toMatchObject({ ok: true });
    expect(rv.auto.checks.find(c => c.key === 'precio')!.detail).toContain('IA: Precio normal.');
    expect(w.listings['l-rv6'].status).toBe('IN_REVIEW');
    expect(w.notifs.at(-1)).toMatchObject({ to: 'ADMIN', title: 'La IA no cree que esta publicación sea verídica' });
    expect(run(w, 'system', 'LISTING_AI_REVIEW', { listingId: 'l-rv6', queuedAt: q, state: 'ERROR', note: 'HTTP 500' }).ok).toBe(true);
    expect(w.listings['l-rv6'].review).toMatchObject({ ai: 'ERROR', aiNote: 'HTTP 500' });
  });

  it('las reglas marcan precio imposible, falta de fotos, fotos repetidas y de galería', () => {
    const w = fresh();
    publish(w, 'l-rv7', { price: 0.4, confirmPrice: true, photoIds: [] });
    const a = w.listings['l-rv7'].review!.auto;
    expect(a.checks.find(c => c.key === 'precio')!.ok).toBe(false);
    expect(a.checks.find(c => c.key === 'fotos')!.ok).toBe(false);
    expect(a.verdict).toBe('RECHAZAR');
    expect(a.farmerMessage).toBe('Pon al menos una foto de tu cosecha, tomada con la app.');
    // la misma foto en la publicación de otro agricultor
    publish(w, 'l-rv8', { photoIds: ['ph-cam-copiada'] });
    const copy = run(w, 'u-justina', 'LISTING_PUBLISH', { orgId: 'org-justina', listingId: 'l-rv9', productId: 'papa_nativa', unit: 'kg', unitKg: 1, qty: 50, price: 3.5, harvestDate: w.now, farmId: 'farm-justina', photoIds: ['ph-cam-copiada'] });
    expect(copy.ok).toBe(true);
    expect(photosUsedElsewhere(w, w.listings['l-rv9'])).toEqual(['l-rv8']);
    expect(w.listings['l-rv9'].review!.auto.checks.find(c => c.key === 'fotos')).toMatchObject({ ok: false });
    publish(w, 'l-rv10', { photoIds: ['ph-gal-1'] });
    expect(w.listings['l-rv10'].review!.auto).toMatchObject({ verdict: 'OBSERVAR' });
    expect(VERDICT_LABEL.OBSERVAR).toBe('Mirar con cuidado');
  });

  it('si las reglas marcan algo, la IA no puede dejarla en «sin observaciones»', () => {
    const w = fresh();
    publish(w, 'l-rv11', { price: 0.4, confirmPrice: true });
    const rules = rulesReview(w, w.listings['l-rv11'], w.now);
    const m = mergeReviews(rules, { at: w.now, verdict: 'OK', score: 95, checks: [{ key: 'foto1', label: 'Foto 1', ok: true, detail: 'Papa amarilla en sacos' }], summary: 'Todo bien.' });
    expect(m.verdict).toBe('OBSERVAR');
    expect(m.score).toBeLessThan(95);
  });

  it('la revisión interna (reglas, IA, mensajes del equipo) solo la ven el agricultor y el equipo', () => {
    const w = fresh();
    expect(run(w, 'u-nuevo', 'USER_REGISTER', { userId: 'u-nuevo', orgId: 'org-nuevo', role: 'FARMER', phone: '987650099', name: 'Agricultor Nuevo', lang: 'es', org: { district: '040519', name: 'Agricultor Nuevo' } }).ok).toBe(true);
    w.orgs['org-nuevo'].level = 1;
    expect(run(w, 'u-nuevo', 'LISTING_PUBLISH', { orgId: 'org-nuevo', listingId: 'l-rv12', productId: 'haba_verde', unit: 'kg', unitKg: 1, qty: 40, price: 3.2, harvestDate: w.now, photoIds: ['ph-cam-x'] }).ok).toBe(true);
    const buyer: Viewer = { kind: 'user', userId: 'u-charo', orgId: 'org-geranios' };
    const owner: Viewer = { kind: 'user', userId: 'u-nuevo', orgId: 'org-nuevo' };
    const admin: Viewer = { kind: 'admin', userId: 'u-lucia' };
    expect(maskWorld(w, buyer).listings['l-rv12'].review).toBeUndefined();
    expect(maskWorld(w, buyer).listings['l-rv12'].flags).toBeUndefined();
    expect(maskWorld(w, owner).listings['l-rv12'].review?.auto.by).toBe('REGLAS');
    expect(maskWorld(w, admin).listings['l-rv12'].flags).toEqual(['Agricultor de nivel 1']);
  });

  it('en la historia de ejemplo todo está aprobado salvo dos publicaciones en la cola del panel', () => {
    const w = seedWorld();
    const review = Object.values(w.listings).filter(l => l.status === 'IN_REVIEW').map(l => [l.id, l.review!.auto.verdict]);
    expect(review).toEqual([['l-j-nativa2', 'OK'], ['l-w-cebolla2', 'RECHAZAR']]);
    for (const l of Object.values(w.listings)) if (l.status === 'ACTIVE') expect(l.review?.approvedBy).toBe('u-lucia');
  });
});
