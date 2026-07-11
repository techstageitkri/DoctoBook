import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { createLogger } from "@doctobook/observability";
import {
  DispatchNotificationJob,
  NOTIFICATION_DISPATCH_JOB,
  NOTIFICATION_DISPATCH_QUEUE_NAME,
  getNotificationDispatchJobId
} from "@doctobook/notifications";

@Injectable()
export class NotificationQueueService implements OnModuleDestroy {
  private readonly logger = createLogger({
    service: "api",
    environment: process.env.NODE_ENV ?? "development"
  });
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
    const job = await this.queue.add(
      NOTIFICATION_DISPATCH_JOB,
      { notificationLogId },
      {
        jobId: getNotificationDispatchJobId(notificationLogId)
      }
    );

    this.logger.info("queue.job.enqueued", {
      queue: NOTIFICATION_DISPATCH_QUEUE_NAME,
      jobId: job.id ?? null,
      jobName: NOTIFICATION_DISPATCH_JOB,
      notificationLogId
    });
  }
}
