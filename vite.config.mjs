import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: 'public',
  optimizeDeps: { exclude: ['api'] },
  build: {
    rollupOptions: {
      external: []
    }
  },
  server: { port: 3000 }
});
