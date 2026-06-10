import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { paginationQuerySchema } from "../contracts";
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength
} from "class-validator";
import { CampaignsService } from "./campaigns.service";

class CreateCampaignDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsUUID()
  segmentId!: string;

  @IsIn(["WHATSAPP", "SMS", "EMAIL", "RCS"])
  channel!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @IsString()
  @Length(1, 5000)
  message!: string;
}

@Controller("campaigns")
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  list(@Query() query: Record<string, string | undefined>) {
    return this.campaigns.list(paginationQuerySchema.parse(query), {
      status: query.status,
      channel: query.channel
    });
  }

  @Post()
  create(@Body() input: CreateCampaignDto) {
    return this.campaigns.create(input);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.campaigns.get(id);
  }

  @Get(":id/audience-preview")
  preview(@Param("id") id: string) {
    return this.campaigns.previewAudience(id);
  }

  @Post(":id/launch")
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  launch(@Param("id") id: string) {
    return this.campaigns.launch(id);
  }
}
