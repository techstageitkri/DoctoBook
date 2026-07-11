import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { ReportController } from "./report.controller.js";
import { ReportService } from "./report.service.js";

@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [ReportController],
  providers: [ReportService],
  exports: [ReportService]
})
export class ReportModule {}
