import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AnalyticsModule } from "../analytics/analytics.module";
import { validateEnvironment } from "../config/env";
import { PrismaModule } from "../prisma/prisma.module";
import { QueueModule } from "../queue/queue.module";
import { AnalyticsWorker } from "./analytics.worker";
import { ReceiptWorker } from "./receipt.worker";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["../.env", ".env"],
      validate: validateEnvironment
    }),
    PrismaModule,
    QueueModule,
    AnalyticsModule
  ],
  providers: [ReceiptWorker, AnalyticsWorker]
})
export class WorkerModule {}
