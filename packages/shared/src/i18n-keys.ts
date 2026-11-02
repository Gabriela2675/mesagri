/*
 * Cadenas de las pantallas críticas del agricultor (16.3, nivel 1). Viven por clave (RF-IDI-03):
 * la app las pide con tr('clave') y muestra la traducción APROBADA del idioma elegido.
 * Un idioma se activa solo cuando todas estas claves están aprobadas por un hablante (RN-32).
 */
export interface KeyDef { key: string; es: string; screen: string }

export const CRITICAL_KEYS: KeyDef[] = [
  { key: 'welcome.choose_language', es: 'Elige tu idioma', screen: 'A-01' },
  { key: 'welcome.continue', es: 'Continuar', screen: 'A-01' },
  { key: 'welcome.audio_guide', es: 'Guía de audio', screen: 'A-01' },
  { key: 'profile.farmer', es: 'Soy agricultor', screen: 'A-01' },
  { key: 'profile.farmer_sub', es: 'Publico y vendo mi cosecha', screen: 'A-01' },
  { key: 'register.phone', es: 'Número de celular', screen: 'A-02' },
  { key: 'register.send_code', es: 'Enviar código', screen: 'A-02' },
  { key: 'register.free', es: 'Registrarte es gratis', screen: 'A-02' },
  { key: 'otp.title', es: 'Verifica tu número', screen: 'A-03' },
  { key: 'otp.verify', es: 'Verificar', screen: 'A-03' },
  { key: 'consent.title', es: 'Antes de empezar', screen: 'A-04' },
  { key: 'consent.accept', es: 'Acepto y continúo', screen: 'A-04' },
  { key: 'identity.title', es: 'Verifica tu identidad', screen: 'A-05' },
  { key: 'payout.title', es: '¿Cómo te pagan?', screen: 'A-06' },
  { key: 'zones.title', es: '¿Dónde entregas?', screen: 'A-07' },
  { key: 'home.title', es: 'Tu chacra hoy', screen: 'A-08' },
  { key: 'home.new_orders', es: 'Pedidos nuevos', screen: 'A-08' },
  { key: 'home.to_deliver', es: 'Por entregar', screen: 'A-08' },
  { key: 'home.to_collect', es: 'Por cobrar', screen: 'A-08' },
  { key: 'home.publish', es: 'Publicar nueva cosecha', screen: 'A-08' },
  { key: 'nav.home', es: 'Inicio', screen: 'nav' },
  { key: 'nav.orders', es: 'Pedidos', screen: 'nav' },
  { key: 'nav.publish', es: 'Publicar', screen: 'nav' },
  { key: 'nav.storage', es: 'Almacén', screen: 'nav' },
  { key: 'nav.profile', es: 'Perfil', screen: 'nav' },
  { key: 'publish.title', es: 'Publicar cosecha', screen: 'A-10' },
  { key: 'publish.quantity', es: 'Cantidad', screen: 'A-10' },
  { key: 'publish.price', es: 'Precio por kilo', screen: 'A-10' },
  { key: 'publish.review', es: 'Revisar', screen: 'A-10' },
  { key: 'publish.confirm', es: 'Publicar', screen: 'A-11' },
  { key: 'order.accept', es: 'Aceptar pedido', screen: 'A-13' },
  { key: 'order.reject', es: 'Rechazar', screen: 'A-13' },
  { key: 'payment.title', es: 'Confirma el pago', screen: 'A-14' },
  { key: 'payment.yes', es: 'Sí, me llegó', screen: 'A-14' },
  { key: 'payment.no', es: 'No me llegó', screen: 'A-14' },
  { key: 'delivery.title', es: 'Entrega del pedido', screen: 'A-15' },
  { key: 'delivery.code', es: 'Código de entrega que te dicta el comprador', screen: 'A-15' },
  { key: 'delivery.confirm', es: 'Confirmar entrega', screen: 'A-15' },
  { key: 'help.title', es: 'Ayuda', screen: 'A-19' },
];

export const CRITICAL_BY_KEY: Record<string, KeyDef> = Object.fromEntries(CRITICAL_KEYS.map(k => [k.key, k]));
