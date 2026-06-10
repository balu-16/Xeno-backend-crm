import {
  ConflictException,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { hash, verify } from "argon2";
import type { Environment } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "MEMBER";
};

type JwtPayload = {
  sub: string;
  email: string;
  role: "ADMIN" | "MEMBER";
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Environment, true>
  ) {}

  async login(email: string, password: string): Promise<{
    token: string;
    user: AuthenticatedUser;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });
    if (!user || !(await verify(user.passwordHash, password))) {
      throw new UnauthorizedException("Invalid email or password");
    }
    const role = user.role;
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role
    };
    const token = await this.jwt.signAsync(payload, {
      secret: this.config.get("JWT_SECRET", { infer: true }),
      expiresIn: this.config.get("JWT_EXPIRES_IN", { infer: true })
    });
    // Log admin login
    await this.prisma.adminLoginLog.create({
      data: {
        userId: user.id,
        email: user.email,
        role,
        ip: null,
        userAgent: null
      }
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role
      }
    };
  }

  async register(
    name: string,
    email: string,
    password: string
  ): Promise<{ token: string; user: AuthenticatedUser }> {
    const existing = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });
    if (existing) {
      throw new ConflictException("An account with this email already exists");
    }
    const passwordHash = await hash(password);
    const user = await this.prisma.user.create({
      data: {
        name: name.trim(),
        email: email.toLowerCase(),
        passwordHash,
        role: "MEMBER"
      }
    });
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role
    };
    const token = await this.jwt.signAsync(payload, {
      secret: this.config.get("JWT_SECRET", { infer: true }),
      expiresIn: this.config.get("JWT_EXPIRES_IN", { infer: true })
    });
    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    };
  }

  async authenticate(token: string): Promise<AuthenticatedUser> {
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.get("JWT_SECRET", { infer: true })
      });
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, name: true, role: true }
      });
      if (!user) {
        throw new UnauthorizedException();
      }
      return {
        ...user,
        role: user.role
      };
    } catch {
      throw new UnauthorizedException("Authentication required");
    }
  }
}
