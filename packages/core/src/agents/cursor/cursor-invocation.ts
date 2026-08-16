/**
 * @license
 * Copyright 2026 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { appendFileSync } from 'node:fs';

import { AgentTerminateMode } from '../../agents/runtime/agent-types.js';
import {
  BaseToolInvocation,
  type AgentResultDisplay,
  type ToolCallConfirmationDetails,
  type ToolConfirmationOutcome,
  type ToolResult,
  type ToolResultDisplay,
} from '../../tools/tools.js';
import { ToolErrorType } from '../../tools/tool-error.js';
import type { Config } from '../../config/config.js';
import type {
  CursorAgentDefinition,
  CursorInteractionQueryMessage,
  CursorModelParameterValue,
  CursorModelParams,
  CursorRunResult,
  CursorSDKMessage,
  CursorSdkErrorLike,
  CursorSdkModule,
  OutputObject,
  SubagentActivityEvent,
  SubagentActivityItem,
} from './types.js';
import type { CursorToolRegistryLike } from './cursor-custom-tools.js';
import { buildCustomTools } from './cursor-custom-tools.js';
import { CursorSdkOutputSuppressor } from './cursor-sdk-output-suppression.js';
import { withRunTimeout, isCliRunTimeoutError } from './run-timeout.js';
import {
  installCursorMcpToolTimeoutOverride,
  restoreCursorMcpToolTimeoutOverride,
} from './cursor-mcp-timeout-override.js';

export const MAX_RECENT_ACTIVITY = 20;

export const CURSOR_API_KEY_ENV_VAR = 'CURSOR_API_KEY';

const CURSOR_API_KEY_PLACEHOLDERS = new Set([
  CURSOR_API_KEY_ENV_VAR,
  `$${CURSOR_API_KEY_ENV_VAR}`,
  `\${${CURSOR_API_KEY_ENV_VAR}}`,
]);

const CURSOR_SDK_TOOL_DISPLAY_NAMES: Record<string, string> = {
  read: 'Read',
  edit: 'Edit',
  write: 'Write',
  delete: 'Delete',
  glob: 'Glob',
  grep: 'Grep',
  shell: 'Shell',
  readlints: 'ReadLints',
  websearch: 'WebSearch',
  webfetch: 'WebFetch',
  task: 'Subagent',
  updatetodos: 'TodoWrite',
  listmcpresources: 'ListMcpResources',
  fetchmcpresource: 'FetchMcpResource',
  generateimage: 'GenerateImage',
  semsearch: 'SemSearch',
  ls: 'LS',
  createplan: 'CreatePlan',
  mcp: 'MCP',
};

export function canonicalSdkToolName(rawName: string | undefined): string {
  if (!rawName) return 'tool';
  const key = rawName.toLowerCase().replace(/[_-]/g, '');
  return CURSOR_SDK_TOOL_DISPLAY_NAMES[key] ?? rawName;
}

export function refineEditNameOnComplete(
  rawName: string | undefined,
  result: unknown,
): string {
  const canon = canonicalSdkToolName(rawName);
  if (canon !== 'Edit') {
    return canon;
  }
  if (!isRecord(result)) return canon;
  const success = result['success'];
  if (!isRecord(success)) return canon;
  const message = asString(success['message']) ?? '';
  if (message.includes('Wrote')) return 'Write';
  const diffString = asString(success['diffString']) ?? '';
  if (diffString.includes('--- /dev/null')) return 'Write';
  const before = success['beforeFullFileContent'];
  if (before === '' || before === undefined) return 'Write';
  return 'Edit';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isToolActivityError(data: unknown): boolean {
  return (
    data !== null &&
    typeof data === 'object' &&
    'isError' in data &&
    (data as { isError: unknown }).isError === true
  );
}

function sanitizeThoughtContent(text: string): string {
  return text;
}

function sanitizeErrorMessage(message: string): string {
  return message;
}

function sanitizeToolArgs(args: unknown): unknown {
  if (typeof args !== 'object' || args === null) return args;
  if (Array.isArray(args)) return args;
  return args;
}

export function resolveCursorApiKey(apiKey?: string): string | undefined {
  const trimmed = apiKey?.trim();
  if (trimmed && !CURSOR_API_KEY_PLACEHOLDERS.has(trimmed)) {
    return trimmed;
  }
  return process.env[CURSOR_API_KEY_ENV_VAR]?.trim() || undefined;
}

function extractSdkInteractionQueryId(
  event: CursorInteractionQueryMessage,
): number | undefined {
  const subtype = event.subtype;
  const container = subtype === 'response' ? event.response : event.query;
  if (!isRecord(container)) {
    return undefined;
  }
  const id = container['id'];
  return typeof id === 'number' ? id : undefined;
}

function extractSdkInteractionRequestArgs(
  event: CursorInteractionQueryMessage,
): { args: unknown; toolCallId?: string } {
  const queryType = event.query_type;
  const query = event.query;
  if (!isRecord(query) || !queryType) {
    return { args: undefined };
  }
  const inner = query[queryType];
  if (!isRecord(inner)) {
    return { args: undefined };
  }
  const args = inner['args'];
  const toolCallId = isRecord(args) ? asString(args['toolCallId']) : undefined;
  return { args, ...(toolCallId !== undefined ? { toolCallId } : {}) };
}

function extractSdkInteractionResponseApproval(
  event: CursorInteractionQueryMessage,
): boolean | undefined {
  const queryType = event.query_type;
  const response = event.response;
  if (!isRecord(response) || !queryType) {
    return undefined;
  }
  const responseKey = queryType.replace(/RequestQuery$/, 'RequestResponse');
  const inner = response[responseKey];
  if (!isRecord(inner)) {
    return undefined;
  }
  if ('approved' in inner) {
    return true;
  }
  if ('denied' in inner) {
    return false;
  }
  return undefined;
}

export function mapCursorEvent(
  event: CursorSDKMessage,
  agentName: string,
): SubagentActivityEvent[] {
  const activity = (
    type: SubagentActivityEvent['type'],
    data: Record<string, unknown>,
  ): SubagentActivityEvent => ({
    isSubagentActivityEvent: true,
    agentName,
    type,
    data,
  });

  switch (event.type) {
    case 'system':
    case 'user':
    case 'task':
    case 'usage':
      return [];
    case 'assistant': {
      const events: SubagentActivityEvent[] = [];
      for (const block of event.message.content ?? []) {
        if (block.type === 'tool_use') {
          events.push(
            activity('TOOL_CALL_START', {
              name: canonicalSdkToolName(block.name),
              callId: block.id,
              args: block.input,
            }),
          );
        }
      }
      return events;
    }
    case 'thinking': {
      if (!event.text) {
        return [];
      }
      return [activity('THOUGHT_CHUNK', { text: event.text })];
    }
    case 'tool_call': {
      if (event.status === 'running') {
        return [
          activity('TOOL_CALL_START', {
            name: canonicalSdkToolName(event.name),
            callId: event.call_id,
            args: event.args,
          }),
        ];
      }
      return [
        activity('TOOL_CALL_END', {
          callId: event.call_id,
          result: event.result,
          isError: event.status === 'error',
          name: refineEditNameOnComplete(event.name, event.result),
        }),
      ];
    }
    case 'status': {
      if (event.status === 'ERROR') {
        return [
          activity('ERROR', {
            error: event.message ?? 'Cursor agent reported an error.',
            context: 'status',
          }),
        ];
      }
      return [];
    }
    case 'request': {
      const queryType = 'cursorApprovalRequest';
      return [
        activity('PERMISSION_GATE', {
          queryType,
          phase: 'request',
          requestId: event.request_id,
        }),
        activity('PERMISSION_GATE', {
          queryType,
          phase: 'response',
          approved: false,
        }),
      ];
    }
    case 'interaction_query': {
      const queryType = event.query_type ?? 'unknown';
      const queryId = extractSdkInteractionQueryId(event);
      if (event.subtype === 'request') {
        const { args, toolCallId } = extractSdkInteractionRequestArgs(event);
        return [
          activity('PERMISSION_GATE', {
            queryType,
            queryId,
            phase: 'request',
            args,
            ...(toolCallId !== undefined ? { toolCallId } : {}),
          }),
        ];
      }
      const approval = extractSdkInteractionResponseApproval(event);
      return [
        activity('PERMISSION_GATE', {
          queryType,
          queryId,
          phase: 'response',
          ...(approval !== undefined ? { approved: approval } : {}),
        }),
      ];
    }
    default: {
      const _exhaustive: never = event;
      void _exhaustive;
      return [];
    }
  }
}

export function extractAssistantText(event: CursorSDKMessage): string {
  if (event.type !== 'assistant') {
    return '';
  }
  let text = '';
  for (const block of event.message.content ?? []) {
    if (block.type === 'text' && block.text) {
      text += block.text;
    }
  }
  return text;
}

function truncateForError(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + '…';
}

export function mapRunResultToOutput(
  result: CursorRunResult,
  buffer: string,
): OutputObject {
  const trimmedResult = (result.result ?? '').trim();
  const trimmedBuffer = buffer.trim();
  switch (result.status) {
    case 'finished':
      return {
        result: trimmedResult || trimmedBuffer || 'Task completed.',
        terminate_reason: AgentTerminateMode.GOAL,
      };
    case 'cancelled':
      return {
        result:
          trimmedResult || trimmedBuffer || 'Cursor agent run was cancelled.',
        terminate_reason: AgentTerminateMode.CANCELLED,
      };
    case 'error':
    default: {
      if (trimmedResult) {
        return {
          result: trimmedResult,
          terminate_reason: AgentTerminateMode.ERROR,
        };
      }
      const debugTail = trimmedBuffer
        ? ` Last assistant text: ${truncateForError(trimmedBuffer, 200)}`
        : '';
      return {
        result:
          'Cursor agent run failed: SDK returned status="error" with no result. ' +
          `Set QWEN_CURSOR_DEBUG=1 (and QWEN_CURSOR_DEBUG_FILE=/path/to/log.jsonl) ` +
          `for cursor run diagnostics.${debugTail}`,
        terminate_reason: AgentTerminateMode.ERROR,
      };
    }
  }
}

export function applyActivity(
  recentActivity: SubagentActivityItem[],
  event: SubagentActivityEvent,
): SubagentActivityItem[] {
  switch (event.type) {
    case 'THOUGHT_CHUNK': {
      const text = sanitizeThoughtContent(String(event.data['text'] ?? ''));
      const last = recentActivity[recentActivity.length - 1];
      if (last && last.type === 'thought' && last.status === 'running') {
        last.content += text;
      } else {
        recentActivity.push({
          id: randomUUID(),
          type: 'thought',
          content: text,
          status: 'running',
        });
      }
      break;
    }
    case 'TOOL_CALL_START': {
      const callId = event.data['callId']
        ? String(event.data['callId'])
        : randomUUID();
      const existing = recentActivity.find(
        (item) => item.type === 'tool_call' && item.id === callId,
      );
      if (existing) {
        break;
      }
      recentActivity.push({
        id: callId,
        type: 'tool_call',
        content: String(event.data['name'] ?? 'tool'),
        args: JSON.stringify(sanitizeToolArgs(event.data['args'] ?? {})),
        status: 'running',
      });
      break;
    }
    case 'TOOL_CALL_END': {
      const callId = event.data['callId']
        ? String(event.data['callId'])
        : undefined;
      if (callId == null) {
        break;
      }
      const isError =
        Boolean(event.data['isError']) || isToolActivityError(event.data);
      for (let i = recentActivity.length - 1; i >= 0; i--) {
        const item = recentActivity[i];
        if (
          item.type === 'tool_call' &&
          item.id === callId &&
          item.status === 'running'
        ) {
          item.status = isError ? 'error' : 'completed';
          break;
        }
      }
      break;
    }
    case 'ERROR': {
      const last = recentActivity[recentActivity.length - 1];
      if (last && last.type === 'thought' && last.status === 'running') {
        last.status = 'error';
      }
      recentActivity.push({
        id: randomUUID(),
        type: 'thought',
        content: `Error: ${sanitizeErrorMessage(
          String(event.data['error'] ?? 'Unknown error'),
        )}`,
        status: 'error',
      });
      break;
    }
    case 'PERMISSION_GATE': {
      const queryType = String(event.data['queryType'] ?? 'unknown');
      const phase = event.data['phase'];
      if (phase === 'request') {
        const toolCallId = event.data['toolCallId'];
        const queryIdRaw = event.data['queryId'];
        const queryId = typeof queryIdRaw === 'number' ? queryIdRaw : undefined;
        const id =
          toolCallId != null
            ? String(toolCallId)
            : queryId !== undefined
              ? `gate-${queryId}`
              : randomUUID();
        const toolCallIdSuffix =
          toolCallId != null ? ` (toolCallId=${String(toolCallId)})` : '';
        recentActivity.push({
          id,
          type: 'tool_call',
          content: `Gate request: ${queryType}${toolCallIdSuffix}`,
          ...(event.data['args'] !== undefined
            ? {
                args: JSON.stringify(
                  sanitizeToolArgs(event.data['args'] ?? {}),
                ),
              }
            : {}),
          status: 'running',
        });
      } else if (phase === 'response') {
        const approved = event.data['approved'];
        let content: string;
        if (approved === true) {
          content = `Gate approved: ${queryType}`;
        } else if (approved === false) {
          content = `Gate denied: ${queryType}`;
        } else {
          content = `Gate ${queryType}`;
        }
        recentActivity.push({
          id: randomUUID(),
          type: 'tool_call',
          content,
          status: approved === false ? 'error' : 'completed',
        });
      }
      break;
    }
    default:
      break;
  }

  if (recentActivity.length > MAX_RECENT_ACTIVITY) {
    return recentActivity.slice(-MAX_RECENT_ACTIVITY);
  }
  return recentActivity;
}

export function toCursorModelParams(
  params?: CursorModelParams,
): CursorModelParameterValue[] | undefined {
  if (!params) {
    return undefined;
  }
  const out: CursorModelParameterValue[] = [];
  if (params.reasoning !== undefined) {
    out.push({ id: 'reasoning', value: params.reasoning });
  }
  const thinkingOff = params.thinking === false;
  if (params.effort !== undefined && !thinkingOff) {
    out.push({ id: 'effort', value: params.effort });
  }
  if (params.thinking !== undefined) {
    out.push({ id: 'thinking', value: String(params.thinking) });
  }
  return out.length > 0 ? out : undefined;
}

export function resolveSettingSources(
  definition: CursorAgentDefinition,
): string[] {
  if (definition.cursorRun?.settingSources !== undefined) {
    return definition.cursorRun.settingSources;
  }
  return definition.loadProjectSettings ? ['project'] : [];
}

// ---------------------------------------------------------------------------
// CursorAgentInvocation — the executor. Drives a LOCAL @cursor/sdk agent loop
// and maps its stream onto upstream's ToolResult / AgentResultDisplay types.
// ---------------------------------------------------------------------------

/** The module specifier for the Cursor SDK. Kept as a variable so TypeScript
 * does not eagerly resolve the (optional, heavy) dependency. */
