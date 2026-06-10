import {
  ArgumentsHost,
  BadRequestException,
  CallHandler,
  Catch,
  ExceptionFilter,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor
} from "@nestjs/common";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { map, type Observable } from "rxjs";

type RequestWithId = Request & { requestId?: string };

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithId>();
    if (request.path.endsWith("/stream")) {
      return next.handle();
    }
    const requestId = request.requestId ?? randomUUID();
    request.requestId = requestId;
    return next.handle().pipe(
      map((result: unknown) => {
        const data =
          result !== null &&
          typeof result === "object" &&
          "data" in result
            ? (result as { data: unknown }).data
            : result;
        const meta =
          result !== null &&
          typeof result === "object" &&
          "meta" in result
            ? (result as { meta?: unknown }).meta
            : undefined;
        return {
          success: true,
          data,
          ...(meta !== undefined ? { meta } : {}),
          requestId
        };
      })
    );
  }
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<RequestWithId>();
    const requestId = request.requestId ?? randomUUID();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const body =
      exception instanceof HttpException ? exception.getResponse() : undefined;

    let message = "An unexpected error occurred";
    let details: unknown;
    if (typeof body === "string") {
      message = body;
    } else if (body !== null && typeof body === "object") {
      const payload = body as { message?: string | string[] };
      if (Array.isArray(payload.message)) {
        message = "Request validation failed";
        details = payload.message;
      } else if (typeof payload.message === "string") {
        message = payload.message;
      }
    } else if (exception instanceof Error && status < 500) {
      message = exception.message;
    }

    if (status >= 500) {
      console.error({ requestId, path: request.path, exception });
    }

    response.status(status).json({
      success: false,
      error: {
        code:
          exception instanceof BadRequestException
            ? "VALIDATION_ERROR"
            : HttpStatus[status] ?? "INTERNAL_SERVER_ERROR",
        message,
        ...(details !== undefined ? { details } : {})
      },
      requestId
    });
  }
}
