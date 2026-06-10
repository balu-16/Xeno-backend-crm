import { Injectable, NotFoundException } from "@nestjs/common";
import type { PaginationQuery, SegmentRuleGroup } from "../contracts";
import { toInputJson } from "../common/json";
import { PrismaService } from "../prisma/prisma.service";
import { SegmentCompilerService } from "./segment-compiler.service";

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
      items.map(async (segment) => ({
        ...segment,
        audienceSize: await this.compiler.count(segment.rules)
      }))
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
    const segment = await this.prisma.segment.create({
      data: {
        name: input.name,
        description: input.description,
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

  async updateName(id: string, name: string) {
    const segment = await this.prisma.segment.findUnique({ where: { id } });
    if (!segment) {
      throw new NotFoundException("Segment not found");
    }
    return this.prisma.segment.update({
      where: { id },
      data: { name },
    });
  }
}
