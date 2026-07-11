import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { SlotController } from "./slot.controller.js";
import { SlotQueueService } from "./slot-queue.service.js";

@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [SlotController],
  providers: [SlotQueueService],
  exports: [SlotQueueService]
})
export class SlotModule {}
