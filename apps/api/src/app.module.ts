import { Module } from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { AuthModule } from "./auth/auth.module.js";
import { AuthorizationModule } from "./authorization/authorization.module.js";
import { ClinicModule } from "./clinics/clinic.module.js";
import { DatabaseModule } from "./database/database.module.js";

@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule, ClinicModule],
  controllers: [AppController]
})
export class AppModule {}
