import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    // las pruebas usan el código fuente de las reglas (mismo módulo que el servidor)
    alias: [{ find: /^@mesagri\/shared$/, replacement: path.resolve(__dirname, '../../packages/shared/src/index.ts') }],
  },
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    pool: 'forks',
  },
});
