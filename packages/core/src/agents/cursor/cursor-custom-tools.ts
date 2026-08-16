import type {
  SDKCustomTool,
  SDKCustomToolContent,
  SDKCustomToolContext,
  SDKCustomToolResult,
  SDKJsonValue,
} from '@cursor/sdk';
import { createDebugLogger } from '../../utils/debugLogger.js';

const logger = createDebugLogger('CURSOR_CUSTOM_TOOLS');

const OVERLAPPING_NATIVE_TOOL_NAMES = new Set([
  'read_file',
  'read_many_files',
  'write_file',
  'edit',
  'run_shell_command',
  'grep_search',
  'glob',
  'find_files',
  'list_directory',
]);

export interface CursorToolHandle {
  name: string;
  description: string;
  schema: { parameters?: Record<string, unknown> };
  buildAndExecute: (
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<{ llmContent: unknown; error?: { message?: string } }>;
}

export interface CursorToolRegistryLike {
  getAllTools(): Iterable<CursorToolHandle>;
}

export interface BuildCustomToolsOptions {
  registry: CursorToolRegistryLike;
  exposeBuiltins?: boolean;
  signal?: AbortSignal;
}

export function buildCustomTools(
  options: BuildCustomToolsOptions,
): Record<string, SDKCustomTool> {
  const { registry, exposeBuiltins = false, signal } = options;
  const customTools: Record<string, SDKCustomTool> = {};

  for (const tool of registry.getAllTools()) {
    if (!exposeBuiltins && OVERLAPPING_NATIVE_TOOL_NAMES.has(tool.name)) {
      continue;
    }

    const description = tool.description;
    const inputSchema =
      (tool.schema.parameters as Record<string, SDKJsonValue> | undefined) ??
      {};

    customTools[tool.name] = {
      description,
      inputSchema,
      execute: async (
        args: Record<string, SDKJsonValue>,
        _context: SDKCustomToolContext,
      ): Promise<SDKCustomToolResult> => {
        if (signal?.aborted) {
          return {
            content: [{ type: 'text', text: 'Run aborted' }],
            isError: true,
          };
        }
        logger.debug(
          `[CursorCustomTools] execute tool=${tool.name} args=${JSON.stringify(args).slice(0, 200)}`,
        );
        try {
          const result = await tool.buildAndExecute(args, signal);
          return {
            content: convertToCustomToolContent(result.llmContent),
            isError: Boolean(result.error),
          };
        } catch (err) {
          return {
            content: [
              {
                type: 'text',
                text: err instanceof Error ? err.message : String(err),
              },
            ],
            isError: true,
          };
        }
      },
    };
  }

  logger.debug(
    `[CursorCustomTools] built ${Object.keys(customTools).length} custom tools`,
  );
  return customTools;
}

function convertToCustomToolContent(content: unknown): SDKCustomToolContent[] {
  const blocks = Array.isArray(content) ? content : [content];
  const result: SDKCustomToolContent[] = [];

  for (const block of blocks) {
    if (typeof block === 'string') {
      result.push({ type: 'text', text: block });
      continue;
    }
    if (block && typeof block === 'object') {
      const rec = block as Record<string, unknown>;
      if (rec['type'] === 'text' && typeof rec['text'] === 'string') {
        result.push({ type: 'text', text: rec['text'] });
        continue;
      }
      if (
        rec['type'] === undefined &&
        typeof rec['text'] === 'string' &&
        rec['data'] === undefined
      ) {
        result.push({ type: 'text', text: rec['text'] });
        continue;
      }
      if (rec['type'] === 'image' && typeof rec['data'] === 'string') {
        result.push({
          type: 'image',
          data: rec['data'],
          mimeType:
            typeof rec['mimeType'] === 'string' ? rec['mimeType'] : undefined,
        });
        continue;
      }
      const inlineData = rec['inlineData'] as
        | Record<string, unknown>
        | undefined;
      if (
        inlineData &&
        typeof inlineData['data'] === 'string' &&
        typeof inlineData['mimeType'] === 'string'
      ) {
        result.push({
          type: 'image',
          data: inlineData['data'],
          mimeType: inlineData['mimeType'],
        });
        continue;
      }
    }
    result.push({
      type: 'text',
      text: typeof block === 'undefined' ? '' : JSON.stringify(block),
    });
  }

  return result.length > 0 ? result : [{ type: 'text', text: '' }];
}
