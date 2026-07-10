import { Module } from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { AuthModule } from "./auth/auth.module.js";
import { AuthorizationModule } from "./authorization/authorization.module.js";
import { ClinicModule } from "./clinics/clinic.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { DoctorModule } from "./doctors/doctor.module.js";
import { ServiceConfigModule } from "./services/service.module.js";

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    AuthorizationModule,
    ClinicModule,
    DoctorModule,
    ServiceConfigModule
  ],
  controllers: [AppController]
})
export class AppModule {}
