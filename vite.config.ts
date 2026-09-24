import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Fast Refresh in `vite dev`: component edits keep the store and the live run.
  plugins: [react()],
  // Relative base so the build works both at a domain root and under the
  // GitHub Pages project subpath (/miner/).
  base: './',
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'shared/**/*.test.{ts,tsx}']
  }
});
