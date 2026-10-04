import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Two pages: the public portal and the admin editor (served at /admin/).
export default defineConfig({
  build: {
    target: 'es2022',
    assetsInlineLimit: 2048,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        admin: resolve(import.meta.dirname, 'admin/index.html'),
      },
    },
  },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
});
