import { Injectable, NotFoundException, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import {
  DEFAULT_SLOT_GENERATION_DAYS,
  GenerateSlotsJob,
  SlotGenerationReason,
  SLOT_GENERATE_RANGE_JOB,
  SLOT_GENERATION_QUEUE_NAME,
  addDaysToDateString,
  getSlotGenerationJobId,
  getTodayDateString
} from "@doctobook/slots";
import { ClinicAssociationStatus } from "@doctobook/database";
import { PrismaService } from "../database/prisma.service.js";

type EnqueueOptions = {
  fromDate?: string;
  toDate?: string;
  reason: SlotGenerationReason;
};

@Injectable()
export class SlotQueueService implements OnModuleDestroy {
  private readonly queue = new Queue<GenerateSlotsJob>(SLOT_GENERATION_QUEUE_NAME, {
    connection: {
      url: process.env.REDIS_URL ?? "redis://localhost:6379"
    },
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

  constructor(private readonly prisma: PrismaService) {}

  async onModuleDestroy() {
    await this.queue.close();
  }

  async enqueueAssociation(doctorClinicId: string, options: EnqueueOptions) {
    const payload = this.buildGeneratePayload(doctorClinicId, options);
    const jobId = getSlotGenerationJobId(payload);

    await this.queue.add(SLOT_GENERATE_RANGE_JOB, payload, {
      jobId
    });

    return { jobId, ...payload };
  }

  async enqueueAssociations(doctorClinicIds: string[], options: EnqueueOptions) {
    const uniqueIds = [...new Set(doctorClinicIds)];
    const jobs = [];

    for (const doctorClinicId of uniqueIds) {
      jobs.push(await this.enqueueAssociation(doctorClinicId, options));
    }

    return { jobs };
  }

  async enqueueAllApproved(options: EnqueueOptions) {
    const associations = await this.prisma.doctorClinic.findMany({
      where: {
        deletedAt: null,
        status: ClinicAssociationStatus.APPROVED
      },
      select: { id: true }
    });

    return this.enqueueAssociations(
      associations.map((association) => association.id),
      options
    );
  }

  async enqueueClinic(clinicId: string, options: EnqueueOptions) {
    const associations = await this.prisma.doctorClinic.findMany({
      where: {
        clinicId,
        deletedAt: null
      },
      select: { id: true }
    });

    return this.enqueueAssociations(
      associations.map((association) => association.id),
      options
    );
  }

  async enqueueDoctor(doctorId: string, options: EnqueueOptions) {
    const associations = await this.prisma.doctorClinic.findMany({
      where: {
        doctorId,
        deletedAt: null
      },
      select: { id: true }
    });

    return this.enqueueAssociations(
      associations.map((association) => association.id),
      options
    );
  }

  async enqueueLocation(clinicLocationId: string, options: EnqueueOptions) {
    const associations = await this.prisma.doctorClinic.findMany({
      where: {
        clinicLocationId,
        deletedAt: null
      },
      select: { id: true }
    });

    return this.enqueueAssociations(
      associations.map((association) => association.id),
      options
    );
  }

  async enqueueClinicService(clinicServiceId: string, options: EnqueueOptions) {
    const associations = await this.prisma.doctorClinic.findMany({
      where: {
        deletedAt: null,
        doctorClinicServices: {
          some: { clinicServiceId }
        }
      },
      select: { id: true }
    });

    return this.enqueueAssociations(
      associations.map((association) => association.id),
      options
    );
  }

  async enqueueDoctorClinicService(doctorClinicServiceId: string, options: EnqueueOptions) {
    const doctorClinicService = await this.prisma.doctorClinicService.findUnique({
      where: { id: doctorClinicServiceId },
      select: { doctorClinicId: true }
    });

    if (!doctorClinicService) {
      return { jobs: [] };
    }

    return this.enqueueAssociations([doctorClinicService.doctorClinicId], options);
  }

  async getJob(jobId: string) {
    const job = await this.queue.getJob(jobId);

    if (!job) {
      throw new NotFoundException("Slot generation job not found");
    }

    return {
      id: job.id,
      name: job.name,
      data: job.data,
      progress: job.progress,
      returnValue: job.returnvalue,
      failedReason: job.failedReason,
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      state: await job.getState()
    };
  }

  private buildGeneratePayload(doctorClinicId: string, options: EnqueueOptions): GenerateSlotsJob {
    const fromDate = options.fromDate ?? getTodayDateString();
    const toDate = options.toDate ?? addDaysToDateString(fromDate, DEFAULT_SLOT_GENERATION_DAYS);

    return {
      doctorClinicId,
      fromDate,
      toDate,
      reason: options.reason
    };
  }
}
