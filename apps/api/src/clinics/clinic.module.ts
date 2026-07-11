import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { SlotModule } from "../slots/slot.module.js";
import { ClinicController } from "./clinic.controller.js";
import { ClinicService } from "./clinic.service.js";

@Module({
  imports: [AuditModule, AuthModule, AuthorizationModule, SlotModule],
  controllers: [ClinicController],
  providers: [ClinicService],
  exports: [ClinicService]
})
export class ClinicModule {}
