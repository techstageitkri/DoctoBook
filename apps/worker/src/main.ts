import { Job, Queue, QueueEvents, Worker } from "bullmq";
import { parseWorkerEnv } from "@doctobook/config";
import { AppointmentStatus, ClinicAssociationStatus, PrismaClient, ScopeType } from "@doctobook/database";
import {
  DispatchNotificationJob,
  NOTIFICATION_DISPATCH_JOB,
  NOTIFICATION_DISPATCH_QUEUE_NAME,
  NOTIFICATION_SCHEDULE_REMINDERS_JOB,
  createNotificationLogs,
  dispatchNotificationLog,
  getNotificationDispatchJobId
} from "@doctobook/notifications";
import {
  InitiatePaymentJob,
  PAYMENT_INITIATE_JOB,
  PAYMENT_INITIATION_QUEUE_NAME,
  ProcessRefundJob,
  REFUND_PROCESSING_QUEUE_NAME,
  REFUND_PROCESS_JOB,
  initiateStoredPayment,
  processStoredRefund
} from "@doctobook/payments";
import {
  DEFAULT_SLOT_GENERATION_DAYS,
  GenerateSlotsJob,
  SLOT_GENERATE_RANGE_JOB,
  SLOT_GENERATION_QUEUE_NAME,
  SLOT_REGENERATE_ASSOCIATION_JOB,
  SLOT_REGENERATE_LOCATION_JOB,
  SLOT_SCHEDULED_GENERATION_JOB,
  SlotGenerationService,
  addDaysToDateString,
  getSlotGenerationJobId,
  getTodayDateString
} from "@doctobook/slots";
import { expirePaymentHolds } from "./payment-holds.js";

const env = parseWorkerEnv(process.env);
const connection = {
  url: env.REDIS_URL
};
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: env.DATABASE_URL
    }
  }
});
const slotGenerationService = new SlotGenerationService(prisma);

type SlotWorkerJob = GenerateSlotsJob | { clinicLocationId: string } | Record<string, never>;

const HOLD_EXPIRATION_QUEUE_NAME = "payment-hold-expiration";
const EXPIRE_PAYMENT_HOLDS_JOB = "payment-holds.expire";
const SCHEDULE_REFUND_PROCESSING_JOB = "refunds.schedule";
const REMINDER_SCAN_WINDOW_MINUTES = 15;

export const slotGenerationQueue = new Queue<SlotWorkerJob>(SLOT_GENERATION_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000
    },
    removeOnComplete: 1000,
    removeOnFail: 5000
  }
});
const queueEvents = new QueueEvents(SLOT_GENERATION_QUEUE_NAME, { connection });
const paymentInitiationQueueEvents = new QueueEvents(PAYMENT_INITIATION_QUEUE_NAME, { connection });
const refundProcessingQueue = new Queue<ProcessRefundJob | Record<string, never>>(
  REFUND_PROCESSING_QUEUE_NAME,
  {
    connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 10000
      },
      removeOnComplete: 1000,
      removeOnFail: 5000
    }
  }
);
const refundProcessingQueueEvents = new QueueEvents(REFUND_PROCESSING_QUEUE_NAME, { connection });
const notificationDispatchQueue = new Queue<
  DispatchNotificationJob | Record<string, never>
