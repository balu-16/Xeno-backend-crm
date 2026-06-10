import {
  campaignDispatchJobSchema,
  segmentRuleGroupSchema
} from "../src/contracts";
import { describe, expect, it } from "vitest";

describe("shared marketing contracts", () => {
  it("accepts a valid nested segment rule", () => {
    const result = segmentRuleGroupSchema.safeParse({
      operator: "AND",
      conditions: [
        { field: "totalSpent", operator: ">", value: 500 },
        {
          operator: "OR",
          conditions: [
            { field: "daysSinceLastOrder", operator: ">", value: 30 },
            { field: "city", operator: "contains", value: "Mumbai" }
          ]
        }
      ]
    });

    expect(result.success).toBe(true);
  });

  it("rejects invalid operators and model-generated fields", () => {
    const result = segmentRuleGroupSchema.safeParse({
      operator: "AND",
      conditions: [
        { field: "rawSql", operator: "EXECUTE", value: "DROP TABLE Customer" }
      ]
    });

    expect(result.success).toBe(false);
  });

  it("rejects rules nested beyond the safety limit", () => {
    const condition = { field: "orderCount", operator: ">", value: 1 };
    const result = segmentRuleGroupSchema.safeParse({
      operator: "AND",
      conditions: [
        {
          operator: "AND",
          conditions: [
            {
              operator: "AND",
              conditions: [{ operator: "AND", conditions: [condition] }]
            }
          ]
        }
      ]
    });

    expect(result.success).toBe(false);
  });

  it("requires typed, idempotent campaign dispatch payloads", () => {
    const result = campaignDispatchJobSchema.safeParse({
      campaignId: "not-a-uuid",
      customerId: "also-not-a-uuid",
      channel: "PUSH",
      destination: "",
      subject: null,
      message: "",
      correlationId: "bad"
    });

    expect(result.success).toBe(false);
  });
});
