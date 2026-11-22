/**
 * Wordmark — the single shared component that renders the jalca version
 * wordmark `jalca v<version>` verbatim. Used by BOTH the Login_Page
 * header (route "/") and the Main_Page header (Layout's top brand
 * buffer) so the version lives in ONE update location: `lib/version.ts`.
 *
 * Behavior:
 *   - Renders the verbatim string from `JALCA_WORDMARK` (e.g. "jalca v113")
 *     as its text content. The version is never hardcoded in JSX here —
 *     it flows from the single `JALCA_VERSION` constant via
 *     `JALCA_WORDMARK`, so bumping the version is a one-line edit in
 *     `lib/version.ts` and every Wordmark instance updates.
 *   - The `aria-label` is always the verbatim wordmark string so screen
 *     readers announce the exact published version regardless of any
 *     CSS text-transform on the visual element.
 *   - Accepts a `className` prop so each usage site applies its own
 *     per-theme visual treatment class (`.brand-wordmark` for the Layout
 *     header band, `.login-wordmark` for the login card header). This
 *     preserves the existing per-theme CSS treatments exactly — the
 *     Wordmark component owns the text + aria-label, the caller owns the
 *     visual styling.
 *   - Polymorphic `as` prop lets the login site render it as an `<h1>`
 *     (page heading semantics) while the Layout site renders it as a
 *     `<span>` (inline brand text). Defaults to `"span"`.
 *   - Passes through arbitrary extra props (e.g. `data-ocid`,
 *     `data-theme`) so callers keep their deterministic markers and
 *     theme hooks.
 *
 * The CSS `text-transform: none` rule on `.login-wordmark` (index.css)
 * is preserved — the login variant continues to render the version
 * verbatim. The `.brand-wordmark` class uppercases the visible text per
 * the Layout's existing treatment; the `aria-label` always carries the
 * verbatim version so the published version is always available to
 * assistive technology exactly as authored.
 */

import type { ElementType } from "react";
import { JALCA_WORDMARK } from "../lib/version";

export interface WordmarkProps {
  /** The element type to render. Defaults to `"span"`. The login site
   * passes `"h1"` for page-heading semantics; the Layout site uses the
   * default `"span"` for inline brand text. */
  as?: ElementType;
  /** Visual treatment class — `.brand-wordmark` for the Layout header
   * band, `.login-wordmark` for the login card header. The Wordmark
   * component never hardcodes a class so each site keeps its per-theme
   * CSS treatment. */
  className?: string;
  /** Optional deterministic marker id (e.g. "login.wordmark"). Passed
   * through as `data-ocid` so test harnesses can target the wordmark. */
  "data-ocid"?: string;
  /** Optional theme hook (e.g. the login site passes the current theme
   * so `.login-wordmark`'s per-theme CSS variants apply). Passed through
   * as `data-theme`. */
  "data-theme"?: string;
}

/**
 * Render the shared jalca version wordmark. See the file docstring for
 * the full behavior contract.
 */
export function Wordmark({
  as,
  className,
  "data-ocid": dataOcid,
  "data-theme": dataTheme,
  ...rest
}: WordmarkProps) {
  const Tag = as ?? "span";
  return (
    <Tag
      className={className}
      aria-label={JALCA_WORDMARK}
      data-ocid={dataOcid}
      data-theme={dataTheme}
      {...rest}
    >
      {JALCA_WORDMARK}
    </Tag>
  );
}
