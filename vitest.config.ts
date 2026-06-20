import { defineConfig } from 'vitest/config';

// Tests run in node by default (the parser/model/format layers are pure and
// DOM-free). HUD files that touch the DOM opt into jsdom per-file with a
// `// @vitest-environment jsdom` pragma at the top of the test.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: false,
  },
});
