import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import compression from "compression";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module";
import type { Environment } from "./config/env";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    bufferLogs: true
  });
  const config = app.get(ConfigService<Environment, true>);
  app.setGlobalPrefix("api/v1");
  app.use(helmet());
  app.use(compression({ threshold: 1024 }));
  app.use(cookieParser());
  // Prevent browser from caching authenticated pages (fixes Back-button after logout)
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
    next();
  });
  app.enableCors({
    origin: config.get("FRONTEND_URL", { infer: true }),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true
    })
  );

  // Swagger API documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle("Xeno CRM API")
    .setDescription("AI-native B2C marketing CRM — Customers → Segments → Campaigns → Delivery → Analytics")
    .setVersion("1.0")
    .addCookieAuth("xeno_access_token", {
      type: "apiKey",
      in: "cookie",
      name: "xeno_access_token"
    })
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("api/v1/docs", app, document);

  app.enableShutdownHooks();
  await app.listen(config.get("CRM_PORT", { infer: true }));
}

bootstrap().catch((error: unknown) => {
  console.error("Fatal: CRM API failed to start", error);
  process.exit(1);
});
