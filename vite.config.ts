import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The production build is a single self-contained index.html (all JS/CSS inlined),
// so it can be hosted anywhere (e.g. GitHub Pages) *or* simply double-clicked and
// opened offline from disk — no server or installation required.
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
