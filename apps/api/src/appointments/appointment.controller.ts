import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import { ZodSchema } from "zod";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { RequestContext, RequestWithUser } from "../auth/auth.types.js";
import { AppointmentBookingService } from "./appointment.service.js";
import { createPatientAppointmentSchema } from "./appointment.schemas.js";

@UseGuards(AccessTokenGuard)
@Controller("v1/patient")
export class AppointmentController {
  constructor(private readonly appointmentBookingService: AppointmentBookingService) {}

  @Post("appointments")
  createPatientAppointment(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | string[] | undefined,
    @Req() request: RequestWithUser
  ) {
    return this.appointmentBookingService.createPatientAppointment(
      this.requireUser(request),
      this.parseBody(createPatientAppointmentSchema, body),
      this.requireIdempotencyKey(idempotencyKey),
      this.getRequestContext(request)
    );
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

  private requireIdempotencyKey(value: string | string[] | undefined) {
    const key = Array.isArray(value) ? value[0] : value;
    const normalized = key?.trim();

    if (!normalized || normalized.length < 8 || normalized.length > 120) {
      throw new BadRequestException("Idempotency-Key header must be between 8 and 120 characters");
    }

    return normalized;
  }

  private requireUser(request: RequestWithUser) {
    if (!request.user) {
      throw new BadRequestException("Missing authenticated user");
    }

    return request.user;
  }

  private getRequestContext(request: RequestWithUser): RequestContext {
    return {
      ipAddress: request.ip ?? null,
      userAgent: request.get?.("user-agent") ?? null
    };
  }
}
