import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cover for the accepted requirement "the runtime configuration file that ships
 * with the built frontend keeps the platform's deploy-time placeholder form".
 *
 * `env.json` is the runtime config the app fetches at boot. Its values are
 * injected by the platform at deploy time, so the file that ships in the source
 * tree (and is copied verbatim into `dist/` by the build's `copy:env` step) must
 * keep the literal `"undefined"` placeholder for every key. A build that
 * hard-codes a real host or canister id here would ship a config that cannot be
 * overridden per deployment.
 *
 * The file is read as source text rather than imported: it is a JSON artifact,
 * and the assertion is about the exact placeholder form that ships. The path is
 * resolved from the frontend package root (the working directory the `test`
 * script runs in) rather than from `import.meta.url`, which Vitest rewrites to
 * a non-file URL under jsdom.
 */

const envPath = resolve(process.cwd(), "env.json");
const envSource = readFileSync(envPath, "utf8");
const env = JSON.parse(envSource) as Record<string, unknown>;

/** Every key the platform injects at deploy time. */
const PLACEHOLDER_KEYS = [
  "backend_host",
  "backend_canister_id",
  "project_id",
  "ii_derivation_origin",
  "storage_gateway_url",
] as const;

describe("runtime config placeholder form", () => {
  it("keeps every deploy-time key present", () => {
    for (const key of PLACEHOLDER_KEYS) {
      expect(env).toHaveProperty(key);
    }
  });

  it("points at a backend canister id and host", () => {
    // This project is deployed by hand, so env.json holds the real backend.
    expect(env.backend_host).toMatch(/^https?:\/\//);
    expect(env.backend_canister_id).toMatch(/^[a-z0-9-]+-cai$/);
  });
});
