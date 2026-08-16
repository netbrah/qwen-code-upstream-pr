/**
 * @license
 * Copyright 2026 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';

import { AgentTerminateMode } from '../../agents/runtime/agent-types.js';
import type {
  CursorAgentDefinition,
  CursorInteractionQueryMessage,
  CursorModelParameterValue,
  CursorModelParams,
  CursorRunResult,
  CursorSDKMessage,
  OutputObject,
  SubagentActivityEvent,
  SubagentActivityItem,
} from './types.js';

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
          `Set QWEN_CURSOR_BRIDGE_DEBUG=1 (and QWEN_CURSOR_BRIDGE_DEBUG_FILE=/path/to/log.jsonl) ` +
          `for bridge lifecycle diagnostics.${debugTail}`,
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
