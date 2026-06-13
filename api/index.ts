import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import type { NextFunction, Request, Response } from "express";
import serverless from "serverless-http";
import { AppModule } from "../src/app.module";

let cachedHandler: ReturnType<typeof serverless>;

async function createApp() {
  const expressApp = express();
  const app = await NestFactory.create(
    AppModule,
    new ExpressAdapter(expressApp),
    { rawBody: true, bufferLogs: true }
  );

  app.setGlobalPrefix("api/v1");
  app.use(helmet());
  app.use(cookieParser());

  // Cache-Control headers to prevent browser caching of authenticated pages
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
    next();
  });

  app.enableCors({
    origin: process.env.FRONTEND_URL || "*",
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    })
  );

  await app.init();
  return expressApp;
}

export default async function handler(req: Request, res: Response) {
  if (!cachedHandler) {
    const app = await createApp();
    cachedHandler = serverless(app, {
      binary: false,
    });
  }
  return cachedHandler(req, res);
}
