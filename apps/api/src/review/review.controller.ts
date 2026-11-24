/*
 * Revisión de publicaciones: el panel pregunta si el modelo de Machine Learning y la IA están activos
 * para mostrarlo en W-06, y puede probar el modelo con una foto suelta. Las decisiones del equipo van
 * por las acciones del motor (LISTING_MODERATE).
 */
import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { PRODUCTS } from '@mesagri/shared';
import { Auth } from '../auth/auth.guard';
import { DomainHttpError } from '../common/errors';
import { AiListingReview } from './ai-review';
import { MlListingReview } from './ml-review';

class TryDto {
  @ApiProperty({ description: 'Foto como data URL (data:image/jpeg;base64,...)' }) dataUrl!: string;
  @ApiProperty({ example: 'cebolla_roja', description: 'Producto que dice la publicación' }) productId!: string;
}

@ApiTags('Revisión de publicaciones')
@Controller('review')
export class ReviewController {
  constructor(private readonly ai: AiListingReview, private readonly ml: MlListingReview) {}

  @Get('info') @Auth('ADMIN')
  @ApiOperation({ summary: 'Si el modelo de ML y la IA están activos, con qué modelo y cuántas revisiones van hoy' })
  async info() { return { ...(await this.ai.info()), ...this.ml.info() }; }

  @Post('ml/try') @Auth('ADMIN')
  @ApiOperation({ summary: 'Prueba el modelo de ML con una foto: qué ve y si muestra el producto elegido (no guarda nada)' })
  async tryPhoto(@Body() b: TryDto) {
    if (!this.ml.configured()) throw new DomainHttpError(503, 'NO_MODEL', 'El modelo de ML no está en este servidor.');
    if (!PRODUCTS.some(p => p.id === b?.productId)) throw new DomainHttpError(422, 'BAD_PRODUCT', 'Elige un producto del catálogo.');
    const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/i.exec(String(b?.dataUrl ?? ''));
    if (!m) throw new DomainHttpError(422, 'BAD_DATA', 'Manda una foto JPG, PNG o WEBP.');
    const img = Buffer.from(m[2], 'base64');
    if (img.length > 6 * 1024 * 1024) throw new DomainHttpError(413, 'TOO_BIG', 'La foto pesa más de 6 MB.');
    try { return await this.ml.tryPhoto(img, b.productId); } catch (e: any) { throw new DomainHttpError(422, 'BAD_IMAGE', 'No pudimos leer esa foto.'); }
  }
}
