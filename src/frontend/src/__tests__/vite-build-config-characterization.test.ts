import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Characterization of the Vite build configuration, taken BEFORE the
 * `build.minify` flag is flipped from false to true, plus cover for the
 * accepted flip itself.
 *
 * The request changes exactly one setting — `build.minify` — so the
 * characterization assertions below deliberately do NOT pin that flag's value
 * (asserting `minify: false` would freeze the behavior the request
 * intentionally changes). What they protect is the rest of the build block
 * that must survive the edit:
 *
 *   - `emptyOutDir: true` — the build wipes stale assets from `dist/` so a
 *     removed chunk cannot linger and be served;
 *   - `sourcemap: false` — production bundles ship without source maps;
 *   - the `build` block itself still exists, so a future edit cannot silently
 *     drop the whole section;
 *   - the `@` -> `./src` resolve alias is still wired, which every application
 *     import depends on.
 *
 * The accepted change is covered by the `minify` test at the end: the flag is
 * now `true`, so a regression back to `false` (or a dropped flag) fails here.
 *
 * The config is read as source text rather than imported: importing
 * `vite.config.js` loads the `vite`/esbuild runtime, which aborts under the
 * jsdom test environment with an esbuild TextEncoder invariant violation. The
 * assertions below match the literal config entries, which is exactly the
 * production artifact under test.
 *
 * The path is resolved from the frontend package root (the working directory
 * the `test` script runs in) rather than from `import.meta.url`, which Vitest
 * rewrites to a non-file URL under jsdom.
 */
const configPath = resolve(process.cwd(), "vite.config.js");
const configSource = readFileSync(configPath, "utf8");

describe("vite build configuration", () => {
  it("keeps the build block present", () => {
    expect(configSource).toMatch(/build\s*:\s*\{/);
  });

  it("empties the output directory before each build", () => {
    expect(configSource).toMatch(/emptyOutDir\s*:\s*true/);
  });

  it("does not emit source maps in production builds", () => {
    expect(configSource).toMatch(/sourcemap\s*:\s*false/);
  });

  it("keeps the @ -> ./src resolve alias wired", () => {
    expect(configSource).toMatch(/find\s*:\s*["']@["']/);
    expect(configSource).toMatch(/new URL\(\s*["']\.\/src["']/);
  });

  it("minifies production bundles (accepted minify flip)", () => {
    // The accepted requirement sets build.minify to true so the production
    // build emits minified JS and CSS bundles. A regression to `false` or a
    // dropped flag fails here.
    expect(configSource).toMatch(/minify\s*:\s*true/);
  });
});
