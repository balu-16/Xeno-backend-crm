import { Controller, Get } from "@nestjs/common";
import { Public } from "../auth/auth.guard";
import { PrismaService } from "../prisma/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get("live")
  live() {
    return { status: "ok", timestamp: new Date().toISOString() };
  }

  @Public()
  @Get("ready")
  async ready() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: "ready" };
  }
}
