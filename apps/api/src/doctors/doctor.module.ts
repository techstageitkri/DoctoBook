import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { NotificationModule } from "../notifications/notification.module.js";
import { SlotModule } from "../slots/slot.module.js";
import { DoctorController } from "./doctor.controller.js";
import { DoctorService } from "./doctor.service.js";

@Module({
  imports: [AuditModule, AuthModule, AuthorizationModule, NotificationModule, SlotModule],
  controllers: [DoctorController],
  providers: [DoctorService],
  exports: [DoctorService]
})
export class DoctorModule {}
