import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    rollupOptions: {
      output: {
        // Route pages are already code-split via React.lazy (see src/App.tsx); this splits
        // the remaining shared vendor bundle by library so no single chunk stays oversized.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('framer-motion')) return 'vendor-motion';
          if (id.includes('recharts') || id.includes('d3-')) return 'vendor-charts';
          if (id.includes('@radix-ui')) return 'vendor-radix';
          if (id.includes('socket.io-client')) return 'vendor-socket';
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|@react-oauth|lucide-react|react-webcam|sonner)[\\/]/.test(id)) {
            return 'vendor-core';
          }
          return 'vendor';
        },
      },
    },
  },
});
