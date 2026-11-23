/*
 * Buscador de direcciones (por internet) para ubicar la chacra: Photon (OpenStreetMap, sin clave) o
 * Google (Geocoding API, con GOOGLE_MAPS_API_KEY). Solo devuelve lugares de la región Arequipa y a
 * cada uno le pone su distrito con los límites del INEI (places.ts). Si el servicio no responde, la
 * app sigue con el buscador del INEI, que funciona sin internet.
 */
import { Injectable, Logger } from '@nestjs/common';
import { AREQUIPA_BOX, DISTRICT_BY_CODE, PROVINCES, locatePoint, placeData, inBox, fold } from '@mesagri/shared';
import { CONFIG } from '../config';

export interface GeoHit {
  label: string;
  sub: string;
  lat: number;
  lng: number;
  /** distrito más probable y los posibles (los límites son aproximados) */
  district?: string;
  candidates: string[];
  ambiguous: boolean;
}
export interface GeoAnswer { results: GeoHit[]; provider: 'photon' | 'google' | 'off'; attribution?: string; error?: string }

type Fetch = typeof fetch;

const ATTR = { photon: '© OpenStreetMap', google: 'Google', off: undefined } as const;
const UA = 'Mesagri/1.0 (piloto UCSM, Arequipa; contacto: equipo Mesagri)';

@Injectable()
export class Geocoder {
  private readonly log = new Logger('Buscador');
  private cache = new Map<string, { at: number; v: GeoAnswer }>();
  /** se reemplaza en las pruebas */
  fetcher: Fetch = (...a) => fetch(...a);

  provider(): GeoAnswer['provider'] { return CONFIG.geocoder.kind === 'google' && !CONFIG.geocoder.googleKey ? 'photon' : CONFIG.geocoder.kind; }

  private remember(key: string, v: GeoAnswer): GeoAnswer {
    if (!v.error) {
      this.cache.set(key, { at: Date.now(), v });
      if (this.cache.size > 600) this.cache.delete(this.cache.keys().next().value as string);
    }
    return v;
  }
  private cached(key: string): GeoAnswer | undefined {
    const c = this.cache.get(key);
    if (!c) return undefined;
    if (Date.now() - c.at > 24 * 3600_000) { this.cache.delete(key); return undefined; }
    return c.v;
  }

