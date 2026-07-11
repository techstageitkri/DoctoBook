import { Module } from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { AppointmentModule } from "./appointments/appointment.module.js";
import { AvailabilityModule } from "./availability/availability.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { AuthorizationModule } from "./authorization/authorization.module.js";
import { ClinicModule } from "./clinics/clinic.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { DoctorModule } from "./doctors/doctor.module.js";
import { NotificationModule } from "./notifications/notification.module.js";
import { PaymentModule } from "./payments/payment.module.js";
import { PatientModule } from "./patients/patient.module.js";
import { PublicMarketplaceModule } from "./public/public-marketplace.module.js";
import { ReportModule } from "./reports/report.module.js";
import { RefundModule } from "./refunds/refund.module.js";
import { ReviewModule } from "./reviews/review.module.js";
import { SecurityModule } from "./security/security.module.js";
import { ServiceConfigModule } from "./services/service.module.js";
import { SlotModule } from "./slots/slot.module.js";

@Module({
  imports: [
    DatabaseModule,
    SecurityModule,
    AuthModule,
    AuthorizationModule,
    ClinicModule,
    DoctorModule,
    AvailabilityModule,
    ServiceConfigModule,
    SlotModule,
    PublicMarketplaceModule,
    NotificationModule,
    PaymentModule,
    PatientModule,
    AppointmentModule,
    ReviewModule,
    ReportModule,
    RefundModule
  ],
  controllers: [AppController]
})
export class AppModule {}
