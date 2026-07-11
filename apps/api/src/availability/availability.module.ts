import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { AvailabilityController } from "./availability.controller.js";
import { DoctorAvailabilityService } from "./availability.service.js";

@Module({
  imports: [AuditModule, AuthModule, AuthorizationModule],
  controllers: [AvailabilityController],
  providers: [DoctorAvailabilityService],
  exports: [DoctorAvailabilityService]
})
export class AvailabilityModule {}
