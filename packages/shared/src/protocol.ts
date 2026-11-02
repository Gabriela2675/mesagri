/**
 * Versión del contrato entre la app y el servidor (forma del mundo y acciones). Sube cuando cambia.
 * Si no coinciden (por ejemplo, quedó abierto el servidor de la versión anterior), la app pide reiniciar
 * el servidor en vez de mostrar pantallas que fallan.
 *   1 · MVP inicial
 *   2 · app final: ingreso por tipo, solicitudes de compra, pedidos programados, equipo y locales
 *   3 · nube: cada celular recibe solo lo que su perfil puede ver (cambios por entidad) y los códigos sellados
 */
export const PROTOCOL = 3;
