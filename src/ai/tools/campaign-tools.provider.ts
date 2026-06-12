import { Injectable } from "@nestjs/common";
import { AIToolsService } from "../ai-tools.service";
import {
  registerDefinitions,
  type AIToolProvider,
  type RegisteredAITool
} from "./tool-provider";

const READ_TOOLS = ["getCampaigns", "getCampaign"] as const;
const MANAGER_TOOLS = [
  "createCampaign",
  "launchCampaign",
  "pauseCampaign"
] as const;

@Injectable()
export class CampaignToolsProvider implements AIToolProvider {
  constructor(private readonly tools: AIToolsService) {}

  get definitions(): RegisteredAITool[] {
    return [
      ...registerDefinitions(
        READ_TOOLS.map((name) => this.require(name)),
        "campaign"
      ),
      ...registerDefinitions(
        MANAGER_TOOLS.map((name) => this.require(name)),
        "campaign",
        ["ADMIN", "MANAGER"]
      ),
      ...registerDefinitions(
        [this.require("deleteCampaign")],
        "campaign",
        ["ADMIN"]
      )
    ];
  }

  private require(name: string) {
    const definition = this.tools.getDefinition(name);
    if (!definition) {
      throw new Error(`Missing campaign AI tool definition: ${name}`);
    }
    return definition;
  }
}

