import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// "npm run dev:phone": HTTPS im WLAN, denn iOS gibt die Kamera nur über HTTPS frei.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'phone' ? [basicSsl()] : [],
  server: { port: 5197, strictPort: true },
}));
