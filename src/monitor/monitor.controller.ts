import { Controller, Get, Query, Sse, UseGuards } from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import { map, type Observable } from "rxjs";
import { AuthGuard } from "../auth/auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { AppEventsService } from "../events/app-events.service";
import { PrismaService } from "../prisma/prisma.service";

@Controller("monitor")
@UseGuards(AuthGuard, RolesGuard)
@Roles("ADMIN")
export class MonitorController {
  constructor(
    private readonly events: AppEventsService,
    private readonly prisma: PrismaService
  ) {}

  @Get("status")
  async status() {
    const failures = await this.prisma.processingFailure.findMany({
      where: { resolvedAt: null },
      orderBy: { createdAt: "desc" },
      take: 25
    });
    return { queues: [], failures };
  }

  @Get("callbacks")
  callbacks(@Query("limit") rawLimit = "100") {
    const limit = Math.min(100, Math.max(1, Number(rawLimit)));
    return this.prisma.webhookReceipt.findMany({
      orderBy: { receivedAt: "desc" },
      take: limit
    });
  }

  @Sse("stream")
  stream(): Observable<MessageEvent> {
    return this.events.stream("monitor").pipe(
      map((data) => ({
        data:
          typeof data === "object" && data !== null ? data : String(data)
      }) satisfies MessageEvent)
    );
  }
}
