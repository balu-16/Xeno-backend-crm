import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
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
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsObject()
  rules?: Record<string, unknown>;
}

class PreviewSegmentDto {
  @IsObject()
  rules!: Record<string, unknown>;
}

@Controller("segments")
@UseGuards(AuthGuard, RolesGuard)
export class SegmentsController {
  constructor(private readonly segments: SegmentsService) {}

  @Get()
  list(@Query() query: Record<string, string | undefined>) {
    return this.segments.list(paginationQuerySchema.parse(query));
  }

  @Post()
  @Roles("ADMIN", "MANAGER")
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

  @Get(":id")
  get(@Param("id") id: string) {
    return this.segments.get(id);
  }

  @Get(":id/customer-count")
  countCustomers(@Param("id") id: string) {
    return this.segments.countCustomers(id);
  }

  @Patch(":id")
  @Roles("ADMIN", "MANAGER")
  update(@Param("id") id: string, @Body() input: UpdateSegmentNameDto) {
    return this.segments.update(id, input);
  }

  @Delete(":id")
  @Roles("ADMIN")
  remove(@Param("id") id: string) {
    return this.segments.remove(id);
  }
}
