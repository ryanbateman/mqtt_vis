/**
 * TypeScript declarations for the W3C WebMCP API (Draft Community Group Report).
 * https://webmachinelearning.github.io/webmcp/
 *
 * Chrome 146+ with WebMCP flag enabled (early preview as of March 2026).
 * These types are not yet in lib.dom.d.ts — this file provides them until
 * they are upstreamed.
 *
 * This is an ambient declaration file (no imports/exports) so all types
 * are globally available without explicit imports.
 */

/** Annotations providing metadata about a tool's behaviour. */
interface ToolAnnotations {
  /** If true, indicates the tool only reads data and does not modify state. */
  readOnlyHint?: boolean;
}

/** Callback invoked when an agent calls a tool. */
type ToolExecuteCallback = (
  input: Record<string, unknown>,
  client: ModelContextClient,
) => Promise<unknown>;

/** A tool definition registered with the browser's model context. */
interface ModelContextTool {
  /** Unique identifier for the tool. */
  name: string;
  /** Natural language description of the tool's functionality. */
  description: string;
  /** JSON Schema object describing expected input parameters. */
  inputSchema?: object;
  /** Callback invoked when an agent calls this tool. */
  execute: ToolExecuteCallback;
  /** Optional annotations about tool behaviour. */
  annotations?: ToolAnnotations;
}

/** Options for provideContext(). */
interface ModelContextOptions {
  /** List of tools to register with the browser. */
  tools?: ModelContextTool[];
}

/** Represents an agent executing a tool — provides user interaction API. */
interface ModelContextClient {
  /** Request user interaction during tool execution (e.g. confirmation dialog). */
  requestUserInteraction(callback: () => Promise<unknown>): Promise<unknown>;
}

/** The ModelContext interface for registering/managing tools. */
interface ModelContext {
  /** Register all tools at once, clearing any pre-existing context. */
  provideContext(options?: ModelContextOptions): void;
  /** Unregister all tools and clear context. */
  clearContext(): void;
  /** Register a single tool without clearing existing tools. */
  registerTool(tool: ModelContextTool): void;
  /** Remove a tool by name. */
  unregisterTool(name: string): void;
}

interface Navigator {
  /** WebMCP model context — available in Chrome 146+ with flag enabled. */
  readonly modelContext?: ModelContext;
}
