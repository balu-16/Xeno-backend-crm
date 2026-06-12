import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import type { Environment } from "../config/env";
import type { ProviderToolDefinition } from "./tool-registry.service";

const providerContentBlockSchema = z
  .object({
    type: z.string(),
    text: z.string().optional(),
    thinking: z.string().optional(),
    signature: z.string().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
    input: z.record(z.unknown()).optional()
  })
  .passthrough();

const providerResponseSchema = z.object({
  id: z.string().optional(),
  content: z.array(providerContentBlockSchema),
  stop_reason: z
    .enum([
      "end_turn",
      "max_tokens",
      "tool_use",
      "content_filter",
      "repetition_truncation"
    ])
    .nullable()
    .optional(),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional()
    })
    .passthrough()
    .optional()
});

const providerStreamEventSchema = z.object({
  type: z.string(),
  delta: z
    .object({
      type: z.string().optional(),
      text: z.string().optional()
    })
    .optional()
});

export type ProviderTextBlock = {
  type: "text";
  text: string;
};

export type ProviderThinkingBlock = {
  type: "thinking";
  thinking?: string;
  signature?: string;
  [key: string]: unknown;
};

export type ProviderToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ProviderToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

export type ProviderAssistantBlock =
  | ProviderTextBlock
  | ProviderThinkingBlock
  | ProviderToolUseBlock;

export type ProviderUserBlock = ProviderTextBlock | ProviderToolResultBlock;

export type ProviderMessage =
  | { role: "user"; content: string | ProviderUserBlock[] }
  | { role: "assistant"; content: string | ProviderAssistantBlock[] };

export type ProviderResponse = {
  id: string | null;
  content: ProviderAssistantBlock[];
  stopReason:
    | "end_turn"
    | "max_tokens"
    | "tool_use"
    | "content_filter"
    | "repetition_truncation"
    | null;
  usage?: { inputTokens?: number; outputTokens?: number };
};

@Injectable()
export class AIProviderService {
  private readonly logger = new Logger(AIProviderService.name);
  private healthCache?: { checkedAt: number; healthy: boolean; error?: string };

  constructor(private readonly config: ConfigService<Environment, true>) {}

  get available(): boolean {
    const baseUrl = this.config.get("ANTHROPIC_BASE_URL", { infer: true });
    const token = this.config.get("XIAOMI_AUTH_TOKEN", { infer: true });
    return typeof baseUrl === "string" && typeof token === "string";
  }

  async createMessage(
    system: string,
    messages: ProviderMessage[],
    tools: ProviderToolDefinition[] = [],
    maxTokens = 4096
  ): Promise<ProviderResponse> {
    const raw = await this.request({
      model: this.config.get("XIAOMI_MODEL", { infer: true }),
      max_tokens: maxTokens,
      temperature: 0.2,
      system,
      messages,
      ...(tools.length > 0
        ? {
            tools,
            tool_choice: {
              type: "auto",
              disable_parallel_tool_use: true
            }
          }
        : {})
    });
    const parsed = providerResponseSchema.parse(raw);
    const content: ProviderAssistantBlock[] = [];
    for (const block of parsed.content) {
      if (block.type === "text" && typeof block.text === "string") {
        content.push({ type: "text", text: block.text });
      } else if (block.type === "thinking") {
        content.push({
          ...block,
          type: "thinking",
          thinking: block.thinking,
          signature: block.signature
        });
      } else if (
        block.type === "tool_use" &&
        typeof block.id === "string" &&
        typeof block.name === "string" &&
        block.input
      ) {
        content.push({
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input
        });
      } else {
        throw new Error(`Unsupported provider content block: ${block.type}`);
      }
    }
    return {
      id: parsed.id ?? null,
      content,
      stopReason: parsed.stop_reason ?? null,
      usage: parsed.usage
        ? {
            inputTokens: parsed.usage.input_tokens,
            outputTokens: parsed.usage.output_tokens
          }
        : undefined
    };
  }

  async complete(system: string, prompt: string): Promise<string | null> {
    if (!this.available) {
      return null;
    }
    try {
      const response = await this.createMessage(
        system,
        [{ role: "user", content: prompt }],
        [],
        900
      );
      const text = response.content
        .filter((block): block is ProviderTextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");
      return text.trim() || null;
    } catch (error) {
      this.logger.error(
        `AI provider call failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  async health(): Promise<{ healthy: boolean; error?: string }> {
    const now = Date.now();
    if (this.healthCache && now - this.healthCache.checkedAt < 60_000) {
      return {
        healthy: this.healthCache.healthy,
        error: this.healthCache.error
      };
    }
    if (!this.available) {
      return { healthy: false, error: "AI provider is not configured" };
    }
    try {
      const response = await this.createMessage(
        "Reply with OK only.",
        [{ role: "user", content: "health check" }],
        [],
        8
      );
      const healthy = response.content.some(
        (block) => block.type === "text" && block.text.trim().length > 0
      );
      this.healthCache = {
        checkedAt: now,
        healthy,
        error: healthy ? undefined : "Provider returned no text"
      };
    } catch (error) {
      this.healthCache = {
        checkedAt: now,
        healthy: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
    return {
      healthy: this.healthCache.healthy,
      error: this.healthCache.error
    };
  }

  async *stream(system: string, prompt: string): AsyncIterable<string> {
    if (!this.available) {
      return;
    }
    const response = await this.fetchProvider({
      model: this.config.get("XIAOMI_MODEL", { infer: true }),
      max_tokens: 900,
      temperature: 0.2,
      system,
      stream: true,
      messages: [{ role: "user", content: prompt }]
    }, 30_000);
    if (!response.body) {
      throw new Error("AI stream response body is empty");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          const event = providerStreamEventSchema.safeParse(JSON.parse(data));
          if (
            event.success &&
            event.data.type === "content_block_delta" &&
            event.data.delta?.type === "text_delta" &&
            event.data.delta.text
          ) {
            yield event.data.delta.text;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async request(body: Record<string, unknown>): Promise<unknown> {
    const response = await this.fetchProvider(body, 60_000);
    return response.json();
  }

  private async fetchProvider(
    body: Record<string, unknown>,
    timeoutMs: number
  ): Promise<Response> {
    const baseUrl = this.config.get("ANTHROPIC_BASE_URL", { infer: true });
    const token = this.config.get("XIAOMI_AUTH_TOKEN", { infer: true });
    if (!baseUrl || !token) {
      throw new Error("AI provider is not configured");
    }
    let response: Response;
    try {
      response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": token,
          authorization: `Bearer ${token}`,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      throw new Error(
        `AI provider network failure: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (!response.ok) {
      const responseBody = await response.text().catch(() => "(unreadable)");
      throw new Error(
        `AI provider returned HTTP ${response.status}: ${responseBody.slice(0, 300)}`
      );
    }
    return response;
  }
}
