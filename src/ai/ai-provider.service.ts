import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Anthropic from "@anthropic-ai/sdk";
import type { Environment } from "../config/env";
import type { ProviderToolDefinition } from "./tool-registry.service";

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
  private client: Anthropic | null = null;

  constructor(private readonly config: ConfigService<Environment, true>) {}

  private getClient(): Anthropic | null {
    const authToken = this.config.get("XIAOMI_AUTH_TOKEN", { infer: true });
    const baseUrl = this.config.get("ANTHROPIC_BASE_URL", { infer: true });

    if (!authToken || !baseUrl) return null;

    if (!this.client) {
      this.client = new Anthropic({
        apiKey: authToken,
        baseURL: baseUrl
      });
    }
    return this.client;
  }

  get available(): boolean {
    const authToken = this.config.get("XIAOMI_AUTH_TOKEN", { infer: true });
    const baseUrl = this.config.get("ANTHROPIC_BASE_URL", { infer: true });
    return typeof authToken === "string" && authToken.length > 0 &&
           typeof baseUrl === "string" && baseUrl.length > 0;
  }

  private convertTools(
    tools: ProviderToolDefinition[]
  ): Anthropic.Tool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      input_schema: tool.input_schema as Anthropic.Tool["input_schema"]
    }));
  }

  private convertMessages(
    messages: ProviderMessage[]
  ): Anthropic.MessageParam[] {
    const result: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === "user") {
        if (typeof msg.content === "string") {
          result.push({ role: "user", content: msg.content });
        } else {
          const content: Anthropic.ContentBlockParam[] = [];
          for (const block of msg.content) {
            if (block.type === "text") {
              content.push({ type: "text", text: block.text });
            } else if (block.type === "tool_result") {
              content.push({
                type: "tool_result",
                tool_use_id: block.tool_use_id,
                content: block.content
              });
            }
          }
          result.push({ role: "user", content });
        }
      } else if (msg.role === "assistant") {
        if (typeof msg.content === "string") {
          result.push({ role: "assistant", content: msg.content });
        } else {
          const content: Anthropic.ContentBlockParam[] = [];
          for (const block of msg.content) {
            if (block.type === "text") {
              content.push({ type: "text", text: block.text });
            } else if (block.type === "tool_use") {
              content.push({
                type: "tool_use",
                id: block.id,
                name: block.name,
                input: block.input
              });
            }
          }
          result.push({ role: "assistant", content });
        }
      }
    }
    return result;
  }

  async createMessage(
    system: string,
    messages: ProviderMessage[],
    tools: ProviderToolDefinition[] = [],
    maxTokens = 4096
  ): Promise<ProviderResponse> {
    const client = this.getClient();
    if (!client) {
      throw new Error("Xiaomi/Anthropic API is not configured");
    }

    const model = this.config.get("XIAOMI_MODEL", { infer: true });
    const convertedMessages = this.convertMessages(messages);

    try {
      const params: Anthropic.MessageCreateParams = {
        model,
        max_tokens: maxTokens,
        temperature: 0.2,
        system,
        messages: convertedMessages,
        ...(tools.length > 0
          ? { tools: this.convertTools(tools) }
          : {})
      };

      const response = await client.messages.create(params);

      const content: ProviderAssistantBlock[] = [];
      for (const block of response.content) {
        if (block.type === "text") {
          content.push({ type: "text", text: block.text });
        } else if (block.type === "tool_use") {
          content.push({
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>
          });
        }
      }

      const stopReason = this.mapStopReason(response.stop_reason);

      return {
        id: response.id,
        content,
        stopReason,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens
        }
      };
    } catch (error) {
      this.logger.error(
        `Xiaomi/Anthropic API call failed: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private mapStopReason(
    reason: string | null | undefined
  ): ProviderResponse["stopReason"] {
    switch (reason) {
      case "end_turn":
        return "end_turn";
      case "max_tokens":
        return "max_tokens";
      case "tool_use":
        return "tool_use";
      case "content_filter":
        return "content_filter";
      case "repetition_truncation":
        return "repetition_truncation";
      default:
        // Log unknown stop reasons for visibility instead of silently mapping to end_turn
        if (reason) {
          this.logger.warn(`Unknown Anthropic stop reason: ${reason}`);
        }
        return reason ? "end_turn" : null;
    }
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
    const client = this.getClient();
    if (!client) {
      return;
    }

    const model = this.config.get("XIAOMI_MODEL", { infer: true });

    try {
      const stream = client.messages.stream({
        model,
        max_tokens: 900,
        temperature: 0.2,
        system,
        messages: [{ role: "user", content: prompt }]
      });

      for await (const event of stream) {
        if (event.type === "content_block_delta") {
          const delta = event.delta;
          if (delta.type === "text_delta") {
            yield delta.text;
          }
        }
      }
    } catch (error) {
      this.logger.error(
        `Xiaomi/Anthropic stream failed: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }
}
