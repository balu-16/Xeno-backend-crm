import { Injectable } from "@nestjs/common";
import { AIToolsService } from "../ai-tools.service";
import {
  registerDefinitions,
  type AIToolProvider,
  type RegisteredAITool
} from "./tool-provider";

const TOOL_NAMES = [
  "getCampaignAnalytics",
  "getSegmentAnalytics",
  "getRevenueAnalytics",
  "getDeliveryAnalytics"
] as const;

@Injectable()
export class AnalyticsToolsProvider implements AIToolProvider {
  constructor(private readonly tools: AIToolsService) {}

  get definitions(): RegisteredAITool[] {
    return registerDefinitions(
      TOOL_NAMES.map((name) => this.require(name)),
      "analytics"
    );
  }

  private require(name: string) {
    const definition = this.tools.getDefinition(name);
    if (!definition) {
      throw new Error(`Missing analytics AI tool definition: ${name}`);
    }
    return definition;
  }
}

