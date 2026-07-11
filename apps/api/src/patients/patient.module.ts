import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PatientController } from "./patient.controller.js";
import { PatientService } from "./patient.service.js";

@Module({
  imports: [AuthModule],
  controllers: [PatientController],
  providers: [PatientService],
  exports: [PatientService]
})
export class PatientModule {}
