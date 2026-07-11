import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import {
  DispatchNotificationJob,
  NOTIFICATION_DISPATCH_JOB,
  NOTIFICATION_DISPATCH_QUEUE_NAME,
  getNotificationDispatchJobId
} from "@doctobook/notifications";

@Injectable()
export class NotificationQueueService implements OnModuleDestroy {
  private readonly queue = new Queue<DispatchNotificationJob>(NOTIFICATION_DISPATCH_QUEUE_NAME, {
    connection: {
      url: process.env.REDIS_URL ?? "redis://localhost:6379"
    },
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 5000
      },
      removeOnComplete: 1000,
      removeOnFail: 5000
    }
  });

  async onModuleDestroy() {
    await this.queue.close();
  }

  async enqueueDispatch(notificationLogId: string) {
    await this.queue.add(
      NOTIFICATION_DISPATCH_JOB,
      { notificationLogId },
      {
        jobId: getNotificationDispatchJobId(notificationLogId)
      }
    );
  }
}
