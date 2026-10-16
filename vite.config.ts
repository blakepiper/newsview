import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3081,
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${process.env.NEWSVIEW_PORT || 3080}`, '/health': `http://127.0.0.1:${process.env.NEWSVIEW_PORT || 3080}` },
  },
});
