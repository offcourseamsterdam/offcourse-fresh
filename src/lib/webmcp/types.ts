/**
 * Minimal types for the experimental WebMCP API
 * (https://webmachinelearning.github.io/webmcp/, Chrome origin trial —
 * https://developer.chrome.com/blog/webmcp-epp). Not yet in TS's DOM lib.
 *
 * The task spec and Chrome's shipping surface both put this on
 * `navigator.modelContext`; the W3C incubation draft text (as fetched
 * 2026-09) instead shows `document.modelContext`. Real spec churn — same
 * situation as MCP's 2026-07-28 versioning rework elsewhere in this repo —
 * so getModelContext() below checks both rather than betting on one.
 */
export interface ModelContextToolAnnotations {
  readOnlyHint?: boolean
  consequentialHint?: boolean
}

export interface ModelContextTool<TInput = Record<string, unknown>> {
  name: string
  description: string
  inputSchema?: object
  execute: (input: TInput, options: { signal?: AbortSignal }) => Promise<unknown> | unknown
  annotations?: ModelContextToolAnnotations
}

export interface ModelContext {
  registerTool: (tool: ModelContextTool, options?: { signal?: AbortSignal }) => Promise<void> | void
}

declare global {
  interface Navigator {
    modelContext?: ModelContext
  }
  interface Document {
    modelContext?: ModelContext
  }
}

/** Returns the WebMCP host object if the browser implements it under either candidate global, else null. */
export function getModelContext(): ModelContext | null {
  if (typeof navigator !== 'undefined' && navigator.modelContext) return navigator.modelContext
  if (typeof document !== 'undefined' && document.modelContext) return document.modelContext
  return null
}
