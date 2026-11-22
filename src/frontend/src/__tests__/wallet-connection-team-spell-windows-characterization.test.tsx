import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the game-flow burn bookkeeping DISPLAY, taken BEFORE the
 * burn flow is repointed to a backend burn that runs directly as the canister
 * itself.
 *
 * The request changes HOW a burn is authorized (no wallet connect, no
 * "Authorize burn" toggle, no signer popup) and the copy that describes it. It
 * does NOT change the per-turn burned-spell windows the game page renders from
 * the backend's `getBurnState` query.
 *
 * What IS protected — the TeamSpellWindow rendering inside the NFT Spell
 * burning window, which no other suite asserts:
 *   - each team's window renders the burned Minor/Major spells (spell name +
 *     game number) from that team's `minorMajorSpells` list;
 *   - each team's Subao Ve section renders the burned Subao Ve spells from
 *     `subaoVeSpells`;
 *   - a team with no burned spells shows its empty state rather than a list.
 *
 * The window's body mounts TeamSpellWindow (which reads useBurnState) and
 * OisyBurnPanel (which consumes useOisyBurn). The burn panel is mocked to a
 * marker so this file stays focused on the bookkeeping display; the real
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

describe("WalletConnectionWindow team spell windows", () => {
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
    // The shield total comes from getShieldResolutionSnapshot; the defensive
    // number is derived from the current game number and the burned Subao Ve
    // spells. Default to a known game number and no shield snapshot so the
    // existing burned-spell assertions are unaffected.
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

  it("renders each team's burned Minor/Major spells with their game numbers", () => {
    useBurnState.mockReturnValue(
      burnStateWith({
        whiteMinorMajor: [
          burnedSpell("Minor Spell", 7n, "White", "Minor"),
          burnedSpell("Major Spell", 9n, "White", "Major"),
        ],
        blackMinorMajor: [burnedSpell("Minor Spell", 3n, "Black", "Minor")],
      }),
    );

    const { container } = renderWindow();

    const white = within(teamWindow(container, "white"));
    expect(white.getByText("Minor Spell")).toBeInTheDocument();
    expect(white.getByText("Game 7")).toBeInTheDocument();
    expect(white.getByText("Major Spell")).toBeInTheDocument();
    expect(white.getByText("Game 9")).toBeInTheDocument();

    const black = within(teamWindow(container, "black"));
    expect(black.getByText("Minor Spell")).toBeInTheDocument();
    expect(black.getByText("Game 3")).toBeInTheDocument();
  });

  it("renders each team's burned Subao Ve spells in the shield section", () => {
    useBurnState.mockReturnValue(
      burnStateWith({
        whiteSubaoVe: [burnedSpell("Subao Ve", 5n, "White", "SubaoVe")],
        blackSubaoVe: [burnedSpell("Subao Ve", 6n, "Black", "SubaoVe")],
      }),
    );

    const { container } = renderWindow();

    // "Subao Ve" is also the section label, so scope to the burned-spell list
    // item by its data-ocid marker.
    const whiteItem = container.querySelector(
      '[data-ocid="team_spell_window.white.subao_ve.item.1"]',
    );
    expect(whiteItem).not.toBeNull();
    expect(whiteItem).toHaveTextContent("Subao Ve");
    expect(whiteItem).toHaveTextContent("Game 5");

    const blackItem = container.querySelector(
      '[data-ocid="team_spell_window.black.subao_ve.item.1"]',
    );
    expect(blackItem).not.toBeNull();
    expect(blackItem).toHaveTextContent("Subao Ve");
    expect(blackItem).toHaveTextContent("Game 6");
  });

  it("shows the empty states for a team with no burned spells", () => {
    useBurnState.mockReturnValue(burnStateWith({}));

    const { container } = renderWindow();

    const white = within(teamWindow(container, "white"));
    expect(white.getByText("No spells burned yet.")).toBeInTheDocument();
    expect(white.getByText("No Subao Ve burned yet")).toBeInTheDocument();

    const black = within(teamWindow(container, "black"));
    expect(black.getByText("No spells burned yet.")).toBeInTheDocument();
    expect(black.getByText("No Subao Ve burned yet")).toBeInTheDocument();
  });

  it("renders each team's current shield total from the shield snapshot", () => {
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

  it("derives the defensive number as the summed Subao Ve power", () => {
    // Current game number 10; burned Subao Ve spells from games 5 and 7 give
    // powers 5 and 3, summing to +8. The defensive number is the additive
    // Subao Ve contribution to the shield.
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

    const defensive = container.querySelector(
      '[data-ocid="team_spell_window.white.defensive_number"]',
    );
    expect(defensive).not.toBeNull();
    expect(defensive).toHaveTextContent("+8");
  });

  it("shows the placeholder shield and defensive number when no snapshot is available", () => {
    useBurnState.mockReturnValue(burnStateWith({}));
    useShieldResolutionSnapshot.mockReturnValue({ data: undefined });
    // With no known game number the defensive number cannot be derived, so the
    // window falls back to the placeholder rather than showing a misleading 0.
    useGameMeta.mockReturnValue({
      gameNumber: null,
      isLoading: false,
      error: null,
    });

    const { container } = renderWindow();

    const whiteShield = container.querySelector(
      '[data-ocid="team_spell_window.white.shield_total"]',
    );
    expect(whiteShield).toHaveTextContent("--");
    const defensive = container.querySelector(
      '[data-ocid="team_spell_window.white.defensive_number"]',
    );
    expect(defensive).toHaveTextContent("--");
  });
});
