import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  IsOptional,
  IsString,
  Length,
  MaxLength
} from "class-validator";
import { AIService } from "./ai.service";

class CreateConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;
}

class SendMessageDto {
  @IsString()
  @Length(1, 4000)
  content!: string;
}

@Controller("ai")
@Throttle({ default: { limit: 20, ttl: 60000 } })
export class AIController {
  constructor(private readonly ai: AIService) {}

  @Get("conversations")
  list() {
    return this.ai.listConversations();
  }

  @Post("conversations")
  create(@Body() input: CreateConversationDto) {
    return this.ai.createConversation(input.title);
  }

  @Get("conversations/:id")
  get(@Param("id") id: string) {
    return this.ai.getConversation(id);
  }

  @Post("conversations/:id/messages")
  send(
    @Param("id") id: string,
    @Body() input: SendMessageDto
  ) {
    return this.ai.sendMessage(id, input.content);
  }

  @Get("request-log")
  getRequestLog() {
    return this.ai.getRequestLog();
  }
}
