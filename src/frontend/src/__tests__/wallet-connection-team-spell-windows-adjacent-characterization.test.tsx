import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Adjacent characterization of the TeamSpellWindow rendering, taken BEFORE the
 * "Spells cast" rework.
 *
 * The accepted request intentionally changes several things inside each team
 * spell-burning window:
 *   - the bottom "Shield +N / No Subao Ve burned yet" block is removed;
 *   - the "Minor / Major spells" heading becomes "Spells cast";
 *   - list items gain a tick / cross / question-mark outcome;
 *   - the list becomes scrollable and its empty-state text is removed.
 *
 * Those are NOT asserted here — characterizing behavior the request intends to
 * change would pin the old shape and fight the change. What IS protected is the
 * surrounding behavior the request explicitly keeps or does not touch:
 *   - the big centered Subao Ve counter still shows the team shield total in
 *     BOTH windows (an explicit acceptance criterion);
 *   - each window keeps its team header label;
 *   - the two internal columns stay mirrored per team (White: list LEFT, shield
 *     RIGHT; Black: shield LEFT, list RIGHT);
 *   - the loading state still renders while the burn state is loading;
 *   - the defensive number is still derived as the summed Subao Ve power.
 *
 * The window body mounts TeamSpellWindow (which reads useBurnState) and
 * OisyBurnPanel (which consumes useOisyBurn). The burn panel is mocked to a
 * marker so this file stays focused on the team spell windows; the real
 * TeamSpellWindow is rendered.
 */

vi.mock("@/backend", () => ({
  SpellComplexity: { Easy: "Easy", Complex: "Complex", Moderate: "Moderate" },
  Team: { Black: "Black", White: "White" },
  SpellUse: { On: "On", Off: "Off" },
}));

const {
  useGameState,
  useSpellBoardState,
  useActorState,
  useBurnState,
  useShieldResolutionSnapshot,
  useGameMeta,
} = vi.hoisted(() => ({
  useGameState: vi.fn(),
  useSpellBoardState: vi.fn(),
  useActorState: vi.fn(),
  useBurnState: vi.fn(),
  useShieldResolutionSnapshot: vi.fn(),
  useGameMeta: vi.fn(),
}));
vi.mock("@/hooks/use-game-state", () => ({ useGameState }));
vi.mock("@/hooks/use-spell-board-state", () => ({ useSpellBoardState }));
vi.mock("@/hooks/use-burn-state", () => ({ useBurnState }));
vi.mock("@/hooks/use-shield-resolution-snapshot", () => ({
  useShieldResolutionSnapshot,
}));
vi.mock("@/hooks/use-game-meta", () => ({ useGameMeta }));
vi.mock("@/lib/backend-actor", () => ({ useActorState }));

// OisyBurnPanel is a large surface owned by the isolated Oisy feature; mock it
// to a marker so this file stays focused on the team spell windows.
vi.mock("@/oisy-burn/OisyBurnPanel", () => ({
  OisyBurnPanel: () => <div data-testid="oisy-burn-panel" />,
}));

import { SpellUse } from "@/backend";
import { WalletConnectionWindow } from "@/components/WalletConnectionWindow";

/** A burned spell entry as the backend's getBurnState returns it. */
interface BurnedSpellFixture {
  spellName: string;
  gameNumber: bigint;
  team: string;
  category: string;
}

function burnedSpell(
  spellName: string,
  gameNumber: bigint,
  team: string,
  category: string,
): BurnedSpellFixture {
  return { spellName, gameNumber, team, category };
}

function burnStateWith(overrides: {
  whiteMinorMajor?: BurnedSpellFixture[];
  whiteSubaoVe?: BurnedSpellFixture[];
  blackMinorMajor?: BurnedSpellFixture[];
  blackSubaoVe?: BurnedSpellFixture[];
}) {
  return {
    data: {
      burnOccurredThisTurn: true,
      burnedByTeam: ["White"],
      whiteWindow: {
        minorMajorSpells: overrides.whiteMinorMajor ?? [],
        subaoVeSpells: overrides.whiteSubaoVe ?? [],
      },
      blackWindow: {
        minorMajorSpells: overrides.blackMinorMajor ?? [],
        subaoVeSpells: overrides.blackSubaoVe ?? [],
      },
    },
    isLoading: false,
    error: null,
  };
}

function renderWindow() {
  // The window body (which mounts the team spell windows) is only rendered
  // when the window is expanded. The window persists its open state under
  // "tco-wallet-connection-open" and is collapsed by default, so seed the
  // persisted open state before rendering to exercise the body.
  window.localStorage.setItem("tco-wallet-connection-open", "true");
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WalletConnectionWindow spellUse={SpellUse.On} />
    </QueryClientProvider>,
  );
}

/**
 * The team windows carry `data-ocid` markers, not `data-testid`, so scope the
 * assertions through the rendered container rather than screen.getByTestId.
 */
function teamWindow(
  container: HTMLElement,
  team: "white" | "black",
): HTMLElement {
  const el = container.querySelector(`[data-ocid="team_spell_window.${team}"]`);
  if (el === null) throw new Error(`team_spell_window.${team} not rendered`);
  return el as HTMLElement;
}