const CURSOR_SDK_MODULE = '@cursor/sdk';

/** Minimal structural view of the SDK Agent handle we drive. */
interface CursorSdkAgent {
  readonly agentId: string;
  send(message: string): Promise<CursorRun>;
  close(): void;
}

/** Minimal structural view of the SDK Run handle we consume. */
interface CursorRun {
  readonly id: string;
  stream(): AsyncGenerator<CursorSDKMessage, void>;
  wait(): Promise<CursorRunResult>;
  cancel(): Promise<void>;
  supports(operation: 'stream' | 'wait' | 'cancel' | 'conversation'): boolean;
}

function activityToToolCallStatus(
  status: SubagentActivityItem['status'],
): 'executing' | 'success' | 'failed' {
  switch (status) {
    case 'running':
      return 'executing';
    case 'completed':
      return 'success';
    case 'error':
    case 'cancelled':
    default:
      return 'failed';
  }
}

function recentActivityToToolCalls(
  activity: SubagentActivityItem[],
): AgentResultDisplay['toolCalls'] {
  const toolCalls: Array<NonNullable<AgentResultDisplay['toolCalls']>[number]> =
    [];
  for (const item of activity) {
    if (item.type !== 'tool_call') {
      continue;
    }
    let args: Record<string, unknown> | undefined;
    if (item.args !== undefined) {
      try {
        const parsed = JSON.parse(item.args);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        args = { raw: item.args };
      }
    }
    toolCalls.push({
      callId: item.id,
      name: item.content,
      status: activityToToolCallStatus(item.status),
      ...(args !== undefined ? { args } : {}),
    });
  }
  return toolCalls.length > 0 ? toolCalls : undefined;
}

