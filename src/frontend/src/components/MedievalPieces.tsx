import { type Piece, PieceType, Team } from "../backend";

/**
 * Merida chess piece set — inlined SVG paths (viewBox 0 0 45 45).
 *
 * Design notes:
 * - Each piece is rendered as an inline <svg> with a single shared viewBox
 *   "0 0 45 45" (the standard merida/cburnett chess glyph coordinate space)
 *   and width/height 100% so it scales to fill its container (the parent
 *   piece-span in Chessboard.tsx, or the w-8 h-8 cell in the promotion
 *   picker). No extra scale transforms — adding a scale transform caused
 *   the prior cburnett distortion bug; we let the viewBox + width/height
 *   100% do all the work.
 * - SVG path data is inlined as string constants — no external fetch, no
 *   asset import, no network call. This avoids the build-pipeline hangs
 *   seen with fetching external SVG sets.
 * - Merida is a single-outline set: the SAME path data is used for both
 *   White and Black of each piece type; color is applied via fill, not via
 *   different paths.
 * - White pieces use a light fill with a baked dark outline (stroke,
 *   stroke-width ~1.3, stroke-linejoin round) so they stay visible on any
 *   square color. Black pieces render solid dark with the same dark stroke
 *   so the silhouette stays crisp on light squares too.
 * - Fills and outline are sourced from per-theme CSS variables defined in
 *   index.css so the same glyph adapts to light (cream/walnut), dark
 *   (high-contrast cream/slate), and neon (cyan/magenta) themes without
 *   changing the SVG paths, viewBox, or stroke-width. The baked dark
 *   outline on white pieces is preserved in every theme via
 *   var(--piece-outline) (light #3a2a1a, dark #0f172a, neon #0a0a14).
 * - Public export signature (MedievalPiece + MedievalPieceProps + default)
 *   is unchanged so Chessboard.tsx and the promotion picker render unchanged.
 */

/**
 * Theme-aware fill + outline sources. These resolve to the per-theme values
 * defined in index.css (:root light, .dark, .dark-neon):
 *   light  — white #f0d9b5, black #3a2a1a, outline #3a2a1a
 *   dark   — white #f5e6c8, black #1e293b, outline #0f172a
 *   neon   — white #22d3ee, black #e879f9, outline #0a0a14
 * The CSS cascade picks the right value based on the .dark / .dark-neon
 * class on <html>; the SVG just references the variable.
 */
const WHITE_FILL = "var(--piece-white-fill)";
const BLACK_FILL = "var(--piece-black-fill)";
const OUTLINE = "var(--piece-outline)";

/** Standard merida/cburnett chess glyph coordinate space. Shared by all pieces. */
const VIEW_BOX = "0 0 45 45";

/**
 * Merida-style path data per PieceType. The same path string is used for both
 * White and Black of each piece type — merida is a single-outline set where
 * color is applied via fill, not via different paths. Inlined — no external
 * assets.
 */
