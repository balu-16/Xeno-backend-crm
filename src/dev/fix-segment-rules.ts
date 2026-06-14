/**
 * One-off utility: scan all Segment rows, normalise malformed `rules` JSON
 * to match the current Zod schema, and update or delete unfixable rows.
 *
 * Run:  npx ts-node --compiler-options '{"module":"commonjs"}' src/dev/fix-segment-rules.ts
 */
import { PrismaClient } from "@prisma/client";
import { segmentRuleGroupSchema } from "../contracts";

const prisma = new PrismaClient();

/**
 * Best-effort normalisation of legacy / AI-generated rule JSON that doesn't
 * match the current schema.  Returns `null` when the data is unfixable.
 */
function normaliseRules(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return null;
  const obj = { ...(raw as Record<string, unknown>) };

  // `logic` -> `operator`  (common AI mistake)
  if ("logic" in obj && !("operator" in obj)) {
    obj.operator = obj.logic;
    delete obj.logic;
  }

  // Normalise operator values
  if (typeof obj.operator === "string") {
    const opMap: Record<string, string> = {
      eq: "=",
      neq: "!=",
      gt: ">",
      gte: ">=",
      lt: "<",
      lte: "<=",
    };
    obj.operator = opMap[obj.operator] ?? obj.operator;
  }

  // Recursively normalise conditions
  if (Array.isArray(obj.conditions)) {
    obj.conditions = obj.conditions.map((c: unknown) => {
      if (!c || typeof c !== "object") return c;
      const cond = { ...(c as Record<string, unknown>) };

      // Nested group – recurse
      if ("conditions" in cond) return normaliseRules(cond);

      // `metadata.emailEngagement` -> `emailEngagement`
      if (typeof cond.field === "string" && cond.field.includes(".")) {
        const parts = cond.field.split(".");
        cond.field = parts[parts.length - 1];
      }

      // Normalise operator aliases on leaf conditions
      if (typeof cond.operator === "string") {
        const opMap: Record<string, string> = {
          eq: "=",
          neq: "!=",
          gt: ">",
          gte: ">=",
          lt: "<",
          lte: "<=",
        };
        cond.operator = opMap[cond.operator] ?? cond.operator;
      }

      return cond;
    });
  }

  return obj;
}

async function main() {
  const segments = await prisma.segment.findMany();
  let fixed = 0;
  let alreadyOk = 0;
  let deleted = 0;

  for (const seg of segments) {
    // Already valid?
    const parsed = segmentRuleGroupSchema.safeParse(seg.rules);
    if (parsed.success) {
      alreadyOk++;
      continue;
    }

    // Try to normalise
    const normalised = normaliseRules(seg.rules);
    if (normalised) {
      const reparsed = segmentRuleGroupSchema.safeParse(normalised);
      if (reparsed.success) {
        await prisma.segment.update({
          where: { id: seg.id },
          data: { rules: reparsed.data as any },
        });
        console.log(`FIXED  ${seg.id}  "${seg.name}"`);
        fixed++;
        continue;
      }
    }

    // Unfixable – delete (no campaigns should reference it if rules were broken)
    const campaignCount = await prisma.campaign.count({
      where: { segmentId: seg.id },
    });
    if (campaignCount === 0) {
      await prisma.segment.delete({ where: { id: seg.id } });
      console.log(`DELETED ${seg.id}  "${seg.name}"`);
      deleted++;
    } else {
      console.log(
        `SKIP   ${seg.id}  "${seg.name}"  (${campaignCount} campaigns reference it)`,
      );
    }
  }

  console.log(
    `\nDone. alreadyOk=${alreadyOk}  fixed=${fixed}  deleted=${deleted}`,
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
