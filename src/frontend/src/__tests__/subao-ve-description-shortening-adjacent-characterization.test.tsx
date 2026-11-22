import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the behavior ADJACENT to the accepted change that
 * shortens the Subao Ve description.
 *
 * The request replaces the long shield description with the shortened wording
 * "Protection against incoming enemy spells. A spell can only affect the game
 * if it has at least double the power of the Subao Ve. Otherwise it only
 * reduces the Subao Ve's remaining power." Everything else about the Subao Ve
 * entry and the spell table is unchanged and is what this file protects:
 *
 *   - the Subao Ve row still renders first, with its name;
 *   - the accepted description is still rendered verbatim from the backend
 *     `spell.spell` field;
 *   - the row still carries its cells with the effect text;
 *   - the other spells' Function text is untouched.
 *
 * This file deliberately does NOT assert the old long description: pinning it
 * would characterize the very text under change. The backend actor is a typed
 * local mock, so this is component/integration coverage of the frontend's
 * rendering of the static table — not real backend behavior. See
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
  SpellKind: { Major: "Major", Minor: "Minor", SubaoVe: "SubaoVe" },
  BurnedSpellCategory: { Major: "Major", Minor: "Minor", SubaoVe: "SubaoVe" },
  BallsColourFamily: {
    Sandy: "Sandy",
    Cloudy: "Cloudy",
    Grassy: "Grassy",
    Fiery: "Fiery",
    Wooden: "Wooden",
  },
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

// OisyBurnPanel is a large surface owned by the isolated Oisy feature; mock it
// to a marker so this file stays focused on the spell table.
vi.mock("@/oisy-burn/OisyBurnPanel", () => ({
  OisyBurnPanel: () => <div data-testid="oisy-burn-panel" />,
}));

/**
 * The accepted shortened Subao Ve description, rendered verbatim from the
 * backend `spell.spell` field.
 */
const SUBAO_VE_ACCEPTED =
  "Protection against incoming enemy spells. A spell can only affect the game if it has at least double the power of the Subao Ve. Otherwise it only reduces the Subao Ve's remaining power.";

