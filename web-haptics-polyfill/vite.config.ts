import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  // Use relative base path so assets load properly whether deployed to
  // GitHub Pages (e.g. https://<user>.github.io/<repo>/) or a custom domain.
  base: './',

  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false
  },

  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: false
  },

  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
    emptyOutDir: true
  },

  worker: {
    format: 'es'
  }
});
