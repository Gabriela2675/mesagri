/*
 * Lugares: buscador de direcciones por internet (para la chacra) y «¿qué hay en este punto?».
 * Lo usa el registro del agricultor antes de tener sesión, por eso no pide ingresar; tiene un
 * límite de consultas por IP y solo responde lugares de la región Arequipa.
 */
import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { locatePoint, placeData, nearestPlaces, validLatLng, AREQUIPA_BOX, inBox } from '@mesagri/shared';
import { DomainHttpError } from '../common/errors';
import { RateLimiter } from '../common/rate-limit';
import { CONFIG } from '../config';
import { Geocoder } from './geocoder';

const HOUR = 3600_000;

@ApiTags('Lugares')
@Controller('places')
export class PlacesController {
  private readonly limiter = new RateLimiter();
  constructor(private readonly geo: Geocoder) {}

  private limit(req: Request) {
    const ip = String(req.ip ?? req.socket?.remoteAddress ?? '');
    if (!this.limiter.hit('geo:' + ip, CONFIG.geocoder.perHour, HOUR)) throw new DomainHttpError(429, 'TOO_MANY', 'Hiciste muchas búsquedas seguidas. Espera un rato o elige tu centro poblado de la lista.');
  }

  @Get('info')
  @ApiOperation({ summary: 'Qué buscador de direcciones usa el servidor (photon = OpenStreetMap, google, off)' })
  info() {
    const provider = this.geo.provider();
    return { provider, attribution: provider === 'photon' ? '© OpenStreetMap' : provider === 'google' ? 'Google' : undefined };
  }

  @Get('search')
  @ApiOperation({ summary: 'Direcciones y lugares de Arequipa que coinciden con lo escrito, con su distrito (los centros poblados del INEI los busca la app sin internet)' })
  @ApiQuery({ name: 'q', example: 'Calle Mercaderes 120' })
  @ApiQuery({ name: 'lat', required: false }) @ApiQuery({ name: 'lng', required: false })
  async search(@Req() req: Request, @Query('q') q?: string, @Query('lat') lat?: string, @Query('lng') lng?: string) {
    const text = String(q ?? '').trim();
    if (text.length < 3) return { results: [], provider: this.geo.provider() };
    this.limit(req);
    const la = Number(lat), lo = Number(lng);
    const near = lat !== undefined && lng !== undefined && validLatLng(la, lo) && inBox(la, lo, AREQUIPA_BOX) ? { lat: la, lng: lo } : undefined;
    return this.geo.search(text, near);
  }

  @Get('reverse')
  @ApiOperation({ summary: 'Qué distrito y qué centro poblado hay en un punto (GPS) y, si hay internet, la dirección' })
  @ApiQuery({ name: 'lat', example: -15.6483 }) @ApiQuery({ name: 'lng', example: -71.6608 })
  async reverse(@Req() req: Request, @Query('lat') lat?: string, @Query('lng') lng?: string) {
    const la = Number(lat), lo = Number(lng);
    if (!validLatLng(la, lo)) throw new DomainHttpError(422, 'BAD_POINT', 'Ese punto no es válido.');
    this.limit(req);
    const data = placeData();
    const loc = locatePoint(data, la, lo);
    const near = nearestPlaces(data, la, lo, 3, 20).map(n => ({ id: n.place.id, name: n.place.name, district: n.place.district, km: Math.round(n.km * 10) / 10 }));
    const addr = loc.inside ? await this.geo.reverse(la, lo) : { results: [], provider: this.geo.provider() };
    return { inside: loc.inside, district: loc.district ?? null, candidates: loc.candidates, ambiguous: loc.ambiguous, near, address: addr.results[0] ?? null, provider: addr.provider, attribution: addr.attribution };
  }
}
