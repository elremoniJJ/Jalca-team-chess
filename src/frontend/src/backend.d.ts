import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export interface AdminCompetitionDate {
    sunday: Timestamp;
    poolE8s: bigint;
}
export interface AdminCompetitionDetail {
    runnerUpName?: string;
    runnerUpWins?: bigint;
    paid: Array<AdminPrizeEntry>;
    unclaimed: Array<AdminPrizeEntry>;
    winnerName?: string;
    winnerWins?: bigint;
    sunday: Timestamp;
    poolE8s: bigint;
    paying: Array<AdminPrizeEntry>;
    firstPrizeE8s: bigint;
}
export interface AdminPrizeEntry {
    rank: bigint;
    recipient?: Principal;
    blockIndex?: bigint;
    amountE8s: bigint;
}
export interface AdminPrizeOverview {
    pool: PrizePool;
    archivedCompetitionCount: bigint;
}
export interface AdminPrizeOverview__1 {
    rows: Array<AdminPrizeRow>;
}
export interface AdminPrizeRow {
    paid: Array<AdminPrizeEntry>;
    unclaimed: Array<AdminPrizeEntry>;
    competition: Timestamp;
    paying: Array<AdminPrizeEntry>;
}
export type AllocationResult = {
    __kind__: "ok";
    ok: SundayAllocationStatus;
} | {
    __kind__: "rejected";
    rejected: Array<PrizeRejection>;
};
export interface Allowance {
    allowance: bigint;
    expires_at?: bigint;
}
export type ApprovalResult = {
    __kind__: "ok";
    ok: ApprovalState;
} | {
    __kind__: "err";
    err: string;
} | {
    __kind__: "consentError";
    consentError: string;
};
export interface ApprovalState {
    grantedAt: Timestamp;
    collection: CollectionPrincipal;
    player: PseudoPrincipal;
    granted: boolean;
    lastConsentError?: string;
    spender: SpenderPrincipal;
}
export type ApprovalStateResult = {
    __kind__: "ok";
    ok: ApprovalState;
} | {
    __kind__: "err";
    err: string;
};
export interface ArchivedPrizePool {
    sunday: Timestamp;
    poolE8s: bigint;
    firstPrizeE8s: bigint;
}
export interface BackfillEntry {
    runnerUpName?: string;
    runnerUpWins?: bigint;
    winnerName: string;
    winnerWins: bigint;
    sunday: Timestamp;
}
export interface BetRecord {
    id: bigint;
    bet: BetSubmission;
    timestamp: Timestamp;
}
export interface BetSubmission {
    pot: Pot;
    displayUsername: string;
    prediction: Prediction;
    anonymous: boolean;
    playerPrincipal: PseudoPrincipal;
}
export interface BlockedSquare {
    owner: Team;
    square: bigint;
}
export interface BurnAndPlayRequest {
    tokenId: bigint;
    kind: SpellKind;
    spellName: string;
    gameNumber?: bigint;
}
export interface BurnAndPlayResult {
    appliedColour?: BallsColourFamily;
    castOutcome?: SpellCastOutcome;
    tokenId: bigint;
    kind: SpellKind;
    team: Team;
    resolution?: SpellResolution;
    removedSquares: Array<bigint>;
    spellCheckWin?: Team;
    insufficientMaterial: boolean;
    appliedOpponentImage?: OpponentBoardImage;
    spellName: string;
    legacyReason?: LegacyReason;
    gameNumber?: bigint;
    transformedSquares: Array<bigint>;
}
export type BurnAndPlayResult2 = {
    __kind__: "ok";
    ok: {
        burn: BurnAndPlayResult;
        shieldState: ShieldState;
    };
} | {
    __kind__: "err";
    err: string;
};
export type BurnOutcome = {
    __kind__: "failed";
    failed: string;
} | {
    __kind__: "burnedWithSpell";
    burnedWithSpell: {
        spellName: string;
        gameNumber: bigint;
    };
} | {
    __kind__: "burnedLegacy";
    burnedLegacy: LegacyReason;
};
export interface BurnRequest {
    category: BurnedSpellCategory;
    spellName: string;
    gameNumber: bigint;
}
export type BurnResult = {
    __kind__: "ok";
    ok: BurnStateSnapshot;
} | {
    __kind__: "err";
    err: string;
};
export interface BurnStateSnapshot {
    burnOccurredThisTurn: boolean;
    whiteWindow: TeamWindow;
    blackWindow: TeamWindow;
    burnedByTeam?: Team;
}
export interface BurnedSpell {
    team: Team;
    category: BurnedSpellCategory;
    spellName: string;
    outcome: SpellCastOutcome;
    gameNumber: bigint;
}
export interface Cell {
    value: Value;
    name: string;
}
export interface ClaimResult {
    state: ClaimState;
    blockIndex?: bigint;
    message?: string;
    amountE8s: bigint;
}
export type CollectionPrincipal = string;
export interface CompFinalizeState {
    liveEntryCount: bigint;
    lastFinalizedSunday: Timestamp;
    nextStart: Timestamp;
    isLive: boolean;
    currentStart: Timestamp;
    nextOrder: bigint;
}
export interface CompStandingRow {
    displayName: string;
    isMe: boolean;
    rank: bigint;
    wins: bigint;
}
export interface CompStatus {
    secondsRemaining: bigint;
    live: boolean;
    sunday: Timestamp;
}
export interface DrinkingAssignment {
    capturedPiece: PieceType;
    trigger?: TriggerType;
    lostTeam: Team;
    moveIndex: bigint;
    timestamp: Timestamp;
    index: bigint;
    drinks: bigint;
}
export type Error_ = {
    __kind__: "FrontendOriginsNotConfigured";
    FrontendOriginsNotConfigured: null;
} | {
    __kind__: "MixedSsoSources";
    MixedSsoSources: {
        otherKeys: Array<string>;
        ssoKeys: Array<string>;
    };
} | {
    __kind__: "Stale";
    Stale: {
        ageNs: bigint;
    };
} | {
    __kind__: "MalformedCandid";
    MalformedCandid: null;
} | {
    __kind__: "AmbiguousAttribute";
    AmbiguousAttribute: {
        field: string;
        sources: Array<string>;
    };
} | {
    __kind__: "NoAttributes";
    NoAttributes: null;
} | {
    __kind__: "UnknownNonce";
    UnknownNonce: null;
} | {
    __kind__: "UntrustedSsoSource";
    UntrustedSsoSource: {
        domain: string;
    };
} | {
    __kind__: "MissingField";
    MissingField: string;
} | {
    __kind__: "FrontendOriginMismatch";
    FrontendOriginMismatch: {
        got: string;
        expected: Array<string>;
    };
};
export type EscrowError = {
    __kind__: "InsufficientAllowance";
    InsufficientAllowance: null;
} | {
    __kind__: "NoApproval";
    NoApproval: null;
} | {
    __kind__: "Unauthorized";
    Unauthorized: null;
} | {
    __kind__: "InvalidTier";
    InvalidTier: null;
} | {
    __kind__: "NoActiveGame";
    NoActiveGame: null;
} | {
    __kind__: "TransferFailed";
    TransferFailed: string;
};
export interface ExerciseAssignment {
    capturedPiece: PieceType;
    trigger?: TriggerType;
    lostTeam: Team;
    reps: bigint;
    exercise: ExerciseKind;
    moveIndex: bigint;
    timestamp: Timestamp;
    index: bigint;
}
export interface ExplosiveSquare {
    owner: Team;
    square: bigint;
}
export type FinalBoardState = Array<string | null>;
export interface FinalizeReport {
    lastFinalizedSunday: Timestamp;
    archived: Array<Timestamp>;
}
export interface GameRecord {
    finalMovePlayerOnTimeout?: string;
    result?: GameResult__1;
    moves: Array<RecordedMove>;
    active: boolean;
    concluded: boolean;
    openingName: string;
    rosters: Array<TeamRoster>;
    endState?: EndState;
    spellWinName?: string;
    playerList: Array<PlayerListEntry>;
    stalePlayerList: Array<PlayerListEntry>;
    finalBoard: FinalBoardState;
}
export interface GameSettingsSnapshot {
    standardCount: bigint;
    ninetySecondCount: bigint;
    spellOnCount: bigint;
    startingPosition: StartingPosition;
    twoMinuteCount: bigint;
    randomCount: bigint;
    spellUse: SpellUse;
    oneMinuteCount: bigint;
    turnDuration: TurnDuration;
    spellOffCount: bigint;
}
export interface GameStateSnapshot {
    spellBoardState: SpellBoardState;
    celebrationSecondsLeft?: bigint;
    spellUseEnabled: boolean;
    turn: Team;
    winner?: Team;
    openingName?: string;
    timerRemainingMs: bigint;
    players: Array<PlayerInfo>;
    spellWinName?: string;
    openingMoveCount: bigint;
    board: Array<Piece | null>;
    moveMaker?: PseudoPrincipal;
    phase: GamePhase;
    turnDuration: TurnDuration;
}
export type KickResult = {
    __kind__: "ok";
    ok: null;
} | {
    __kind__: "err";
    err: string;
};
export interface KickState {
    players: Array<PlayerKickState>;
}
export interface LoginResult {
    principal: PseudoPrincipal;
    username: string;
    team: Team;
    gameState: GameStateSnapshot;
}
export interface MintAttempt {
    id: bigint;
    attemptedAt: Timestamp;
    recipientRole: RecipientRole;
    recipientTeam: Team;
    outcome: MintOutcome;
    recipientUsername: string;
    gameNumber: bigint;
    recipientWalletAddress: string;
}
export interface MintAttemptGroup {
    attempts: Array<MintAttempt>;
    gameNumber: bigint;
}
export interface MintMetadata {
    moveCount: bigint;
    concludedAt: Timestamp;
    gameResult: GameResult__1;
    endState: EndState;
    spellName: string;
    finalBoardState: FinalBoardState;
    recipientRole: RecipientRole;
    recipientTeam: Team;
    recipientUsername: string;
    gameNumber: bigint;
    spellId: bigint;
    recipientWalletAddress: string;
}
export type MintOutcome = {
    __kind__: "skipped";
    skipped: string;
} | {
    __kind__: "failed";
    failed: string;
} | {
    __kind__: "succeeded";
    succeeded: {
        tokenId: bigint;
    };
};
export interface MintStatusEntry {
    username: string;
    team: Team;
    walletAddress?: string;
    outcome?: MintOutcome;
}
export type MoveResult = {
    __kind__: "ok";
    ok: GameStateSnapshot;
} | {
    __kind__: "err";
    err: string;
};
export interface MyPrize {
    rank: bigint;
    deadline: Timestamp;
    sunday: Timestamp;
    amountE8s: bigint;
}
export interface MyWins {
    rank: bigint;
    wins: bigint;
}
export interface NextGameSettings {
    startingPosition: StartingPosition;
    spellUse: SpellUse;
    turnDuration: TurnDuration;
}
export interface PastWinnerRow {
    runnerUpName?: string;
    runnerUpWins?: bigint;
    winnerName?: string;
    winnerWins?: bigint;
    sunday: Timestamp;
}
export interface PbppInformationEntry {
    content: string;
    timestamp: Timestamp;
}
export interface Piece {
    pieceType: PieceType;
    color: Team;
    summoned: boolean;
}
export interface PlaceBetArgs {
    username: string;
    player: Principal;
    wallet_address: string;
    pot_tier: bigint;
    anonymous: boolean;
    amount_e8s: bigint;
    outcome: GameOutcome;
}
export type PlaceBetResult = {
    __kind__: "ok";
    ok: bigint;
} | {
    __kind__: "err";
    err: EscrowError;
};
export interface PlayerInfo {
    principal: PseudoPrincipal;
    username: string;
    team: Team;
    walletSource: WalletSource;
    walletAddress?: string;
    isMoveMaker: boolean;
    isFresh: boolean;
    isBot: boolean;
    isInactive: boolean;
}
export interface PlayerKickState {
    principal: PseudoPrincipal;
    kickCount: bigint;
    kickedBy: Array<string>;
}
export interface PlayerListEntry {
    principal: PseudoPrincipal;
    username: string;
    listPosition: bigint;
    team: Team;
    walletAddress?: string;
}
export type PrizeBalancesResult = {
    __kind__: "ok";
    ok: PrizeCanisterBalances;
} | {
    __kind__: "err";
    err: string;
};
export interface PrizeCanisterBalances {
    icpE8s: bigint;
    cycles: bigint;
}
export interface PrizePool {
    poolE8s: bigint;
    firstPrizeE8s: bigint;
}
export interface PrizePreview {
    poolRequiredE8s: bigint;
    rankPrizesE8s: Array<bigint>;
    prizesTotalE8s: bigint;
    feesTotalE8s: bigint;
    firstPrizeE8s: bigint;
}
export interface PrizePreviewResult {
    preview: PrizePreview;
    warnings: Array<PrizeWarning>;
    rejections: Array<PrizeRejection>;
}
export type PseudoPrincipal = string;
export interface RealBet {
    username: string;
    block_index: bigint;
    placed_at: bigint;
    player: Principal;
    wallet_address: string;
    pot_tier: bigint;
    anonymous: boolean;
    amount_e8s: bigint;
    game_id: string;
    outcome: GameOutcome;
}
export interface RealBetRecord {
    id: bigint;
    bet: RealBet;
    timestamp: Timestamp;
}
export interface RecordedMove {
    capturedPiece?: PieceType;
    username: string;
    notation: string;
    team: Team;
    isCastling: boolean;
    toSquare: bigint;
    promotion?: PieceType;
    fromSquare: bigint;
    timestamp: Timestamp;
    index: bigint;
    gaveCheck: boolean;
    isEnPassant: boolean;
}
export interface ReportOutcomeArgs {
    result: GameOutcome;
    end_time: bigint;
    game_id: string;
}
export type ReportOutcomeResult = {
    __kind__: "ok";
    ok: null;
} | {
    __kind__: "err";
    err: EscrowError;
};
export interface Result {
    hasMore: boolean;
    rows: Array<Array<Cell>>;
}
export interface ResultRecord {
    id: bigint;
    result: GameResult;
    timestamp: Timestamp;
}
export type Result__1 = {
    __kind__: "ok";
    ok: null;
} | {
    __kind__: "err";
    err: Error_;
};
export interface SettlementRecord {
    id: bigint;
    timestamp: Timestamp;
    settlement: SettlementResult;
}
export interface SettlementResult {
    game_id: string;
    outcome: GameOutcome;
    settled_at: bigint;
}
export interface ShieldResolutionSnapshot {
    whiteShield: bigint;
    blackShield: bigint;
    lastBurnAndPlay?: BurnAndPlayResult;
}
export interface ShieldState {
    whiteShield: bigint;
    blackShield: bigint;
}
export interface SpellBoardState {
    blockedSquareOwners: Array<BlockedSquare>;
    blackBallsColour?: BallsColourFamily;
    explosiveSquares: Array<ExplosiveSquare>;
    whiteBallsColour?: BallsColourFamily;
    blockedSquares: Array<bigint>;
    blackOpponentImage?: OpponentBoardImage;
    whiteOpponentImage?: OpponentBoardImage;
}
export interface SpellBoardView {
    blockedSquareOwners: Array<BlockedSquare>;
    spellUseEnabled: boolean;
    blackBallsColour?: BallsColourFamily;
    explosiveSquares: Array<ExplosiveSquare>;
    whiteBallsColour?: BallsColourFamily;
    blockedSquares: Array<bigint>;
    blackOpponentImage?: OpponentBoardImage;
    whiteOpponentImage?: OpponentBoardImage;
}
export interface SpellEntry {
    id: bigint;
    complexity: SpellComplexity;
    nftEligible: boolean;
    meaning: string;
    name: string;
    magicCategory?: MagicCategory;
    level?: SpellLevel;
    spell: string;
    category: SpellCategory;
    dropChance: bigint;
}
export interface SpellResolution {
    attacker: Team;
    shieldBefore: bigint;
    shieldAfter: bigint;
    firesOnBoard: boolean;
    spellValue: bigint;
    outcome: SpellResolutionOutcome;
    defender: Team;
}
export interface SpellTable {
    major: Array<SpellEntry>;
    minor: Array<SpellEntry>;
    balls: Array<SpellEntry>;
    block?: SpellEntry;
}
export type SpenderPrincipal = string;
export interface StartGameArgs {
    start_time: bigint;
    game_id: string;
}
export type StartGameResult = {
    __kind__: "ok";
    ok: null;
} | {
    __kind__: "err";
    err: EscrowError;
};
export interface StoryRow {
    deleted: boolean;
    text: string;
    hasVotedKeep: boolean;
    hasVotedDelete: boolean;
    index: bigint;
    keepCount: bigint;
    deleteCount: bigint;
}
export interface SundayAllocationStatus {
    allocated: boolean;
    sunday: Timestamp;
    poolE8s?: bigint;
}
export interface TeamRoster {
    members: Array<PlayerListEntry>;
    count: bigint;
    team: Team;
}
export interface TeamWindow {
    minorMajorSpells: Array<BurnedSpell>;
    subaoVeSpells: Array<BurnedSpell>;
}
export type Timestamp = bigint;
export type Value = {
    __kind__: "int";
    int: bigint;
} | {
    __kind__: "nat";
    nat: bigint;
} | {
    __kind__: "float";
    float: number;
} | {
    __kind__: "bool";
    bool: boolean;
} | {
    __kind__: "null";
    null: null;
} | {
    __kind__: "text";
    text: string;
};
export interface Vote {
    startingPosition: StartingPosition;
    spellUse: SpellUse;
    turnDuration: TurnDuration;
}
export interface VoteTally {
    standardCount: bigint;
    ninetySecondCount: bigint;
    spellOnCount: bigint;
    twoMinuteCount: bigint;
    randomCount: bigint;
    oneMinuteCount: bigint;
    spellOffCount: bigint;
    winning: NextGameSettings;
}
export interface WinCreditPreviewPlayer {
    username: string;
    team: Team;
    isBound: boolean;
    secondsSinceLastPing: bigint;
    pingFresh: boolean;
}
export interface WinnerRankingRow {
    displayName: string;
    isMe: boolean;
    rank: bigint;
    wins: bigint;
}
export enum BallsColourFamily {
    Sandy = "Sandy",
    Cloudy = "Cloudy",
    Grassy = "Grassy",
    Fiery = "Fiery",
    Wooden = "Wooden"
}
export enum BurnedSpellCategory {
    Balls = "Balls",
    Major = "Major",
    Minor = "Minor",
    SubaoVe = "SubaoVe"
}
export enum ClaimState {
    paid = "paid",
    claimable = "claimable",
    paying = "paying"
}
export enum ClaimStatus {
    expired = "expired",
    claimable = "claimable"
}
export enum EndState {
    Draw = "Draw",
    Checkmate = "Checkmate",
    Timeout = "Timeout",
    Stalemate = "Stalemate",
    InsufficientMaterial = "InsufficientMaterial"
}
export enum ExerciseKind {
    NinjaRoll = "NinjaRoll",
    PushUps = "PushUps",
    Squats = "Squats",
    Cartwheel = "Cartwheel",
    Crunches = "Crunches"
}
export enum GameOutcome {
    draw = "draw",
    black = "black",
    white = "white"
}
export enum GamePhase {
    Paused = "Paused",
    Draw = "Draw",
    Playing = "Playing",
    Celebration = "Celebration"
}
export enum GameResult {
    Draw = "Draw",
    Black = "Black",
    White = "White"
}
export enum GameResult__1 {
    Draw = "Draw",
    BlackWin = "BlackWin",
    WhiteWin = "WhiteWin"
}
export enum LegacyReason {
    keysAbsent = "keysAbsent",
    wrongType = "wrongType",
    keysDisagree = "keysDisagree",
    readFailed = "readFailed"
}
export enum MagicCategory {
    Hex = "Hex",
    Elemental = "Elemental",
    Necromancy = "Necromancy",
    Conjuring = "Conjuring"
}
export enum OpponentBoardImage {
    Shiny = "Shiny",
    Hairy = "Hairy",
    Veiny = "Veiny"
}
export enum PieceType {
    Bishop = "Bishop",
    King = "King",
    Pawn = "Pawn",
    Rook = "Rook",
    Knight = "Knight",
    Queen = "Queen"
}
export enum Pot {
    One = "One",
    Ten = "Ten",
    Hundred = "Hundred",
    Thousand = "Thousand"
}
export enum Prediction {
    Draw = "Draw",
    Black = "Black",
    White = "White"
}
export enum PrizeRejection {
    rank10RoundsToZero = "rank10RoundsToZero",
    poolTooSmallForFees = "poolTooSmallForFees",
    aboveMaximumPool = "aboveMaximumPool"
}
export enum PrizeWarning {
    lowRanksBelowFee = "lowRanksBelowFee"
}
export enum RecipientRole {
    Drawer = "Drawer",
    Winner = "Winner"
}
export enum SpellCastOutcome {
    noEffect = "noEffect",
    prevented = "prevented",
    succeeded = "succeeded"
}
export enum SpellCategory {
    Balls = "Balls",
    Block = "Block",
    Major = "Major",
    Minor = "Minor"
}
export enum SpellComplexity {
    Easy = "Easy",
    Complex = "Complex",
    Moderate = "Moderate"
}
export enum SpellKind {
    Balls = "Balls",
    Major = "Major",
    Minor = "Minor",
    SubaoVe = "SubaoVe"
}
export enum SpellLevel {
    OP = "OP",
    Skilled = "Skilled",
    Advanced = "Advanced",
    Basic = "Basic",
    Mastery = "Mastery"
}
export enum SpellResolutionOutcome {
    fired = "fired",
    cancelled = "cancelled",
    legacy = "legacy"
}
export enum SpellUse {
    On = "On",
    Off = "Off"
}
export enum StartingPosition {
    Standard = "Standard",
    Random = "Random"
}
export enum Team {
    Black = "Black",
    White = "White"
}
export enum TriggerType {
    Capture = "Capture",
    EnPassant = "EnPassant",
    Castling = "Castling",
    Check = "Check"
}
export enum TurnDuration {
    TwoMinutes = "TwoMinutes",
    NinetySeconds = "NinetySeconds",
    OneMinute = "OneMinute"
}
export enum UserRole {
    admin = "admin",
    user = "user",
    guest = "guest"
}
export enum WalletSource {
    typed = "typed",
    none = "none",
    oisy = "oisy"
}
export interface BoardFrame {
    kind: string;
    caption: string;
    fromSquare: bigint;
    toSquare: bigint;
    board: string;
    summoned: Array<bigint>;
}
export interface BoardFrameList {
    generation: bigint;
    frames: Array<BoardFrame>;
}
export interface ResignState {
    whiteVotes: bigint;
    whiteNeeded: bigint;
    blackVotes: bigint;
    blackNeeded: bigint;
    voters: Array<string>;
    resignedTeam: string;
}
export interface backendInterface {
    adminBackfillCompetition(entry: BackfillEntry, winnerPrincipal: Principal): Promise<void>;
    adminBackfillPrizeAllocation(sunday: Timestamp, poolE8s: bigint): Promise<AllocationResult>;
    adminFinalizeCompetitions(): Promise<FinalizeReport>;
    appendPbppInformation(content: string): Promise<PbppInformationEntry>;
    appendStorySection(text: string): Promise<void>;
    assignCallerUserRole(user: Principal, role: UserRole): Promise<void>;
    attemptMove(principal: PseudoPrincipal, fromSquare: bigint, toSquare: bigint, promotion: PieceType | null): Promise<MoveResult>;
    burnAndPlay(principal: PseudoPrincipal, request: BurnAndPlayRequest): Promise<BurnAndPlayResult2>;
    burnNft(tokenId: bigint): Promise<BurnOutcome>;
    burnNfts(tokenIds: Array<bigint>): Promise<Array<BurnOutcome>>;
    castKickVote(principal: PseudoPrincipal, target: PseudoPrincipal): Promise<KickResult>;
    castVote(principal: PseudoPrincipal, vote: Vote): Promise<{
        __kind__: "ok";
        ok: null;
    } | {
        __kind__: "err";
        err: string;
    }>;
    checkAllowance(player: Principal): Promise<Allowance>;
    claimPrize(competition: Timestamp, rank: bigint, recipient: Principal): Promise<ClaimResult>;
    claimStoryAuthorship(): Promise<Principal>;
    clearNftMintAttempts(): Promise<void>;
    clearPrizeAllocation(sunday: Timestamp): Promise<AllocationResult>;
    concludeByInsufficientMaterial(now: Timestamp): Promise<void>;
    concludeBySpellCheck(winner: Team, spellName: string, now: Timestamp): Promise<void>;
    createDrinkingAssignment(capturedPiece: PieceType, lostTeam: Team, moveIndex: bigint): Promise<DrinkingAssignment>;
    createEnPassantDrinkingAssignment(lostTeam: Team, moveIndex: bigint): Promise<DrinkingAssignment>;
    createEnPassantExerciseAssignments(lostTeam: Team, moveIndex: bigint): Promise<Array<ExerciseAssignment>>;
    createExerciseAssignment(capturedPiece: PieceType, lostTeam: Team, moveIndex: bigint): Promise<ExerciseAssignment>;
    execute(qJson: string): Promise<Result>;
    fillStoryGap(index: bigint, text: string): Promise<void>;
    fireApproval(player: PseudoPrincipal): Promise<ApprovalResult>;
    getAdminAllocatedCompetitionDates(): Promise<Array<AdminCompetitionDate>>;
    getAdminCompetitionDetail(sunday: Timestamp): Promise<AdminCompetitionDetail>;
    getAdminPrizeClaims(): Promise<AdminPrizeOverview__1>;
    getAdminPrizeOverview(): Promise<AdminPrizeOverview>;
    getApiDoc(): Promise<string>;
    kickBot(principal: PseudoPrincipal): Promise<string>;
    getBoardFrames(): Promise<BoardFrameList>;
    getResignState(): Promise<ResignState>;
    castResignVote(principal: PseudoPrincipal): Promise<string>;
    withdrawResignVote(principal: PseudoPrincipal): Promise<string>;
    getApprovalState(player: PseudoPrincipal): Promise<ApprovalStateResult>;
    getArchivedPrizePool(sunday: Timestamp): Promise<ArchivedPrizePool | null>;
    getBets(): Promise<Array<BetRecord>>;
    getBurnState(): Promise<BurnStateSnapshot>;
    getCallerUserRole(): Promise<UserRole>;
    getClaimStatus(sunday: Timestamp): Promise<ClaimStatus>;
    getCompFinalizeState(): Promise<CompFinalizeState>;
    getCurrentPrizePool(): Promise<PrizePool>;
    getDrinkingAssignments(): Promise<Array<DrinkingAssignment>>;
    getExerciseAssignments(): Promise<Array<ExerciseAssignment>>;
    getFirstPrizeForSunday(sunday: Timestamp): Promise<bigint | null>;
    getGameNumber(): Promise<bigint>;
    getGameRecord(): Promise<GameRecord>;
    getGameSettingsSnapshot(): Promise<GameSettingsSnapshot>;
    getGameState(principal: PseudoPrincipal): Promise<GameStateSnapshot>;
    getKickState(): Promise<KickState>;
    getMintAttemptsByGame(): Promise<Array<MintAttemptGroup>>;
    getMintStatusForPlayer(walletAddress: string): Promise<MintOutcome | null>;
    getMintStatusesForGame(): Promise<Array<MintStatusEntry>>;
    getMyPrize(): Promise<MyPrize | null>;
    getMyWins(): Promise<MyWins>;
    getNextGameSettings(): Promise<NextGameSettings>;
    getNftMetadata(tokenId: bigint): Promise<MintMetadata | null>;
    getNftMetadataBatch(tokenIds: Array<bigint>): Promise<Array<MintMetadata | null>>;
    getNftsForOwner(owner: string): Promise<Array<bigint>>;
    getPastWinners(): Promise<Array<PastWinnerRow>>;
    getPbppInformation(): Promise<Array<PbppInformationEntry>>;
    getPrizeCanisterBalances(): Promise<PrizeBalancesResult>;
    getRealBets(): Promise<Array<RealBetRecord>>;
    getResults(): Promise<Array<ResultRecord>>;
    getSettlements(): Promise<Array<SettlementRecord>>;
    getShieldResolutionSnapshot(): Promise<ShieldResolutionSnapshot>;
    getShieldState(): Promise<ShieldState>;
    getSpellBoardState(): Promise<SpellBoardView>;
    getSpellNameForGame(gameNumber: bigint, walletAddress: string): Promise<string | null>;
    getSpellTable(): Promise<SpellTable>;
    getStoryAuthor(): Promise<Principal | null>;
    getStorySections(): Promise<Array<StoryRow>>;
    getSundayCompStandings(limit: bigint): Promise<Array<CompStandingRow>>;
    getSundayCompStatus(): Promise<CompStatus>;
    getUpcomingAllocationStatuses(): Promise<Array<SundayAllocationStatus>>;
    getVoteTally(): Promise<VoteTally>;
    getWinCreditPreview(): Promise<{
        players: Array<WinCreditPreviewPlayer>;
        celebrationWinner?: Team;
        phase: GamePhase;
        competitionLive: boolean;
        gameNumber: bigint;
    }>;
    getWinnerRanking(limit: bigint): Promise<Array<WinnerRankingRow>>;
    heartbeat(principal: PseudoPrincipal): Promise<{
        __kind__: "ok";
        ok: null;
    } | {
        __kind__: "err";
        err: string;
    }>;
    isCallerAdmin(): Promise<boolean>;
    isInsufficientMaterialForSquares(pieces: Array<[bigint, PieceType, Team]>): Promise<boolean>;
    login(principal: PseudoPrincipal, username: string, walletAddress: string | null, walletSource: WalletSource): Promise<LoginResult>;
    loginRanked(rosterKey: string, username: string, walletAddress: string | null, walletSource: WalletSource): Promise<LoginResult>;
    logout(principal: PseudoPrincipal): Promise<void>;
    mintGameNfts(): Promise<void>;
    placeBet(args: PlaceBetArgs): Promise<PlaceBetResult>;
    pressStoryDelete(index: bigint): Promise<void>;
    pressStoryKeep(index: bigint): Promise<void>;
    previewPrizeAllocation(poolE8s: bigint): Promise<PrizePreviewResult>;
    recordBurn(principal: PseudoPrincipal, request: BurnRequest): Promise<BurnResult>;
    recordConsentError(player: PseudoPrincipal, error: string): Promise<void>;
    recordGameResult(result: GameResult): Promise<ResultRecord>;
    reportOutcome(args: ReportOutcomeArgs): Promise<ReportOutcomeResult>;
    requestNewGame(principal: PseudoPrincipal): Promise<{
        __kind__: "ok";
        ok: null;
    } | {
        __kind__: "err";
        err: string;
    }>;
    runMaintenance(now: Timestamp): Promise<void>;
    savePrizeAllocation(sunday: Timestamp, poolE8s: bigint): Promise<AllocationResult>;
    schema(): Promise<string>;
    setApprovalGranted(player: PseudoPrincipal, granted: boolean): Promise<ApprovalStateResult>;
    setJalcaPrincipal(principal: Principal): Promise<void>;
    setPbppCanisterPrincipal(principal: Principal): Promise<void>;
    setPrizeCanisterPrincipal(principal: Principal): Promise<void>;
    startGame(args: StartGameArgs): Promise<StartGameResult>;
    submitBet(pot: Pot, prediction: Prediction, playerPrincipal: PseudoPrincipal, displayUsername: string, anonymous: boolean): Promise<BetRecord>;
    updateWalletAddress(principal: PseudoPrincipal, walletAddress: string | null, walletSource: WalletSource): Promise<void>;
    withdrawKickVote(principal: PseudoPrincipal, target: PseudoPrincipal): Promise<KickResult>;
    writeStory(text: string): Promise<void>;
}
