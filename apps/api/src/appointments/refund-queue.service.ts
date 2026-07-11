import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { createLogger } from "@doctobook/observability";
import {
  ProcessRefundJob,
  REFUND_PROCESSING_QUEUE_NAME,
  REFUND_PROCESS_JOB
} from "@doctobook/payments";

@Injectable()
export class RefundQueueService implements OnModuleDestroy {
  private readonly logger = createLogger({
    service: "api",
    environment: process.env.NODE_ENV ?? "development"
  });
  private readonly queue = new Queue<ProcessRefundJob>(REFUND_PROCESSING_QUEUE_NAME, {
    connection: {
      url: process.env.REDIS_URL ?? "redis://localhost:6379"
    },
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 10000
      },
      removeOnComplete: 1000,
      removeOnFail: 5000
    }
  });

  async onModuleDestroy() {
    await this.queue.close();
  }

  async enqueueRefundProcessing(input: ProcessRefundJob) {
    const job = await this.queue.add(REFUND_PROCESS_JOB, input, {
      jobId: `refund-processing|${input.refundId}`
    });

    this.logger.info("queue.job.enqueued", {
      queue: REFUND_PROCESSING_QUEUE_NAME,
      jobId: job.id ?? null,
      jobName: REFUND_PROCESS_JOB,
      refundId: input.refundId
    });

    return input;
  }
}
