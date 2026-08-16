import { describe, it, expect, vi } from 'vitest';
import type { SDKCustomToolResult } from '@cursor/sdk';
import type { CursorToolRegistryLike } from './cursor-custom-tools.js';
import { buildCustomTools } from './cursor-custom-tools.js';

type ObjectToolResult = Extract<
  SDKCustomToolResult,
  { content: unknown; isError?: boolean }
>;

function asObjectResult(result: SDKCustomToolResult): ObjectToolResult {
  if (
    result !== null &&
    typeof result === 'object' &&
    !Array.isArray(result) &&
    'content' in result
  ) {
    return result as ObjectToolResult;
  }
  throw new Error(
    `expected object-form result, got: ${JSON.stringify(result)}`,
  );
}

function mockTool(
  name: string,
  opts?: { description?: string; schema?: unknown },
) {
  return {
    name,
    displayName: name,
    description: opts?.description ?? `Tool ${name}`,
    kind: 0,
    schema: {
      name,
      description: opts?.description ?? `Tool ${name}`,
      parameters: opts?.schema ?? { type: 'object', properties: {} },
    },
    isOutputMarkdown: false,
    canUpdateOutput: false,
    build: vi.fn(() => ({ execute: vi.fn() })),
    buildAndExecute: vi.fn(async () => ({
      llmContent: [{ text: `${name} result` }],
      returnDisplay: `${name} result`,
    })),
  };
}

function mockRegistry(tools: Array<ReturnType<typeof mockTool>>) {
  return {
    getAllTools: () => tools,
    getTool: (name: string) => tools.find((t) => t.name === name),
  };
}

describe('buildCustomTools', () => {
  it('builds a customTools record from the registry', () => {
    const registry = mockRegistry([
      mockTool('my_tool'),
      mockTool('another_tool'),
    ]);
    const record = buildCustomTools({
      registry: registry as unknown as CursorToolRegistryLike,
    });
    expect(Object.keys(record).sort()).toEqual(['another_tool', 'my_tool']);
    expect(record['my_tool']).toBeDefined();
    expect(typeof record['my_tool'].execute).toBe('function');
  });

  it('excludes overlapping native tool names by default', () => {
    const registry = mockRegistry([
      mockTool('read_file'),
      mockTool('edit'),
      mockTool('run_shell_command'),
      mockTool('my_custom_tool'),
    ]);
    const record = buildCustomTools({
      registry: registry as unknown as CursorToolRegistryLike,
    });
    expect(Object.keys(record)).toEqual(['my_custom_tool']);
  });

  it('includes overlapping native tool names when exposeBuiltins is true', () => {
    const registry = mockRegistry([mockTool('read_file'), mockTool('my_tool')]);
    const record = buildCustomTools({
      registry: registry as unknown as CursorToolRegistryLike,
      exposeBuiltins: true,
    });
    expect(Object.keys(record).sort()).toEqual(['my_tool', 'read_file']);
  });

  it('execute callback calls buildAndExecute and returns SDKCustomToolResult', async () => {
    const tool = mockTool('my_tool');
    const registry = mockRegistry([tool]);
    const record = buildCustomTools({
      registry: registry as unknown as CursorToolRegistryLike,
    });
    const result = await record['my_tool'].execute(
      { foo: 'bar' },
      {
        toolCallId: undefined,
      },
    );
    const obj = asObjectResult(result);
    expect(tool.buildAndExecute).toHaveBeenCalledWith(
      { foo: 'bar' },
      undefined,
    );
    expect(obj.isError).toBe(false);
    expect(obj.content).toEqual([{ type: 'text', text: 'my_tool result' }]);
  });

  it('execute callback returns isError on exception', async () => {
    const tool = mockTool('boom');
    tool.buildAndExecute = vi.fn(async () => {
      throw new Error('kaboom');
    });
    const registry = mockRegistry([tool]);
    const record = buildCustomTools({
      registry: registry as unknown as CursorToolRegistryLike,
    });
    const result = await record['boom'].execute(
      {},
      {
        toolCallId: undefined,
      },
    );
    const obj = asObjectResult(result);
    expect(obj.isError).toBe(true);
    expect(obj.content[0]).toMatchObject({ type: 'text', text: 'kaboom' });
  });

  it('execute callback returns isError when signal already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const tool = mockTool('my_tool');
    const registry = mockRegistry([tool]);
    const record = buildCustomTools({
      registry: registry as unknown as CursorToolRegistryLike,
      signal: controller.signal,
    });
    const result = await record['my_tool'].execute(
      {},
      {
        toolCallId: undefined,
      },
    );
    expect(asObjectResult(result).isError).toBe(true);
    expect(tool.buildAndExecute).not.toHaveBeenCalled();
  });

  it('CONTROL: empty registry yields empty record (always-passing)', () => {
    const registry = mockRegistry([]);
    const record = buildCustomTools({
      registry: registry as unknown as CursorToolRegistryLike,
    });
    expect(Object.keys(record)).toEqual([]);
  });
});
