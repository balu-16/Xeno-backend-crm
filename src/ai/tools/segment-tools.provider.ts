import { Injectable } from "@nestjs/common";
import { AIToolsService } from "../ai-tools.service";
import {
  registerDefinitions,
  type AIToolProvider,
  type RegisteredAITool
} from "./tool-provider";

const READ_TOOLS = [
  "getSegments",
  "getSegment",
  "getSegmentCustomerCount"
] as const;
const WRITE_TOOLS = ["createSegment", "updateSegment"] as const;

@Injectable()
export class SegmentToolsProvider implements AIToolProvider {
  constructor(private readonly tools: AIToolsService) {}

  get definitions(): RegisteredAITool[] {
    return [
      ...registerDefinitions(
        READ_TOOLS.map((name) => this.require(name)),
        "segment"
      ),
      ...registerDefinitions(
        WRITE_TOOLS.map((name) => this.require(name)),
        "segment",
        ["ADMIN", "MANAGER"]
      ),
      ...registerDefinitions(
        [this.require("deleteSegment")],
        "segment",
        ["ADMIN"]
      )
    ];
  }

  private require(name: string) {
    const definition = this.tools.getDefinition(name);
    if (!definition) {
      throw new Error(`Missing segment AI tool definition: ${name}`);
    }
    return definition;
  }
}

