import {
  Injectable,
  type NestMiddleware
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { NextFunction, Request, Response } from "express";
import type { Environment } from "../config/env";

@Injectable()
export class OriginMiddleware implements NestMiddleware {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  use(_request: Request, _response: Response, next: NextFunction): void {
    // CORS is fully handled by the express cors() middleware in api/index.ts.
    // This middleware is a no-op to avoid double-rejecting requests.
    next();
  }
}
