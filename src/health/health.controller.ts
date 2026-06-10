import { Controller, Get } from "@nestjs/common";
import { Public } from "../auth/auth.guard";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService
  ) {}

  @Public()
  @Get("live")
  live() {
    return { status: "ok", timestamp: new Date().toISOString() };
  }

  @Public()
  @Get("ready")
  async ready() {
    await this.prisma.$queryRaw`SELECT 1`;
    const queues = await this.queues.getQueueCounts();
    return { status: "ready", queues: queues.map((queue) => queue.queue) };
  }
}
