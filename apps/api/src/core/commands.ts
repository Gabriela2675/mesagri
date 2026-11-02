/*
 * Ejecutar una acción del dominio desde un endpoint REST: el actor es el usuario de la sesión, el
 * encabezado Idempotency-Key evita duplicar en los reintentos y el error de la regla vuelve como
 * application/problem+json.
 */
import { Injectable } from '@nestjs/common';
import { uid } from '@mesagri/shared';
import { EngineService } from './engine.service';
import { ruleError } from '../common/errors';
import type { AuthUser } from '../auth/auth.service';

@Injectable()
export class Commands {
  constructor(private readonly engine: EngineService) {}

  async run(user: AuthUser, type: string, p: any, idem?: string, device?: string) {
    const id = idem && /^[A-Za-z0-9:_.-]{4,80}$/.test(idem) ? idem : 'api-' + uid();
    const r = await this.engine.apply({ id, type, actor: user.id, p, device: device ?? 'api' });
    if (!r.ok) throw ruleError(r.error);
    return { ok: true, seq: r.seq, actionId: r.event.id, result: r.result ?? null };
  }

  get world() { return this.engine.world; }
}
