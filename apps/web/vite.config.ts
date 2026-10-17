/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const API = process.env.VITE_API_PROXY ?? 'http://localhost:3000';
const pkg = (name: string) => fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Los paquetes compartidos se consumen desde el código fuente TypeScript.
    alias: { '@necta/cash-engine': pkg('cash-engine'), '@necta/contracts': pkg('contracts') },
  },
  server: {
    port: 5173,
    // Proxy: la web y la API comparten origen, así la cookie HttpOnly es SameSite=Lax de primera parte.
    proxy: {
      '/v2': { target: API, changeOrigin: false },
      '/health': { target: API },
      '/socket.io': { target: API, ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    restoreMocks: true,
  },
});
