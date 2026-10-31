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
export type Routes = Record<Outcome, string>;
export type Node =
  | { kind: "activity"; action: string; routes: Routes; input?: Json; params?: Json; loopLimits?: Record<string, number> }
  | { kind: "await-signal"; signal: string; routes: Routes; loopLimits?: Record<string, number> }
  | { kind: "complete"; output?: Json }
  | { kind: "fail"; error: { code: string; message: string } };

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
export interface NodeResult { visit: number; outcome: string; output: Json }
export interface From { node: string; outcome: string; output: Json }
export interface Invocation { id: string; nodeId: string; attempt: number; input: Json; params: Json }
export type Status = "running" | "waiting" | "needs-intervention" | "completed" | "failed" | "cancelled";
export interface RunState {
  runId: string;
  status: Status;
  input: Json;
  position: string | null;
  visits: Record<string, number>;
  activations: number;
  nodes: Record<string, NodeResult>;
  streaks: Record<string, { outcome: string; count: number }>;
  from: From | null;
  invocation: Invocation | null;
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