function terminateReasonToDisplayStatus(
  reason: AgentTerminateMode,
): AgentResultDisplay['status'] {
  switch (reason) {
    case AgentTerminateMode.GOAL:
      return 'completed';
    case AgentTerminateMode.CANCELLED:
    case AgentTerminateMode.SHUTDOWN:
      return 'cancelled';
    case AgentTerminateMode.TIMEOUT:
    case AgentTerminateMode.MAX_TURNS:
    case AgentTerminateMode.LOOP_DETECTED:
    case AgentTerminateMode.ERROR:
    default:
      return 'failed';
  }
}

async function cancelRunSafely(run: CursorRun | undefined): Promise<void> {
  if (!run) {
    return;
  }
  try {
    if (run.supports('cancel')) {
      await run.cancel();
    }
  } catch {
    // Swallow: best-effort cancel.
  }
}

async function disposeAgent(agent: CursorSdkAgent | undefined): Promise<void> {
  if (!agent) {
    return;
  }
  try {
    agent.close();
  } catch {
    // Swallow: best-effort dispose.
  }
}

export class CursorAgentInvocation extends BaseToolInvocation<
  { query: string },
  ToolResult
> {
  /** Persist the durable Cursor agentId across ephemeral invocation instances. */
  private static readonly sessionState = new Map<string, string>();

  constructor(
    private readonly definition: CursorAgentDefinition,
    private readonly context: {
      config: Pick<Config, 'getProjectRoot' | 'getToolRegistry'>;
      toolRegistry: CursorToolRegistryLike;
    },
    params: { query: string },
  ) {
    super(params);
  }

  private get agentName(): string {
    return this.definition.displayName ?? this.definition.name;
  }

  getDescription(): string {
    return `Calling Cursor agent ${this.agentName} (${this.definition.cursorModel})`;
  }

  override getConfirmationDetails(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails> {
    const details: ToolCallConfirmationDetails = {
      type: 'info',
      title: `Call Cursor Agent: ${this.agentName}`,
      prompt: `Delegating to Cursor agent (${this.definition.cursorModel}): "${this.params.query}"`,
      onConfirm: async (_outcome: ToolConfirmationOutcome) => {
        // Policy updates are handled centrally by the scheduler.
      },
    };
    return Promise.resolve(details);
  }

  async execute(
    signal: AbortSignal,
    updateOutput?: (output: ToolResultDisplay) => void,
  ): Promise<ToolResult> {
    const agentName = this.agentName;

    if (this.definition.trust !== true) {
      const message =
        `Cursor agent '${this.definition.name}' is not trusted. Set ` +
        `'trust: true' on the agent definition before delegating, because ` +
        `Cursor's built-in shell/edit/write tools run without per-call ` +
        `confirmation.`;
      const display: AgentResultDisplay = {
        type: 'task_execution',
        subagentName: agentName,
        taskDescription: this.params.query,
        taskPrompt: this.params.query,
        status: 'failed',
        terminateReason: AgentTerminateMode.ERROR,
        result: message,
      };
      if (updateOutput) {
        updateOutput(display);
      }
      return {
        llmContent: [{ text: message }],
        returnDisplay: display,
        error: { message, type: ToolErrorType.EXECUTION_FAILED },
      };
    }

    let recentActivity: SubagentActivityItem[] = [];
    let buffer = '';
    let tempDir: string | undefined;
    let agent: CursorSdkAgent | undefined;
    let activeRun: CursorRun | undefined;
    let hitMaxTurns = false;
    const outputSuppressor = new CursorSdkOutputSuppressor();
    let timeoutOverrideInstalled = false;

    const emit = (events: SubagentActivityEvent[]): void => {
      if (events.length === 0) {
        return;
      }
      for (const event of events) {
        recentActivity = applyActivity(recentActivity, event);
      }
      if (updateOutput) {
        updateOutput(
          this.buildProgressDisplay(
            agentName,
            'running',
            buffer,
            recentActivity,
            AgentTerminateMode.GOAL,
          ),
        );
      }
    };

    try {
      if (updateOutput) {
        updateOutput(
          this.buildProgressDisplay(
            agentName,
            'running',
            '',
            [],
            AgentTerminateMode.GOAL,
          ),
        );
      }

      const apiKey = resolveCursorApiKey();
      if (!apiKey) {
        throw new Error(
          `Cursor agent '${this.definition.name}' requires a ${CURSOR_API_KEY_ENV_VAR}.`,
        );
      }

      let cwd: string;
      if (this.definition.isolatedCwd) {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cursor-'));
        cwd = tempDir;
      } else {
        cwd = this.context.config.getProjectRoot();
      }

      const sdk = (await import(
        CURSOR_SDK_MODULE
      )) as unknown as CursorSdkModule;
      const { Agent } = sdk;

      const priorAgentId = CursorAgentInvocation.sessionState.get(
        this.definition.name,
      );

      const settingSources = resolveSettingSources(this.definition);
      const sandboxEnabled =
        this.definition.cursorRun?.sandbox?.enabled ?? false;

      const createOptions: Record<string, unknown> = {
        apiKey,
        model: {
          id: this.definition.cursorModel,
          params: toCursorModelParams(this.definition.modelParams),
        },
        local: {
          cwd,
          settingSources,
          sandboxOptions: { enabled: sandboxEnabled },
          customTools: buildCustomTools({
            registry: this.context.toolRegistry,
            signal,
          }),
          ...(this.definition.cursorRun?.autoReview !== undefined && {
            autoReview: this.definition.cursorRun.autoReview,
          }),
        },
        mcpServers: {},
      };

      if (this.definition.cursorRun?.mode !== undefined) {
        createOptions['mode'] = this.definition.cursorRun.mode;
      }

      installCursorMcpToolTimeoutOverride();
      timeoutOverrideInstalled = true;

      agent = await outputSuppressor.runStartupScope(() =>
        this.definition.resume && priorAgentId
          ? (Agent.resume(
              priorAgentId,
              createOptions,
            ) as Promise<CursorSdkAgent>)
          : (Agent.create(createOptions) as Promise<CursorSdkAgent>),
      );

      // Re-install the suppressor with startupScope inactive so the
      // known-noise filter stays alive for late managed_skills.* lines
      // emitted during the stream loop.
      outputSuppressor.install();

      CursorAgentInvocation.sessionState.set(
        this.definition.name,
        agent.agentId,
      );

      const maxTurns = this.definition.runConfig?.maxTurns;
      const result = await withRunTimeout(
        async () => {
          const run = await agent!.send(this.params.query);
          activeRun = run;
          const onAbort = () => {
            void cancelRunSafely(run);
          };
          signal.addEventListener('abort', onAbort, { once: true });
          let logicalTurns = 0;
          const countedCallIds = new Set<string>();
          const tryCountTurn = (callId: string | undefined): boolean => {
            if (maxTurns === undefined) return false;
            if (callId && countedCallIds.has(callId)) return false;
            if (callId) countedCallIds.add(callId);
            logicalTurns += 1;
            return logicalTurns >= maxTurns;
          };
          const streamTracePath = process.env['QWEN_CURSOR_STREAM_TRACE'];
          try {
            for await (const event of run.stream()) {
              if (signal.aborted) {
                break;
              }
              if (streamTracePath) {
                try {
                  const blocks =
                    event.type === 'assistant'
                      ? (event.message?.content ?? [])
                          .map((b: { type?: string }) => b?.type ?? '?')
                          .join(',')
                      : undefined;
                  const line = JSON.stringify({
                    t: Date.now(),
                    runId: run.id,
                    type: event.type,
                    ...(blocks !== undefined ? { blocks } : {}),
                    turnsBefore: logicalTurns,
                  });
                  appendFileSync(streamTracePath, line + '\n');
                } catch {
                  // Tracing must never break the run.
                }
              }
              buffer += extractAssistantText(event);
              emit(mapCursorEvent(event, agentName));

              let hitCap = false;
              if (event.type === 'tool_call' && event.status === 'running') {
                hitCap = tryCountTurn(event.call_id);
              } else if (event.type === 'assistant') {
                for (const block of event.message?.content ?? []) {
                  if (block.type === 'tool_use') {
                    if (tryCountTurn(block.id)) {
                      hitCap = true;
                      break;
                    }
                  }
                }
              }
              if (hitCap) {
                hitMaxTurns = true;
                await cancelRunSafely(run);
                break;
              }
            }
            let runResult: CursorRunResult;
            try {
              runResult = await run.wait();
            } catch (e) {
              if (e instanceof sdk.CursorSdkError) {
                const err = e as CursorSdkErrorLike;
                runResult = {
                  id: run.id,
                  status: 'error',
                  result:
                    `Cursor SDK error [${err.code ?? 'UNKNOWN'}]: ${err.message}` +
                    (err.operation ? ` (operation: ${err.operation})` : '') +
                    (err.requestId ? ` (requestId: ${err.requestId})` : ''),
                };
              } else {
                throw e;
              }
            }
            return runResult;
          } finally {
            signal.removeEventListener('abort', onAbort);
          }
        },
        this.definition.runConfig?.maxTimeMinutes,
        () => {
          void cancelRunSafely(activeRun);
        },
      );

      const output = mapRunResultToOutput(result, buffer);

      if (hitMaxTurns) {
        output.terminate_reason = AgentTerminateMode.MAX_TURNS;
        output.result =
          (output.result && output.result.trim()) ||
          `Cursor agent stopped after reaching the maximum of ${maxTurns} turns.`;
      }

      if (result.status === 'error') {
        output.result = sanitizeErrorMessage(output.result);
        recentActivity = applyActivity(recentActivity, {
          isSubagentActivityEvent: true,
          agentName,
          type: 'ERROR',
          data: { error: output.result },
        });
      } else {
        for (const item of recentActivity) {
          if (item.status === 'running') {
            item.status =
              output.terminate_reason === AgentTerminateMode.GOAL
                ? 'completed'
                : 'cancelled';
          }
        }
      }

      const progressState = terminateReasonToDisplayStatus(
        output.terminate_reason,
      );
      const progress = this.buildProgressDisplay(
        agentName,
        progressState,
        output.result,
        recentActivity,
        output.terminate_reason,
        result.usage,
      );
      if (updateOutput) {
        updateOutput(progress);
      }

      return {
        llmContent: [
          {
            text: `Cursor agent finished.\nTermination Reason: ${output.terminate_reason}\nResult:\n${output.result}`,
          },
        ],
        returnDisplay: progress,
      };
    } catch (error: unknown) {
      const isTimeout = isCliRunTimeoutError(error);
      const isAbort =
        signal.aborted ||
        (error instanceof Error && error.name === 'AbortError');
      const terminateReason = isTimeout
        ? AgentTerminateMode.TIMEOUT
        : isAbort
          ? AgentTerminateMode.CANCELLED
          : AgentTerminateMode.ERROR;

      const rawMessage = error instanceof Error ? error.message : String(error);
      const message = sanitizeErrorMessage(rawMessage);
      const fullDisplay = sanitizeErrorMessage(
        buffer ? `${buffer}\n\n${message}` : message,
      );

      for (const item of recentActivity) {
        if (item.status === 'running') {
          item.status = 'cancelled';
        }
      }

      const progress = this.buildProgressDisplay(
        agentName,
        isAbort ? 'cancelled' : 'failed',
        fullDisplay,
        recentActivity,
        terminateReason,
      );
      if (updateOutput) {
        updateOutput(progress);
      }

      return {
        llmContent: [
          {
            text: `Cursor agent finished.\nTermination Reason: ${terminateReason}\nResult:\n${fullDisplay}`,
          },
        ],
        returnDisplay: progress,
        error: { message: fullDisplay, type: ToolErrorType.EXECUTION_FAILED },
      };
    } finally {
      outputSuppressor.uninstall();
      if (timeoutOverrideInstalled) {
        restoreCursorMcpToolTimeoutOverride();
      }
      await disposeAgent(agent);
      if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  private buildProgressDisplay(
    agentName: string,
    status: AgentResultDisplay['status'],
    result: string,
    recentActivity: SubagentActivityItem[],
    terminateReason: AgentTerminateMode,
    usage?: CursorRunResult['usage'],
  ): AgentResultDisplay {
    return {
      type: 'task_execution',
      subagentName: agentName,
      taskDescription: this.params.query,
      taskPrompt: this.params.query,
      status,
      terminateReason,
      result,
      toolCalls: recentActivityToToolCalls(recentActivity),
      ...(usage ? { tokenCount: usage.outputTokens } : {}),
    };
  }
}