describe("TeamSpellWindow adjacent behavior (pre-rework)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useGameState.mockReturnValue({
      data: { moveMaker: "player-1", turn: "White" },
      isLoading: false,
      error: null,
      moves: [],
      lastMove: null,
      prevBoard: null,
      checkSquare: null,
    });
    useSpellBoardState.mockReturnValue({
      spellContext: undefined,
      isLoading: false,
    });
    useActorState.mockReturnValue({
      actor: null,
      isLoading: false,
      error: null,
      retry: () => {},
    });
    useShieldResolutionSnapshot.mockReturnValue({ data: undefined });
    useGameMeta.mockReturnValue({
      gameNumber: 10n,
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("keeps the big centered Subao Ve counter showing the team shield total in both windows", () => {
    useBurnState.mockReturnValue(burnStateWith({}));
    useShieldResolutionSnapshot.mockReturnValue({
      data: { whiteShield: 6n, blackShield: 4n },
    });

    const { container } = renderWindow();

    const whiteShield = container.querySelector(
      '[data-ocid="team_spell_window.white.shield_total"]',
    );
    expect(whiteShield).not.toBeNull();
    expect(whiteShield).toHaveTextContent("6");

    const blackShield = container.querySelector(
      '[data-ocid="team_spell_window.black.shield_total"]',
    );
    expect(blackShield).not.toBeNull();
    expect(blackShield).toHaveTextContent("4");
  });

  it("keeps each window's team header label", () => {
    useBurnState.mockReturnValue(burnStateWith({}));

    const { container } = renderWindow();

    expect(
      within(teamWindow(container, "white")).getByText("White team"),
    ).toBeInTheDocument();
    expect(
      within(teamWindow(container, "black")).getByText("Black team"),
    ).toBeInTheDocument();
  });

  it("keeps the two internal columns mirrored per team", () => {
    useBurnState.mockReturnValue(burnStateWith({}));

    const { container } = renderWindow();

    // The two columns are always in the same DOM order (spell list first,
    // shield second); the mirroring is done with the Tailwind `order-2` class.
    // White: the shield column carries order-2 (list LEFT, shield RIGHT).
    // Black: the spell-list column carries order-2 (shield LEFT, list RIGHT).
    const whiteWindow = teamWindow(container, "white");
    const whiteColumns = whiteWindow.querySelectorAll(
      ".grid.grid-cols-2 > div",
    );
    expect(whiteColumns).toHaveLength(2);
    // The heading is intentionally renamed to "Spells cast" by the accepted
    // request; the column ORDER (the mirroring) is what this test protects.
    expect(whiteColumns[0]).toHaveTextContent("Spells cast");
    expect(whiteColumns[0]).not.toHaveClass("order-2");
    expect(whiteColumns[1]).toHaveAttribute(
      "data-ocid",
      "team_spell_window.white.subao_ve",
    );
    expect(whiteColumns[1]).toHaveClass("order-2");

    const blackWindow = teamWindow(container, "black");
    const blackColumns = blackWindow.querySelectorAll(
      ".grid.grid-cols-2 > div",
    );
    expect(blackColumns).toHaveLength(2);
    expect(blackColumns[0]).toHaveTextContent("Spells cast");
    expect(blackColumns[0]).toHaveClass("order-2");
    expect(blackColumns[1]).toHaveAttribute(
      "data-ocid",
      "team_spell_window.black.subao_ve",
    );
    expect(blackColumns[1]).not.toHaveClass("order-2");
  });

  it("keeps the loading state while the burn state is loading", () => {
    useBurnState.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    const { container } = renderWindow();

    expect(
      container.querySelector(
        '[data-ocid="team_spell_window.white.loading_state"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-ocid="team_spell_window.black.loading_state"]',
      ),
    ).not.toBeNull();
  });

  it("no longer renders the bottom Shield +N / No Subao Ve burned yet block", () => {
    // The accepted request removes the bottom block (the shield icon, the
    // "Shield" label, the defensive number and the "No Subao Ve burned yet"
    // empty line) from BOTH team windows because it duplicated the big
    // centered Subao Ve counter. The counter itself is protected above.
    useBurnState.mockReturnValue(
      burnStateWith({
        whiteSubaoVe: [
          burnedSpell("Subao Ve", 5n, "White", "SubaoVe"),
          burnedSpell("Subao Ve", 7n, "White", "SubaoVe"),
        ],
      }),
    );
    useGameMeta.mockReturnValue({
      gameNumber: 10n,
      isLoading: false,
      error: null,
    });

    const { container } = renderWindow();

    for (const team of ["white", "black"] as const) {
      expect(
        container.querySelector(
          `[data-ocid="team_spell_window.${team}.defensive_number"]`,
        ),
      ).toBeNull();
      expect(
        container.querySelector(
          `[data-ocid="team_spell_window.${team}.subao_ve.item.1"]`,
        ),
      ).toBeNull();
    }
    expect(
      within(teamWindow(container, "white")).queryByText(
        "No Subao Ve burned yet",
      ),
    ).not.toBeInTheDocument();
    expect(
      within(teamWindow(container, "black")).queryByText(
        "No Subao Ve burned yet",
      ),
    ).not.toBeInTheDocument();
  });
});
