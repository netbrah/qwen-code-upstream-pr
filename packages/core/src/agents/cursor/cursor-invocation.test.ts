import { describe, it, expect } from 'vitest';
import {
  mapCursorEvent,
  extractAssistantText,
  mapRunResultToOutput,
  applyActivity,
  resolveCursorApiKey,
  toCursorModelParams,
} from './cursor-invocation.js';
import { AgentTerminateMode } from '../../agents/runtime/agent-types.js';
import type {
  CursorSDKMessage,
  SubagentActivityEvent,
  SubagentActivityItem,
} from './types.js';

describe('mapCursorEvent', () => {
  it('maps a thinking message to a THOUGHT_CHUNK event', () => {
    const events = mapCursorEvent(
      {
        type: 'thinking',
        agent_id: 'a',
        run_id: 'r',
        text: 'hello',
      },
      'cursor-coder',
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('THOUGHT_CHUNK');
    expect(events[0].data['text']).toBe('hello');
  });

  it('maps an assistant tool_use block to a TOOL_CALL_START event', () => {
    const events = mapCursorEvent(
      {
        type: 'assistant',
        agent_id: 'a',
        run_id: 'r',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'call1', name: 'shell', input: {} },
          ],
        },
      },
      'cursor-coder',
    );
    expect(events[0].type).toBe('TOOL_CALL_START');
    expect(events[0].data['callId']).toBe('call1');
  });

  it('maps a tool_call(running) to TOOL_CALL_START', () => {
    const events = mapCursorEvent(
      {
        type: 'tool_call',
        agent_id: 'a',
        run_id: 'r',
        call_id: 'c1',
        name: 'read',
        status: 'running',
      },
      'cursor-coder',
    );
    expect(events[0].type).toBe('TOOL_CALL_START');
  });

  it('maps a tool_call(completed) to TOOL_CALL_END', () => {
    const events = mapCursorEvent(
      {
        type: 'tool_call',
        agent_id: 'a',
        run_id: 'r',
        call_id: 'c1',
        name: 'read',
        status: 'completed',
      },
      'cursor-coder',
    );
    expect(events[0].type).toBe('TOOL_CALL_END');
  });

  it('maps a status(ERROR) to an ERROR event', () => {
    const events = mapCursorEvent(
      {
        type: 'status',
        agent_id: 'a',
        run_id: 'r',
        status: 'ERROR',
        message: 'boom',
      },
      'cursor-coder',
    );
    expect(events[0].type).toBe('ERROR');
  });

  it('maps a request (approval) to auto-denied PERMISSION_GATE pair', () => {
    const events = mapCursorEvent(
      {
        type: 'request',
        agent_id: 'a',
        run_id: 'r',
        request_id: 'req1',
      },
      'cursor-coder',
    );
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('PERMISSION_GATE');
    expect(events[0].data['phase']).toBe('request');
    expect(events[1].data['phase']).toBe('response');
    expect(events[1].data['approved']).toBe(false);
  });

  it('returns [] for system/user/task messages', () => {
    const msgs: CursorSDKMessage[] = [
      { type: 'system', agent_id: 'a', run_id: 'r' },
      {
        type: 'user',
        agent_id: 'a',
        run_id: 'r',
        message: { role: 'user', content: [] },
      },
      { type: 'task', agent_id: 'a', run_id: 'r' },
    ];
    for (const msg of msgs) {
      expect(mapCursorEvent(msg, 'cursor-coder')).toEqual([]);
    }
  });

  it('CONTROL: empty thinking text yields no event (always-passing)', () => {
    expect(
      mapCursorEvent(
        { type: 'thinking', agent_id: 'a', run_id: 'r', text: '' },
        'cursor-coder',
      ),
    ).toEqual([]);
  });

  it('maps an interaction_query(request) to a PERMISSION_GATE request', () => {
    const events = mapCursorEvent(
      {
        type: 'interaction_query',
        subtype: 'request',
        query_type: 'toolApprovalRequestQuery',
        query: {
          id: 7,
          toolApprovalRequestQuery: { args: { toolCallId: 'tc1' } },
        },
      },
      'cursor-coder',
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('PERMISSION_GATE');
    expect(events[0].data['phase']).toBe('request');
    expect(events[0].data['queryId']).toBe(7);
    expect(events[0].data['toolCallId']).toBe('tc1');
  });

  it('maps an interaction_query(response, denied) to a denied PERMISSION_GATE response', () => {
    const events = mapCursorEvent(
      {
        type: 'interaction_query',
        subtype: 'response',
        query_type: 'toolApprovalRequestQuery',
        response: {
          id: 7,
          toolApprovalRequestResponse: { denied: true },
        },
      },
      'cursor-coder',
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('PERMISSION_GATE');
    expect(events[0].data['phase']).toBe('response');
    expect(events[0].data['approved']).toBe(false);
  });

  it('returns [] for usage messages', () => {
    expect(
      mapCursorEvent(
        {
          type: 'usage',
          agent_id: 'a',
          run_id: 'r',
          usage: {
            inputTokens: 1,
            outputTokens: 2,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 3,
          },
        },
        'cursor-coder',
      ),
    ).toEqual([]);
  });
});

