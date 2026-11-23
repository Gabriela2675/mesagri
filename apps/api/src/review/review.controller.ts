/*
 * Revisión de publicaciones: el panel pregunta si la IA está activa (y con qué modelo) para
 * mostrarlo en W-06. Las decisiones del equipo van por las acciones del motor (LISTING_MODERATE).
 */
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '../auth/auth.guard';
import { AiListingReview } from './ai-review';

@ApiTags('Revisión de publicaciones')
@Controller('review')
export class ReviewController {
  constructor(private readonly ai: AiListingReview) {}

  @Get('info') @Auth('ADMIN')
  @ApiOperation({ summary: 'Si la revisión con IA está activa, el modelo y cuántas revisiones van hoy (tope diario)' })
  info() { return this.ai.info(); }
}
