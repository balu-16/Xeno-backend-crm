import {
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import { channelWebhookSchema } from "../contracts";
import { Prisma } from "@prisma/client";
import type { Request } from "express";
import {
  createHmac,
  timingSafeEqual
} from "node:crypto";
import { Public } from "../auth/auth.guard";
import { toInputJson } from "../common/json";
import type { Environment } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { AppEventsService } from "../events/app-events.service";
import { ReceiptProcessingService } from "./receipt-processing.service";

type RawRequest = Request & { rawBody?: Buffer };

@Controller("webhooks")
export class WebhooksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Environment, true>,
    private readonly receipts: ReceiptProcessingService,
    private readonly events: AppEventsService
  ) {}

  @Public()
  @Throttle({ default: { limit: 2000, ttl: 60000 } })
  @Post("channel")
  @HttpCode(202)
  async receive(
    @Req() request: RawRequest,
    @Headers("x-xeno-signature") suppliedSignature?: string
  ) {
    // rawBody is set by NestJS { rawBody: true } — if missing, the body was
    // already consumed and we cannot reconstruct the exact bytes for HMAC.
    if (!request.rawBody) {
      throw new UnauthorizedException(
        "Cannot verify webhook signature: raw body unavailable"
      );
    }
    const raw = request.rawBody;
    const expected = createHmac(
      "sha256",
      this.config.get("CHANNEL_WEBHOOK_SECRET", { infer: true })
    )
      .update(raw)
      .digest("hex");
    const supplied = suppliedSignature?.replace(/^sha256=/, "") ?? "";
    const suppliedBuf = Buffer.from(supplied.padEnd(expected.length, "\0"));
    const expectedBuf = Buffer.from(expected);
    const valid =
      supplied.length === expected.length &&
      timingSafeEqual(suppliedBuf, expectedBuf);
    if (!valid) {
      throw new UnauthorizedException("Invalid webhook signature");
    }
    const event = channelWebhookSchema.parse(request.body);
    try {
      const receipt = await this.prisma.webhookReceipt.create({
        data: {
          eventId: event.eventId,
          campaignId: event.campaignId,
          customerId: event.customerId,
          type: event.type,
          correlationId: event.correlationId,
          payload: toInputJson({
            ...event.payload,
            occurredAt: event.occurredAt
          })
        }
      });
      // Process receipt synchronously (no queue)
      await this.receipts.processReceipt({ ...event, receiptId: receipt.id });
      this.events.publish("monitor", {
        type: "webhook.received",
        receiptId: receipt.id,
        event
      });
      return { accepted: true, duplicate: false, receiptId: receipt.id };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return { accepted: true, duplicate: true };
      }
      throw error;
    }
  }
}
