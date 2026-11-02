/*
 * Servidor de Mesagri: API REST /api/v1 (con documentación OpenAPI en /api/docs), tiempo real por
 * Socket.IO y la app web (celulares de la demo y panel de administración) en la misma dirección.
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConsoleLogger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppModule } from './app.module';
import { CONFIG } from './config';
import { ProblemFilter } from './common/errors';

/** Registro sin el detalle de cada ruta al arrancar (sigue mostrando avisos y errores). */
class QuietLogger extends ConsoleLogger {
  log(message: any, context?: string) {
    if (context && ['RouterExplorer', 'RoutesResolver', 'InstanceLoader', 'WebSocketsController', 'NestFactory', 'NestApplication'].includes(context)) return;
    super.log(message, context);
  }
}

export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, logger: new QuietLogger('Mesagri', { timestamp: false }) });
  const http = app.getHttpAdapter().getInstance() as express.Express;
  http.disable('x-powered-by');
  http.set('trust proxy', CONFIG.trustProxy);

  // Cabeceras de seguridad (14.4)
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=(self)');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    // en la nube siempre se entra por https: el navegador no vuelve a probar sin cifrar
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    if (!req.path.startsWith('/api/docs')) {
      res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; connect-src 'self' ws: wss:; media-src 'self' blob: data:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'");
    }
    next();
  });
  app.use('/api/v1/files', express.raw({ type: ['image/*', 'application/pdf', 'audio/*', 'application/octet-stream'], limit: '6mb' }));
  // los avisos de WhatsApp se comprueban con su firma: se guarda el cuerpo tal cual llegó
  app.use(express.json({ limit: '8mb', verify: (req: any, _res, buf) => { if (String(req.originalUrl ?? req.url ?? '').startsWith('/api/v1/whatsapp/')) req.rawBody = Buffer.from(buf); } }));
  if (CONFIG.corsOrigins.length) app.enableCors({ origin: CONFIG.corsOrigins, credentials: false });

  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemFilter());
  app.enableShutdownHooks();

  const doc = SwaggerModule.createDocument(app, new DocumentBuilder()
    .setTitle('Mesagri · API v1')
    .setDescription('Contrato del API (sección 14.6 del documento de diseño v5). JSON, Authorization: Bearer, identificadores por uuid, paginación por cursor, errores application/problem+json y encabezado Idempotency-Key en las escrituras reintentables. Tiempo real por Socket.IO en /sync.')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build());
  SwaggerModule.setup('api/docs', app, doc, { customSiteTitle: 'Mesagri · API', swaggerOptions: { persistAuthorization: true, docExpansion: 'none', tagsSorter: 'alpha' } });

  // Política de privacidad (la pide Meta para publicar la app de WhatsApp)
  const privacy = [path.resolve(__dirname, '../static/privacidad.html'), path.resolve(process.cwd(), 'apps/api/static/privacidad.html'), path.resolve(process.cwd(), 'static/privacidad.html')].find(f => fs.existsSync(f));
  if (privacy) http.get(['/privacidad', '/privacy'], (_req, res) => { res.setHeader('Cache-Control', 'public, max-age=3600'); res.type('html').send(fs.readFileSync(privacy)); });

  // App web (app del celular en /, panel en /panel, demo de varios celulares en /demo) con rutas del lado del navegador
  if (fs.existsSync(path.join(CONFIG.webDist, 'index.html'))) {
    app.useStaticAssets(CONFIG.webDist, { index: false, maxAge: '1h', setHeaders: (res, file) => { if (/[\\/]assets[\\/]/.test(file)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); } });
    const file = path.join(CONFIG.webDist, 'index.html');
    let cached = { mtime: 0, body: Buffer.alloc(0) };
    http.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => {
      try {
        const st = fs.statSync(file);
        if (st.mtimeMs !== cached.mtime) cached = { mtime: st.mtimeMs, body: fs.readFileSync(file) };
        res.setHeader('Cache-Control', 'no-cache');
        res.type('html').send(cached.body);
      } catch { res.status(503).send('La app web no está compilada.'); }
    });
  }
  return app;
}

function lanUrls(port: number): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${port}`);
  return out;
}

async function main() {
  const app = await createApp();
  await app.listen(CONFIG.port, CONFIG.host);
  const log = new Logger('Mesagri');
  log.log(`Listo en http://localhost:${CONFIG.port}  (app: / · panel: /panel · demo: /demo · API: /api/docs)`);
  for (const u of lanUrls(CONFIG.port)) log.log(`Desde un celular en la misma red Wi-Fi: ${u}`);
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  main().catch(e => { console.error('No se pudo iniciar Mesagri:', e?.message ?? e); process.exit(1); });
}