describe('extractAssistantText', () => {
  it('concatenates text blocks from an assistant message', () => {
    const text = extractAssistantText({
      type: 'assistant',
      agent_id: 'a',
      run_id: 'r',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'hello ' },
          { type: 'text', text: 'world' },
        ],
      },
    });
    expect(text).toBe('hello world');
  });

  it('returns "" for non-assistant messages', () => {
    const msg: CursorSDKMessage = {
      type: 'thinking',
      agent_id: 'a',
      run_id: 'r',
      text: 'x',
    };
    expect(extractAssistantText(msg)).toBe('');
  });
});

describe('mapRunResultToOutput', () => {
  it('finished → GOAL', () => {
    const out = mapRunResultToOutput(
      { id: 'r', status: 'finished', result: 'done' },
      '',
    );
    expect(out.terminate_reason).toBe(AgentTerminateMode.GOAL);
    expect(out.result).toBe('done');
  });

  it('cancelled → CANCELLED', () => {
    const out = mapRunResultToOutput(
      { id: 'r', status: 'cancelled' },
      'partial buffer',
    );
    expect(out.terminate_reason).toBe(AgentTerminateMode.CANCELLED);
  });

  it('error with result → ERROR + result', () => {
    const out = mapRunResultToOutput(
      { id: 'r', status: 'error', result: 'SDK failed' },
      '',
    );
    expect(out.terminate_reason).toBe(AgentTerminateMode.ERROR);
    expect(out.result).toBe('SDK failed');
  });

  it('error without result → ERROR + "no result" marker', () => {
    const out = mapRunResultToOutput(
      { id: 'r', status: 'error' },
      'last assistant text',
    );
    expect(out.terminate_reason).toBe(AgentTerminateMode.ERROR);
    expect(out.result).toContain('no result');
    expect(out.result).toContain('Last assistant text');
  });
});

describe('resolveCursorApiKey', () => {
  it('explicit arg wins', () => {
    expect(resolveCursorApiKey('explicit-key')).toBe('explicit-key');
  });

  it('falls through to env var', () => {
    const prior = process.env['CURSOR_API_KEY'];
    process.env['CURSOR_API_KEY'] = 'env-key';
    try {
      expect(resolveCursorApiKey()).toBe('env-key');
    } finally {
      if (prior === undefined) delete process.env['CURSOR_API_KEY'];
      else process.env['CURSOR_API_KEY'] = prior;
    }
  });

  it('returns undefined when nothing set', () => {
    const prior = process.env['CURSOR_API_KEY'];
    delete process.env['CURSOR_API_KEY'];
    try {
      expect(resolveCursorApiKey()).toBeUndefined();
    } finally {
      if (prior !== undefined) process.env['CURSOR_API_KEY'] = prior;
    }
  });

  it('placeholder values fall through to env', () => {
    const prior = process.env['CURSOR_API_KEY'];
    process.env['CURSOR_API_KEY'] = 'env-key';
    try {
      expect(resolveCursorApiKey('$CURSOR_API_KEY')).toBe('env-key');
    } finally {
      if (prior === undefined) delete process.env['CURSOR_API_KEY'];
      else process.env['CURSOR_API_KEY'] = prior;
    }
  });
});

describe('toCursorModelParams', () => {
  it('returns undefined for no params', () => {
    expect(toCursorModelParams(undefined)).toBeUndefined();
  });

  it('emits reasoning/effort/thinking', () => {
    const out = toCursorModelParams({
      reasoning: 'high',
      effort: 'medium',
      thinking: true,
    });
    expect(out).toEqual([
      { id: 'reasoning', value: 'high' },
      { id: 'effort', value: 'medium' },
      { id: 'thinking', value: 'true' },
    ]);
  });

  it('omits effort when thinking is false', () => {
    const out = toCursorModelParams({ effort: 'medium', thinking: false });
    expect(out).toEqual([{ id: 'thinking', value: 'false' }]);
  });
});

describe('applyActivity', () => {
  it('merges consecutive THOUGHT_CHUNKs into one running thought', () => {
    let activity: SubagentActivityItem[] = [];
    activity = applyActivity(activity, {
      isSubagentActivityEvent: true,
      agentName: 'a',
      type: 'THOUGHT_CHUNK',
      data: { text: 'foo' },
    });
    activity = applyActivity(activity, {
      isSubagentActivityEvent: true,
      agentName: 'a',
      type: 'THOUGHT_CHUNK',
      data: { text: 'bar' },
    });
    expect(activity).toHaveLength(1);
    expect(activity[0].content).toBe('foobar');
  });

  it('dedupes TOOL_CALL_START by callId', () => {
    let activity: SubagentActivityItem[] = [];
    const ev: SubagentActivityEvent = {
      isSubagentActivityEvent: true,
      agentName: 'a',
      type: 'TOOL_CALL_START',
      data: { callId: 'c1', name: 'shell', args: {} },
    };
    activity = applyActivity(activity, ev);
    activity = applyActivity(activity, ev);
    expect(activity.filter((i) => i.type === 'tool_call')).toHaveLength(1);
  });

  it('marks a running tool_call as completed on TOOL_CALL_END', () => {
    let activity: SubagentActivityItem[] = [];
    activity = applyActivity(activity, {
      isSubagentActivityEvent: true,
      agentName: 'a',
      type: 'TOOL_CALL_START',
      data: { callId: 'c1', name: 'shell', args: {} },
    });
    activity = applyActivity(activity, {
      isSubagentActivityEvent: true,
      agentName: 'a',
      type: 'TOOL_CALL_END',
      data: { callId: 'c1', isError: false },
    });
    expect(activity[0].status).toBe('completed');
  });
});
