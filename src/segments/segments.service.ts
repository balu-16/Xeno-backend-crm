import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { PaginationQuery, SegmentRuleGroup } from "../contracts";
import { toInputJson } from "../common/json";
import { PrismaService } from "../prisma/prisma.service";
import { SegmentCompilerService } from "./segment-compiler.service";
import { rulesToDescription } from "./rule-description.util";

@Injectable()
export class SegmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly compiler: SegmentCompilerService
  ) {}

  async list(query: PaginationQuery) {
    const where = query.search
      ? { name: { contains: query.search, mode: "insensitive" as const } }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.segment.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: "desc" }
      }),
      this.prisma.segment.count({ where })
    ]);
    const data = await Promise.all(
      items.map(async (segment) => {
        let audienceSize = 0;
        try {
          audienceSize = await this.compiler.count(segment.rules);
        } catch {
          // Segment has invalid rules (e.g. wrong field names or operators);
          // return 0 so the page still loads instead of crashing.
        }
        return { ...segment, audienceSize };
      })
    );
    return {
      data,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize)
      }
    };
  }

  async create(input: {
    name: string;
    description?: string;
    rules: unknown;
  }) {
    const rules = this.compiler.validate(input.rules);
    const description = input.description ?? rulesToDescription(rules as SegmentRuleGroup);
    const segment = await this.prisma.segment.create({
      data: {
        name: input.name,
        description,
        rules: toInputJson(rules)
      }
    });
    return {
      ...segment,
      audienceSize: await this.compiler.count(rules)
    };
  }

  async preview(rules: unknown, page = 1, pageSize = 20) {
    const validated = this.compiler.validate(rules);
    const [items, total] = await Promise.all([
      this.compiler.match(validated, {
        limit: pageSize,
        offset: (page - 1) * pageSize
      }),
      this.compiler.count(validated)
    ]);
    return {
      data: { rules: validated, customers: items, audienceSize: total },
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    };
  }

  async getRules(id: string): Promise<SegmentRuleGroup> {
    const segment = await this.prisma.segment.findUnique({ where: { id } });
    if (!segment) {
      throw new NotFoundException("Segment not found");
    }
    return this.compiler.validate(segment.rules);
  }

  async get(id: string) {
    const segment = await this.prisma.segment.findUnique({ where: { id } });
    if (!segment) {
      throw new NotFoundException("Segment not found");
    }
    const rules = this.compiler.validate(segment.rules);
    return {
      ...segment,
      rules,
      audienceSize: await this.compiler.count(rules)
    };
  }

  async update(id: string, input: {
    name?: string;
    description?: string | null;
    rules?: unknown;
  }) {
    const segment = await this.prisma.segment.findUnique({ where: { id } });
    if (!segment) {
      throw new NotFoundException("Segment not found");
    }
    const rules = input.rules === undefined
      ? undefined
      : this.compiler.validate(input.rules);
    // Auto-regenerate description when rules change and no explicit description provided
    const autoDescription = rules !== undefined && input.description === undefined
      ? rulesToDescription(rules as SegmentRuleGroup)
      : undefined;
    const updated = await this.prisma.segment.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : autoDescription !== undefined
            ? { description: autoDescription }
            : {}),
        ...(rules !== undefined ? { rules: toInputJson(rules) } : {})
      }
    });
    const effectiveRules = rules ?? this.compiler.validate(updated.rules);
    return {
      ...updated,
      rules: effectiveRules,
      audienceSize: await this.compiler.count(effectiveRules)
    };
  }

  async updateName(id: string, name: string) {
    return this.update(id, { name });
  }

  async countCustomers(id: string) {
    const rules = await this.getRules(id);
    return { segmentId: id, audienceSize: await this.compiler.count(rules) };
  }

  async remove(id: string) {
    const segment = await this.prisma.segment.findUnique({ where: { id } });
    if (!segment) {
      throw new NotFoundException("Segment not found");
    }
    // Check if any campaigns reference this segment
    const campaignCount = await this.prisma.campaign.count({
      where: { segmentId: id }
    });
    if (campaignCount > 0) {
      throw new ConflictException(
        `Cannot delete segment: ${campaignCount} campaign(s) reference it`
      );
    }
    await this.prisma.segment.delete({ where: { id } });
    return { deleted: true, id };
  }
}
