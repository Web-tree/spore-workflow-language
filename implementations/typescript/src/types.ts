export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type Outcome = string;
export type Effect = "pure" | "read-only" | "idempotent" | "unsafe";

export interface ActionContract {
  effect: Effect;
  outcomes: Outcome[];
  retry?: { maxAttempts?: number };
  inputSchema?: Record<string, unknown>;
  outputSchemas?: Record<string, Record<string, unknown>>;
  capabilities?: string[];
}
/** A route value is one node ID, or in the parallel profile an array of them (a split). */
export type RouteTarget = string | string[];
export type Routes = Record<Outcome, RouteTarget>;
/** Members a node may carry when it is a gather (parallel profile). */
export interface GatherMembers { need?: "all" | "any" | number; optional?: string[]; losers?: "stop" | "wait" }
export type Node = GatherMembers & (
  | { kind: "activity"; action: string; routes: Routes; input?: Json; params?: Json; loopLimits?: Record<string, number> }
  | { kind: "await-signal"; signal: string; routes: Routes; loopLimits?: Record<string, number> }
  | { kind: "complete"; output?: Json }
  | { kind: "fail"; error: { code: string; message: string } }
  | { kind: "drop" }
);

export interface Definition {
  language: "swl";
  name: string;
  start: string;
  nodes: Record<string, Node>;
  actions?: Record<string, ActionContract>;
  requires?: string[];
  limits?: { maxVisitsPerNode?: number; maxActivations?: number };
  inputSchema?: Record<string, unknown>;
}
export interface Arrival { outcome: string; output: Json }
export type Arrivals = Record<string, Arrival | null>;
export interface NodeResult { visit: number; outcome?: string; output?: Json; arrivals?: Arrivals }
export interface From { node: string; outcome: string; output: Json }
export interface Invocation { id: string; nodeId: string; attempt: number; input: Json; params: Json }
export type Status = "running" | "waiting" | "needs-intervention" | "stopping" | "completed" | "failed" | "cancelled";
/** One open branch: where it is and what it waits for. A core run has at most one. */
export interface Position {
  node: string;
  invocation: Invocation | null;
  /** Parked on an unknown result, waiting for a resolve event. */
  parked: boolean;
  from: From | null;
  /** The split instance this branch belongs to, or null at the top level. */
  split: string | null;
  /** The branch name within that split: the branch's first node. */
  branch: string | null;
}
/** One taking of a split, keyed by `<split node>#<visit>`. Removed once its gather has decided. */
export interface SplitInstance {
  node: string;
  visit: number;
  outcome: string;
  gather: string;
  targets: string[];
  /** The enclosing split instance and the branch of it that contains this split. */
  parent: string | null;
  branch: string | null;
  /** One entry per finished branch: its arrival, or null when it dropped. Open branches have no entry. */
  arrivals: Arrivals;
}
export interface RunState {
  runId: string;
  status: Status;
  input: Json;
  positions: Position[];
  splits: Record<string, SplitInstance>;
  visits: Record<string, number>;
  activations: number;
  nodes: Record<string, NodeResult>;
  streaks: Record<string, { outcome: string; count: number }>;
  /** The end a stopping run will take once every unsafe invocation has a known result. */
  pending?: { status: "failed" | "cancelled"; error?: { code: string; message: string } };
  result?: Json;
  error?: { code: string; message: string };
}
export type Event =
  | { type: "start"; runId: string; input?: Json }
  | { type: "result"; invocationId: string; status: "success" | "failure" | "unknown"; outcome?: string; output?: Json; error?: string; retryable?: boolean }
  | { type: "signal"; name: string; outcome: string; output?: Json }
  | { type: "resolve"; invocationId: string; action: "complete" | "retry" | "fail"; outcome?: string; output?: Json; error?: string }
  | { type: "cancel"; reason?: string };
export type Command =
  | { type: "invoke"; invocationId: string; nodeId: string; action: string; attempt: number; idempotencyKey: string; input: Json; params: Json }
  | { type: "cancel"; invocationId: string };
export interface Decision { state: RunState; commands: Command[]; diagnostics: string[] }
