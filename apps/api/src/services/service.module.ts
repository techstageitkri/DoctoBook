import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { SlotModule } from "../slots/slot.module.js";
import { ServiceController } from "./service.controller.js";
import { AppointmentServiceConfigService } from "./service.service.js";

@Module({
  imports: [AuditModule, AuthModule, AuthorizationModule, SlotModule],
  controllers: [ServiceController],
  providers: [AppointmentServiceConfigService],
  exports: [AppointmentServiceConfigService]
})
export class ServiceConfigModule {}
