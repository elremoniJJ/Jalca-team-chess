import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the burn-and-play toast behavior that must SURVIVE the
 * Subao Ve wording change, taken BEFORE that change.
 *
 * The request intentionally changes the resolution line for a defensive Subao
 * Ve burn: a Subao Ve burn contributes a shield and must no longer read as the
 * legacy "burned inert, no shield effect" message. That means the toast's
 * wording for a Subao Ve burn WILL change, so this file deliberately does NOT
 * pin what a Subao Ve burn currently renders.
 *
 * What it protects is the adjacent behavior the request leaves alone:
 *   - a TRUE legacy burn — resolution absent AND game number absent AND a
 *     specific legacyReason present — still renders that specific reason text;
 *   - a true legacy burn with no reason still renders the generic legacy
 *     wording;
 *   - an offensive spell that carries a fired resolution still renders the
 *     existing shield math and no legacy wording;
 *   - an offensive spell that carries a cancelled resolution still renders the
 *     existing shield math and no legacy wording;
 *   - a resolution whose outcome is `legacy` still renders the specific reason
 *     when one is present;
 *   - the headline, token id, team, and close-button contract are unchanged.
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

describe("burn-and-play toast adjacent invariants for the Subao Ve wording change", () => {
  it("renders the specific reason for a true legacy burn (no resolution, no game number, reason set)", () => {
    const legacy = makeResult({
      gameNumber: undefined,
      resolution: undefined,
      legacyReason: LegacyReason.keysAbsent,
    });
    render(
      <BurnPlayToast toasts={[entry("burn-1", legacy)]} onClose={vi.fn()} />,
    );

    // The triple condition (resolution absent AND game number absent AND a
    // reason present) is a genuine legacy burn: its specific reason survives.
    expect(screen.getByText(/spell keys absent/)).toBeInTheDocument();
    expect(
      screen.queryByText(/burned inert, no shield effect/),
    ).not.toBeInTheDocument();
  });

  it("renders the generic legacy wording for a true legacy burn with no reason", () => {
    const legacy = makeResult({
      gameNumber: undefined,
      resolution: undefined,
      legacyReason: undefined,
    });
    render(
      <BurnPlayToast toasts={[entry("burn-1", legacy)]} onClose={vi.fn()} />,
    );

    // With no specific reason, the generic legacy wording is the fallback.
    expect(
      screen.getByText(/Legacy NFT — burned inert, no shield effect\./),
    ).toBeInTheDocument();
  });

  it("renders the fired shield math and no legacy wording for an offensive burn", () => {
    render(
      <BurnPlayToast
        toasts={[entry("burn-1", makeResult())]}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/Fired on the board — 5 vs Black shield 4 → 0\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Legacy/i)).not.toBeInTheDocument();
  });

  it("renders the cancelled shield math and no legacy wording for an offensive burn", () => {
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

  it("renders the specific reason when a resolution outcome is legacy", () => {
    const legacyResolution = makeResult({
      resolution: {
        attacker: Team.White,
        defender: Team.Black,
        spellValue: 0n,
        shieldBefore: 0n,
        shieldAfter: 0n,
        outcome: SpellResolutionOutcome.legacy,
        firesOnBoard: false,
      },
      legacyReason: LegacyReason.readFailed,
    });
    render(
      <BurnPlayToast
        toasts={[entry("burn-1", legacyResolution)]}
        onClose={vi.fn()}
      />,
    );

    // A resolution present with the legacy outcome still surfaces the specific
    // reason rather than the generic wording.
    expect(screen.getByText(/metadata read failed/)).toBeInTheDocument();
    expect(
      screen.queryByText(/burned inert, no shield effect/),
    ).not.toBeInTheDocument();
  });

  it("keeps the headline, token id, team, and close-button contract", async () => {
    const onClose = vi.fn();
    render(
      <BurnPlayToast
        toasts={[entry("burn-42", makeResult())]}
        onClose={onClose}
      />,
    );

    expect(screen.getByText("Minor Spell")).toBeInTheDocument();
    expect(screen.getByText(/NFT #42/)).toBeInTheDocument();
    expect(screen.getByText(/White/)).toBeInTheDocument();
    expect(screen.getByText("Burned & played")).toBeInTheDocument();

    screen
      .getByRole("button", {
        name: "Dismiss burn-and-play toast for Minor Spell",
      })
      .click();
    expect(onClose).toHaveBeenCalledWith("burn-42");
  });
});
