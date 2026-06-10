import { Module } from "@nestjs/common";
import { SegmentCompilerService } from "./segment-compiler.service";
import { SegmentsController } from "./segments.controller";
import { SegmentsService } from "./segments.service";

@Module({
  controllers: [SegmentsController],
  providers: [SegmentsService, SegmentCompilerService],
  exports: [SegmentsService, SegmentCompilerService]
})
export class SegmentsModule {}
