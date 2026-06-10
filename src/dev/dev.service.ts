import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Environment } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { seedDatabase } from "./seed-data";

@Injectable()
export class DevService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Environment, true>
  ) {}

  seed() {
    return seedDatabase(this.prisma, {
      adminEmail: this.config.get("SEED_ADMIN_EMAIL", { infer: true }),
      adminPassword: this.config.get("SEED_ADMIN_PASSWORD", { infer: true })
    });
  }
}
