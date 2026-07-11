import { Module } from "@nestjs/common";
import { AppointmentModule } from "../appointments/appointment.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { NotificationModule } from "../notifications/notification.module.js";
import { RefundController } from "./refund.controller.js";
import { RefundRecoveryService } from "./refund.service.js";

@Module({
  imports: [AuthModule, AuthorizationModule, AppointmentModule, NotificationModule],
  controllers: [RefundController],
  providers: [RefundRecoveryService],
  exports: [RefundRecoveryService]
})
export class RefundModule {}
