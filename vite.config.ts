import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Sync port detection: prefer BKG_PORT env, then common dev ports
  const BACKEND_PORT = env.BKG_PORT ? parseInt(env.BKG_PORT, 10)
    : parseInt(process.env.BKG_PORT ?? '5020', 10);
  const BACKEND = `http://localhost:${BACKEND_PORT}`;

  console.log(`[vite] → proxying API to bKG server on port ${BACKEND_PORT}`);

  const API_PREFIXES = [
    '/api', '/auth', '/admin',
    '/flow', '/hub', '/game',
    '/voxel', '/vldb', '/mmo',
    '/providers', '/settings', '/plugins',
    '/api-keys', '/health', '/user',
    '/sql-wasm.wasm',
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proxy: Record<string, any> = {};
  for (const prefix of API_PREFIXES) {
    proxy[prefix] = {
      target:       BACKEND,
      changeOrigin: true,
      // Suppress ECONNREFUSED spam — return 503 JSON instead
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      configure: (proxyServer: any) => {
        proxyServer.on('error', (err: NodeJS.ErrnoException, _req: unknown, res: any) => {
          if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
            try {
              res?.writeHead?.(503);
              res?.end?.(JSON.stringify({ error: 'Backend offline', port: BACKEND_PORT }));
            } catch { /**/ }
          }
        });
      },
    };
  }

  return {
    plugins: [react()],
    resolve: { alias: { '@': path.resolve(__dirname, './src') } },
    worker: { format: 'es' },
    optimizeDeps: { exclude: ['@mlc-ai/web-llm'] },
    build: {
      target: 'esnext',
      rollupOptions: {
        output: { assetFileNames: 'assets/[name]-[hash][extname]' },
      },
    },
    server: {
      allowedHosts: true,
      port:         3000,   // Vite dev server on 3000, backend on 5020
      proxy,
    },
  };
});
