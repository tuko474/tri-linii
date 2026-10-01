import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // относительные пути — нужно для Capacitor
  build: { outDir: 'dist', target: 'es2020', assetsInlineLimit: 0 },
  server: { host: true },
});
