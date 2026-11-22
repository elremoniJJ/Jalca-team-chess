import { fileURLToPath, URL } from "url";
import { defineConfig } from "vitest/config";

// The frontend suite runs under Vitest's default `forks` pool. On hosts with a
// constrained CPU count, Vitest's default min/max fork bounds conflict and
// tinypool aborts the whole run before any test executes with
// "RangeError: options.minThreads and options.maxThreads must not conflict".
// Pin the pool to a single fork so the default `pnpm test` command runs the
// suite cleanly regardless of the host's CPU topology.
//
// The `@` alias mirrors the one in vite.config.js so test files can import
// application modules the same way the app itself does.
export default defineConfig({
  test: {
    pool: "forks",
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: 1,
      },
    },
  },
  resolve: {
    alias: [
      {
        find: "@",
        replacement: fileURLToPath(new URL("./src", import.meta.url)),
      },
    ],
  },
});
