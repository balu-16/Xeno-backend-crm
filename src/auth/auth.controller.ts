import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";
import type { Request, Response } from "express";
import type { Environment } from "../config/env";
import type { AuthenticatedRequest } from "./auth.guard";
import { Public } from "./auth.guard";
import { AuthService, type AuthenticatedUser } from "./auth.service";

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

class RegisterDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Environment, true>
  ) {}

  private cookieOptions(production: boolean) {
    return {
      httpOnly: true,
      secure: production,
      sameSite: (production ? "strict" : "lax") as "strict" | "lax",
      path: "/"
    };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post("register")
  async register(
    @Body() input: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<{ user: Awaited<ReturnType<AuthService["register"]>>["user"] }> {
    const result = await this.auth.register(
      input.name,
      input.email,
      input.password,
      request.ip,
      request.header("user-agent")
    );
    const production =
      this.config.get("NODE_ENV", { infer: true }) === "production";
    const opts = this.cookieOptions(production);
    response.cookie("xeno_access_token", result.token, {
      ...opts,
      maxAge: 8 * 60 * 60 * 1000
    });
    response.cookie("xeno_refresh_token", result.refreshToken, {
      ...opts,
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    return { user: result.user };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post("login")
  @HttpCode(200)
  async login(
    @Body() input: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<{ user: Awaited<ReturnType<AuthService["login"]>>["user"] }> {
    const result = await this.auth.login(
      input.email,
      input.password,
      request.ip,
      request.header("user-agent")
    );
    const production =
      this.config.get("NODE_ENV", { infer: true }) === "production";
    const opts = this.cookieOptions(production);
    response.cookie("xeno_access_token", result.token, {
      ...opts,
      maxAge: 8 * 60 * 60 * 1000
    });
    response.cookie("xeno_refresh_token", result.refreshToken, {
      ...opts,
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    return { user: result.user };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post("refresh")
  @HttpCode(200)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<{ user: AuthenticatedUser }> {
    const refreshToken = request.cookies?.["xeno_refresh_token"] as
      | string
      | undefined;
    if (!refreshToken) {
      throw new UnauthorizedException("Refresh token not found");
    }
    const result = await this.auth.refreshAccessToken(refreshToken);
    const production =
      this.config.get("NODE_ENV", { infer: true }) === "production";
    const opts = this.cookieOptions(production);
    response.cookie("xeno_access_token", result.token, {
      ...opts,
      maxAge: 8 * 60 * 60 * 1000
    });
    // Set new refresh token (rotation)
    const newRefreshToken = (result as { refreshToken?: string }).refreshToken;
    if (newRefreshToken) {
      response.cookie("xeno_refresh_token", newRefreshToken, {
        ...opts,
        maxAge: 7 * 24 * 60 * 60 * 1000
      });
    }
    return { user: result.user };
  }

  @Post("logout")
  @HttpCode(200)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<{ loggedOut: true }> {
    const production =
      this.config.get("NODE_ENV", { infer: true }) === "production";
    const opts = this.cookieOptions(production);
    // Revoke the refresh token if present
    const refreshToken = request.cookies?.["xeno_refresh_token"] as
      | string
      | undefined;
    if (refreshToken) {
      await this.auth.revokeRefreshToken(refreshToken);
    }
    response.clearCookie("xeno_access_token", opts);
    response.clearCookie("xeno_refresh_token", opts);
    return { loggedOut: true };
  }

  @Get("me")
  me(@Req() request: AuthenticatedRequest): { user: AuthenticatedRequest["user"] } {
    return { user: request.user };
  }

}
