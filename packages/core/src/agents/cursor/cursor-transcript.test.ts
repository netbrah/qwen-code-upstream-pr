import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatRecord } from '../../services/chatRecordingService.js';
import { createCursorTranscriptWriter } from './cursor-transcript.js';

function readJsonl(filePath: string): ChatRecord[] {
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as ChatRecord);
}

describe('createCursorTranscriptWriter', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('persists the launch prompt and mapped cursor activity as chained sidechain records', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-jsonl-'));
    tempDirs.push(tempDir);
    const jsonlPath = path.join(tempDir, 'subagents', 'agent-cursor.jsonl');
    const append = createCursorTranscriptWriter(jsonlPath, {
      agentId: 'cursor-1',
      agentName: 'cursor-coder',
      agentColor: 'cyan',
      sessionId: 'session-1',
      cwd: '/repo',
      version: 'test-version',
      gitBranch: 'main',
      initialUserPrompt: 'Inspect the repository.',
    });

    append({
      isSubagentActivityEvent: true,
      agentName: 'cursor-coder',
      type: 'THOUGHT_CHUNK',
      data: { text: 'I will inspect the files.' },
    });
    append({
      isSubagentActivityEvent: true,
      agentName: 'cursor-coder',
      type: 'TOOL_CALL_START',
      data: {
        callId: 'read-1',
        name: 'Read',
        args: { file_path: 'README.md' },
      },
    });
    append({
      isSubagentActivityEvent: true,
      agentName: 'cursor-coder',
      type: 'TOOL_CALL_END',
      data: {
        callId: 'read-1',
        name: 'Read',
        result: { output: '# Readme' },
        isError: false,
      },
    });

    const records = readJsonl(jsonlPath);
    expect(records).toHaveLength(4);
    expect(records.map((record) => record.type)).toEqual([
      'user',
      'assistant',
      'assistant',
      'tool_result',
    ]);
    expect(records[0]?.message).toEqual({
      role: 'user',
      parts: [{ text: 'Inspect the repository.' }],
    });
    expect(records[1]?.message?.parts).toEqual([
      { text: 'I will inspect the files.', thought: true },
    ]);
    expect(records[2]?.message?.parts).toEqual([
      {
        functionCall: {
          id: 'read-1',
          name: 'Read',
          args: { file_path: 'README.md' },
        },
      },
    ]);
    expect(records[3]?.message?.parts).toEqual([
      {
        functionResponse: {
          id: 'read-1',
          name: 'Read',
          response: { output: '# Readme' },
        },
      },
    ]);
    expect(records[3]?.toolCallResult).toMatchObject({
      callId: 'read-1',
      status: 'success',
    });
    for (const record of records) {
      expect(record).toMatchObject({
        agentId: 'cursor-1',
        agentName: 'cursor-coder',
        agentColor: 'cyan',
        sessionId: 'session-1',
        cwd: '/repo',
        version: 'test-version',
        gitBranch: 'main',
        isSidechain: true,
      });
    }
    expect(records[0]?.parentUuid).toBeNull();
    expect(records[1]?.parentUuid).toBe(records[0]?.uuid);
    expect(records[2]?.parentUuid).toBe(records[1]?.uuid);
    expect(records[3]?.parentUuid).toBe(records[2]?.uuid);
  });

  it('normalizes non-object tool-call args and preserves object args', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-jsonl-'));
    tempDirs.push(tempDir);
    const jsonlPath = path.join(tempDir, 'subagents', 'agent-cursor.jsonl');
    const append = createCursorTranscriptWriter(jsonlPath, {
      agentId: 'cursor-1',
      agentName: 'cursor-coder',
      sessionId: 'session-1',
      cwd: '/repo',
      version: 'test-version',
    });
    const objectArgs = { file_path: 'README.md', line_start: 3 };

    append({
      isSubagentActivityEvent: true,
      agentName: 'cursor-coder',
      type: 'TOOL_CALL_START',
      data: { callId: 'primitive-1', name: 'Read', args: 'README.md' },
    });
    append({
      isSubagentActivityEvent: true,
      agentName: 'cursor-coder',
      type: 'TOOL_CALL_START',
      data: { callId: 'array-1', name: 'Read', args: ['README.md'] },
    });
    append({
      isSubagentActivityEvent: true,
      agentName: 'cursor-coder',
      type: 'TOOL_CALL_START',
      data: { callId: 'object-1', name: 'Read', args: objectArgs },
    });

    const records = readJsonl(jsonlPath);
    expect(records).toHaveLength(3);
    expect(records[0]?.message?.parts).toEqual([
      {
        functionCall: {
          id: 'primitive-1',
          name: 'Read',
          args: {},
        },
      },
    ]);
    expect(records[1]?.message?.parts).toEqual([
      {
        functionCall: {
          id: 'array-1',
          name: 'Read',
          args: {},
        },
      },
    ]);
    expect(records[2]?.message?.parts).toEqual([
      {
        functionCall: {
          id: 'object-1',
          name: 'Read',
          args: objectArgs,
        },
      },
    ]);
  });

  it('persists error activity without fabricating permission records', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-jsonl-'));
    tempDirs.push(tempDir);
    const jsonlPath = path.join(tempDir, 'subagents', 'agent-cursor.jsonl');
    const append = createCursorTranscriptWriter(jsonlPath, {
      agentId: 'cursor-1',
      agentName: 'cursor-coder',
      sessionId: 'session-1',
      cwd: '/repo',
      version: 'test-version',
    });

    append({
      isSubagentActivityEvent: true,
      agentName: 'cursor-coder',
      type: 'TOOL_CALL_END',
      data: {
        callId: 'read-1',
        name: 'Read',
        result: { error: 'Read failed.' },
        isError: true,
      },
    });
    append({
      isSubagentActivityEvent: true,
      agentName: 'cursor-coder',
      type: 'ERROR',
      data: { error: 'Cursor failed.' },
    });
    append({
      isSubagentActivityEvent: true,
      agentName: 'cursor-coder',
      type: 'PERMISSION_GATE',
      data: { queryType: 'cursorApprovalRequest', phase: 'request' },
    });

    const records = readJsonl(jsonlPath);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      type: 'tool_result',
      toolCallResult: { callId: 'read-1', status: 'error' },
      message: {
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: 'read-1',
              name: 'Read',
              response: { error: 'Read failed.' },
            },
          },
        ],
      },
    });
    expect(records[1]).toMatchObject({
      type: 'assistant',
      message: {
        role: 'model',
        parts: [{ text: 'Error: Cursor failed.' }],
      },
    });
  });
});
