import { Controller, Get, Param, Query } from "@nestjs/common";
import { paginationQuerySchema } from "../contracts";
import { CustomersService } from "./customers.service";

@Controller("customers")
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@Query() query: Record<string, string | undefined>) {
    return this.customers.list(paginationQuerySchema.parse(query));
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.customers.get(id);
  }

  @Get(":id/login-logs")
  getLoginLogs(@Param("id") id: string) {
    return this.customers.getLoginLogs(id);
  }
}
