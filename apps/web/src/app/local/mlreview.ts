/*
 * Primer filtro con Machine Learning en la demo sin internet (computadora): hace lo mismo que el
 * servicio del servidor (apps/api/src/review/ml-review.ts) con el modelo en el navegador. Cuando un
 * agricultor publica, cambia fotos o precio, o corrige, mira las fotos y anota LISTING_ML_REVIEW.
 */
import type { Listing, MEvent } from '@mesagri/shared/types';
import { mlReview, cosine, hamming, sameImage, isSamplePhoto, ML_T, type MlPhotoInput } from '@mesagri/shared/ml';
import { product } from '@mesagri/shared/catalog';
import { localServer } from './server';
import type { PhotoStore } from '../photos';

let started = false;

export async function startLocalMl(photos: PhotoStore) {
  if (started) return;
  started = true;
  const { mlAvailable, mlLabels, embedPhotos } = await import('../vision/clip');
  if (!(await mlAvailable())) return;
  const s = localServer();
  await s.ready;
  const vectors = new Map<string, { vec: Float32Array; hash: string; orgId: string; listingId: string }>();
  const queue: string[] = [];
  const seen = new Set<string>();
  let busy = false;
  const keyOf = (l: Listing) => `${l.id}@${l.review?.queuedAt}@${l.photoIds.join('|')}@${l.price}@${l.qtyTotal}`;

  const consider = (id: string) => {
    const l = s.world.listings[id];
    if (!l || l.status !== 'IN_REVIEW' || !l.review || l.review.mlState === 'LISTA') return;
    // sin fotos reales (ninguna, o solo dibujos de ejemplo) no hay nada que mirar: quedan las reglas
    if (!l.photoIds.some(p => !isSamplePhoto(p))) return;
    const k = keyOf(l);
    if (seen.has(k)) return;
    seen.add(k);
    if (!queue.includes(id)) queue.push(id);
    void pump();
  };
  const scan = () => { for (const l of Object.values(s.world.listings)) if (l.status === 'IN_REVIEW' && l.review && l.review.mlState !== 'LISTA') consider(l.id); };

  const mark = (l: Listing, state: string, extra: Record<string, unknown> = {}) =>
    s.apply({ type: 'LISTING_ML_REVIEW', actor: 'system', p: { listingId: l.id, queuedAt: l.review!.queuedAt, photos: l.photoIds.join('|'), price: l.price, state, ...extra } }, true);

  async function review(id: string) {
    const l0 = s.world.listings[id];
    if (!l0 || l0.status !== 'IN_REVIEW' || !l0.review) return;
    const key = keyOf(l0);
    const real = l0.photoIds.filter(p => !isSamplePhoto(p)).slice(0, 5);
    const t0 = performance.now();
    mark(l0, 'PENDIENTE');
    try {
      const model = await mlLabels();
      const srcs = await Promise.all(real.map(p => photos.get(p)));
      const embs = await embedPhotos(srcs.map(x => x ?? ''));
      const l = s.world.listings[id];
      if (!l || keyOf(l) !== key) return;
      const vec = new Map(real.map((p, i) => [p, embs[i]]));
      const inputs: MlPhotoInput[] = l.photoIds.slice(0, 5).map(p => {
        if (isSamplePhoto(p)) return { photoId: p, sample: true };
        const e = vec.get(p);
        if (!e) return { photoId: p };
        // ¿casi la misma foto que una de otro agricultor?
        let dupOf: string | undefined;
        for (const [other, v] of vectors) {
          if (other === p || v.orgId === l.orgId) continue;
          const dist = hamming(e.hash, v.hash);
          if (dist <= ML_T.dupHashNear && sameImage(dist, cosine(e.emb, v.vec))) { const o = s.world.listings[v.listingId]; dupOf = o ? `${s.world.orgs[o.orgId]?.name ?? 'otro agricultor'} (${product(o.productId).name.toLowerCase()})` : 'otro agricultor'; break; }
        }
        return { photoId: p, emb: e.emb, light: e.light, sharp: e.sharp, dupOf };
      });
      for (const [p, e] of vec) if (e) vectors.set(p, { vec: e.emb, hash: e.hash, orgId: l.orgId, listingId: l.id });
      const ml = mlReview(s.world, l, inputs, model, s.simNow(), performance.now() - t0);
      mark(l, 'LISTA', { ml });
    } catch (e: any) {
      const l = s.world.listings[id];
      if (l && keyOf(l) === key) mark(l, 'ERROR', { note: `El modelo no pudo mirar las fotos (${String(e?.message ?? e).slice(0, 80)}): quedó la revisión por reglas.` });
    }
  }

  async function pump() {
    if (busy) return;
    busy = true;
    try { while (queue.length) await review(queue.shift()!); } finally { busy = false; }
  }

  s.subscribe((type, data) => {
    if (type === 'reset') { queue.length = 0; seen.clear(); vectors.clear(); setTimeout(scan, 800); return; }
    const ev = (data as { event?: MEvent })?.event;
    if (ev && ['LISTING_PUBLISH', 'LISTING_EDIT', 'LISTING_RESUME'].includes(ev.type)) setTimeout(() => consider(String(ev.p?.listingId ?? '')), 150);
  });
  setTimeout(scan, 1500);
}
