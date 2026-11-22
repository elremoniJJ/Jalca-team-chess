import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// WalletConnectionWindow imports SpellComplexity/Team/SpellUse as runtime
// values from @/backend, which transitively pulls in
// @caffeineai/object-storage and @caffeineai/core-infrastructure. Those
// packages fail to resolve their own submodules in the jsdom test
// environment (a pre-existing dependency issue), so mock the backend module
// with the enum values the component needs.
vi.mock("@/backend", () => ({
  SpellComplexity: { Easy: "Easy", Complex: "Complex", Moderate: "Moderate" },
  Team: { Black: "Black", White: "White" },
  SpellUse: { On: "On", Off: "Off" },
}));

// The window's body mounts TeamSpellWindow (which reads useGameState,
// useSpellBoardState, useActorState) and OisyBurnPanel (which consumes
// useOisyBurn). Mock those hooks so the test drives the collapsible-window
// behavior deterministically without a real actor or signer. useOisyBurn now
// also consumes useBurnState, so mock it too.
const { useGameState, useSpellBoardState, useActorState, useBurnState } =
  vi.hoisted(() => ({
    useGameState: vi.fn(),
    useSpellBoardState: vi.fn(),
    useActorState: vi.fn(),
    useBurnState: vi.fn(),
  }));
vi.mock("@/hooks/use-game-state", () => ({ useGameState }));
vi.mock("@/hooks/use-spell-board-state", () => ({ useSpellBoardState }));
vi.mock("@/hooks/use-burn-state", () => ({ useBurnState }));
vi.mock("@/lib/backend-actor", () => ({ useActorState }));

// useGuestIdentity / useWalletAddress read localStorage directly; keep them
// real so the OFF/ON wallet indicator reflects the persisted address.

// OisyBurnPanel is a large surface owned by the isolated Oisy feature; mock
// it to a marker so the window test stays focused on the collapsible card.
vi.mock("@/oisy-burn/OisyBurnPanel", () => ({
  OisyBurnPanel: () => <div data-testid="oisy-burn-panel" />,
}));

import { SpellUse } from "@/backend";
import { WalletConnectionWindow } from "@/components/WalletConnectionWindow";

/**
 * The NFT Spell burning collapsible window. The window is ALWAYS openable
 * regardless of the game's NFT spells setting (spellUse) — only the
 * individual NFT burn buttons are gated by spellUseEnabled (see
 * useOisyBurn). The header always reads "NFT Spell burning" (never the
 * "disabled" variant) and the header toggle is never disabled.
 *
 * What must remain stable across that change is protected here:
 *   - the window is a collapsible card whose header reads "NFT Spell
 *     burning" and is expanded by default;
 *   - clicking the header toggles the body open/closed;
 *   - the header no longer carries an OFF/ON wallet-connection label;
 *   - the info button toggles the NFT spell information content.
 */

function renderWindow(spellUse: SpellUse = SpellUse.On) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WalletConnectionWindow spellUse={spellUse} />
    </QueryClientProvider>,
  );
}

describe("WalletConnectionWindow collapsible behavior", () => {
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
    useBurnState.mockReturnValue({
      data: { burnOccurredThisTurn: false },
      isLoading: false,
      error: null,
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
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("when ON renders the header with heading 'NFT Spell burning' and is expanded by default", () => {
    renderWindow(SpellUse.On);
    expect(
      screen.getByRole("button", { name: /NFT Spell burning/i }),
    ).toBeInTheDocument();
    // Expanded by default — the body (Oisy burn panel) is present.
    expect(screen.getByTestId("oisy-burn-panel")).toBeInTheDocument();
  });

  it("when ON collapses and re-expands the body when the header is clicked", async () => {
    const user = userEvent.setup();
    renderWindow(SpellUse.On);
    const header = screen.getByRole("button", { name: /NFT Spell burning/i });

    // Expanded by default.
    expect(screen.getByTestId("oisy-burn-panel")).toBeInTheDocument();

    // Collapse — body unmounts.
    await user.click(header);
    expect(screen.queryByTestId("oisy-burn-panel")).not.toBeInTheDocument();

    // Re-expand — body returns.
    await user.click(header);
    expect(screen.getByTestId("oisy-burn-panel")).toBeInTheDocument();
  });

  it("when OFF the window stays openable and headed 'NFT Spell burning' (no 'disabled')", async () => {
    const user = userEvent.setup();
    renderWindow(SpellUse.Off);

    // The heading always reads the plain "NFT Spell burning" — never the
    // disabled variant — regardless of the NFT spells setting.
    expect(
      screen.getByRole("button", { name: /^NFT Spell burning$/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /NFT Spell burning - disabled/i }),
    ).not.toBeInTheDocument();

    // Openable — the body (Oisy burn panel) is present by default.
    expect(screen.getByTestId("oisy-burn-panel")).toBeInTheDocument();

    // The header toggle is never disabled — it can collapse and re-expand.
    await user.click(
      screen.getByRole("button", { name: /^NFT Spell burning$/i }),
    );
    expect(screen.queryByTestId("oisy-burn-panel")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /^NFT Spell burning$/i }),
    );
    expect(screen.getByTestId("oisy-burn-panel")).toBeInTheDocument();
  });

  it("when OFF stays openable even if a previously-closed state was persisted", () => {
    // Simulate a prior session that persisted a collapsed state.
    window.localStorage.setItem("tco-wallet-connection-open", "false");
    renderWindow(SpellUse.Off);
    // The window is never force-closed by the NFT spells setting — the
    // persisted collapsed state is respected, but the header is present and
    // headed "NFT Spell burning" (no "disabled").
    expect(screen.queryByTestId("oisy-burn-panel")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^NFT Spell burning$/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /NFT Spell burning - disabled/i }),
    ).not.toBeInTheDocument();
  });

  it("does not render an OFF/ON wallet-connection label in the header", () => {
    renderWindow(SpellUse.On);
    expect(
      screen.queryByLabelText("Wallet connection off"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Wallet connection on"),
    ).not.toBeInTheDocument();
  });

  it("keeps the header free of the OFF/ON label when a wallet is connected", () => {
    window.localStorage.setItem("team-chess-wallet-address", "aaaaa-aa");
    renderWindow(SpellUse.On);
    expect(
      screen.queryByLabelText("Wallet connection on"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Wallet connection off"),
    ).not.toBeInTheDocument();
  });

  it("toggles the NFT spell information content via the info button", async () => {
    const user = userEvent.setup();
    renderWindow(SpellUse.On);

    // Default body shows the Oisy burn panel, not the info content.
    expect(screen.getByTestId("oisy-burn-panel")).toBeInTheDocument();
    expect(screen.queryByText("Game NFT spells")).not.toBeInTheDocument();

    // Toggle info on — the info content replaces the default body.
    await user.click(
      screen.getByRole("button", { name: /Toggle NFT wallet information/i }),
    );
    expect(screen.getByText("Game NFT spells")).toBeInTheDocument();
    expect(screen.queryByTestId("oisy-burn-panel")).not.toBeInTheDocument();

    // Toggle info off — the default body returns.
    await user.click(
      screen.getByRole("button", { name: /Toggle NFT wallet information/i }),
    );
    expect(screen.getByTestId("oisy-burn-panel")).toBeInTheDocument();
  });
});
