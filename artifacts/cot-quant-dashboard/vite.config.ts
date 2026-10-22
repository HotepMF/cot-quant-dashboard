import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// The Cloudflare build sets PORT and BASE_PATH explicitly; local dev falls back to these defaults.
const port = Number(process.env.PORT ?? 5173);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env.PORT}"`);
}
const basePath = process.env.BASE_PATH ?? '/';

export default defineConfig(({ mode }) => {
  // Where /api goes in local dev: the local Worker (`pnpm dev:api`) by default, or the live site
  // (`pnpm dev:live`, read-only GETs against production data). API_ORIGIN overrides both.
  const apiOrigin = process.env.API_ORIGIN ?? (mode === 'live' ? 'https://zcot.trade' : 'http://127.0.0.1:8787');
  return {
    base: basePath,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
      },
      dedupe: ['react', 'react-dom'],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, 'dist/public'),
      emptyOutDir: true,
    },
    server: {
      port,
      strictPort: true,
      host: '127.0.0.1',
      fs: {
        strict: true,
      },
      proxy: {
        '/api': { target: apiOrigin, changeOrigin: true },
      },
    },
    preview: {
      port,
      host: '127.0.0.1',
    },
  };
});
