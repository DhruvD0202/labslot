import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: 'client',
  envDir: '..',
  plugins: [vue()],
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3001' } },
  build: { outDir: '../dist', emptyOutDir: true },
});
