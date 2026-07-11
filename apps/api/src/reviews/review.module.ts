import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { NotificationModule } from "../notifications/notification.module.js";
import { ReviewController } from "./review.controller.js";
import { ReviewService } from "./review.service.js";

@Module({
  imports: [AuthModule, AuthorizationModule, NotificationModule],
  controllers: [ReviewController],
  providers: [ReviewService],
  exports: [ReviewService]
})
export class ReviewModule {}
