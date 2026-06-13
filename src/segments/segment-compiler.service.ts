import { Injectable } from "@nestjs/common";
import {
  segmentRuleGroupSchema,
  type SegmentCondition,
  type SegmentRuleGroup
} from "../contracts";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

type SegmentMatchRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
};

@Injectable()
export class SegmentCompilerService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly countCache = new Map<
    string,
    { value: number; expiresAt: number }
  >();
  private readonly CACHE_TTL_MS = 30_000;
  private readonly MAX_CACHE_SIZE = 256;

  validate(rules: unknown): SegmentRuleGroup {
    return segmentRuleGroupSchema.parse(rules);
  }

  private compileCondition(condition: SegmentCondition): Prisma.Sql {
    const columns: Record<SegmentCondition["field"], Prisma.Sql> = {
      totalSpent: Prisma.sql`"totalSpent"`,
      orderCount: Prisma.sql`"orderCount"`,
      daysSinceLastOrder: Prisma.sql`"daysSinceLastOrder"`,
      city: Prisma.sql`"city"`,
      emailEngagement: Prisma.sql`"emailEngagement"`
    };
    const column = columns[condition.field];
    switch (condition.operator) {
      case ">":
        return Prisma.sql`${column} > ${condition.value}`;
      case ">=":
        return Prisma.sql`${column} >= ${condition.value}`;
      case "<":
        return Prisma.sql`${column} < ${condition.value}`;
      case "<=":
        return Prisma.sql`${column} <= ${condition.value}`;
      case "=":
        return Prisma.sql`${column} = ${condition.value}`;
      case "!=":
        return Prisma.sql`${column} != ${condition.value}`;
      case "contains": {
        const escaped = String(condition.value)
          .replace(/\\/g, "\\\\")
          .replace(/%/g, "\\%")
          .replace(/_/g, "\\_");
        return Prisma.sql`${column} ILIKE ${`%${escaped}%`}`;
      }
    }
  }

  private compileGroup(group: SegmentRuleGroup): Prisma.Sql {
    const expressions = group.conditions.map((condition) =>
      "conditions" in condition
        ? this.compileGroup(condition)
        : this.compileCondition(condition)
    );
    return Prisma.sql`(${Prisma.join(
      expressions,
      group.operator === "AND" ? " AND " : " OR "
    )})`;
  }

  async match(
    rawRules: unknown,
    options: { limit?: number; offset?: number; tx?: Prisma.TransactionClient } = {}
  ): Promise<SegmentMatchRow[]> {
    const rules = this.validate(rawRules);
    const where = this.compileGroup(rules);
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;
    const client = options.tx ?? this.prisma;
    return client.$queryRaw<SegmentMatchRow[]>(Prisma.sql`
      WITH customer_metrics AS (
        SELECT
          c.id,
          c.name,
          c.email,
          c.phone,
          COALESCE(SUM(o.amount), 0)::double precision AS "totalSpent",
          COUNT(o.id)::integer AS "orderCount",
          COALESCE(
            EXTRACT(EPOCH FROM (NOW() - MAX(o."createdAt"))) / 86400,
            99999
          )::double precision AS "daysSinceLastOrder",
          COALESCE(c.metadata->>'city', '') AS city,
          COALESCE(
            NULLIF(c.metadata->>'emailEngagement', '')::double precision,
            0
          ) AS "emailEngagement"
        FROM "Customer" c
        LEFT JOIN "Order" o ON o."customerId" = c.id
        GROUP BY c.id
      )
      SELECT id, name, email, phone
      FROM customer_metrics
      WHERE ${where}
      ORDER BY id
      LIMIT ${limit}
      OFFSET ${offset}
    `);
  }

  async count(rawRules: unknown): Promise<number> {
    const cacheKey = JSON.stringify(rawRules);
    const cached = this.countCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const rules = this.validate(rawRules);
    const where = this.compileGroup(rules);
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      WITH customer_metrics AS (
        SELECT
          c.id,
          COALESCE(SUM(o.amount), 0)::double precision AS "totalSpent",
          COUNT(o.id)::integer AS "orderCount",
          COALESCE(
            EXTRACT(EPOCH FROM (NOW() - MAX(o."createdAt"))) / 86400,
            99999
          )::double precision AS "daysSinceLastOrder",
          COALESCE(c.metadata->>'city', '') AS city,
          COALESCE(
            NULLIF(c.metadata->>'emailEngagement', '')::double precision,
            0
          ) AS "emailEngagement"
        FROM "Customer" c
        LEFT JOIN "Order" o ON o."customerId" = c.id
        GROUP BY c.id
      )
      SELECT COUNT(*)::bigint AS count
      FROM customer_metrics
      WHERE ${where}
    `);
    const result = Number(rows[0]?.count ?? 0);
    // Evict oldest entry if cache is full
    if (this.countCache.size >= this.MAX_CACHE_SIZE) {
      const oldestKey = this.countCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.countCache.delete(oldestKey);
      }
    }
    this.countCache.set(cacheKey, {
      value: result,
      expiresAt: Date.now() + this.CACHE_TTL_MS
    });
    return result;
  }
}
