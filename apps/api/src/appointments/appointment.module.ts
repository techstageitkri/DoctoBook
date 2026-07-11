import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { NotificationModule } from "../notifications/notification.module.js";
import { ReviewModule } from "../reviews/review.module.js";
import { AppointmentOperationsController } from "./appointment-operations.controller.js";
import { AppointmentOperationsService } from "./appointment-operations.service.js";
import { AppointmentRescheduleService } from "./appointment-reschedule.service.js";
import { AppointmentController } from "./appointment.controller.js";
import { AppointmentBookingService } from "./appointment.service.js";
import { PaymentQueueService } from "./payment-queue.service.js";
import { RefundQueueService } from "./refund-queue.service.js";

@Module({
  imports: [AuthModule, AuthorizationModule, NotificationModule, ReviewModule],
  controllers: [AppointmentController, AppointmentOperationsController],
  providers: [
    AppointmentBookingService,
    AppointmentOperationsService,
    AppointmentRescheduleService,
    PaymentQueueService,
    RefundQueueService
  ],
  exports: [
    AppointmentBookingService,
    AppointmentOperationsService,
    AppointmentRescheduleService,
    RefundQueueService
  ]
})
export class AppointmentModule {}
