import type { SegmentCondition, SegmentRuleGroup } from "../contracts";

const FIELD_LABELS: Record<string, string> = {
  totalSpent: "Total spent",
  orderCount: "Order count",
  daysSinceLastOrder: "Days since last order",
  city: "City",
  emailEngagement: "Email engagement",
};

const OPERATOR_LABELS: Record<string, string> = {
  ">": "greater than",
  ">=": "at least",
  "<": "less than",
  "<=": "at most",
  "=": "equals",
  "!=": "not equal to",
  contains: "containing",
};

function formatValue(field: string, value: unknown): string {
  if (field === "totalSpent") return `₹${Number(value).toLocaleString("en-IN")}`;
  if (field === "city") return String(value);
  if (field === "emailEngagement") return String(value);
  return String(value);
}

function conditionToText(field: string, operator: string, value: unknown): string {
  const label = FIELD_LABELS[field] ?? field;
  const op = OPERATOR_LABELS[operator] ?? operator;
  const formatted = formatValue(field, value);
  return `${label} ${op} ${formatted}`;
}

function isCondition(c: SegmentCondition | SegmentRuleGroup): c is SegmentCondition {
  return "field" in c;
}

/**
 * Convert segment rules JSON to a human-readable description.
 * Example: {operator:"AND", conditions:[{field:"totalSpent", operator:">", value:500}]}
 * → "Customers with total spent greater than ₹500"
 */
export function rulesToDescription(rules: SegmentRuleGroup): string {
  if (!rules?.conditions?.length) return "All customers";

  const parts = rules.conditions.map((c) => {
    if (isCondition(c)) {
      return conditionToText(c.field, c.operator, c.value);
    }
    // Nested group — recurse
    return rulesToDescription(c);
  });

  const joiner = rules.operator === "OR" ? " or " : " and ";
  return `Customers with ${parts.join(joiner)}`;
}
