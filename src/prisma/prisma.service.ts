import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch (error) {
      console.error("Database connection unavailable during startup", error);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
