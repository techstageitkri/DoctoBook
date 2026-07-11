import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import { ZodSchema } from "zod";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { RequestWithUser } from "../auth/auth.types.js";
import { AuthorizationService } from "../authorization/authorization.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { regenerateSlotsSchema } from "./slot.schemas.js";
import { SlotQueueService } from "./slot-queue.service.js";

@UseGuards(AccessTokenGuard)
@Controller("v1")
export class SlotController {
  constructor(
    private readonly slotQueueService: SlotQueueService,
    private readonly authorizationService: AuthorizationService,
    private readonly prisma: PrismaService
  ) {}

  @Post("admin/slots/regenerate")
  async regenerateAdminSlots(@Body() body: unknown, @Req() request: RequestWithUser) {
    const actor = this.requireUser(request);
    await this.assertCan(actor, "availability.manage", "platform", null);
    const input = this.parseBody(regenerateSlotsSchema, body);

    if (input.doctorClinicId) {
      return this.slotQueueService.enqueueAssociation(input.doctorClinicId, input);
    }

    return this.slotQueueService.enqueueAllApproved(input);
  }

  @Post("clinics/:clinicId/slots/regenerate")
  async regenerateClinicSlots(
    @Param("clinicId") clinicId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    const actor = this.requireUser(request);
    await this.assertCan(actor, "availability.manage", "clinic", clinicId);
    const input = this.parseBody(regenerateSlotsSchema, body);

    if (input.doctorClinicId) {
      await this.assertDoctorClinicBelongsToClinic(input.doctorClinicId, clinicId);
      return this.slotQueueService.enqueueAssociation(input.doctorClinicId, input);
    }

    return this.slotQueueService.enqueueClinic(clinicId, input);
  }

  @Get("admin/slot-jobs/:jobId")
  async getJob(@Param("jobId") jobId: string, @Req() request: RequestWithUser) {
    const actor = this.requireUser(request);
    await this.assertCan(actor, "availability.manage", "platform", null);

    return this.slotQueueService.getJob(jobId);
  }

  private parseBody<T>(schema: ZodSchema<T>, body: unknown): T {
    const result = schema.safeParse(body);

    if (!result.success) {
      throw new BadRequestException({
        message: "Invalid request",
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      });
    }

    return result.data;
  }

  private requireUser(request: RequestWithUser) {
    if (!request.user) {
      throw new BadRequestException("Missing authenticated user");
    }

    return request.user;
  }

  private async assertCan(
    actor: NonNullable<RequestWithUser["user"]>,
    permissionCode: string,
    scope: "platform" | "clinic",
    scopeId: string | null
  ) {
    const allowed = await this.authorizationService.can(actor, permissionCode, {
      scope,
      scopeId
    });

    if (!allowed) {
      throw new ForbiddenException("Missing required permission");
    }
  }

  private async assertDoctorClinicBelongsToClinic(doctorClinicId: string, clinicId: string) {
    const doctorClinic = await this.prisma.doctorClinic.findFirst({
      where: {
        id: doctorClinicId,
        clinicId,
        deletedAt: null
      },
      select: { id: true }
    });

    if (!doctorClinic) {
      throw new BadRequestException("Doctor clinic association does not belong to clinic");
    }
  }
}
