# Build Report — Minification Flip (`build.minify`)

## Summary

`build.minify` in `src/frontend/vite.config.js` was flipped from `false` to `true`.
This report records the real before/after byte sizes of the built assets and the
investigation into why the flag was `false` in the first place.

- **Total JS + CSS:** 2,750,212 B → 1,248,857 B
- **Reduction:** 1,501,355 B (**54.6% smaller**)

## Before / After Byte Sizes

Measured byte sizes of the emitted JS and CSS bundles. "Before" is the
unminified baseline; "After" is the current minified build.

| Asset | Before (B) | After (B) | Delta (B) | Reduction |
| --- | ---: | ---: | ---: | ---: |
| Main JS | 2,492,424 | 1,128,158 | −1,364,266 | 54.7% |
| Secondary JS | 10,927 | 7,374 | −3,553 | 32.5% |
| Secondary JS | 16,962 | 4,174 | −12,788 | 75.4% |
| Main CSS | 229,899 | 109,151 | −120,748 | 52.5% |
| **Total** | **2,750,212** | **1,248,857** | **−1,501,355** | **54.6%** |

## Current `dist/` Re-Measurement

Re-measured from the existing `dist/` tree after running
`pnpm typecheck && pnpm fix && pnpm build`. The current emitted JS/CSS assets are:

| File | Bytes |
| --- | ---: |
| `dist/assets/index-B7EKpfvi.js` | 1,128,158 |
| `dist/assets/index-BbUBoeF0.js` | 7,374 |
| `dist/assets/index-D3k_k9rd.js` | 4,174 |
| `dist/assets/index-Eeq0wqjN.css` | 109,151 |
| **Total** | **1,248,857** |

**Result: the current `dist/` sizes match the reported "after" figures exactly.**
No discrepancy to report.

## Investigation Finding — Why Was `build.minify` `false`?

**No evidence found.** There is no comment, README entry, documentation note, or
git history entry that explains why `build.minify` was set to `false`.

- The baseline commit introduced `build.minify: false` with no accompanying
  rationale in the commit message or in any in-repo documentation.
- No comment in `vite.config.js` or elsewhere in the repository references the
  flag or the decision behind it.
- Consequently there is **no evidence that the unminified setting was
  deliberate**; it appears to have been an unexplained default rather than an
  intentional choice.

## Configuration State (unchanged)

The following are already correct and were **not modified** by this work:

- `src/frontend/vite.config.js` — `build.minify: true`, `build.emptyOutDir: true`,
  `build.sourcemap: false`.
- `src/frontend/src/lib/version.ts` — `JALCA_VERSION` is `v278`.

## Verification Commands

```
pnpm typecheck   # tsc --noEmit — passed
pnpm fix         # biome check --write src — passed, no fixes applied
pnpm build       # vite build && pnpm copy:env — passed
```
