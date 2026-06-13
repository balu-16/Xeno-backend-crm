import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod
} from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import {
  ThrottlerGuard,
  ThrottlerModule
} from "@nestjs/throttler";
import { AIModule } from "./ai/ai.module";
import { AIInsightsModule } from "./ai-insights/ai-insights.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { AuthGuard } from "./auth/auth.guard";
import { AuthModule } from "./auth/auth.module";
import { CampaignsModule } from "./campaigns/campaigns.module";
import {
  ApiExceptionFilter,
  ApiResponseInterceptor
} from "./common/http";
import { RequestIdMiddleware } from "./common/request-id.middleware";
import { OriginMiddleware } from "./common/origin.middleware";
import { validateEnvironment } from "./config/env";
import { CustomersModule } from "./customers/customers.module";
import { DevModule } from "./dev/dev.module";
import { EventsModule } from "./events/events.module";
import { HealthModule } from "./health/health.module";
import { MonitorModule } from "./monitor/monitor.module";
import { PrismaModule } from "./prisma/prisma.module";
import { SegmentsModule } from "./segments/segments.module";
import { WebhooksModule } from "./webhooks/webhooks.module";

const isDev = process.env.NODE_ENV !== "production";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["../.env", ".env"],
      validate: validateEnvironment
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    PrismaModule,
    EventsModule,
    AuthModule,
    CustomersModule,
    SegmentsModule,
    CampaignsModule,
    AnalyticsModule,
    AIModule,
    AIInsightsModule,
    MonitorModule,
    WebhooksModule,
    HealthModule,
    ...(isDev ? [DevModule] : [])
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: ApiResponseInterceptor },
    { provide: APP_FILTER, useClass: ApiExceptionFilter }
  ]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestIdMiddleware)
      .forRoutes({ path: "*path", method: RequestMethod.ALL });
    consumer
      .apply(OriginMiddleware)
      .forRoutes({ path: "*path", method: RequestMethod.ALL });
  }
}
