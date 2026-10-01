import { defineConfig } from 'vitest/config';

// Used by `npm run gen:plugin` to regenerate the C++ tables of the VST plugin from the TypeScript sources.
export default defineConfig({
  test: { include: ['scripts/**/*.gen.ts'] },
});
