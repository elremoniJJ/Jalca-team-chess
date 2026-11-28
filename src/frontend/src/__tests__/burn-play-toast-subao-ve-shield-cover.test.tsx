import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the accepted Subao Ve burn wording.
 *
 * The request fixes a misclassification in the burn-and-play toast: a
 * defensive Subao Ve burn contributes a shield to the burning team, but the
 * backend returns it with `resolution === null` (there is no offensive
 * resolution to report). The toast previously treated every resolution-less
 * burn as a legacy inert burn and rendered "burned inert, no shield effect".
 *
 * The accepted discriminator is the game number:
 *   - resolution absent AND gameNumber defined  -> defensive Subao Ve shield
 *     contribution wording, never the legacy message;
 *   - resolution absent AND gameNumber absent   -> a genuine legacy burn,
 *     which keeps its specific reason or the generic legacy fallback.
 *
 * This file pins the NEW branch (the Subao Ve shield contribution) and the
 * boundary that separates it from a true legacy burn. The adjacent legacy and
 * offensive-spell behavior is protected in
 * burn-play-toast-subao-ve-adjacent-characterization.test.tsx.
 *
 * These are pure component contracts with no actor or network access. The
 * backend classification itself is not observable here; see
 * episode.coverageLimits.
 */

import {
  type BurnAndPlayResult,
  LegacyReason,
  SpellKind,
  SpellResolutionOutcome,
  Team,
} from "@/backend";
import { BurnPlayToast } from "@/components/BurnPlayToast";
import type { BurnPlayToastEntry } from "@/components/BurnPlayToast";

// The detail line is a single span containing several text nodes, so match on
// a regex against the rendered text rather than an exact string.
const SUBAO_VE_SHIELD_TEXT =
  /Defensive Subao Ve — contributes a shield to your team\./;
const GENERIC_LEGACY_TEXT = /Legacy NFT — burned inert, no shield effect\./;

function makeResult(
  overrides: Partial<BurnAndPlayResult> = {},
): BurnAndPlayResult {
  return {
    tokenId: 42n,
    spellName: "Subao Ve",
    gameNumber: 7n,
    team: Team.White,
    kind: SpellKind.SubaoVe,
    resolution: undefined,
    removedSquares: [],
    insufficientMaterial: false,
    transformedSquares: [],
    ...overrides,
  };
}

function entry(id: string, result: BurnAndPlayResult): BurnPlayToastEntry {
  return { id, result };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("burn-and-play toast Subao Ve shield contribution", () => {
  it("renders the shield-contribution wording for a resolution-less Subao Ve burn with a game number", () => {
    render(
      <BurnPlayToast
        toasts={[entry("burn-1", makeResult())]}
        onClose={vi.fn()}
      />,
    );

    // The defensive burn reads as a shield contribution...
    expect(screen.getByText(SUBAO_VE_SHIELD_TEXT)).toBeInTheDocument();
    // ...and never as the legacy inert message.
    expect(
      screen.queryByText(/burned inert, no shield effect/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Legacy NFT/)).not.toBeInTheDocument();
  });

  it("still names the Subao Ve spell and its game number", () => {
    render(
      <BurnPlayToast
        toasts={[entry("burn-1", makeResult())]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Subao Ve")).toBeInTheDocument();
    expect(screen.getByText(/NFT #42/)).toBeInTheDocument();
    expect(screen.getByText(/Game 7/)).toBeInTheDocument();
  });

  it("does not render the legacy message even when a legacy reason is present alongside a game number", () => {
    // The game number is the discriminator: a resolution-less burn classified
    // against a real game is a Subao Ve shield contribution, so a stray reason
    // must not pull it back into the legacy wording.
    render(
      <BurnPlayToast
        toasts={[
          entry(
            "burn-1",
            makeResult({ legacyReason: LegacyReason.keysAbsent }),
          ),
        ]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(SUBAO_VE_SHIELD_TEXT)).toBeInTheDocument();
    expect(
      screen.queryByText(/burned inert, no shield effect/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/spell keys absent/)).not.toBeInTheDocument();
  });

  it("keeps a true legacy burn (no game number) on its specific reason, not the shield wording", () => {
    render(
      <BurnPlayToast
        toasts={[
          entry(
            "burn-1",
            makeResult({
              gameNumber: undefined,
              legacyReason: LegacyReason.readFailed,
            }),
          ),
        ]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/metadata read failed/)).toBeInTheDocument();
    expect(screen.queryByText(SUBAO_VE_SHIELD_TEXT)).not.toBeInTheDocument();
  });

  it("keeps a true legacy burn with no reason on the generic legacy wording", () => {
    render(
      <BurnPlayToast
        toasts={[
          entry(
            "burn-1",
            makeResult({ gameNumber: undefined, legacyReason: undefined }),
          ),
        ]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(GENERIC_LEGACY_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(SUBAO_VE_SHIELD_TEXT)).not.toBeInTheDocument();
  });

  it("keeps an offensive spell burn on its fired resolution wording", () => {
    render(
      <BurnPlayToast
        toasts={[
          entry(
            "burn-1",
            makeResult({
              spellName: "Minor Spell",
              kind: SpellKind.Minor,
              resolution: {
                attacker: Team.White,
                defender: Team.Black,
                spellValue: 5n,
                shieldBefore: 4n,
                shieldAfter: 0n,
                outcome: SpellResolutionOutcome.fired,
                firesOnBoard: true,
              },
            }),
          ),
        ]}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/Fired on the board — 5 vs Black shield 4 → 0\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(SUBAO_VE_SHIELD_TEXT)).not.toBeInTheDocument();
  });

  it("keeps an offensive spell burn on its cancelled resolution wording", () => {
    render(
      <BurnPlayToast
        toasts={[
          entry(
            "burn-1",
            makeResult({
              spellName: "Major Spell",
              kind: SpellKind.Major,
              resolution: {
                attacker: Team.White,
                defender: Team.Black,
                spellValue: 2n,
                shieldBefore: 6n,
                shieldAfter: 4n,
                outcome: SpellResolutionOutcome.cancelled,
                firesOnBoard: false,
              },
            }),
          ),
        ]}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/Cancelled — 2 vs Black shield 6 → 4\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(SUBAO_VE_SHIELD_TEXT)).not.toBeInTheDocument();
  });
});
