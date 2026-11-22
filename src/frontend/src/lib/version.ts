/**
 * Shared jalca version constant — the SINGLE source of truth for the
 * current published jalca version. Bump this one constant on publish and
 * every Wordmark instance (Login_Page header + Main_Page header) updates.
 *
 * The version is stored as the bare version tag (e.g. "v115") so it can
 * be composed into the full wordmark string `jalca v<version>` without
 * string surgery. `JALCA_WORDMARK` is the pre-composed display string the
 * Wordmark component renders verbatim.
 *
 * Keep the `v` prefix lowercase to match the established convention
 * `jalca v115` (lowercase `v`, no space between `v` and the number).
 */

/** The current published jalca version tag, e.g. "v115". */
export const JALCA_VERSION = "v425";

/** The full wordmark string rendered verbatim by the Wordmark component,
 * e.g. "jalca v115". Composed once so every consumer renders the exact
 * same string without re-deriving it. */
export const JALCA_WORDMARK = `jalca ${JALCA_VERSION}`;
