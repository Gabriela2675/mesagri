/*
 * Módulos del API (14.3): autenticación, verificación, catálogo, pedidos (pagos, entrega, chat,
 * calificaciones, soporte), administración, almacenes, cobros, envíos, archivos y sincronización.
 */
import { Controller, Get, Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CONFIG, BUILD_ID } from './config';
import { PROTOCOL } from '@mesagri/shared';
import { EngineService } from './core/engine.service';
import { Commands } from './core/commands';
import { rows } from './db/db';
import { AuthService } from './auth/auth.service';
import { AuthGuard } from './auth/auth.guard';
import { AuthController } from './auth/auth.controller';
import { SyncController } from './sync/sync.controller';
import { WhatsAppService } from './auth/whatsapp';
import { SmsService } from './auth/sms';
import { WhatsAppController } from './auth/whatsapp.controller';
import { TeamController } from './domain/team.controller';
import { TeamAccounts } from './domain/team.accounts';
import { SyncGateway } from './sync/sync.gateway';
import { DemoController } from './demo/demo.controller';
import { FilesController } from './files/files.controller';
import { CatalogController } from './domain/catalog.controller';
import { OrdersController } from './domain/orders.controller';
import { VerificationController, AdminController } from './domain/admin.controller';
import { StorageController, BillingController, ShippingController } from './domain/logistics.controller';

@ApiTags('Servidor')
@Controller()
class HealthController {
  constructor(private readonly engine: EngineService) {}
  @Get('health')
  @ApiOperation({ summary: 'Estado del servidor y de la base de datos' })
  async health() {
    let db = false;
    try { db = !!(await rows(this.engine.pool, 'SELECT 1 AS ok'))[0]?.ok; } catch { db = false; }
    return { ok: db && this.engine.ready, db, epoch: this.engine.epoch, seq: this.engine.seq, simNow: this.engine.simNow(), demo: CONFIG.demo, version: '1.0.0', protocol: PROTOCOL, build: BUILD_ID };
  }
}

@Global()
@Module({
  imports: [JwtModule.register({ secret: CONFIG.jwtSecret, signOptions: { algorithm: 'HS256', issuer: 'mesagri' }, verifyOptions: { algorithms: ['HS256'], issuer: 'mesagri' } })],
  providers: [EngineService, Commands, TeamAccounts, WhatsAppService, SmsService, AuthService, AuthGuard, SyncGateway],
  controllers: [HealthController, AuthController, WhatsAppController, TeamController, SyncController, DemoController, FilesController, CatalogController, OrdersController, VerificationController, AdminController, StorageController, BillingController, ShippingController],
  exports: [EngineService, Commands, AuthService, AuthGuard],
})
export class AppModule {}
