import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { adiantarTela } from './plugin-adiantar-tela';

export default defineConfig({
  plugins: [react(), adiantarTela()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:3333', changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: false },
});
