import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Sse, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  IsOptional,
  IsString,
  Length,
  MaxLength
} from "class-validator";
import { Observable, Subscriber } from "rxjs";
import type { AuthenticatedRequest } from "../auth/auth.guard";
import { AuthGuard } from "../auth/auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { AIService } from "./ai.service";

class CreateConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;
}

class RenameConversationDto {
  @IsString()
  @Length(1, 100)
  title!: string;
}

class SendMessageDto {
  @IsString()
  @Length(1, 4000)
  content!: string;
}

@Controller("ai")
@UseGuards(AuthGuard, RolesGuard)
@Throttle({ default: { limit: 20, ttl: 60000 } })
export class AIController {
  constructor(
    private readonly ai: AIService
  ) {}

  @Get("conversations")
  list(@Req() req: AuthenticatedRequest) {
    return this.ai.listConversations(req.user.id);
  }

  @Post("conversations")
  create(@Req() req: AuthenticatedRequest, @Body() input: CreateConversationDto) {
    return this.ai.createConversation(req.user.id, input.title);
  }

  @Get("conversations/:id")
  get(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.ai.getConversation(id, req.user.id);
  }

  @Patch("conversations/:id")
  rename(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() input: RenameConversationDto
  ) {
    return this.ai.renameConversation(id, req.user.id, input.title);
  }

  @Delete("conversations/:id")
  delete(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.ai.deleteConversation(id, req.user.id);
  }

  @Post("conversations/:id/messages")
  send(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() input: SendMessageDto
  ) {
    return this.ai.sendMessage(id, input.content, req.user);
  }

  @Get("request-log")
  @Roles("ADMIN")
  getRequestLog() {
    return this.ai.getRequestLog();
  }

  @Get("guardrails")
  @Roles("ADMIN")
  getGuardrails() {
    return this.ai.getGuardrails();
  }

  @Get("conversations/:id/stream")
  @Sse()
  stream(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Query("content") content: string
  ): Observable<{ data: string }> {
    return new Observable<{ data: string }>((subscriber: Subscriber<{ data: string }>) => {
      const run = async () => {
        try {
          const generator = this.ai.streamMessage(id, content, req.user);
          for await (const event of generator) {
            if (subscriber.closed) break;
            subscriber.next(event);
          }
        } catch (error) {
          subscriber.next({
            data: JSON.stringify({
              type: "done",
              toolResult: null,
              grounding: {
                tool: null,
                sources: [],
                executionId: null,
                error: error instanceof Error ? error.message : String(error)
              }
            })
          });
        } finally {
          subscriber.complete();
        }
      };
      void run();
    });
  }
}
