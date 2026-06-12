import {
  ConflictException,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { hash, verify } from "argon2";
import { createHash, randomBytes } from "node:crypto";
import type { Environment } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "MANAGER" | "MEMBER";
};

type JwtPayload = {
  sub: string;
  email: string;
  role: "ADMIN" | "MANAGER" | "MEMBER";
};

const REFRESH_TOKEN_TTL_DAYS = 7;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Environment, true>
  ) {}

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private async generateRefreshToken(userId: string): Promise<string> {
    const token = randomBytes(48).toString("base64url");
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(
      Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
    );
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash, expiresAt }
    });
    return token;
  }

  async refreshAccessToken(
    refreshToken: string
  ): Promise<{ token: string; user: AuthenticatedUser }> {
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, email: true, name: true, role: true } } }
    });
    if (!stored || stored.expiresAt < new Date()) {
      // Clean up expired token if found
      if (stored) {
        await this.prisma.refreshToken.delete({ where: { id: stored.id } });
      }
      throw new UnauthorizedException("Invalid or expired refresh token");
    }
    // Rotate: revoke old token, issue new pair
    await this.prisma.refreshToken.delete({ where: { id: stored.id } });
    const user = stored.user;
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role
    };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get("JWT_SECRET", { infer: true }),
      expiresIn: this.config.get("JWT_EXPIRES_IN", { infer: true })
    });
    const newRefreshToken = await this.generateRefreshToken(user.id);
    return {
      token: accessToken,
      refreshToken: newRefreshToken,
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
    } as { token: string; user: AuthenticatedUser } & { refreshToken: string };
  }

  async revokeRefreshToken(refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.refreshToken.deleteMany({ where: { tokenHash } });
  }

  async revokeAllUserTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({ where: { userId } });
  }

  async login(
    email: string,
    password: string,
    ip?: string,
    userAgent?: string
  ): Promise<{
    token: string;
    refreshToken: string;
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
    const refreshToken = await this.generateRefreshToken(user.id);
    // Log admin login with IP and User-Agent for forensic audit
    await this.prisma.adminLoginLog.create({
      data: {
        userId: user.id,
        email: user.email,
        role,
        ip: ip ?? null,
        userAgent: userAgent ?? null
      }
    });

    return {
      token,
      refreshToken,
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
    password: string,
    _ip?: string,
    _userAgent?: string
  ): Promise<{ token: string; refreshToken: string; user: AuthenticatedUser }> {
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
    const refreshToken = await this.generateRefreshToken(user.id);
    return {
      token,
      refreshToken,
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
