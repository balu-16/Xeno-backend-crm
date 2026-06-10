import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";
import type { Response } from "express";
import type { Environment } from "../config/env";
import type { AuthenticatedRequest } from "./auth.guard";
import { Public } from "./auth.guard";
import { AuthService } from "./auth.service";

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

  @Public()
  @Post("register")
  async register(
    @Body() input: RegisterDto,
    @Res({ passthrough: true }) response: Response
  ): Promise<{ user: Awaited<ReturnType<AuthService["register"]>>["user"] }> {
    const result = await this.auth.register(
      input.name,
      input.email,
      input.password
    );
    const production =
      this.config.get("NODE_ENV", { infer: true }) === "production";
    response.cookie("xeno_access_token", result.token, {
      httpOnly: true,
      secure: production,
      sameSite: production ? "none" : "lax",
      path: "/",
      maxAge: 8 * 60 * 60 * 1000
    });
    return { user: result.user };
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  async login(
    @Body() input: LoginDto,
    @Res({ passthrough: true }) response: Response
  ): Promise<{ user: Awaited<ReturnType<AuthService["login"]>>["user"] }> {
    const result = await this.auth.login(input.email, input.password);
    const production =
      this.config.get("NODE_ENV", { infer: true }) === "production";
    response.cookie("xeno_access_token", result.token, {
      httpOnly: true,
      secure: production,
      sameSite: production ? "none" : "lax",
      path: "/",
      maxAge: 8 * 60 * 60 * 1000
    });
    return { user: result.user };
  }

  @Post("logout")
  @HttpCode(200)
  logout(@Res({ passthrough: true }) response: Response): { loggedOut: true } {
    const production =
      this.config.get("NODE_ENV", { infer: true }) === "production";
    response.clearCookie("xeno_access_token", {
      httpOnly: true,
      secure: production,
      sameSite: production ? "none" : "lax",
      path: "/"
    });
    return { loggedOut: true };
  }

  @Get("me")
  me(@Req() request: AuthenticatedRequest): { user: AuthenticatedRequest["user"] } {
    return { user: request.user };
  }
}
