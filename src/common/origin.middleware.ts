import {
  ForbiddenException,
  Injectable,
  type NestMiddleware
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { NextFunction, Request, Response } from "express";
import type { Environment } from "../config/env";

@Injectable()
export class OriginMiddleware implements NestMiddleware {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  use(request: Request, _response: Response, next: NextFunction): void {
    if (
      ["GET", "HEAD", "OPTIONS"].includes(request.method) ||
      request.path.endsWith("/webhooks/channel")
    ) {
      next();
      return;
    }
    const origin = request.header("origin");
    const production =
      this.config.get("NODE_ENV", { infer: true }) === "production";
    const expected = this.config.get("FRONTEND_URL", { infer: true });

    // In production, reject requests without an Origin header (fail-closed)
    if (production && !origin) {
      throw new ForbiddenException("Origin header is required");
    }
    // If Origin is present, it must match the expected frontend URL
    if (origin && origin !== expected) {
      throw new ForbiddenException("Request origin is not allowed");
    }
    next();
  }
}
