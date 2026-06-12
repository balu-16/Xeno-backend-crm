import { Injectable } from "@nestjs/common";
import { AIToolsService } from "../ai-tools.service";
import {
  registerDefinitions,
  type AIToolProvider,
  type RegisteredAITool
} from "./tool-provider";

const TOOL_NAMES = [
  "getDashboardMetrics",
  "generateSegmentRules",
  "generateCampaignMessage",
  "recommendAudience",
  "diagnoseCampaignFailure",
  "getBestSendTime",
  "suggestABTest"
] as const;

@Injectable()
export class OptionalToolsProvider implements AIToolProvider {
  constructor(private readonly tools: AIToolsService) {}

  get definitions(): RegisteredAITool[] {
    return registerDefinitions(
      TOOL_NAMES.map((name) => this.require(name)),
      "optional"
    );
  }

  private require(name: string) {
    const definition = this.tools.getDefinition(name);
    if (!definition) {
      throw new Error(`Missing optional AI tool definition: ${name}`);
    }
    return definition;
  }
}