>(NOTIFICATION_DISPATCH_QUEUE_NAME, {
  connection,
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
const notificationDispatchQueueEvents = new QueueEvents(NOTIFICATION_DISPATCH_QUEUE_NAME, {
  connection
});
const holdExpirationQueue = new Queue<Record<string, never>>(HOLD_EXPIRATION_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000
    },
    removeOnComplete: 1000,
    removeOnFail: 5000
  }
});
const holdExpirationQueueEvents = new QueueEvents(HOLD_EXPIRATION_QUEUE_NAME, { connection });
const slotWorker = new Worker(
  SLOT_GENERATION_QUEUE_NAME,
  async (job: Job<SlotWorkerJob>) => {
    if (job.name === SLOT_GENERATE_RANGE_JOB || job.name === SLOT_REGENERATE_ASSOCIATION_JOB) {
      return slotGenerationService.generateRange(job.data as GenerateSlotsJob);
    }

    if (job.name === SLOT_REGENERATE_LOCATION_JOB) {
      const payload = job.data as unknown as { clinicLocationId: string };
      return enqueueLocationRegeneration(payload.clinicLocationId);
    }

    if (job.name === SLOT_SCHEDULED_GENERATION_JOB) {
      return enqueueScheduledRegeneration();
    }

    throw new Error(`Unsupported slot-generation job ${job.name}`);
  },
  {
    connection,
    concurrency: 2
  }
);
const paymentInitiationWorker = new Worker(
  PAYMENT_INITIATION_QUEUE_NAME,
  async (job: Job<InitiatePaymentJob>) => {
    if (job.name !== PAYMENT_INITIATE_JOB) {
      throw new Error(`Unsupported payment-initiation job ${job.name}`);
    }

    return initiateStoredPayment(prisma, job.data.paymentId, process.env);
  },
  {
    connection,
    concurrency: 4
  }
);
const refundProcessingWorker = new Worker(
  REFUND_PROCESSING_QUEUE_NAME,
  async (job: Job<ProcessRefundJob | Record<string, never>>) => {
    if (job.name === SCHEDULE_REFUND_PROCESSING_JOB) {
      return enqueueRequestedRefunds();
    }

    if (job.name !== REFUND_PROCESS_JOB) {
      throw new Error(`Unsupported refund-processing job ${job.name}`);
    }

    const payload = job.data as ProcessRefundJob;

    try {
      const result = await processStoredRefund(prisma, payload.refundId, process.env);

      if (result.processed) {
        await enqueueRefundNotification(payload.refundId, "refund.completed");
      }

      return result;
    } catch (error) {
      await enqueueRefundNotification(payload.refundId, "refund.failed");
      throw error;
    }
  },
  {
    connection,
    concurrency: 2
  }
);
const notificationDispatchWorker = new Worker(
  NOTIFICATION_DISPATCH_QUEUE_NAME,
  async (job: Job<DispatchNotificationJob | Record<string, never>>) => {
    if (job.name === NOTIFICATION_SCHEDULE_REMINDERS_JOB) {
      return enqueueAppointmentReminders();
    }

    if (job.name !== NOTIFICATION_DISPATCH_JOB) {
      throw new Error(`Unsupported notification job ${job.name}`);
    }

    const payload = job.data as DispatchNotificationJob;

    return dispatchNotificationLog(prisma, payload.notificationLogId, process.env);
  },
  {
    connection,
    concurrency: 8
  }
);
const holdExpirationWorker = new Worker(
  HOLD_EXPIRATION_QUEUE_NAME,
  async (job: Job<Record<string, never>>) => {
    if (job.name !== EXPIRE_PAYMENT_HOLDS_JOB) {
      throw new Error(`Unsupported hold-expiration job ${job.name}`);
    }

    return expirePaymentHolds(prisma);
  },
  {
    connection,
    concurrency: 1
  }
);

queueEvents.on("failed", ({ jobId, failedReason }) => {
  console.error("Slot generation job failed", { jobId, failedReason });
});

queueEvents.on("completed", ({ jobId }) => {
  console.log("Slot generation job completed", { jobId });
});

paymentInitiationQueueEvents.on("failed", ({ jobId, failedReason }) => {
  console.error("Payment initiation job failed", { jobId, failedReason });
});

paymentInitiationQueueEvents.on("completed", ({ jobId }) => {
  console.log("Payment initiation job completed", { jobId });
});

refundProcessingQueueEvents.on("failed", ({ jobId, failedReason }) => {
  console.error("Refund processing job failed", { jobId, failedReason });
});

refundProcessingQueueEvents.on("completed", ({ jobId }) => {
  console.log("Refund processing job completed", { jobId });
});

notificationDispatchQueueEvents.on("failed", ({ jobId, failedReason }) => {
  console.error("Notification job failed", { jobId, failedReason });
});

notificationDispatchQueueEvents.on("completed", ({ jobId }) => {
  console.log("Notification job completed", { jobId });
});

holdExpirationQueueEvents.on("failed", ({ jobId, failedReason }) => {
  console.error("Payment hold expiration job failed", { jobId, failedReason });
});

holdExpirationQueueEvents.on("completed", ({ jobId }) => {
  console.log("Payment hold expiration job completed", { jobId });
});

await prisma.$connect();
await scheduleRollingGeneration();
await schedulePaymentHoldExpiration();
await scheduleRefundProcessing();
await scheduleAppointmentReminders();

