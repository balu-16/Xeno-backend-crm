import { Injectable } from "@nestjs/common";
import { AIToolsService } from "../ai-tools.service";
import {
  registerDefinitions,
  type AIToolProvider,
  type RegisteredAITool
} from "./tool-provider";

const TOOL_NAMES = [
  "retryCampaign",
  "simulateDelivery"
] as const;

@Injectable()
export class ChannelToolsProvider implements AIToolProvider {
  constructor(private readonly tools: AIToolsService) {}

  get definitions(): RegisteredAITool[] {
    return registerDefinitions(
      TOOL_NAMES.map((name) => this.require(name)),
      "channel",
      ["ADMIN", "MANAGER"]
    );
  }

  private require(name: string) {
    const definition = this.tools.getDefinition(name);
    if (!definition) {
      throw new Error(`Missing channel AI tool definition: ${name}`);
    }
    return definition;
  }
}

