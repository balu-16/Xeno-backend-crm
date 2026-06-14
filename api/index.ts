import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import { ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "../src/app.module";

let cachedApp: express.Express | null = null;

const allowedOrigins = [
  process.env.FRONTEND_URL,
  "https://xeno-frontend-kappa.vercel.app",
  "http://localhost:5173",
].filter(Boolean) as string[];

async function createApp() {
  const expressApp = express();

  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp), {
    rawBody: true,
    bufferLogs: true,
  });

  app.setGlobalPrefix("api/v1");

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow: boolean) => void,
    ) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie", "Cache-Control"],
  });

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.use(cookieParser());

  // Prevent browser from caching authenticated pages
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
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
    }),
  );

  await app.init();
  return expressApp;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

export default async function handler(req: Request, res: Response) {
  if (!cachedApp) {
    try {
      cachedApp = await withTimeout(createApp(), 8000, "NestJS app init");
    } catch (error) {
      console.error("Failed to initialize NestJS app:", error);
      res.status(503).json({
        success: false,
        error: { message: "Service temporarily unavailable — app failed to start" },
      });
      return;
    }
  }
  // Express apps are request handlers — call directly, no serverless-http needed.
  cachedApp(req, res);
}
