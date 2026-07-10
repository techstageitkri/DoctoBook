import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { DoctorController } from "./doctor.controller.js";
import { DoctorService } from "./doctor.service.js";

@Module({
  imports: [AuditModule, AuthModule, AuthorizationModule],
  controllers: [DoctorController],
  providers: [DoctorService],
  exports: [DoctorService]
})
export class DoctorModule {}
