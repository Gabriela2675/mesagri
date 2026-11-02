/*
 * Webhook de WhatsApp (Meta): aquí llegan los mensajes que las personas le escriben a Mesagri.
 * - GET: Meta comprueba la dirección con la clave WHATSAPP_VERIFY_TOKEN (al configurar el webhook).
 * - POST: mensajes nuevos. Se comprueba que vengan de Meta (firma con WHATSAPP_APP_SECRET), se le
 *   responde a Meta al instante y, por detrás, a cada persona con su código.
 * Configuración en Meta: tu app → WhatsApp → Configuración → URL de devolución de llamada
 *   https://<servidor>/api/v1/whatsapp/webhook, y en «Campos del webhook», suscribir «messages».
 */
import { Controller, Get, Headers, HttpCode, Logger, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CONFIG } from '../config';
import { WhatsAppService } from './whatsapp';
import { AuthService } from './auth.service';

@ApiExcludeController()
@Controller('whatsapp')
export class WhatsAppController {
  private readonly log = new Logger('WhatsApp');
  constructor(private readonly wa: WhatsAppService, private readonly auth: AuthService) {}

  @Get('webhook')
  verify(@Req() req: Request, @Res() res: Response) {
    const q = req.query as Record<string, string>;
    const want = CONFIG.whatsapp.verifyToken;
    if (q['hub.mode'] === 'subscribe' && want && q['hub.verify_token'] === want) {
      this.log.log('Meta conectó el webhook de WhatsApp');
      res.type('text/plain').send(String(q['hub.challenge'] ?? ''));
      return;
    }
    res.status(403).type('text/plain').send('La clave del webhook no coincide.');
  }

  @Post('webhook') @HttpCode(200)
  receive(@Req() req: Request & { rawBody?: Buffer }, @Headers('x-hub-signature-256') sig?: string) {
    if (!this.wa.signatureOk(req.rawBody, sig)) {
      this.log.warn('Llegó un aviso de WhatsApp sin la firma de Meta: se ignora');
      return { ok: false };
    }
    const list = this.wa.inbound(req.body);
    if (list.length && this.wa.configured) {
      void (async () => {
        for (const m of list) {
          try { await this.auth.answerWhatsApp(m); } catch (e: any) { this.log.warn(`No se pudo responder un mensaje: ${e?.message ?? e}`); }
        }
      })();
    }
    return { ok: true };
  }
}
