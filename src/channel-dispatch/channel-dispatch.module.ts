import { Module } from "@nestjs/common";
import { ChannelDispatchService } from "./channel-dispatch.service";

@Module({
  providers: [ChannelDispatchService],
  exports: [ChannelDispatchService]
})
export class ChannelDispatchModule {}
