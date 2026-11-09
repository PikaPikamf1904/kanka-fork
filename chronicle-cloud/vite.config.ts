import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        // Stable vendor chunks cache well across deploys; maps and Markdown load on demand.
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return undefined;
          if (/\/node_modules\/(react|react-dom|scheduler|react-router)\//.test(id)) return 'react';
          if (id.includes('/node_modules/@supabase/')) return 'supabase';
          if (id.includes('/node_modules/leaflet/')) return 'leaflet';
          return undefined;
        },
      },
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'functions/**/*.test.ts', 'importer/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'db',
          include: ['tests/db/**/*.test.ts'],
          environment: 'node',
          // One database; run files one after another.
          fileParallelism: false,
          testTimeout: 30000,
          hookTimeout: 60000,
        },
      },
    ],
  },
});
