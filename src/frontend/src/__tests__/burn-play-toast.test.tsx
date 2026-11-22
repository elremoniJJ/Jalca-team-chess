import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the distinct burn-and-play toast.
 *
 * The request adds a distinct alert/toast that appears when an NFT is burned
 * and played, naming the burned NFT and its spell, and requires it to be
 * visually different from the game's existing exercise, drinking, and opening
 * toasts. The existing three toast contracts are protected separately in
 * existing-toasts-characterization.test.tsx; this file pins the NEW toast's
 * rendering contract:
 *   - one toast per burn-and-play result, naming the spell and the token id;
 *   - the resolution line states the shield math for a fired spell (value vs
 *     shield, before → after) and for a cancelled spell;
 *   - a legacy burn (no game number, no resolution) reads as inert;
 *   - the container carries its own distinct marker, separate from the
 *     exercise / drinking / opening containers;
 *   - the close button reports the toast id.
 *
 * These are pure component contracts with no actor or network access.
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

function makeEntry(id: string, result: BurnAndPlayResult): BurnPlayToastEntry {
  return { id, result };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BurnPlayToast rendering", () => {
  it("names the burned NFT and its spell", () => {
    render(
      <BurnPlayToast
        toasts={[makeEntry("burn-1", makeResult())]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Minor Spell — Minor")).toBeInTheDocument();
    expect(screen.getByText(/NFT #42/)).toBeInTheDocument();
    expect(screen.getByText("Burned & played")).toBeInTheDocument();
  });

  it("states the shield math for a fired spell", () => {
    render(
      <BurnPlayToast
        toasts={[makeEntry("burn-1", makeResult())]}
        onClose={vi.fn()}
      />,
    );

    // The spell value strictly exceeded the shield: it fired on the board and
    // the shield dropped to zero.
    expect(
      screen.getByText(/Fired on the board — 5 vs Black shield 4 → 0\./),
    ).toBeInTheDocument();
  });

  it("states the shield math for a cancelled spell", () => {
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
      <BurnPlayToast
        toasts={[makeEntry("burn-1", cancelled)]}
        onClose={vi.fn()}
      />,
    );

    // The spell value was equal to or less than the shield: it was cancelled
    // and the shield was reduced by the spell value.
    expect(
      screen.getByText(/Cancelled — 2 vs Black shield 6 → 4\./),
    ).toBeInTheDocument();
  });

  it("labels a Balls spell and states its shield math", () => {
    // The Balls palette is explicitly out of scope for the board-effect
    // request, so the toast's Balls rendering must stay exactly as it is: the
    // kind label reads "Balls" and the resolution line uses the same
    // fired/cancelled math as any other offensive spell.
    const balls = makeResult({
      spellName: "Sandy Balls",
      kind: SpellKind.Balls,
      resolution: {
        attacker: Team.White,
        defender: Team.Black,
        spellValue: 3n,
        shieldBefore: 1n,
        shieldAfter: 0n,
        outcome: SpellResolutionOutcome.fired,
        firesOnBoard: true,
      },
    });
    render(
      <BurnPlayToast toasts={[makeEntry("burn-1", balls)]} onClose={vi.fn()} />,
    );

    expect(screen.getByText("Sandy Balls — Balls")).toBeInTheDocument();
    expect(
      screen.getByText(/Fired on the board — 3 vs Black shield 1 → 0\./),
    ).toBeInTheDocument();
  });

  it("reads a legacy burn as inert with no shield effect", () => {
    const legacy = makeResult({
      gameNumber: undefined,
      resolution: undefined,
    });
    render(
      <BurnPlayToast
        toasts={[makeEntry("burn-1", legacy)]}
        onClose={vi.fn()}
      />,
    );

    // The detail line names the burn as a legacy NFT and states the inert
    // outcome; the resolution line carries no shield math.
    expect(screen.getByText(/Legacy NFT · White/)).toBeInTheDocument();
    expect(
      screen.getByText(/Legacy NFT — burned inert, no shield effect\./),
    ).toBeInTheDocument();
  });

  it("renders one toast per result and stacks them in order", () => {
    render(
      <BurnPlayToast
        toasts={[
          makeEntry(
            "burn-1",
            makeResult({
              tokenId: 1n,
              spellName: "Minor Spell",
              kind: SpellKind.Minor,
            }),
          ),
          makeEntry(
            "burn-2",
            makeResult({
              tokenId: 2n,
              spellName: "Major Spell",
              kind: SpellKind.Major,
            }),
          ),
        ]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Minor Spell — Minor")).toBeInTheDocument();
    expect(screen.getByText("Major Spell — Major")).toBeInTheDocument();
    expect(screen.getByText(/NFT #1/)).toBeInTheDocument();
    expect(screen.getByText(/NFT #2/)).toBeInTheDocument();
  });

  it("carries its own container marker, distinct from the existing toasts", () => {
    render(
      <BurnPlayToast
        toasts={[makeEntry("burn-1", makeResult())]}
        onClose={vi.fn()}
      />,
    );

    // The burn-and-play container is its own labelled region, separate from
    // the exercise / drinking / opening containers.
    expect(screen.getByLabelText("Burn and play toasts")).toBeInTheDocument();
    expect(screen.queryByLabelText("Exercise toasts")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Drinking toasts")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Opening announcement"),
    ).not.toBeInTheDocument();
  });

  it("reports the toast id when its close button is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <BurnPlayToast
        toasts={[makeEntry("burn-42", makeResult())]}
        onClose={onClose}
      />,
    );

    const container = screen.getByLabelText("Burn and play toasts");
    await user.click(
      within(container).getByRole("button", {
        name: "Dismiss burn-and-play toast for Minor Spell",
      }),
    );
    expect(onClose).toHaveBeenCalledWith("burn-42");
  });
});
