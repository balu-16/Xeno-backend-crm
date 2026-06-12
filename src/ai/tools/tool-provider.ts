import type { AuthenticatedUser } from "../../auth/auth.service";
import type {
  AIToolDefinition,
  ToolResult
} from "../ai-tools.service";

export type AIToolCategory =
  | "customer"
  | "segment"
  | "campaign"
  | "analytics"
  | "channel"
  | "optional";

export type RegisteredAITool = AIToolDefinition & {
  category: AIToolCategory;
  allowedRoles: AuthenticatedUser["role"][];
};

export interface AIToolProvider {
  readonly definitions: RegisteredAITool[];
}

export type ExecutedAITool = {
  definition: RegisteredAITool;
  result: ToolResult;
  durationMs: number;
};

export function registerDefinitions(
  definitions: AIToolDefinition[],
  category: AIToolCategory,
  allowedRoles: AuthenticatedUser["role"][] = []
): RegisteredAITool[] {
  return definitions.map((definition) => ({
    ...definition,
    category,
    allowedRoles
  }));
}

