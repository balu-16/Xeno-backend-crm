import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { EventsModule } from "../events/events.module";
import { MonitorController } from "./monitor.controller";

@Module({
  imports: [AuthModule, EventsModule],
  controllers: [MonitorController]
})
export class MonitorModule {}
