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
      // Wrap $connect in a timeout so the app doesn't hang forever if the DB is unreachable
      await Promise.race([
        this.$connect(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Database connection timed out after 5s")), 5000),
        ),
      ]);
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
