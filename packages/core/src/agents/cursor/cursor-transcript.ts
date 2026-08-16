import { randomUUID } from 'node:crypto';
import type { ChatRecord } from '../../services/chatRecordingService.js';
import { writeLineSync } from '../../utils/jsonl-utils.js';
import type { SubagentActivityEvent } from './types.js';

export interface CursorTranscriptWriterOptions {
  agentId: string;
  agentName: string;
  agentColor?: string;
  sessionId: string;
  cwd: string;
  version: string;
  gitBranch?: string;
  initialUserPrompt?: string;
}

function asArgs(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asResponse(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { result: value };
}

export function createCursorTranscriptWriter(
  jsonlPath: string,
  options: CursorTranscriptWriterOptions,
): (event: SubagentActivityEvent) => void {
  let parentUuid: string | null = null;

  const append = (record: Omit<ChatRecord, 'uuid' | 'parentUuid'>) => {
    const next: ChatRecord = {
      ...record,
      uuid: randomUUID(),
      parentUuid,
    };
    writeLineSync(jsonlPath, next);
    parentUuid = next.uuid;
  };

  const base = (type: ChatRecord['type']) => ({
    sessionId: options.sessionId,
    timestamp: new Date().toISOString(),
    type,
    cwd: options.cwd,
    version: options.version,
    gitBranch: options.gitBranch,
    agentId: options.agentId,
    agentName: options.agentName,
    agentColor: options.agentColor,
    isSidechain: true,
  });

  if (options.initialUserPrompt) {
    append({
      ...base('user'),
      message: { role: 'user', parts: [{ text: options.initialUserPrompt }] },
    });
  }

  return (event) => {
    switch (event.type) {
      case 'THOUGHT_CHUNK':
        append({
          ...base('assistant'),
          message: {
            role: 'model',
            parts: [{ text: String(event.data['text'] ?? ''), thought: true }],
          },
        });
        return;
      case 'TOOL_CALL_START':
        append({
          ...base('assistant'),
          message: {
            role: 'model',
            parts: [
              {
                functionCall: {
                  id: String(event.data['callId'] ?? ''),
                  name: String(event.data['name'] ?? 'tool'),
                  args: asArgs(event.data['args']),
                },
              },
            ],
          },
        });
        return;
      case 'TOOL_CALL_END': {
        const callId = String(event.data['callId'] ?? '');
        const name = String(event.data['name'] ?? 'tool');
        const failed = event.data['isError'] === true;
        append({
          ...base('tool_result'),
          message: {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  id: callId,
                  name,
                  response: asResponse(event.data['result']),
                },
              },
            ],
          },
          toolCallResult: { callId, status: failed ? 'error' : 'success' },
        });
        return;
      }
      case 'ERROR':
        append({
          ...base('assistant'),
          message: {
            role: 'model',
            parts: [{ text: `Error: ${String(event.data['error'] ?? '')}` }],
          },
        });
        return;
      case 'PERMISSION_GATE':
        return;
      default:
        return;
    }
  };
}