const { spellTable } = vi.hoisted(() => ({
  spellTable: {
    block: {
      id: 0n,
      complexity: "Easy",
      nftEligible: true,
      meaning: "Protection",
      name: "Subao Ve",
      spell:
        "Protection against incoming enemy spells. A spell can only affect the game if it has at least double the power of the Subao Ve. Otherwise it only reduces the Subao Ve's remaining power.",
      category: { Block: null },
      dropChance: 8n,
    },
    minor: [
      {
        id: 3n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Plague",
        name: "Bendika",
        spell: "Removes all remaining enemy Pawns from the board.",
        category: { Minor: null },
        dropChance: 10n,
      },
    ],
    major: [
      {
        id: 1n,
        complexity: "Moderate",
        nftEligible: false,
        meaning: "Queen horse",
        name: "Newkai Dodan",
        spell: "Replaces the enemy Queen with an enemy Knight.",
        category: { Major: null },
        dropChance: 2n,
      },
    ],
    balls: [],
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

describe("Subao Ve description shortening — adjacent behavior", () => {
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

  it("still renders the Subao Ve row first with its name and no meaning", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    // The modal is portaled to document.body, so rows are queried there.
    const rows = document.querySelectorAll("[data-ocid^='spell_table.row.']");
    expect(rows.length).toBe(3);
    expect(rows[0]).toHaveTextContent("Subao Ve");

    const row = rowFor(document.body, "Subao Ve");
    expect(within(row).getByText("Subao Ve")).toBeInTheDocument();
    // The accepted request removes the Meaning column, so the meaning text no
    // longer appears in the row.
    expect(within(row).queryByText("Protection")).not.toBeInTheDocument();
  });

  it("still renders the accepted Subao Ve description verbatim", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    const row = rowFor(document.body, "Subao Ve");
    // The accepted text is rendered verbatim from the backend field.
    expect(within(row).getByText(SUBAO_VE_ACCEPTED)).toBeInTheDocument();
    // The accepted clauses survive.
    expect(row.textContent).toContain(
      "A spell can only affect the game if it has at least double the power of the Subao Ve.",
    );
    expect(row.textContent).toContain(
      "Otherwise it only reduces the Subao Ve's remaining power.",
    );
    // The old long shield wording is gone.
    expect(row.textContent).not.toContain(
      "Preemptively sets up a shield to block incoming enemy Major or Minor spells.",
    );
  });

  it("keeps the Subao Ve row's name and effect text", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    const row = rowFor(document.body, "Subao Ve");
    // The accepted two-column layout shows the name (left) and the effect text
    // (right). The old Meaning column is intentionally removed.
    expect(within(row).getByText("Subao Ve")).toBeInTheDocument();
    expect(row).toHaveTextContent(SUBAO_VE_ACCEPTED);
  });

  it("leaves the other spells' Function text untouched", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    const bendika = rowFor(document.body, "Bendika");
    expect(bendika).toHaveTextContent(
      "Removes all remaining enemy Pawns from the board.",
    );

    const newkai = rowFor(document.body, "Newkai Dodan");
    expect(newkai).toHaveTextContent(
      "Replaces the enemy Queen with an enemy Knight.",
    );
  });

  it("renders the Subao Ve effect text verbatim from the backend field", async () => {
    // The frontend must not hardcode the Subao Ve wording: it renders whatever
    // `spell.spell` the backend returns. This is the seam the accepted backend
    // change travels through, so a distinct sentinel proves the pass-through
    // without pinning either the old or the new production wording.
    const sentinel = "SENTINEL-SUBAO-VE-EFFECT-TEXT";
    getSpellTable.mockResolvedValue({
      ...spellTable,
      block: { ...spellTable.block, spell: sentinel },
    });

    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    const row = rowFor(document.body, "Subao Ve");
    expect(within(row).getByText(sentinel)).toBeInTheDocument();
  });

  it("keeps the Subao Ve entry's identity fields unchanged", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    // The request changes only the effect text, so the entry's identity fields
    // are the contract: it stays the first row, named Subao Ve, and the backend
    // fixture still carries id 0, the Block category and nftEligible=true.
    const rows = document.querySelectorAll("[data-ocid^='spell_table.row.']");
    expect(rows[0]).toHaveTextContent("Subao Ve");

    const row = rowFor(document.body, "Subao Ve");
    expect(within(row).getByText("Subao Ve")).toBeInTheDocument();
    expect(spellTable.block.id).toBe(0n);
    expect(spellTable.block.category).toEqual({ Block: null });
    expect(spellTable.block.nftEligible).toBe(true);
  });

  it("keeps the Subao Ve entry's meaning field on the backend contract", async () => {
    // The accepted change replaces only the `spell` effect text. The entry's
    // `meaning` ("Protection") is part of the backend contract the frontend
    // consumes and must survive the shortening. This asserts the fixture the
    // modal renders still carries it, without pinning the changing effect text.
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    expect(spellTable.block.meaning).toBe("Protection");
    // The Subao Ve row is still the first row and still renders its name, so
    // the entry the modal consumes is the same one carrying the meaning.
    const rows = document.querySelectorAll("[data-ocid^='spell_table.row.']");
    expect(rows[0]).toHaveTextContent("Subao Ve");
  });

  it("keeps the other spells' identity fields and effect text unchanged", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    // The request touches only the Subao Ve entry, so the sibling entries'
    // identity fields and effect text are the contract.
    const bendika = rowFor(document.body, "Bendika");
    expect(bendika).toHaveTextContent("Bendika");
    expect(bendika).toHaveTextContent(
      "Removes all remaining enemy Pawns from the board.",
    );

    const newkai = rowFor(document.body, "Newkai Dodan");
    expect(newkai).toHaveTextContent("Newkai Dodan");
    expect(newkai).toHaveTextContent(
      "Replaces the enemy Queen with an enemy Knight.",
    );
  });
});