const PATHS: Record<PieceType, string> = {
  [PieceType.King]:
    "M 22.5,11.63 L 22.5,6 M 20,8 L 25,8 M 22.5,25 s 4.5,-7.5 3,-10.5 c 0,0 -1,-2.5 -3,-2.5 s -3,2.5 -3,2.5 c -1.5,3 3,10.5 3,10.5 M 11.5,37 c 5.5,3.5 15.5,3.5 21,0 v -7 s 9,-4.5 6,-10.5 c -4,-6.5 -13.5,-3.5 -16,4 V 27 v -3.5 c -3.5,-7.5 -13,-10.5 -16,-4 -3,6 5,10 5,10 z M 11.5,30 c 5.5,-3 15.5,-3 21,0 m -21,3.5 c 5.5,-3 15.5,-3 21,0 m -21,3.5 c 5.5,-3 15.5,-3 21,0",
  [PieceType.Queen]:
    "M 8,12 a 2,2 0 1,1 -4,0 a 2,2 0 1,1 4,0 m 16.5,-4.5 a 2,2 0 1,1 -4,0 a 2,2 0 1,1 4,0 M 41,12 a 2,2 0 1,1 -4,0 a 2,2 0 1,1 4,0 M 16,8.5 a 2,2 0 1,1 -4,0 a 2,2 0 1,1 4,0 M 33,9 a 2,2 0 1,1 -4,0 a 2,2 0 1,1 4,0 M 9,26 c 8.5,-1.5 21,-1.5 27,0 l 2,-12 -7,11 V 11 l -5.5,13.5 -3,-15 -3,15 -5.5,-14 V 25 L 7,14 z M 9,26 c 0,2 1.5,2 2.5,4 1,1.5 1,1 0.5,3.5 -1.5,1 -1.5,2.5 -1.5,2.5 -1.5,1.5 0.5,2.5 0.5,2.5 6.5,1 16.5,1 23,0 0,0 1.5,-1 0,-2.5 0,0 0.5,-1.5 -1,-2.5 -0.5,-2.5 -0.5,-2 0.5,-3.5 1,-2 2.5,-2 2.5,-4 -8.5,-1.5 -18.5,-1.5 -27,0 z M 11.5,30 c 3.5,-1 18.5,-1 22,0 M 12,33.5 c 6,-1 15,-1 21,0",
  [PieceType.Rook]:
    "M 9,39 L 36,39 L 36,36 L 9,36 L 9,39 z M 9,36 L 36,36 L 36,33 L 9,33 L 9,36 z M 13,33 L 13,18 L 9,18 L 9,15 L 36,15 L 36,18 L 32,18 L 32,33 L 28,33 L 28,18 L 25,18 L 25,33 L 20,33 L 20,18 L 17,18 L 17,33 L 13,33 z M 9,15 L 36,15 L 36,12 L 9,12 L 9,15 z M 11,12 L 11,9 L 15,9 L 15,11 L 20,11 L 20,9 L 25,9 L 25,11 L 30,11 L 30,9 L 34,9 L 34,12 L 11,12 z",
  [PieceType.Bishop]:
    "M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.354.49-2.323.47-3-.5 1.354-1.94 3-2 3-2zm6-4c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2zM25 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0z M17.5 26h10M15 30h15m-7.5-14.5v5M20 18h5",
  [PieceType.Knight]:
    "M 22,10 C 32.5,11 38.5,18 38,39 L 15,39 C 15,30 25,32.5 23,18 M 24,18 C 24.38,20.91 18.45,25.37 16,27 C 13,29 13.18,31.34 11,31 C 9.958,30.06 12.41,27.96 11,28 C 10,28 11.19,29.23 10,30 C 9,30 5.997,31 6,26 C 6,24 12,14 12,14 C 12,14 13.89,12.1 14,10.5 C 13.27,9.506 13.5,8.5 13.5,7.5 C 14.5,6.5 16.5,10 16.5,10 L 18.5,10 C 18.5,10 19.28,8.008 21,7 C 22,7 22,10 22,10 M 9.5 25.5 A 0.5 0.5 0 1 1 8.5,25.5 A 0.5 0.5 0 1 1 9.5 25.5 z M 15 15.5 A 0.5 1.5 0 1 1 14,15.5 A 0.5 1.5 0 1 1 15 15.5 z M 24.55,10.4 L 24.1,11.85 L 24.6,12 C 27.75,13 30.25,14.49 32.5,18.75 C 34.75,23.01 35.75,29.06 35.25,39 L 35.2,39.5 L 37.45,39.5 L 37.5,39 C 38,28.94 36.62,22.15 34.25,17.66 C 31.88,13.17 28.46,11.02 25.06,10.5 L 24.55,10.4 z",
  [PieceType.Pawn]:
    "M 22.5,9 C 20.5,9 19,10.5 19,12.5 C 19,13.5 19.5,14.5 20.5,15 C 18.5,16 17,18 17,20.5 C 17,23 18.5,25 20.5,26 C 18,27 16,29 16,32 L 16,33 L 29,33 L 29,32 C 29,29 27,27 24.5,26 C 26.5,25 28,23 28,20.5 C 28,18 26.5,16 24.5,15 C 25.5,14.5 26,13.5 26,12.5 C 26,10.5 24.5,9 22.5,9 z M 16,33 L 29,33 L 29,36 L 16,36 L 16,33 z M 14,36 L 31,36 L 31,39 L 14,39 L 14,36 z",
};

interface PieceArtProps {
  /** White team or Black team — controls fill + outline. */
  color: Team;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export interface MedievalPieceProps extends PieceArtProps {
  /** Which chess piece to render. */
  pieceType: PieceType;
}

/**
 * Render a single chess piece as an inline SVG (merida set). The <svg> fills
 * its container (the parent piece-span in Chessboard.tsx, or the w-8 h-8
 * cell in the promotion picker) via width/height 100% and uses the shared
 * "0 0 45 45" viewBox — no extra scale transforms. Both White and Black use
 * the same path data per piece type; color is applied via fill sourced from
 * the per-theme CSS variables (--piece-white-fill / --piece-black-fill). Both
 * colors get a baked dark outline (stroke var(--piece-outline),
 * stroke-width ~1.3, stroke-linejoin round) so silhouettes stay crisp on any
 * square color in every theme. The neon glow itself is applied by the
 * parent piece-span wrapper (see Chessboard.tsx / CapturedTray.tsx /
 * EndGameModal.tsx) via the .piece-glow-white / .piece-glow-black utilities
 * scoped to .dark-neon — this component only owns fill + outline.
 */
export function MedievalPiece({ pieceType, color }: MedievalPieceProps) {
  const isWhite = color === Team.White;
  const pathData = PATHS[pieceType] ?? "";
  const label = `${isWhite ? "White" : "Black"} ${pieceType.toLowerCase()}`;
  const fill = isWhite ? WHITE_FILL : BLACK_FILL;
  // Merida is a single-outline set: both colors share the same dark stroke so
  // the silhouette stays crisp on both light and dark squares. stroke-width
  // ~1.3 of the 45-unit viewBox keeps the outline clean without thickening.
  const stroke = OUTLINE;
  const strokeWidth = 1.3;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={VIEW_BOX}
      width="100%"
      height="100%"
      style={{ display: "block", userSelect: "none" }}
      preserveAspectRatio="xMidYMid meet"
    >
      <path
        d={pathData}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default MedievalPiece;
