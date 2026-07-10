import { Injectable } from "@nestjs/common";
import { Prisma } from "@doctobook/database";
import { PrismaService } from "../database/prisma.service.js";

type AuditInput = {
  actorUserId?: string | null;
  actorRole?: string | null;
  actionCode: string;
  entityType: string;
  entityId?: string | null;
  clinicId?: string | null;
  patientId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
  beforeData?: Prisma.InputJsonValue;
  afterData?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput) {
    await this.prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        actorRole: input.actorRole ?? null,
        actionCode: input.actionCode,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        clinicId: input.clinicId ?? null,
        patientId: input.patientId ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        correlationId: input.correlationId ?? null,
        beforeData: input.beforeData,
        afterData: input.afterData,
        metadata: input.metadata
      }
    });
  }
}
