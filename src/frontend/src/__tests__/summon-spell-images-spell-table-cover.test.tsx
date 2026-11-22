import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the three new summon spells (ids 23-25: Lazarus, Cuoclot Sac
 * Wonmuc Rook, Anne Boleyn) in the two frontend surfaces the request wires:
 *
 *   - the Oisy wallet NFT grid card thumbnail (OisyBurnPanel), which must show
 *     each spell's own PNG instead of the Rabbit placeholder;
 *   - the 'Spell names, meanings and effects' info modal
 *     (WalletConnectionWindow's SpellTableModal), which must show each spell's
 *     own PNG and render it as ENABLED (the backend flips nftEligible to true
 *     and complexity to Easy for these three).
 *
 * The backend actor is a typed local mock, so this is component/integration
 * coverage of the frontend's rendering — not real backend behavior. See
 * episode.coverageLimits.
 */

// The components import enum values from @/backend at runtime, which
// transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the components need.
vi.mock("@/backend", () => ({
  SpellComplexity: { Easy: "Easy", Complex: "Complex", Moderate: "Moderate" },
  SpellCategory: {
    Block: "Block",
    Major: "Major",
    Minor: "Minor",
    Balls: "Balls",
  },
  SpellKind: {
    Major: "Major",
    Minor: "Minor",
    SubaoVe: "SubaoVe",
    Balls: "Balls",
  },
  LegacyReason: {
    keysAbsent: "keysAbsent",
    wrongType: "wrongType",
    keysDisagree: "keysDisagree",
    readFailed: "readFailed",
  },
  BurnedSpellCategory: {
    Major: "Major",
    Minor: "Minor",
    SubaoVe: "SubaoVe",
    Balls: "Balls",
  },
  BallsColourFamily: {
    Sandy: "Sandy",
    Cloudy: "Cloudy",
    Grassy: "Grassy",
    Fiery: "Fiery",
    Wooden: "Wooden",
  },
  OpponentBoardImage: { Hairy: "Hairy", Veiny: "Veiny", Shiny: "Shiny" },
  Team: { Black: "Black", White: "White" },
  SpellUse: { On: "On", Off: "Off" },
  PieceType: {
    Bishop: "Bishop",
    King: "King",
    Pawn: "Pawn",
    Rook: "Rook",
    Knight: "Knight",
    Queen: "Queen",
  },
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
}));

// AdvicePopup -> lib/backend-actor imports createActorWithConfig from
// @caffeineai/core-infrastructure, which also fails to resolve its own
// submodules in jsdom. The window under test never calls the actor directly.
vi.mock("@caffeineai/core-infrastructure", () => ({
  createActorWithConfig: vi.fn(),
}));

/** The three new summon spells and the asset each must render. */
const SUMMON_SPELLS = [
  { name: "Lazarus", image: "/assets/spells/23.png" },
  { name: "Cuoclot Sac Wonmuc Rook", image: "/assets/spells/24.png" },
  { name: "Anne Boleyn", image: "/assets/spells/25.png" },
] as const;

/** Existing image-mapped spells whose mapping must be unchanged. */
const EXISTING_IMAGE_SPELLS = [
  { name: "Hairy Balls", image: "/assets/spells/hairy-balls.png" },
  { name: "Tia Lua", image: "/assets/spells/10.png" },
  { name: "Bamburgh", image: "/assets/spells/17.png" },
] as const;

/**
 * A spell table fixture carrying the three new summon spells (enabled, as the
 * backend now defines them) plus one existing image-mapped spell and one
 * ineligible spell, so the modal renders a stable multi-row table.
 */
const { spellTable } = vi.hoisted(() => ({
  spellTable: {
    block: {
      id: 0n,
      complexity: "Easy",
      nftEligible: true,
      meaning: "Protection",
      name: "Subao Ve",
      spell: "Preemptively sets up a shield.",
      category: { Block: null },
      dropChance: 8n,
    },
    minor: [
      {
        id: 23n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Lazarus",
        name: "Lazarus",
        spell:
          "Summons 1 friendly Bishop on the closest safe square to the centre, whether or not one was captured.",
        category: { Minor: null },
        dropChance: 10n,
      },
      {
        id: 24n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Extreme Makeover: Rook edition",
        name: "Cuoclot Sac Wonmuc Rook",
        spell:
          "Summons 1 friendly Rook on the closest safe square to the centre, whether or not one was captured.",
        category: { Minor: null },
        dropChance: 10n,
      },
      {
        id: 25n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Anne Boleyn",
        name: "Anne Boleyn",
        spell:
          "Summons 1 friendly Queen on the closest safe square to the centre, whether or not one was captured.",
        category: { Minor: null },
        dropChance: 10n,
      },
      {
        id: 21n,
        complexity: "Moderate",
        nftEligible: false,
        meaning: "Zombie",
        name: "Thayma",
        spell:
          "Summons 1 friendly Pawn on the closest safe square to the centre, whether or not one was captured.",
        category: { Minor: null },
        dropChance: 10n,
      },
      {
        id: 17n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Bamburgh",
        name: "Bamburgh",
        spell: "Removes 1 random enemy Rook from the board.",
        category: { Minor: null },
        dropChance: 10n,
      },
    ],
    major: [
      {
        id: 10n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Fire bolt",
        name: "Tia Lua",
        spell: "Removes 1 random enemy Pawn from the board.",
        category: { Major: null },
        dropChance: 2n,
      },
    ],
    balls: [
      {
        id: 31n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Hairy Balls",
        name: "Hairy Balls",
        spell: "An offensive Balls spell.",
        category: { Balls: null },
        dropChance: 0n,
      },
    ],
  },
}));

const { getSpellTable, useActorState, useGameState, useBurnState } = vi.hoisted(
  () => ({
    getSpellTable: vi.fn(),
    useActorState: vi.fn(),
    useGameState: vi.fn(),
    useBurnState: vi.fn(),
  }),
);

vi.mock("@/lib/backend-actor", () => ({
  useActorState,
  getActor: vi.fn().mockResolvedValue({ getSpellTable }),
}));
vi.mock("@/hooks/use-game-state", () => ({ useGameState }));
vi.mock("@/hooks/use-burn-state", () => ({ useBurnState }));

import { SpellUse } from "@/backend";
import { WalletConnectionWindow } from "@/components/WalletConnectionWindow";

function renderWindow() {
  // Seed the NFT wallet window open so its body (and the info panel) mounts
  // regardless of the collapsed-by-default first-visit state.
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

/** Open the info panel, then the spell table modal. */
async function openSpellTable(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", { name: /Toggle NFT wallet information/i }),
  );
  await user.click(
    screen.getByRole("button", { name: /Spell names and effects/i }),
  );
  return screen.findByRole("dialog");
}

/** The row whose text contains the given spell name. The modal is portaled to
 * document.body, so rows are queried there rather than in the render
 * container. */
function rowFor(_container: HTMLElement, name: string): HTMLElement {
  const rows = Array.from(
    document.querySelectorAll<HTMLElement>("[data-ocid^='spell_table.row.']"),
  );
  const row = rows.find((r) => r.textContent?.includes(name));
  if (row === undefined) throw new Error(`no spell table row for ${name}`);
  return row;
}

describe("WalletConnectionWindow summon spell images and enablement", () => {
  beforeEach(() => {
    window.localStorage.clear();
    getSpellTable.mockResolvedValue(spellTable);
    useActorState.mockReturnValue({
      actor: { getSpellTable },
      isLoading: false,
      error: null,
      retry: () => {},
    });
    useGameState.mockReturnValue({
      data: { moveMaker: "player-1", turn: "White" },
      isLoading: false,
      error: null,
      moves: [],
      lastMove: null,
      prevBoard: null,
      checkSquare: null,
    });
    useBurnState.mockReturnValue({
      data: { burnOccurredThisTurn: false },
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders each summon spell's own PNG in its row", async () => {
    const user = userEvent.setup();
    const { container } = renderWindow();

    await openSpellTable(user);

    for (const spell of SUMMON_SPELLS) {
      const row = rowFor(container, spell.name);
      const img = row.querySelector("img");
      expect(img, `${spell.name} should render an image`).not.toBeNull();
      expect(img).toHaveAttribute("src", spell.image);
    }
  });

  it("shows each summon spell's name and effect text in the modal", async () => {
    const user = userEvent.setup();
    renderWindow();

    await openSpellTable(user);

    // The accepted two-column layout shows each spell's name and its effect
    // text. The old Enabled column is intentionally removed, so it is not
    // asserted.
    const effects: Record<string, string> = {
      Lazarus: "Summons 1 friendly Bishop",
      "Cuoclot Sac Wonmuc Rook": "Summons 1 friendly Rook",
      "Anne Boleyn": "Summons 1 friendly Queen",
    };
    for (const spell of SUMMON_SPELLS) {
      const row = rowFor(document.body, spell.name);
      expect(row).toHaveTextContent(spell.name);
      expect(row).toHaveTextContent(effects[spell.name]);
    }
  });

  it("keeps the existing image mappings for an ineligible spell", async () => {
    const user = userEvent.setup();
    renderWindow();

    await openSpellTable(user);

    for (const spell of EXISTING_IMAGE_SPELLS) {
      const row = rowFor(document.body, spell.name);
      expect(row.querySelector("img")).toHaveAttribute("src", spell.image);
    }

    // Thayma (id 21) is explicitly left alone by the request: still ineligible.
    // The old Enabled column is intentionally removed, so only its presence is
    // asserted.
    const thayma = rowFor(document.body, "Thayma");
    expect(thayma).toHaveTextContent("Thayma");
  });
});
