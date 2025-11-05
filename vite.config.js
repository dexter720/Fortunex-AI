import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      external: [],
    },
  },
  server: {
    port: 3000,
  },
  // 👇 Ignore the API folder during build
  publicDir: 'public',
  optimizeDeps: {
    exclude: ['api'],
  },
})
