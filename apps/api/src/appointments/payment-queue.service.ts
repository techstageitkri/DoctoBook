import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { createLogger } from "@doctobook/observability";
import {
  InitiatePaymentJob,
  PAYMENT_INITIATE_JOB,
  PAYMENT_INITIATION_QUEUE_NAME
} from "@doctobook/payments";

@Injectable()
export class PaymentQueueService implements OnModuleDestroy {
  private readonly logger = createLogger({
    service: "api",
    environment: process.env.NODE_ENV ?? "development"
  });
  private readonly queue = new Queue<InitiatePaymentJob>(PAYMENT_INITIATION_QUEUE_NAME, {
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

  async enqueuePaymentInitiation(input: InitiatePaymentJob) {
    const job = await this.queue.add(PAYMENT_INITIATE_JOB, input, {
      jobId: `payment-initiation|${input.paymentId}`
    });

    this.logger.info("queue.job.enqueued", {
      queue: PAYMENT_INITIATION_QUEUE_NAME,
      jobId: job.id ?? null,
      jobName: PAYMENT_INITIATE_JOB,
      paymentId: input.paymentId,
      appointmentId: input.appointmentId
    });

    return input;
  }
}
