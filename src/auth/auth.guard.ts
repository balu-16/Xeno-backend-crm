import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { AuthService, type AuthenticatedUser } from "./auth.service";

export const PUBLIC_ROUTE = "public-route";
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PUBLIC_ROUTE, true);

export type AuthenticatedRequest = Omit<Request, "cookies"> & {
  user: AuthenticatedUser;
  cookies?: Record<string, string>;
  rawBody?: Buffer;
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass()
    ]);
    if (isPublic) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.cookies?.xeno_access_token;
    if (!token) {
      throw new UnauthorizedException("Authentication required");
    }
    request.user = await this.auth.authenticate(token);
    return true;
  }
}
