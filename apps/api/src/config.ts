/*
 * Configuración por variables de entorno (archivo .env en la raíz del proyecto).
 * Los secretos nunca van en el repositorio (14.9): el script de instalación los genera.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Carga ../../.env (raíz del monorepo) sin dependencias. */
function loadDotEnv() {
  const candidates = [path.resolve(process.cwd(), '.env'), path.resolve(__dirname, '../../../.env'), path.resolve(__dirname, '../../../../.env')];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m || line.trimStart().startsWith('#')) continue;
      const v = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
    break;
  }
}
loadDotEnv();

const env = (k: string, d?: string) => process.env[k] ?? d;
const num = (k: string, d: number) => Number(process.env[k] ?? d);
const bool = (k: string, d: boolean) => (process.env[k] ?? String(d)).toLowerCase() === 'true';

/**
 * Base de datos. En la nube (Aiven, Railway, PlanetScale...) basta DATABASE_URL, por ejemplo
 * mysql://avnadmin:clave@servidor.aivencloud.com:12345/defaultdb?ssl-mode=REQUIRED
 * Con ssl-mode=REQUIRED la conexión va cifrada; con DB_CA_CERT (el certificado de la nube, en texto)
 * además se comprueba que el servidor sea el correcto.
 */
function dbConfig() {
  const base = {
    host: env('DB_HOST', '127.0.0.1')!,
    port: num('DB_PORT', 3307),
    user: env('DB_USER', 'mesagri')!,
    password: env('DB_PASSWORD', 'mesagri')!,
    database: env('DB_NAME', 'mesagri')!,
    ssl: undefined as undefined | { rejectUnauthorized: boolean; ca?: string },
  };
  let sslMode = (env('DB_SSL_MODE', '') ?? '').toUpperCase();
  const url = env('DATABASE_URL', '') ?? '';
  if (url) {
    const u = new URL(url);
    if (!/^mysql2?:$/.test(u.protocol)) throw new Error('DATABASE_URL debe empezar con mysql://');
    base.host = u.hostname;
    base.port = Number(u.port) || 3306;
    base.user = decodeURIComponent(u.username);
    base.password = decodeURIComponent(u.password);
    if (u.pathname.length > 1) base.database = decodeURIComponent(u.pathname.slice(1));
    sslMode = (u.searchParams.get('ssl-mode') ?? u.searchParams.get('sslmode') ?? sslMode).toUpperCase();
    if (!sslMode && u.searchParams.get('ssl') && u.searchParams.get('ssl') !== 'false') sslMode = 'REQUIRED';
  }
  const ca = (env('DB_CA_CERT', '') ?? '').replace(/\\n/g, '\n').trim() || (env('DB_CA_FILE') && fs.existsSync(env('DB_CA_FILE')!) ? fs.readFileSync(env('DB_CA_FILE')!, 'utf8') : '');
  if (ca) base.ssl = { rejectUnauthorized: true, ca };
  else if (['VERIFY_CA', 'VERIFY_IDENTITY'].includes(sslMode)) base.ssl = { rejectUnauthorized: true };
  else if (['REQUIRED', 'REQUIRE', 'TRUE', 'ON'].includes(sslMode) || bool('DB_SSL', false)) base.ssl = { rejectUnauthorized: false };
  return base;
}

/** Detrás de un proxy (Render, Railway, Nginx): de quién viene cada pedido, para los límites de intentos. */
function trustProxy(): boolean | number | string {
  const v = (env('TRUST_PROXY', 'loopback') ?? 'loopback').trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  return /^\d+$/.test(v) ? Number(v) : v;
}

export const CONFIG = {
  /** API_PORT en la instalación local; PORT lo pone la nube (Render, Railway, Fly...). */
  port: num('API_PORT', num('PORT', 3000)),
  host: env('API_HOST', '0.0.0.0')!,
  db: dbConfig(),
  trustProxy: trustProxy(),
  /**
   * Clave del equipo: protege las herramientas de la demo (sesiones sin código, reloj, reinicio,
   * claves del panel) y el mundo completo del escenario de varios celulares. Sin clave (instalación
   * local en una red de confianza) todo queda abierto como antes.
   */
  teamKey: env('TEAM_KEY', '')!.trim(),
  /** Fotos y documentos: en la base de datos (sirve en la nube, donde el disco se borra) o en una carpeta. */
  filesInDb: (env('FILES_STORAGE', 'db') ?? 'db').toLowerCase() !== 'disk',
  /** Firma de los tokens de acceso (JWT HS256, 15 minutos). */
  jwtSecret: env('JWT_SECRET', 'mesagri-desarrollo-cambiar-en-produccion')!,
  accessTtlSeconds: num('ACCESS_TTL_SECONDS', 15 * 60),
  refreshTtlDays: num('REFRESH_TTL_DAYS', 30),
  /** Clave de 32 bytes en hex para cifrar cuentas de cobro y códigos de entrega (AES-256-GCM). */
  dataKey: env('DATA_KEY', '6d65736167726920646573617272726f6c6c6f206c6f63616c20323032362021')!,
  /** Clave inicial de las cuentas del equipo (panel web). El doble factor se genera por cuenta. */
  adminPassword: env('ADMIN_PASSWORD', 'demo-mesagri')!,
  /** Modo demo: personas de ejemplo sin código, reloj que se adelanta y reinicio de los datos. */
  demo: bool('DEMO_MODE', true),
  /** El reloj de la demo se detiene cuando se apaga el servidor (resume) o sigue la hora real (real). */
  clockMode: env('DEMO_CLOCK', 'resume') as 'resume' | 'real',
  filesDir: path.resolve(env('FILES_DIR', path.resolve(__dirname, '../../../storage/files'))!),
  webDist: path.resolve(env('WEB_DIST', path.resolve(__dirname, '../../web/dist'))!),
  corsOrigins: (env('CORS_ORIGINS', '') ?? '').split(',').map(s => s.trim()).filter(Boolean),
};

/** Identificador de esta compilación del servidor (lo escribe `npm run build`). INICIAR lo compara con
 *  el de la carpeta: si el servidor que está corriendo es de otra compilación, lo reinicia. */
export const BUILD_ID: string = (() => {
  try { return fs.readFileSync(path.join(__dirname, 'build-id.txt'), 'utf8').trim(); } catch { /* sin archivo */ }
  try { return String(Math.round(fs.statSync(__filename).mtimeMs)); } catch { return 'dev'; }
})();