  private async getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), CONFIG.geocoder.timeoutMs);
    try {
      const r = await this.fetcher(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: ctl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally { clearTimeout(timer); }
  }

  /** Pone el distrito a cada punto y deja solo los de Arequipa (sin repetir). */
  private finish(list: { label: string; sub: string; lat: number; lng: number }[]): GeoHit[] {
    const data = placeData();
    const out: GeoHit[] = [];
    const seen = new Set<string>();
    for (const h of list) {
      if (!Number.isFinite(h.lat) || !Number.isFinite(h.lng) || !inBox(h.lat, h.lng, AREQUIPA_BOX)) continue;
      const loc = locatePoint(data, h.lat, h.lng);
      if (!loc.inside || !loc.district) continue;
      const d = DISTRICT_BY_CODE[loc.district];
      const key = fold(h.label) + '|' + loc.district;
      if (seen.has(key)) continue;
      seen.add(key);
      const sub = h.sub || `${d.name}, ${PROVINCES[d.province].name}`;
      out.push({ label: h.label.slice(0, 140), sub: sub.slice(0, 160), lat: Math.round(h.lat * 1e6) / 1e6, lng: Math.round(h.lng * 1e6) / 1e6, district: loc.district, candidates: loc.candidates, ambiguous: loc.ambiguous });
    }
    return out;
  }

  async search(q: string, near?: { lat: number; lng: number }): Promise<GeoAnswer> {
    const provider = this.provider();
    const query = q.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (provider === 'off' || query.length < 3) return { results: [], provider };
    const key = `s|${provider}|${fold(query)}|${near ? `${near.lat.toFixed(2)},${near.lng.toFixed(2)}` : ''}`;
    const hit = this.cached(key);
    if (hit) return hit;
    try {
      const raw = provider === 'google' ? await this.googleSearch(query) : await this.photonSearch(query, near);
      return this.remember(key, { results: this.finish(raw).slice(0, 6), provider, attribution: ATTR[provider] });
    } catch (e: any) {
      this.log.warn(`No respondió ${provider}: ${e?.message ?? e}`);
      return { results: [], provider, attribution: ATTR[provider], error: 'UNAVAILABLE' };
    }
  }

  async reverse(lat: number, lng: number): Promise<GeoAnswer> {
    const provider = this.provider();
    if (provider === 'off') return { results: [], provider };
    const key = `r|${provider}|${lat.toFixed(4)},${lng.toFixed(4)}`;
    const hit = this.cached(key);
    if (hit) return hit;
    try {
      const raw = provider === 'google' ? await this.googleReverse(lat, lng) : await this.photonReverse(lat, lng);
      // el punto es el que marcó la persona (no el de la calle que devuelve el servicio)
      const fixed = raw.slice(0, 1).map((h: { label: string; sub: string; lat: number; lng: number }) => ({ ...h, lat, lng }));
      return this.remember(key, { results: this.finish(fixed), provider, attribution: ATTR[provider] });
    } catch (e: any) {
      this.log.warn(`No respondió ${provider} (reverso): ${e?.message ?? e}`);
      return { results: [], provider, attribution: ATTR[provider], error: 'UNAVAILABLE' };
    }
  }

  /* ---------- Photon (OpenStreetMap) ---------- */
  private photonText(p: any): { label: string; sub: string } {
    const street = [p.street, p.housenumber].filter(Boolean).join(' ');
    const label = String(p.name || street || p.locality || p.district || p.city || '').trim();
    const parts = [p.name && street ? street : '', p.locality, p.district, p.city, p.county].map(x => String(x ?? '').trim()).filter(Boolean);
    const sub = parts.filter((x, i) => fold(x) !== fold(label) && parts.findIndex(y => fold(y) === fold(x)) === i).join(', ');
    return { label, sub };
  }
  private async photonSearch(q: string, near?: { lat: number; lng: number }) {
    const b = AREQUIPA_BOX;
    const u = new URL(CONFIG.geocoder.photonUrl + '/api/');
    u.searchParams.set('q', q);
    u.searchParams.set('limit', '10');
    u.searchParams.set('bbox', `${b[0]},${b[1]},${b[2]},${b[3]}`);
    if (near) { u.searchParams.set('lat', String(near.lat)); u.searchParams.set('lon', String(near.lng)); }
    const j = await this.getJson(u.toString());
    return (Array.isArray(j?.features) ? j.features : []).map((f: any) => ({ ...this.photonText(f.properties ?? {}), lng: Number(f.geometry?.coordinates?.[0]), lat: Number(f.geometry?.coordinates?.[1]) })).filter((h: any) => h.label);
  }
  private async photonReverse(lat: number, lng: number) {
    const u = new URL(CONFIG.geocoder.photonUrl + '/reverse');
    u.searchParams.set('lat', String(lat));
    u.searchParams.set('lon', String(lng));
    u.searchParams.set('limit', '1');
    const j = await this.getJson(u.toString());
    return (Array.isArray(j?.features) ? j.features : []).map((f: any) => ({ ...this.photonText(f.properties ?? {}), lng: Number(f.geometry?.coordinates?.[0]), lat: Number(f.geometry?.coordinates?.[1]) })).filter((h: any) => h.label);
  }

  /* ---------- Google (Geocoding API) ---------- */
  private googleText(r: any): { label: string; sub: string } {
    const comps: any[] = Array.isArray(r.address_components) ? r.address_components : [];
    const pick = (t: string) => comps.find(c => (c.types ?? []).includes(t))?.long_name as string | undefined;
    const route = [pick('route'), pick('street_number')].filter(Boolean).join(' ');
    const label = route || pick('premise') || pick('point_of_interest') || pick('sublocality') || pick('locality') || String(r.formatted_address ?? '').split(',')[0];
    const sub = [pick('sublocality'), pick('locality'), pick('administrative_area_level_2')].filter((x): x is string => !!x && fold(x) !== fold(label)).join(', ');
    return { label: String(label ?? '').trim(), sub };
  }
  private async googleSearch(q: string) {
    const b = AREQUIPA_BOX;
    const u = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    u.searchParams.set('address', q);
    u.searchParams.set('components', 'country:PE|administrative_area:Arequipa');
    u.searchParams.set('bounds', `${b[1]},${b[0]}|${b[3]},${b[2]}`);
    u.searchParams.set('language', 'es');
    u.searchParams.set('region', 'pe');
    u.searchParams.set('key', CONFIG.geocoder.googleKey);
    const j = await this.getJson(u.toString());
    if (j?.status && !['OK', 'ZERO_RESULTS'].includes(j.status)) throw new Error(`Google: ${j.status}`);
    return (Array.isArray(j?.results) ? j.results : []).map((r: any) => ({ ...this.googleText(r), lat: Number(r.geometry?.location?.lat), lng: Number(r.geometry?.location?.lng) })).filter((h: any) => h.label);
  }
  private async googleReverse(lat: number, lng: number) {
    const u = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    u.searchParams.set('latlng', `${lat},${lng}`);
    u.searchParams.set('language', 'es');
    u.searchParams.set('key', CONFIG.geocoder.googleKey);
    const j = await this.getJson(u.toString());
    if (j?.status && !['OK', 'ZERO_RESULTS'].includes(j.status)) throw new Error(`Google: ${j.status}`);
    return (Array.isArray(j?.results) ? j.results : []).map((r: any) => ({ ...this.googleText(r), lat: Number(r.geometry?.location?.lat), lng: Number(r.geometry?.location?.lng) })).filter((h: any) => h.label);
  }
}
