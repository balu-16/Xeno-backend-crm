import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import type { NextFunction, Request, Response } from "express";
import serverless from "serverless-http";
import { AppModule } from "../src/app.module";

let cachedHandler: ReturnType<typeof serverless>;

const allowedOrigins = [
  process.env.FRONTEND_URL,
  "https://xeno-frontend-kappa.vercel.app",
  "http://localhost:5173",
].filter(Boolean) as string[];

async function createApp() {
  const expressApp = express();

  // CORS must be applied BEFORE NestJS to handle OPTIONS preflight
  expressApp.use(cors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow: boolean) => void) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`), false);
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
  }));

  const app = await NestFactory.create(
    AppModule,
    new ExpressAdapter(expressApp),
    { rawBody: true, bufferLogs: true }
  );

  app.setGlobalPrefix("api/v1");
  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  }));
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
