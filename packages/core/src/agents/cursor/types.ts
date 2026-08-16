// Structural mirrors of the `@cursor/sdk` message / result / error shapes.
// These intentionally duplicate the SDK types (rather than importing them) so
// the pure mapper functions and their tests run WITHOUT the heavy SDK
// (sqlite3/protobuf) installed. Production code lazy-imports the real SDK at
// runtime; these mirrors are type-erased at compile time. Shapes are derived
// from `node_modules/@cursor/sdk/dist/esm/{messages,run,usage-types,errors,
// options,agent}.d.ts` (SDK 1.0.28) and are structurally identical to the SDK
// types. `Cursor`-prefixed names mirror the SDK members the mapper reads.

export interface CursorModelParameterValue {
  id: string;
  value: string;
}

export interface CursorModelSelection {
  id: string;
  params?: CursorModelParameterValue[];
}

export interface CursorTextBlock {
  type: 'text';
  text: string;
}

export interface CursorToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export type CursorContentBlock = CursorTextBlock | CursorToolUseBlock;

export interface CursorSystemMessage {
  type: 'system';
  subtype?: 'init';
  agent_id: string;
  run_id: string;
  model?: CursorModelSelection;
  tools?: string[];
}

export interface CursorUserMessage {
  type: 'user';
  agent_id: string;
  run_id: string;
  message: { role: 'user'; content: CursorTextBlock[] };
}

export interface CursorAssistantMessage {
  type: 'assistant';
  agent_id: string;
  run_id: string;
  message: { role: 'assistant'; content: CursorContentBlock[] };
}

export interface CursorToolCallMessage {
  type: 'tool_call';
  agent_id: string;
  run_id: string;
  call_id: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  args?: unknown;
  result?: unknown;
  truncated?: {
    args?: boolean;
    result?: boolean;
  };
}

export interface CursorThinkingMessage {
  type: 'thinking';
  agent_id: string;
  run_id: string;
  text: string;
  thinking_duration_ms?: number;
}

export interface CursorStatusMessage {
  type: 'status';
  agent_id: string;
  run_id: string;
  status:
    | 'CREATING'
    | 'RUNNING'
    | 'FINISHED'
    | 'ERROR'
    | 'CANCELLED'
    | 'EXPIRED';
  message?: string;
}

export interface CursorRequestMessage {
  type: 'request';
  agent_id: string;
  run_id: string;
  request_id: string;
}

export interface CursorTaskMessage {
  type: 'task';
  agent_id: string;
  run_id: string;
  status?: string;
  text?: string;
}

export interface CursorUsageMessage {
  type: 'usage';
  agent_id: string;
  run_id: string;
  usage: CursorTokenUsage;
}

export interface CursorInteractionQueryMessage {
  type: 'interaction_query';
  subtype: 'request' | 'response';
  query_type: string;
  query?: { id?: number; [innerQueryKey: string]: unknown };
  response?: { id?: number; [innerResponseKey: string]: unknown };
}

export type CursorSDKMessage =
  | CursorSystemMessage
  | CursorUserMessage
  | CursorAssistantMessage
  | CursorToolCallMessage
  | CursorThinkingMessage
  | CursorStatusMessage
  | CursorRequestMessage
  | CursorTaskMessage
  | CursorUsageMessage
  | CursorInteractionQueryMessage;

export type CursorRunResultStatus = 'finished' | 'error' | 'cancelled';

export interface CursorRunError {
  message: string;
  code?: string;
}

export interface CursorTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
}

export interface CursorRunResult {
  id: string;
  requestId?: string;
  status: CursorRunResultStatus;
  result?: string;
  error?: CursorRunError;
  model?: CursorModelSelection;
  durationMs?: number;
  usage?: CursorTokenUsage;
}

export interface CursorSdkErrorLike extends Error {
  readonly isRetryable: boolean;
  readonly code?: string;
  readonly status?: number;
  readonly cause?: unknown;
  readonly endpoint?: string;
  readonly requestId?: string;
  readonly operation?: string;
}

export interface CursorSdkModule {
  Agent: {
    create(options: unknown): Promise<unknown>;
    resume(agentId: string, options?: unknown): Promise<unknown>;
  };
  CursorSdkError: new (...args: never[]) => CursorSdkErrorLike;
}

export interface CursorAgentDefinition {
  kind: 'cursor';
  name: string;
  displayName?: string;
  description: string;
  cursorModel: string;
  trust: boolean;
  isolatedCwd: boolean;
  loadProjectSettings?: boolean;
  cursorRun?: {
    sandbox?: { enabled: boolean };
    mode?: string;
    settingSources?: string[];
    autoReview?: boolean;
  };
  modelParams?: CursorModelParams;
  runConfig?: { maxTimeMinutes?: number; maxTurns?: number };
  resume?: boolean;
}

export interface CursorModelParams {
  reasoning?: string;
  effort?: string;
  thinking?: boolean;
}

export interface SubagentActivityEvent {
  isSubagentActivityEvent: true;
  agentName: string;
  type:
    | 'THOUGHT_CHUNK'
    | 'TOOL_CALL_START'
    | 'TOOL_CALL_END'
    | 'ERROR'
    | 'PERMISSION_GATE';
  data: Record<string, unknown>;
}

export interface SubagentActivityItem {
  id: string;
  type: 'thought' | 'tool_call';
  content: string;
  args?: string;
  status: 'running' | 'completed' | 'error' | 'cancelled';
}

export interface OutputObject {
  result: string;
  terminate_reason: import('../../agents/runtime/agent-types.js').AgentTerminateMode;
}
