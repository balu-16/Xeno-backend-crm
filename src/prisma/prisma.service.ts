import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private connected = false;

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.connected = true;
    } catch (error) {
      // Don't crash on startup — the DB might not be reachable yet.
      // Connection will be retried on first query.
      console.warn("Database connection failed during startup, will retry on first query:", error);
    }
  }

  /** Ensures the client is connected before the first query. */
  async ensureConnected(): Promise<void> {
    if (!this.connected) {
      await this.$connect();
      this.connected = true;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
