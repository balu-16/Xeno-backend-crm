import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { PaginationQuery } from "../contracts";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: PaginationQuery, filters?: { tag?: string }) {
    const where: Prisma.CustomerWhereInput = {
      ...(query.search
        ? {
            OR: [
              {
                name: { contains: query.search, mode: "insensitive" as const },
              },
              {
                email: { contains: query.search, mode: "insensitive" as const },
              },
            ],
          }
        : {}),
      ...(filters?.tag ? { tags: { has: filters.tag } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { orders: true } },
          orders: {
            select: { createdAt: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      }),
      this.prisma.customer.count({ where }),
    ]);
    // Use the already-fetched customer IDs instead of re-querying
    const customerIds = items.map((c) => c.id);
    const orderAggregates =
      customerIds.length > 0
        ? await this.prisma.order.groupBy({
            by: ["customerId"],
            where: { customerId: { in: customerIds } },
            orderBy: { customerId: "asc" },
            _sum: { amount: true },
          })
        : [];
    const ltvMap = new Map(
      orderAggregates.map((row) => [
        row.customerId,
        Number(row._sum?.amount ?? 0),
      ]),
    );
    return {
      data: items.map((customer) => ({
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        metadata: customer.metadata,
        orders: customer._count.orders,
        lifetimeValue: ltvMap.get(customer.id) ?? 0,
        lastActivity: customer.orders[0]?.createdAt ?? customer.createdAt,
      })),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async create(input: {
    name: string;
    email: string;
    phone: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }) {
    const existing = await this.prisma.customer.findUnique({
      where: { email: input.email.toLowerCase() },
    });
    if (existing) {
      throw new ConflictException("A customer with this email already exists");
    }
    return this.prisma.customer.create({
      data: {
        name: input.name.trim(),
        email: input.email.toLowerCase(),
        phone: input.phone,
        tags: input.tags ?? [],
        metadata: (input.metadata ?? {}) as Prisma.InputJsonObject,
      },
    });
  }

  async get(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        orders: { orderBy: { createdAt: "desc" }, take: 20 },
        campaignEvents: {
          include: { campaign: { select: { name: true } } },
          orderBy: { occurredAt: "desc" },
          take: 30,
        },
      },
    });
    if (!customer) {
      throw new NotFoundException("Customer not found");
    }
    return customer;
  }

  async getByEmail(email: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        orders: { orderBy: { createdAt: "desc" }, take: 20 },
        campaignEvents: {
          include: { campaign: { select: { name: true } } },
          orderBy: { occurredAt: "desc" },
          take: 30,
        },
      },
    });
    if (!customer) {
      throw new NotFoundException("Customer not found");
    }
    return customer;
  }

  async update(
    id: string,
    input: {
      name?: string;
      email?: string;
      phone?: string;
      tags?: string[];
      metadata?: Record<string, unknown>;
    },
  ) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      throw new NotFoundException("Customer not found");
    }
    // Check email uniqueness if email is being changed
    if (input.email && input.email.toLowerCase() !== customer.email) {
      const existing = await this.prisma.customer.findUnique({
        where: { email: input.email.toLowerCase() },
      });
      if (existing) {
        throw new ConflictException(
          "A customer with this email already exists",
        );
      }
    }
    return this.prisma.customer.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.email !== undefined
          ? { email: input.email.toLowerCase() }
          : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.metadata !== undefined
          ? { metadata: input.metadata as Prisma.InputJsonObject }
          : {}),
      },
    });
  }

  async remove(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      throw new NotFoundException("Customer not found");
    }
    await this.prisma.customer.delete({ where: { id } });
    return { deleted: true, id };
  }

  async getLoginLogs(customerId: string) {
    return this.prisma.customerLoginLog.findMany({
      where: { customerId },
      orderBy: { loggedInAt: "desc" },
      take: 50,
    });
  }

  async getCommunications(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) {
      throw new NotFoundException("Customer not found");
    }

    const events = await this.prisma.campaignEvent.findMany({
      where: { customerId },
      include: {
        campaign: { select: { id: true, name: true, channel: true } },
      },
      orderBy: { occurredAt: "desc" },
      take: 100,
    });

    // Group events by campaign for a cleaner timeline view
    const campaignMap = new Map<
      string,
      {
        campaign: { id: string; name: string; channel: string };
        events: typeof events;
      }
    >();

    for (const event of events) {
      const cid = event.campaignId;
      let group = campaignMap.get(cid);
      if (!group) {
        group = { campaign: event.campaign, events: [] };
        campaignMap.set(cid, group);
      }
      group.events.push(event);
    }

    return {
      totalEvents: events.length,
      campaigns: [...campaignMap.values()].map((group) => ({
        campaignId: group.campaign.id,
        campaignName: group.campaign.name,
        channel: group.campaign.channel,
        events: group.events.map((e) => ({
          id: e.id,
          type: e.type,
          payload: e.payload,
          occurredAt: e.occurredAt,
        })),
      })),
    };
  }

  async getTags() {
    const customers = await this.prisma.customer.findMany({
      select: { tags: true },
      where: { tags: { isEmpty: false } },
    });
    const tagSet = new Set<string>();
    for (const c of customers) {
      for (const tag of c.tags) {
        tagSet.add(tag);
      }
    }
    return [...tagSet].sort();
  }
}
