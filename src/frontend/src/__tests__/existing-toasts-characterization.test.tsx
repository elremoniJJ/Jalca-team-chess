import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the game's EXISTING toast surfaces, taken BEFORE a new
 * burn-and-play toast is added.
 *
 * The request adds a distinct alert/toast that appears when an NFT is burned
 * and played, and requires it to be visually different from the game's
 * existing exercise, drinking, and opening toasts. The existing three toast
 * components must keep rendering exactly what they render today so the new
 * toast can be told apart from them.
 *
 * What IS protected here — the rendering contracts of the three existing
 * toast components, which no other suite asserts directly (the route-level
 * suites mock them to markers):
 *   - ExerciseToasts renders one toast per assignment with the team/reps/
 *     exercise text, a capture/en-passant badge, and a per-toast close button
 *     that reports the toast id; its container carries the exercise marker.
 *   - DrinkingToasts renders the team/drinks/(piece) text, the en-passant
 *     variant without the piece, and its own distinct container marker.
 *   - OpeningToast shows the opening name once on a null -> non-null
 *     transition, stays hidden for a null opening, and hides on close.
 *
 * These are pure component contracts with no actor or network access.
 */

import { DrinkingToasts } from "@/components/DrinkingToasts";
import { ExerciseToasts } from "@/components/ExerciseToasts";
import { OpeningToast } from "@/components/OpeningToast";
import type { DrinkingToast } from "@/types/drinking";
import type { ExerciseToast } from "@/types/exercise";

function makeExerciseToast(
  overrides: Partial<ExerciseToast> = {},
): ExerciseToast {
  return {
    id: "0",
    team: "white",
    reps: 10,
    exercise: "push-ups",
    capturedPiece: "pawn",
    trigger: "Capture",
    moveIndex: 0,
    ...overrides,
  };
}

function makeDrinkingToast(
  overrides: Partial<DrinkingToast> = {},
): DrinkingToast {
  return {
    id: "0",
    team: "black",
    drinks: 3,
    capturedPiece: "rook",
    trigger: "Capture",
    moveIndex: 0,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ExerciseToasts rendering", () => {
  it("renders one toast per assignment with the team, reps, and exercise text", () => {
    render(
      <ExerciseToasts
        toasts={[
          makeExerciseToast({ id: "0", team: "white", reps: 10 }),
          makeExerciseToast({
            id: "1",
            team: "black",
            reps: 5,
            exercise: "squats",
          }),
        ]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("White: 10x push-ups")).toBeInTheDocument();
    expect(screen.getByText("Black: 5x squats")).toBeInTheDocument();
    // The container carries the exercise marker that distinguishes it from
    // the drinking and opening containers.
    expect(screen.getByLabelText("Exercise toasts")).toBeInTheDocument();
  });

  it("labels the capture and en-passant triggers distinctly", () => {
    render(
      <ExerciseToasts
        toasts={[
          makeExerciseToast({ id: "0", trigger: "Capture" }),
          makeExerciseToast({ id: "1", trigger: "EnPassant" }),
        ]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Trigger: capture")).toBeInTheDocument();
    expect(screen.getByLabelText("Trigger: en passant")).toBeInTheDocument();
  });

  it("reports the toast id when its close button is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ExerciseToasts
        toasts={[makeExerciseToast({ id: "42", team: "white" })]}
        onClose={onClose}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Dismiss White exercise toast",
      }),
    );
    expect(onClose).toHaveBeenCalledWith("42");
  });
});

describe("DrinkingToasts rendering", () => {
  it("renders the team, drink count, and captured piece", () => {
    render(
      <DrinkingToasts
        toasts={[makeDrinkingToast({ team: "black", drinks: 3 })]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Black: 3 drinks (rook)")).toBeInTheDocument();
    // Its own container marker, distinct from the exercise container.
    expect(screen.getByLabelText("Drinking toasts")).toBeInTheDocument();
  });

  it("omits the captured piece for an en-passant toast", () => {
    render(
      <DrinkingToasts
        toasts={[
          makeDrinkingToast({
            team: "white",
            drinks: 1,
            capturedPiece: "pawn",
            trigger: "EnPassant",
          }),
        ]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("White: 1 drink")).toBeInTheDocument();
    expect(screen.queryByText(/\(pawn\)/)).not.toBeInTheDocument();
  });

  it("reports the toast id when its close button is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <DrinkingToasts
        toasts={[makeDrinkingToast({ id: "7", team: "black" })]}
        onClose={onClose}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Dismiss Black drinking toast",
      }),
    );
    expect(onClose).toHaveBeenCalledWith("7");
  });
});

describe("OpeningToast rendering", () => {
  it("shows the opening name once a non-null opening arrives", () => {
    render(<OpeningToast openingName="Sicilian Defense - Najdorf Variation" />);

    const container = screen.getByLabelText("Opening announcement");
    expect(
      within(container).getByText(/Sicilian Defense - Najdorf Variation/),
    ).toBeInTheDocument();
    expect(within(container).getByText("Opening:")).toBeInTheDocument();
  });

  it("shows nothing when the opening name is absent", () => {
    render(<OpeningToast openingName={undefined} />);
    expect(
      screen.queryByLabelText("Opening announcement"),
    ).not.toBeInTheDocument();
  });

  it("hides the announcement when its close button is pressed", async () => {
    const user = userEvent.setup();
    render(<OpeningToast openingName="Italian Game - Giuoco Piano" />);

    await user.click(
      screen.getByRole("button", { name: "Dismiss opening announcement" }),
    );
    expect(
      screen.queryByLabelText("Opening announcement"),
    ).not.toBeInTheDocument();
  });
});
