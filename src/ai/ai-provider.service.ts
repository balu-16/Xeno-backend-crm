import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import type { Environment } from "../config/env";

const anthropicResponseSchema = z.object({
  content: z.array(
    z.object({
      type: z.string(),
      text: z.string().optional()
    })
  )
});

@Injectable()
export class AIProviderService {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  get available(): boolean {
    const baseUrl = this.config.get("ANTHROPIC_BASE_URL", { infer: true });
    const token = this.config.get("XIAOMI_AUTH_TOKEN", { infer: true });
    return typeof baseUrl === "string" && typeof token === "string";
  }

  async complete(system: string, prompt: string): Promise<string | null> {
    const baseUrl = this.config.get("ANTHROPIC_BASE_URL", { infer: true });
    const token = this.config.get("XIAOMI_AUTH_TOKEN", { infer: true });
    if (!baseUrl || !token) {
      return null;
    }
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": token,
          authorization: `Bearer ${token}`,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: this.config.get("XIAOMI_MODEL", { infer: true }),
          max_tokens: 900,
          temperature: 0.2,
          system,
          messages: [{ role: "user", content: prompt }]
        }),
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) {
        return null;
      }
      const parsed = anthropicResponseSchema.parse(await response.json());
      return (
        parsed.content.find(
          (item) => item.type === "text" && typeof item.text === "string"
        )?.text ?? null
      );
    } catch {
      return null;
    }
  }
}
