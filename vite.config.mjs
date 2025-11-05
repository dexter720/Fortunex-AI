import { defineConfig } from 'vite'

export default defineConfig({
  // Vite will only build your frontend; the /api folder is run by Vercel
  publicDir: 'public',
  optimizeDeps: {
    exclude: ['api'],
  },
  build: {
    rollupOptions: {
      external: [], // keep empty
    },
  },
  server: { port: 3000 },
})
