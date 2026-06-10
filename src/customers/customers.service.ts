import { Injectable, NotFoundException } from "@nestjs/common";
import type { PaginationQuery } from "../contracts";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: PaginationQuery) {
    const where = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" as const } },
            { email: { contains: query.search, mode: "insensitive" as const } }
          ]
        }
      : {};
    const [items, total, orderAggregates] = await this.prisma.$transaction([
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
            take: 1
          }
        }
      }),
      this.prisma.customer.count({ where }),
      this.prisma.order.groupBy({
        by: ["customerId"],
        where: {
          customerId: {
            in: (
              await this.prisma.customer.findMany({
                where,
                skip: (query.page - 1) * query.pageSize,
                take: query.pageSize,
                orderBy: { createdAt: "desc" },
                select: { id: true }
              })
            ).map((c) => c.id)
          }
        },
        orderBy: { customerId: "asc" },
        _sum: { amount: true }
      })
    ]);
    const ltvMap = new Map(
      orderAggregates.map((row) => [row.customerId, Number(row._sum?.amount ?? 0)])
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
        lastActivity: customer.orders[0]?.createdAt ?? customer.createdAt
      })),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize)
      }
    };
  }

  async get(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        orders: { orderBy: { createdAt: "desc" }, take: 20 },
        campaignEvents: {
          include: { campaign: { select: { name: true } } },
          orderBy: { occurredAt: "desc" },
          take: 30
        }
      }
    });
    if (!customer) {
      throw new NotFoundException("Customer not found");
    }
    return customer;
  }

  async getLoginLogs(customerId: string) {
    return this.prisma.customerLoginLog.findMany({
      where: { customerId },
      orderBy: { loggedInAt: "desc" },
      take: 50
    });
  }
}