console.log("DoctoBook worker started");

async function enqueueScheduledRegeneration() {
  const associations = await prisma.doctorClinic.findMany({
    where: {
      deletedAt: null,
      status: ClinicAssociationStatus.APPROVED
    },
    select: { id: true }
  });
  const fromDate = getTodayDateString();
  const toDate = addDaysToDateString(fromDate, DEFAULT_SLOT_GENERATION_DAYS);

  for (const association of associations) {
    const payload: GenerateSlotsJob = {
      doctorClinicId: association.id,
      fromDate,
      toDate,
      reason: "scheduled"
    };

    await slotGenerationQueue.add(SLOT_GENERATE_RANGE_JOB, payload, {
      jobId: getSlotGenerationJobId(payload)
    });
  }

  return { queued: associations.length };
}

async function enqueueLocationRegeneration(clinicLocationId: string) {
  const associations = await prisma.doctorClinic.findMany({
    where: {
      clinicLocationId,
      deletedAt: null
    },
    select: { id: true }
  });
  const fromDate = getTodayDateString();
  const toDate = addDaysToDateString(fromDate, DEFAULT_SLOT_GENERATION_DAYS);

  for (const association of associations) {
    const payload: GenerateSlotsJob = {
      doctorClinicId: association.id,
      fromDate,
      toDate,
      reason: "clinic_hours_changed"
    };

    await slotGenerationQueue.add(SLOT_GENERATE_RANGE_JOB, payload, {
      jobId: getSlotGenerationJobId(payload)
    });
  }

  return { queued: associations.length };
}

async function scheduleRollingGeneration() {
  await slotGenerationQueue.add(
    SLOT_SCHEDULED_GENERATION_JOB,
    {},
    {
      jobId: "slot-generation|scheduled",
      repeat: {
        every: 60 * 60 * 1000
      }
    }
  );
}

async function schedulePaymentHoldExpiration() {
  await holdExpirationQueue.add(
    EXPIRE_PAYMENT_HOLDS_JOB,
    {},
    {
      jobId: "payment-holds|expire",
      repeat: {
        every: 60 * 1000
      }
    }
  );
}

async function scheduleRefundProcessing() {
  await refundProcessingQueue.add(
    SCHEDULE_REFUND_PROCESSING_JOB,
    {},
    {
      jobId: "refunds|schedule",
      repeat: {
        every: 2 * 60 * 1000
      }
    }
  );
}

async function scheduleAppointmentReminders() {
  await notificationDispatchQueue.add(
    NOTIFICATION_SCHEDULE_REMINDERS_JOB,
    {},
    {
      jobId: "notification-reminders|schedule",
      repeat: {
        every: 15 * 60 * 1000
      }
    }
  );
}

async function enqueueAppointmentReminders() {
  const offsets = await getReminderOffsetsMinutes();
  let queued = 0;

  for (const offsetMinutes of offsets) {
    const now = new Date();
    const windowStart = new Date(
      now.getTime() + (offsetMinutes - REMINDER_SCAN_WINDOW_MINUTES) * 60 * 1000
    );
    const windowEnd = new Date(
      now.getTime() + (offsetMinutes + REMINDER_SCAN_WINDOW_MINUTES) * 60 * 1000
    );
    const appointments = await prisma.appointment.findMany({
      where: {
        status: AppointmentStatus.CONFIRMED,
        startsAt: {
          gte: windowStart,
          lt: windowEnd
        }
      },
      include: {
        patient: {
          select: { userId: true }
        },
        clinic: {
          select: { id: true, name: true }
        },
        clinicLocation: {
          select: { name: true, city: true, timezone: true }
        },
        doctor: {
          include: {
            user: {
              select: { fullName: true }
            }
          }
        }
      },
      take: 500
    });

    for (const appointment of appointments) {
      const result = await createNotificationLogs(prisma, {
        eventCode: "appointment.reminder",
        userId: appointment.patient.userId,
        appointmentId: appointment.id,
        clinicId: appointment.clinicId,
        idempotencyKeySuffix: `${appointment.id}|${offsetMinutes}`,
        variables: {
          appointment: {
            id: appointment.id,
            number: appointment.appointmentNumber,
            serviceName: appointment.serviceNameSnapshot,
            startsAt: appointment.startsAt.toISOString(),
            endsAt: appointment.endsAt.toISOString()
          },
          doctor: {
            name: appointment.doctor.user.fullName
          },
          clinic: {
            name: appointment.clinic.name,
            locationName: appointment.clinicLocation.name,
            city: appointment.clinicLocation.city,
            timezone: appointment.clinicLocation.timezone
          },
          reminder: {
            offsetMinutes
          }
        }
      });

      for (const log of result.logs) {
        await notificationDispatchQueue.add(
          NOTIFICATION_DISPATCH_JOB,
          { notificationLogId: log.id },
          {
            jobId: getNotificationDispatchJobId(log.id)
          }
        );
        queued += 1;
      }
    }
  }

  return { queued };
}

