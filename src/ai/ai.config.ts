/**
 * Production guardrails for the AI Copilot.
 * All values are configurable via environment variables.
 */

export const AI_CONFIG = {
  /** Maximum number of LLM conversation rounds per user message */
  MAX_ROUNDS: Number(process.env.AI_MAX_ROUNDS ?? 8),

  /** Maximum number of tool calls per user message */
  MAX_TOOL_CALLS: Number(process.env.AI_MAX_TOOL_CALLS ?? 8),

  /** Maximum wall-clock execution time per user message (ms) */
  MAX_EXECUTION_MS: Number(process.env.AI_MAX_EXECUTION_MS ?? 25_000),

  /** Maximum input tokens per LLM call */
  MAX_INPUT_TOKENS: Number(process.env.AI_MAX_INPUT_TOKENS ?? 100_000),

  /** Maximum total tokens (input + output) per query */
  MAX_TOKENS_PER_QUERY: Number(process.env.AI_MAX_TOKENS_PER_QUERY ?? 50_000),

  /** Confirmation TTL in milliseconds */
  CONFIRMATION_TTL_MS: Number(process.env.AI_CONFIRMATION_TTL_MS ?? 15 * 60 * 1000),

  /** Number of recent messages injected into LLM context */
  HISTORY_LIMIT: Number(process.env.AI_HISTORY_LIMIT ?? 40),

  /** Maximum number of request log entries kept in memory */
  REQUEST_LOG_LIMIT: Number(process.env.AI_REQUEST_LOG_LIMIT ?? 200),

  /** Whether to enable decision logging */
  DECISION_LOG_ENABLED: process.env.AI_DECISION_LOG_ENABLED !== "false",

  /** Retry configuration for failed tool calls */
  RETRY: {
    MAX_ATTEMPTS: Number(process.env.AI_RETRY_MAX_ATTEMPTS ?? 1),
    BACKOFF_MS: Number(process.env.AI_RETRY_BACKOFF_MS ?? 1000),
    /** HTTP status codes considered retryable */
    RETRYABLE_STATUSES: [408, 429, 500, 502, 503, 504],
  },
} as const;

/** Human-readable summary of active guardrails */
export function guardrailSummary(): Record<string, unknown> {
  return {
    maxRounds: AI_CONFIG.MAX_ROUNDS,
    maxToolCalls: AI_CONFIG.MAX_TOOL_CALLS,
    maxExecutionMs: AI_CONFIG.MAX_EXECUTION_MS,
    maxInputTokens: AI_CONFIG.MAX_INPUT_TOKENS,
    maxTokensPerQuery: AI_CONFIG.MAX_TOKENS_PER_QUERY,
    confirmationTtlMs: AI_CONFIG.CONFIRMATION_TTL_MS,
    historyLimit: AI_CONFIG.HISTORY_LIMIT,
    requestLogLimit: AI_CONFIG.REQUEST_LOG_LIMIT,
    decisionLogEnabled: AI_CONFIG.DECISION_LOG_ENABLED,
    retryMaxAttempts: AI_CONFIG.RETRY.MAX_ATTEMPTS,
    retryBackoffMs: AI_CONFIG.RETRY.BACKOFF_MS,
  };
}
