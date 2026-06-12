import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { paginationQuerySchema } from "../contracts";
import {
  IsArray,
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength
} from "class-validator";
import { CustomersService } from "./customers.service";

class CreateCustomerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(20)
  phone!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

@Controller("customers")
@UseGuards(AuthGuard, RolesGuard)
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@Query() query: Record<string, string | undefined>) {
    return this.customers.list(paginationQuerySchema.parse(query), {
      tag: query.tag
    });
  }

  @Post()
  @Roles("ADMIN", "MANAGER")
  create(@Body() input: CreateCustomerDto) {
    return this.customers.create(input);
  }

  @Get("tags")
  getTags() {
    return this.customers.getTags();
  }

  @Get("email/:email")
  getByEmail(@Param("email") email: string) {
    return this.customers.getByEmail(email);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.customers.get(id);
  }

  @Patch(":id")
  @Roles("ADMIN", "MANAGER")
  update(@Param("id") id: string, @Body() input: UpdateCustomerDto) {
    return this.customers.update(id, input);
  }

  @Delete(":id")
  @Roles("ADMIN")
  remove(@Param("id") id: string) {
    return this.customers.remove(id);
  }

  @Get(":id/communications")
  getCommunications(@Param("id") id: string) {
    return this.customers.getCommunications(id);
  }

  @Get(":id/login-logs")
  getLoginLogs(@Param("id") id: string) {
    return this.customers.getLoginLogs(id);
  }
}