async function getReminderOffsetsMinutes() {
  const setting = await prisma.systemSetting.findFirst({
    where: {
      scopeType: ScopeType.PLATFORM,
      scopeId: null,
      key: "notification.reminder_offsets_minutes"
    },
    select: { value: true }
  });
  const offsets =
    setting?.value && typeof setting.value === "object" && "offsets" in setting.value
      ? (setting.value.offsets as unknown)
      : null;

  if (!Array.isArray(offsets)) {
    return [1440, 120];
  }

  const parsed = offsets
    .map((offset) => Number(offset))
    .filter((offset) => Number.isInteger(offset) && offset > 0);

  return parsed.length > 0 ? parsed : [1440, 120];
}

async function enqueueRefundNotification(refundId: string, eventCode: string) {
  const refund = await prisma.refund.findUnique({
    where: { id: refundId },
    include: {
      appointment: {
        include: {
          patient: {
            select: { userId: true }
          },
          clinic: {
            select: { id: true, name: true }
          },
          clinicLocation: {
            select: { name: true, city: true, timezone: true }
          },
          doctor: {
            include: {
              user: {
                select: { fullName: true }
              }
            }
          }
        }
      }
    }
  });

  if (!refund) {
    return { queued: 0 };
  }

  const result = await createNotificationLogs(prisma, {
    eventCode,
    userId: refund.appointment.patient.userId,
    appointmentId: refund.appointmentId,
    clinicId: refund.appointment.clinicId,
    idempotencyKeySuffix: refund.id,
    variables: {
      appointment: {
        id: refund.appointment.id,
        number: refund.appointment.appointmentNumber,
        serviceName: refund.appointment.serviceNameSnapshot,
        startsAt: refund.appointment.startsAt.toISOString()
      },
      refund: {
        id: refund.id,
        amountMinor: refund.amountMinor.toString(),
        currency: refund.currency,
        status: refund.status.toLowerCase()
      },
      doctor: {
        name: refund.appointment.doctor.user.fullName
      },
      clinic: {
        name: refund.appointment.clinic.name,
        locationName: refund.appointment.clinicLocation.name,
        city: refund.appointment.clinicLocation.city,
        timezone: refund.appointment.clinicLocation.timezone
      }
    }
  });

  for (const log of result.logs) {
    await notificationDispatchQueue.add(
      NOTIFICATION_DISPATCH_JOB,
      { notificationLogId: log.id },
      {
        jobId: getNotificationDispatchJobId(log.id)
      }
    );
  }

  return { queued: result.logs.length };
}

async function enqueueRequestedRefunds() {
  const refunds = await prisma.refund.findMany({
    where: {
      status: {
        in: ["REQUESTED", "APPROVED"]
      }
    },
    select: { id: true },
    take: 100,
    orderBy: { requestedAt: "asc" }
  });

  for (const refund of refunds) {
    await refundProcessingQueue.add(
      REFUND_PROCESS_JOB,
      { refundId: refund.id },
      {
        jobId: `refund-processing|${refund.id}`
      }
    );
  }

  return { queued: refunds.length };
}

async function shutdown() {
  await slotWorker.close();
  await paymentInitiationWorker.close();
  await refundProcessingWorker.close();
  await notificationDispatchWorker.close();
  await holdExpirationWorker.close();
  await queueEvents.close();
  await paymentInitiationQueueEvents.close();
  await refundProcessingQueueEvents.close();
  await notificationDispatchQueueEvents.close();
  await holdExpirationQueueEvents.close();
  await slotGenerationQueue.close();
  await refundProcessingQueue.close();
  await notificationDispatchQueue.close();
  await holdExpirationQueue.close();
  await prisma.$disconnect();
}

process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});
