/**
 * OpenChatIcon — the clickable OpenChat channel badge shown immediately to
 * the LEFT of the JALCA wordmark in BOTH headers (the login page header and
 * the main page top brand buffer).
 *
 * Behavior:
 *   - Renders the user-supplied OpenChat channel icon from the public asset
 *     path `/assets/openchat/openchat-channel-icon.png`. The real image is
 *     NOT present in the workspace; the directory
 *     `src/frontend/public/assets/openchat/` is created so the real PNG can
 *     be dropped in without any code change. Until then the <img> renders
 *     with an empty alt (decorative) and the link keeps its accessible name
 *     from `aria-label`, so the control is still reachable and announced.
 *   - Links to the JALCA OpenChat channel and opens in a new tab with
 *     `target="_blank"` + `rel="noopener noreferrer"`.
 *   - Sizes with `em` units so the icon tracks the surrounding header font
 *     size (the wordmark text size) instead of a fixed pixel size.
 *   - Has a subtle glow on hover/focus, driven by the `.openchat-icon`
 *     class in index.css so it re-themes with every palette.
 *   - Carries an `aria-label` describing the OpenChat channel.
 */

/** The JALCA OpenChat channel URL. */
export const OPENCHAT_CHANNEL_URL =
  "https://oc.app/community/ff4v6-7iaaa-aaaac-bgawa-cai/channel/2618902881";

/** Public path for the user-supplied OpenChat channel icon. The real image
 * is dropped into `src/frontend/public/assets/openchat/` by the user. */
export const OPENCHAT_ICON_SRC = "/assets/openchat/openchat-channel-icon.png";

export interface OpenChatIconProps {
  /** Optional deterministic marker id (e.g. "login.openchat_link"). Passed
   * through as `data-ocid` so test harnesses can target the link. */
  "data-ocid"?: string;
}

/**
 * Render the clickable OpenChat channel icon. See the file docstring for
 * the full behavior contract.
 */
export function OpenChatIcon({ "data-ocid": dataOcid }: OpenChatIconProps) {
  return (
    <a
      href={OPENCHAT_CHANNEL_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open the JALCA OpenChat channel"
      title="Open the JALCA OpenChat channel"
      data-ocid={dataOcid}
      className="openchat-icon"
    >
      <img
        src={OPENCHAT_ICON_SRC}
        alt="OpenChat channel"
        className="openchat-icon-img"
      />
    </a>
  );
}
