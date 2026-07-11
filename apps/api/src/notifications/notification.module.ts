import { Module, forwardRef } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { NotificationController } from "./notification.controller.js";
import { NotificationQueueService } from "./notification-queue.service.js";
import { NotificationService } from "./notification.service.js";

@Module({
  imports: [forwardRef(() => AuthModule), AuthorizationModule],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationQueueService],
  exports: [NotificationService, NotificationQueueService]
})
export class NotificationModule {}
