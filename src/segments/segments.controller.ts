import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { paginationQuerySchema } from "../contracts";
import {
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength
} from "class-validator";
import { SegmentsService } from "./segments.service";

class CreateSegmentDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsObject()
  rules!: Record<string, unknown>;
}

class UpdateSegmentNameDto {
  @IsString()
  @Length(2, 120)
  name!: string;
}

class PreviewSegmentDto {
  @IsObject()
  rules!: Record<string, unknown>;
}

@Controller("segments")
export class SegmentsController {
  constructor(private readonly segments: SegmentsService) {}

  @Get()
  list(@Query() query: Record<string, string | undefined>) {
    return this.segments.list(paginationQuerySchema.parse(query));
  }

  @Post()
  create(@Body() input: CreateSegmentDto) {
    return this.segments.create(input);
  }

  @Post("preview")
  preview(
    @Body() input: PreviewSegmentDto,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20"
  ) {
    return this.segments.preview(
      input.rules,
      Math.max(1, Number(page)),
      Math.min(100, Math.max(1, Number(pageSize)))
    );
  }

  @Patch(":id")
  updateName(@Param("id") id: string, @Body() input: UpdateSegmentNameDto) {
    return this.segments.updateName(id, input.name);
  }
}
