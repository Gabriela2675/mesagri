/*
 * Pruebas de pantallas sin navegador: dibujan las pantallas con los datos de ejemplo (React en el
 * servidor) y revisan que se vean y no fallen. Son rápidas y no necesitan Chromium; los recorridos
 * con clics siguen en e2e/ (Playwright).
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const shared = fileURLToPath(new URL('../../../packages/shared/src', import.meta.url));
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  plugins: [react()],
  resolve: { alias: [{ find: /^@mesagri\/shared$/, replacement: shared + '/index.ts' }, { find: /^@mesagri\/shared\/(.*)$/, replacement: shared + '/$1' }] },
  define: { 'import.meta.env.VITE_LOCAL': '"0"' },
  test: { include: ['smoke/**/*.test.tsx'], environment: 'node' },
});
