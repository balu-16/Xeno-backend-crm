import { Injectable } from "@nestjs/common";
import { AIToolsService } from "../ai-tools.service";
import {
  registerDefinitions,
  type AIToolProvider,
  type RegisteredAITool
} from "./tool-provider";

const READ_TOOLS = [
  "getCustomers",
  "getCustomerById",
  "getCustomerByEmail"
] as const;
const WRITE_TOOLS = ["createCustomer", "updateCustomer"] as const;

@Injectable()
export class CustomerToolsProvider implements AIToolProvider {
  constructor(private readonly tools: AIToolsService) {}

  get definitions(): RegisteredAITool[] {
    return [
      ...registerDefinitions(
        READ_TOOLS.map((name) => this.require(name)),
        "customer"
      ),
      ...registerDefinitions(
        WRITE_TOOLS.map((name) => this.require(name)),
        "customer",
        ["ADMIN", "MANAGER"]
      ),
      ...registerDefinitions(
        [this.require("deleteCustomer")],
        "customer",
        ["ADMIN"]
      )
    ];
  }

  private require(name: string) {
    const definition = this.tools.getDefinition(name);
    if (!definition) {
      throw new Error(`Missing customer AI tool definition: ${name}`);
    }
    return definition;
  }
}

