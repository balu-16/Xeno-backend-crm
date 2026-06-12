import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AuthGuard } from "../auth/auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { paginationQuerySchema } from "../contracts";
import {
  IsIn,
  IsObject,
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

  @IsOptional()
  @IsString()
  scheduledAt?: string;
}

class SimulateDeliveryDto {
  @IsUUID()
  customerId!: string;

  @IsIn([
    "MessageSent",
    "MessageDelivered",
    "MessageOpened",
    "MessageClicked",
    "MessageConverted",
    "MessageFailed"
  ])
  type!: "MessageSent" | "MessageDelivered" | "MessageOpened" | "MessageClicked" | "MessageConverted" | "MessageFailed";

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

@Controller("campaigns")
@UseGuards(AuthGuard, RolesGuard)
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
  @Roles("ADMIN", "MANAGER")
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
  @Roles("ADMIN", "MANAGER")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  launch(@Param("id") id: string) {
    return this.campaigns.launch(id);
  }

  @Patch(":id/pause")
  @Roles("ADMIN", "MANAGER")
  pause(@Param("id") id: string) {
    return this.campaigns.pause(id);
  }

  @Post(":id/retry")
  @Roles("ADMIN", "MANAGER")
  retry(@Param("id") id: string) {
    return this.campaigns.retryFailed(id);
  }

  @Post(":id/simulate-delivery")
  @Roles("ADMIN", "MANAGER")
  simulateDelivery(
    @Param("id") id: string,
    @Body() input: SimulateDeliveryDto
  ) {
    return this.campaigns.simulateDelivery(
      id,
      input.customerId,
      input.type,
      input.payload ?? {}
    );
  }

  @Delete(":id")
  @Roles("ADMIN")
  remove(@Param("id") id: string) {
    return this.campaigns.remove(id);
  }

  @Post("launch-scheduled")
  @HttpCode(200)
  @Roles("ADMIN")
  launchScheduled() {
    return this.campaigns.launchScheduled();
  }
}
