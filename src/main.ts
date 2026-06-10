import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
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
  app.setGlobalPrefix("api");
  app.use(helmet());
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
  app.enableShutdownHooks();
  await app.listen(config.get("CRM_PORT", { infer: true }));
}

void bootstrap();
