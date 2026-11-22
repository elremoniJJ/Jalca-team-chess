import { Actor, HttpAgent } from "@icp-sdk/core/agent";
import { IDL } from "@icp-sdk/core/candid";
import { Principal } from "@icp-sdk/core/principal";
import { useQuery } from "@tanstack/react-query";
import { ICRC7_CANISTER_ID } from "../oisy-burn/oisy-signer";

/**
 * useCanisterCycles — fetches a target canister's cycle balance via the
 * public blackhole canister (`e3mmv-5qaaa-aaaah-aadma-cai`).
 *
 * The target canister defaults to the ICRC-7 NFT canister but any canister
 * id can be passed (e.g. the JEL escrow ledger canister). The cycle balance
 * is NOT in the public read_state tree, so the standard public route is to
 * call `canister_status` on the blackhole canister, passing the target
 * canister_id. This works ONLY if the target canister has the blackhole as
 * a controller. If the call rejects (canister not blackhole-controlled),
 * the hook falls back gracefully: `cycles` is set to null and `error`
 * carries a descriptive message. The gauge then renders all 10 segments
 * unlit and the popup shows "Cycle balance unavailable" instead of the
 * formatted total.
 *
 * Fetch policy (per the dispatch contract):
 *   - Fetch ONCE on mount / page load.
 *   - Expose a `refetch` function for manual refresh.
 *   - Do NOT poll on a timer (`refetchInterval: false`).
 *   - Do NOT refetch on window focus (`refetchOnWindowFocus: false`).
 *   - Do NOT refetch on every click — the popup reads cached data.
 *
 * The only two refresh triggers are: (1) page load (the initial fetch),
 * and (2) a single `refetch()` call after the post-game NFT mint
 * completes (wired in routes/game.tsx where the mint status is
 * observed).
 *
 * Returns `{ cycles: bigint | null, isLoading, error, refetch }`.
 *   - `cycles` is null while loading, on fetch error, or when the
 *     blackhole call rejects. A null value is the single signal the UI
 *     uses to render the "unavailable" state.
 *   - `error` is a string message when the fetch failed or the blackhole
 *     call rejected; null otherwise.
 */

/** Blackhole canister — accepts `canister_status` for any canister that
 * lists it as a controller. Public, read-only, no auth required. */
const BLACKHOLE_CANISTER_ID = "e3mmv-5qaaa-aaaah-aadma-cai";

/** Mainnet IC boundary node for the anonymous read-only agent. */
const IC_HOST = "https://icp-api.io";

/**
 * Hand-written Candid IDL for the blackhole canister's `canister_status`
 * method. The blackhole exposes the same interface as the IC management
 * canister's `canister_status`:
 *
 *   canister_status : (record { canister_id: principal }) ->
 *     (record {
 *       status: variant { running; stopping; stopped };
 *       memory_size: nat;
 *       cycles: nat;
 *       settings: record {
 *         controllers: vec principal;
 *         compute_allocation: nat;
 *         memory_allocation: nat;
 *         freezing_threshold: nat;
 *       };
 *       module_hash: opt vec nat8;
 *     })
 *
 * IMPORTANT: `canister_status` is an UPDATE method, not a query. The
 * blackhole's source (`src/blackhole.mo`) declares it as
 * `public func canister_status(...) : async canister_status`, which
 * forwards to the IC management canister's update call. Declaring it as
 * a query here caused the replica to reject the call with IC0536
 * "Canister has no query method canister_status". The method list is
 * therefore `[]` (update), matching the blackhole's real interface.
 *
 * The variant tags are lowercase (`running`/`stopping`/`stopped`) per
 * the blackhole's published Candid. We only decode the `cycles` field,
 * but the full record shape is declared so the IDL decodes the whole
 * response without a shape-mismatch rejection.
 */
const CanisterStatusResultIDL = IDL.Record({
  status: IDL.Variant({
    running: IDL.Null,
    stopping: IDL.Null,
    stopped: IDL.Null,
  }),
  memory_size: IDL.Nat,
  cycles: IDL.Nat,
  settings: IDL.Record({
    controllers: IDL.Vec(IDL.Principal),
    compute_allocation: IDL.Nat,
    memory_allocation: IDL.Nat,
    freezing_threshold: IDL.Nat,
  }),
  module_hash: IDL.Opt(IDL.Vec(IDL.Nat8)),
});

const blackholeIdlFactory: IDL.InterfaceFactory = () =>
  IDL.Service({
    canister_status: IDL.Func(
      [IDL.Record({ canister_id: IDL.Principal })],
      [CanisterStatusResultIDL],
      // Update method — the blackhole's `canister_status` forwards to the
      // IC management canister's update call. Declaring it as a query
      // caused IC0536 "Canister has no query method canister_status".
      [],
    ),
  });

/** Decoded canister_status result — only `cycles` is consumed. */
interface CanisterStatusResult {
  status: { running: null } | { stopping: null } | { stopped: null };
  memory_size: bigint;
  cycles: bigint;
  settings: {
    controllers: Principal[];
    compute_allocation: bigint;
    memory_allocation: bigint;
    freezing_threshold: bigint;
  };
  module_hash: Uint8Array[] | [];
}

/**
 * Fetch a target canister's cycle balance via the blackhole canister.
 * Returns the `cycles` field as a bigint on success. On any rejection
 * (canister not blackhole-controlled, network error, decode failure),
 * throws an Error with a descriptive message — the hook's queryFn turns
 * the thrown error into the cached `error` state and sets `cycles` to
 * null so the UI renders the "unavailable" state.
 */
async function fetchCanisterCycles(targetCanisterId: string): Promise<bigint> {
  const agent = await HttpAgent.create({ host: IC_HOST });
  const actor = Actor.createActor(blackholeIdlFactory, {
    agent,
    canisterId: Principal.fromText(BLACKHOLE_CANISTER_ID),
  });
  const result = (await actor.canister_status({
    canister_id: Principal.fromText(targetCanisterId),
  })) as CanisterStatusResult;
  return result.cycles;
}

export function useCanisterCycles(
  targetCanisterId: string = ICRC7_CANISTER_ID,
) {
  const query = useQuery<bigint>({
    queryKey: ["canisterCycles", targetCanisterId],
    queryFn: async () => {
      try {
        return await fetchCanisterCycles(targetCanisterId);
      } catch (e) {
        // Re-throw as a plain Error so React Query caches the message.
        // The blackhole call rejects when the target canister is not
        // blackhole-controlled; surface a clear reason to the UI.
        const message =
          e instanceof Error
            ? e.message
            : "Cycle balance unavailable — the canister may not be blackhole-controlled.";
        throw new Error(message);
      }
    },
    // Per the dispatch contract: no polling, no window-focus refetch.
    // The only refresh triggers are the initial fetch and a manual
    // refetch() call (wired to the post-game mint completion).
    refetchOnWindowFocus: false,
    refetchInterval: false,
    // Keep stale data while refetching so the gauge does not blink to
    // "unavailable" during a manual refresh after the post-game mint.
    placeholderData: (prev) => prev,
  });

  return {
    cycles: query.data ?? null,
    isLoading: query.isLoading && query.data === undefined,
    error: query.error ? query.error.message : null,
    refetch: () => query.refetch(),
  };
}
