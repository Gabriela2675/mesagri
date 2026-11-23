/*
 * Datos del buscador de lugares (centros poblados y límites distritales del INEI).
 * Pesa ~280 kB (~80 kB comprimido): la app lo importa recién al abrir el buscador.
 */
import ccpp from './geo/ccpp.json';
import limites from './geo/limites.json';
import { buildPlaceData, type PlaceData, type RawCcpp, type RawLimits } from './places';

let cache: PlaceData | undefined;
export function placeData(): PlaceData {
  return (cache ??= buildPlaceData(ccpp as unknown as RawCcpp, limites as unknown as RawLimits));
}
