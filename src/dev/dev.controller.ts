import {
  Controller,
  ForbiddenException,
  NotFoundException,
  Post,
  Req
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AuthenticatedRequest } from "../auth/auth.guard";
import type { Environment } from "../config/env";
import { DevService } from "./dev.service";

@Controller("dev")
export class DevController {
  constructor(
    private readonly dev: DevService,
    private readonly config: ConfigService<Environment, true>
  ) {}

  @Post("seed")
  seed(@Req() request: AuthenticatedRequest) {
    if (this.config.get("NODE_ENV", { infer: true }) !== "development") {
      throw new NotFoundException();
    }
    if (request.user.role !== "ADMIN") {
      throw new ForbiddenException("Administrator access required");
    }
    return this.dev.seed();
  }
}
