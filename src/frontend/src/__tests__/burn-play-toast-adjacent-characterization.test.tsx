import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the burn-and-play toast behavior that must SURVIVE the
 * legacy-reason change, taken BEFORE that change.
 *
 * The request intentionally changes how a Legacy burn is classified and
 * displayed: a failed/trapped/empty metadata read is retried and no longer
 * collapses into Legacy, and a Legacy classification carries a specific reason
 * that the toast renders. That means the toast's Legacy wording WILL change,
 * so this file deliberately does NOT pin the current legacy text.
 *
 * What it protects is the adjacent behavior the request leaves alone:
 *   - a burn that carries a resolution (fired or cancelled) renders the
 *     existing shield math and must NOT render any Legacy wording, even though
 *     the result may carry no reason field;
 *   - a burn that carries a game number renders "Game N" in the detail line,
 *     not "Legacy NFT";
 *   - the headline, the token id, the team, and the close-button contract are
 *     unchanged.
 *
 * These are pure component contracts with no actor or network access. The
 * backend classification itself is not observable here; see
 * episode.coverageLimits.
 */

import {
  type BurnAndPlayResult,
  SpellKind,
  SpellResolutionOutcome,
  Team,
} from "@/backend";
import { BurnPlayToast } from "@/components/BurnPlayToast";
import type { BurnPlayToastEntry } from "@/components/BurnPlayToast";

function makeResult(
  overrides: Partial<BurnAndPlayResult> = {},
): BurnAndPlayResult {
  return {
    tokenId: 42n,
    spellName: "Minor Spell",
    gameNumber: 7n,
    team: Team.White,
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

describe("burn-and-play toast adjacent invariants", () => {
  it("renders the fired shield math and no legacy wording for a resolved burn", () => {
    render(
      <BurnPlayToast
        toasts={[entry("burn-1", makeResult())]}
        onClose={vi.fn()}
      />,
    );

    // The fired resolution line is the existing shield math, unchanged.
    expect(
      screen.getByText(/Fired on the board — 5 vs Black shield 4 → 0\./),
    ).toBeInTheDocument();
    // A resolved burn is not a legacy burn: no legacy wording may appear,
    // even though the result carries no reason field.
    expect(screen.queryByText(/Legacy/i)).not.toBeInTheDocument();
  });

  it("renders the cancelled shield math and no legacy wording for a cancelled burn", () => {
    const cancelled = makeResult({
      resolution: {
        attacker: Team.White,
        defender: Team.Black,
        spellValue: 2n,
        shieldBefore: 6n,
        shieldAfter: 4n,
        outcome: SpellResolutionOutcome.cancelled,
        firesOnBoard: false,
      },
    });
    render(
      <BurnPlayToast toasts={[entry("burn-1", cancelled)]} onClose={vi.fn()} />,
    );

    expect(
      screen.getByText(/Cancelled — 2 vs Black shield 6 → 4\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Legacy/i)).not.toBeInTheDocument();
  });

  it("renders the game number in the detail line for a non-legacy burn", () => {
    render(
      <BurnPlayToast
        toasts={[entry("burn-1", makeResult({ gameNumber: 7n }))]}
        onClose={vi.fn()}
      />,
    );

    // A burn that carries a game number shows "Game N", never "Legacy NFT".
    expect(screen.getByText(/Game 7/)).toBeInTheDocument();
    expect(screen.queryByText(/Legacy NFT/)).not.toBeInTheDocument();
  });

  it("keeps the headline, token id, and team for a resolved burn", () => {
    render(
      <BurnPlayToast
        toasts={[entry("burn-1", makeResult())]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Minor Spell")).toBeInTheDocument();
    expect(screen.getByText(/NFT #42/)).toBeInTheDocument();
    expect(screen.getByText(/White/)).toBeInTheDocument();
    expect(screen.getByText("Burned & played")).toBeInTheDocument();
  });

  it("keeps the close-button contract for a resolved burn", async () => {
    const onClose = vi.fn();
    render(
      <BurnPlayToast
        toasts={[entry("burn-42", makeResult())]}
        onClose={onClose}
      />,
    );

    screen
      .getByRole("button", {
        name: "Dismiss burn-and-play toast for Minor Spell",
      })
      .click();
    expect(onClose).toHaveBeenCalledWith("burn-42");
  });
});
