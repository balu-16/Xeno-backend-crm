import {
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.service";
import type { ToolResult } from "./ai-tools.service";
import { AnalyticsToolsProvider } from "./tools/analytics-tools.provider";
import { CampaignToolsProvider } from "./tools/campaign-tools.provider";
import { ChannelToolsProvider } from "./tools/channel-tools.provider";
import { CustomerToolsProvider } from "./tools/customer-tools.provider";
import { OptionalToolsProvider } from "./tools/optional-tools.provider";
import { SegmentToolsProvider } from "./tools/segment-tools.provider";
import type {
  AIToolProvider,
  ExecutedAITool,
  RegisteredAITool
} from "./tools/tool-provider";

export type ProviderToolDefinition = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export function flattenToolProviders(
  providers: AIToolProvider[]
): RegisteredAITool[] {
  const definitions = providers.flatMap((provider) => provider.definitions);
  const seen = new Set<string>();
  for (const definition of definitions) {
    if (seen.has(definition.name)) {
      throw new Error(`Duplicate AI tool registration: ${definition.name}`);
    }
    seen.add(definition.name);
  }
  return definitions;
}

@Injectable()
export class ToolRegistryService {
  private readonly tools: Map<string, RegisteredAITool>;

  constructor(
    customer: CustomerToolsProvider,
    segment: SegmentToolsProvider,
    campaign: CampaignToolsProvider,
    analytics: AnalyticsToolsProvider,
    channel: ChannelToolsProvider,
    optional: OptionalToolsProvider
  ) {
    const definitions = flattenToolProviders([
      customer,
      segment,
      campaign,
      analytics,
      channel,
      optional
    ]);
    this.tools = new Map(
      definitions.map((definition) => [definition.name, definition])
    );
  }

  get definitions(): RegisteredAITool[] {
    return [...this.tools.values()];
  }

  get providerDefinitions(): ProviderToolDefinition[] {
    return this.definitions.map((definition) => ({
      name: definition.name,
      description: definition.description,
      input_schema: definition.inputSchema
    }));
  }

  get(name: string): RegisteredAITool {
    const definition = this.tools.get(name);
    if (!definition) {
      throw new NotFoundException(`AI tool not found: ${name}`);
    }
    return definition;
  }

  authorize(definition: RegisteredAITool, user: AuthenticatedUser): void {
    if (
      definition.allowedRoles.length > 0 &&
      !definition.allowedRoles.includes(user.role)
    ) {
      throw new ForbiddenException(
        `${definition.name} requires one of these roles: ${definition.allowedRoles.join(", ")}`
      );
    }
  }

  validate(
    name: string,
    input: unknown,
    user: AuthenticatedUser
  ): { definition: RegisteredAITool; input: Record<string, unknown> } {
    const definition = this.get(name);
    this.authorize(definition, user);
    return { definition, input: definition.validate(input) };
  }

  async executeValidated(
    definition: RegisteredAITool,
    input: Record<string, unknown>
  ): Promise<ExecutedAITool> {
    const startedAt = performance.now();
    const result: ToolResult = await definition.execute(input);
    return {
      definition,
      result,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt))
    };
  }
}
