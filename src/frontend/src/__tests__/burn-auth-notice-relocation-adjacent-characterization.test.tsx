import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Adjacent characterization taken BEFORE the burning-authorization notice is
 * relocated.
 *
 * The accepted request intentionally changes two things:
 *   - the standalone always-visible notice
 *     (data-ocid `oisy_burn.backend_authorized_notice`) is removed from the
 *     NFT Spell burning window body;
 *   - the burning-authorization text is moved into the window's info section
 *     (InfoContent in WalletConnectionWindow.tsx).
 *
 * Those two changes are deliberately NOT asserted here — pinning the old
 * standalone notice or the old info-section shape would fight the change.
 *
 * What IS protected is the surrounding behavior the request does not touch:
 *   - the burn confirmation step still carries the backend-authorization copy
 *     (data-ocid `oisy_burn.burn_confirm_authorization`), so the deliberate
 *     absence of a wallet consent step stays visible at the moment of action;
 *   - the burn button still carries the copy as its title;
 *   - the window's Info control still toggles the info content, and the info
 *     content still renders its existing sections and the spell-table button.
 *
 * The Oisy hook is replaced by a typed local mock of `UseOisyBurn`, so this is
 * component/integration coverage of the panel's rendering and interaction —
 * not a deployed browser journey and not real backend behavior.
 */

vi.mock("@/backend", () => ({
  SpellComplexity: { Easy: "Easy", Complex: "Complex", Moderate: "Moderate" },
  Team: { Black: "Black", White: "White" },
  SpellUse: { On: "On", Off: "Off" },
  BurnedSpellCategory: { SubaoVe: "SubaoVe", MinorMajor: "MinorMajor" },
  SpellCastOutcome: {
    Success: "Success",
    Blocked: "Blocked",
    NoEffect: "NoEffect",
  },
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

import { SpellUse } from "@/backend";
import { WalletConnectionWindow } from "@/components/WalletConnectionWindow";
import { OisyBurnPanel } from "@/oisy-burn/OisyBurnPanel";
import type { OisyNft } from "@/oisy-burn/types";
import type { UseOisyBurn } from "@/oisy-burn/use-oisy-burn";

function makeNft(overrides: Partial<OisyNft> = {}): OisyNft {
  return {
    id: 1n,
    name: "JALCA Game NFT #1",
    thumbnailUrl: null,
    gameNumber: 7n,
    spellName: "Minor Spell",
    ...overrides,
  };
}

/**
 * Build a fully-typed `UseOisyBurn` mock. Defaults describe a disconnected
 * player whose wallet address is already on file, who is the Move_Maker and
 * may burn.
 */
function makeOisy(overrides: Partial<UseOisyBurn> = {}): UseOisyBurn {
  return {
    connection: { status: "disconnected" },
    listingOwner: "wallet-abc",
    nfts: [makeNft()],
    loadingNfts: false,
    nftsError: null,
    tokenStates: {},
    tokenResults: {},
    burning: false,
    signerAvailable: true,
    isMoveMaker: true,
    burnOccurredThisTurn: false,
    isFirstTurn: false,
    canBurn: true,
    burnDisabledReason: null,
    burnDisabledReasonFor: () => null,
    burnNoteFor: () => null,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
    burnOne: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderPanel(oisy: UseOisyBurn) {
  return render(<OisyBurnPanel oisy={oisy} />);
}

function renderWindow() {
  // The window body is only rendered when expanded; it persists its open state
  // under "tco-wallet-connection-open" and is collapsed by default.
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
  useBurnState.mockReturnValue({
    data: {
      burnOccurredThisTurn: false,
      burnedByTeam: [],
      whiteWindow: { minorMajorSpells: [], subaoVeSpells: [] },
      blackWindow: { minorMajorSpells: [], subaoVeSpells: [] },
    },
    isLoading: false,
    error: null,
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("burn confirmation step keeps the backend-authorization copy", () => {
  it("repeats the copy inside the burn confirmation dialog", async () => {
    const user = userEvent.setup();
    renderPanel(makeOisy());

    await user.click(
      screen.getByRole("button", { name: "Burn Minor Spell · Game 7" }),
    );

    const dialog = screen.getByRole("dialog", {
      name: /confirm burn of jalca game nft #1/i,
    });
    const authorization = within(dialog).getByText(
      /authorized by the game backend, not signed by your wallet/i,
    );
    expect(authorization).toBeInTheDocument();
    expect(authorization).toHaveTextContent(
      /no wallet signature or approval step/i,
    );
  });

  it("keeps the copy as the burn button title", () => {
    renderPanel(makeOisy());

    const burnButton = screen.getByRole("button", {
      name: "Burn Minor Spell · Game 7",
    });
    expect(burnButton).toHaveAttribute(
      "title",
      expect.stringMatching(/authorized by the game backend/i),
    );
  });
});

describe("NFT Spell burning window info section (adjacent behavior)", () => {
  it("toggles the info content from the header Info control", async () => {
    const user = userEvent.setup();
    renderWindow();

    const infoButton = screen.getByRole("button", {
      name: "Toggle NFT wallet information",
    });
    expect(infoButton).toHaveAttribute("aria-pressed", "false");

    await user.click(infoButton);

    expect(infoButton).toHaveAttribute("aria-pressed", "true");
    // The info content's own sections are rendered (the request replaces the
    // panel copy with the new 'Game NFT spells' content).
    expect(screen.getByText("Game NFT spells")).toBeInTheDocument();
    expect(screen.getByText("How power works")).toBeInTheDocument();
    expect(screen.getByText("First turn")).toBeInTheDocument();
    expect(screen.getByText("Played spells are burned")).toBeInTheDocument();
  });

  it("keeps the spell-table button in the info content", async () => {
    const user = userEvent.setup();
    renderWindow();

    await user.click(
      screen.getByRole("button", { name: "Toggle NFT wallet information" }),
    );

    expect(
      screen.getByRole("button", {
        name: "Spell names and effects",
      }),
    ).toBeInTheDocument();
  });

  it("shows the new 'Game NFT spells' content in the window's info section", async () => {
    const user = userEvent.setup();
    renderWindow();

    // The accepted request replaces the window's info section (InfoContent)
    // with the new 'Game NFT spells' copy. It is not visible until the Info
    // control is selected.
    expect(screen.queryByText("Game NFT spells")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Toggle NFT wallet information" }),
    );

    expect(screen.getByText("Game NFT spells")).toBeInTheDocument();
    expect(
      screen.getByText(
        "NFT spells let you influence the game. Here is how they work.",
      ),
    ).toBeInTheDocument();
  });
});
