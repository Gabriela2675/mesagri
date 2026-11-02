import { defineConfig } from 'vitest/config';

/* Pruebas de las reglas puras (17: «Unitarias: reglas puras, máquina de estados»). */
export default defineConfig({ test: { include: ['test/**/*.test.ts'], environment: 'node' } });
