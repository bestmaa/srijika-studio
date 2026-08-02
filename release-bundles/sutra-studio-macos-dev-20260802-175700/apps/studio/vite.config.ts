import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
  clearScreen: false,
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
