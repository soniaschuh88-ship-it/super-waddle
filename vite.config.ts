import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@mlc-ai/web-llm'] },
  build: {
    target: 'esnext',
    // Keep COEP/COOP in the production build for SharedArrayBuffer support
    rollupOptions: {
      output: { assetFileNames: 'assets/[name]-[hash][extname]' },
    },
  },
  server: {
    allowedHosts: true,
    // No COEP/COOP in dev — these headers break HTTP/2 reverse proxies (tunnels).
    // WebGPU inference works without them; only WASM multi-threading needs them.
  },
});
