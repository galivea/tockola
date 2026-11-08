import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Frontend test config. Kept apart from vite.config.js so the dev server's port
// and HMR settings never leak in. Run with: npx vitest run
export default defineConfig({
  plugins: [svelte({ hot: false })],
  // Svelte 5 only exports its client runtime under the browser condition; without
  // this, component tests cannot get `mount`.
  resolve: { conditions: ["browser"] },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/unit/setup.js"],
    include: ["tests/unit/**/*.test.js"],
    // One environment per file: the locale binding is module-level global state,
    // so sharing it would let cases contaminate each other.
    isolate: true,
    restoreMocks: true,
  },
});
