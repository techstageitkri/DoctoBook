import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import { ZodSchema } from "zod";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { RequestContext, RequestWithUser } from "../auth/auth.types.js";
import {
  cancelAppointmentSchema,
  listAppointmentsQuerySchema,
  recordOfflinePaymentSchema,
  rescheduleAppointmentSchema,
  rescheduleOptionsQuerySchema,
  updateAppointmentStatusSchema
} from "./appointment-operations.schemas.js";
import { AppointmentOperationsService } from "./appointment-operations.service.js";
import { AppointmentRescheduleService } from "./appointment-reschedule.service.js";

@UseGuards(AccessTokenGuard)
@Controller("v1")
export class AppointmentOperationsController {
  constructor(
    private readonly appointmentOperationsService: AppointmentOperationsService,
    private readonly appointmentRescheduleService: AppointmentRescheduleService
  ) {}

  @Post("patient/appointments/:appointmentId/cancel")
  cancelPatientAppointment(
    @Param("appointmentId") appointmentId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.appointmentOperationsService.cancelPatientAppointment(
      this.requireUser(request),
      appointmentId,
      this.parseBody(cancelAppointmentSchema, body),
      this.getRequestContext(request)
    );
  }

  @Get("patient/appointments/:appointmentId/reschedule-options")
  listPatientRescheduleOptions(
    @Param("appointmentId") appointmentId: string,
    @Query() query: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.appointmentRescheduleService.listPatientRescheduleOptions(
      this.requireUser(request),
      appointmentId,
      this.parseBody(rescheduleOptionsQuerySchema, query)
    );
  }

  @Post("patient/appointments/:appointmentId/reschedule")
  createPatientReschedule(
    @Param("appointmentId") appointmentId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | string[] | undefined,
    @Req() request: RequestWithUser
  ) {
    return this.appointmentRescheduleService.createPatientReschedule(
      this.requireUser(request),
      appointmentId,
      this.parseBody(rescheduleAppointmentSchema, body),
      this.requireIdempotencyKey(idempotencyKey),
      this.getRequestContext(request)
    );
  }

  @Get("patient/appointments/:appointmentId/reschedule-status")
  getPatientRescheduleStatus(
    @Param("appointmentId") appointmentId: string,
    @Req() request: RequestWithUser
  ) {
    return this.appointmentRescheduleService.getPatientRescheduleStatus(
      this.requireUser(request),
      appointmentId
    );
  }

  @Post("patient/appointments/:appointmentId/reschedule/cancel")
  cancelPatientReschedule(
    @Param("appointmentId") appointmentId: string,
    @Req() request: RequestWithUser
  ) {
    return this.appointmentRescheduleService.cancelPatientReschedule(
      this.requireUser(request),
      appointmentId,
      this.getRequestContext(request)
    );
  }

  @Get("doctors/me/appointments")
  listDoctorAppointments(@Query() query: unknown, @Req() request: RequestWithUser) {
    return this.appointmentOperationsService.listDoctorAppointments(
      this.requireUser(request),
      this.parseBody(listAppointmentsQuerySchema, query)
    );
  }

  @Get("doctors/me/appointments/:appointmentId")
  getDoctorAppointment(
    @Param("appointmentId") appointmentId: string,
    @Req() request: RequestWithUser
  ) {
    return this.appointmentOperationsService.getDoctorAppointment(
      this.requireUser(request),
      appointmentId
    );
  }

  @Patch("doctors/me/appointments/:appointmentId/status")
  updateDoctorAppointmentStatus(
    @Param("appointmentId") appointmentId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.appointmentOperationsService.updateDoctorAppointmentStatus(
      this.requireUser(request),
      appointmentId,
      this.parseBody(updateAppointmentStatusSchema, body),
      this.getRequestContext(request)
    );
  }

  @Get("clinics/:clinicId/appointments")
  listClinicAppointments(
    @Param("clinicId") clinicId: string,
    @Query() query: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.appointmentOperationsService.listClinicAppointments(
      this.requireUser(request),
      clinicId,
      this.parseBody(listAppointmentsQuerySchema, query)
    );
  }

  @Get("clinics/:clinicId/appointments/:appointmentId")
  getClinicAppointment(
    @Param("clinicId") clinicId: string,
    @Param("appointmentId") appointmentId: string,
    @Req() request: RequestWithUser
  ) {
    return this.appointmentOperationsService.getClinicAppointment(
      this.requireUser(request),
      clinicId,
      appointmentId
    );
  }

  @Post("clinics/:clinicId/appointments/:appointmentId/check-in")
  checkInClinicAppointment(
    @Param("clinicId") clinicId: string,
    @Param("appointmentId") appointmentId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    const input = this.parseBody(updateAppointmentStatusSchema.partial({ status: true }), body);

    return this.appointmentOperationsService.checkInClinicAppointment(
      this.requireUser(request),
      clinicId,
      appointmentId,
      input,
      this.getRequestContext(request)
    );
  }

  @Patch("clinics/:clinicId/appointments/:appointmentId/status")
  updateClinicAppointmentStatus(
    @Param("clinicId") clinicId: string,
    @Param("appointmentId") appointmentId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.appointmentOperationsService.updateClinicAppointmentStatus(
      this.requireUser(request),
      clinicId,
      appointmentId,
      this.parseBody(updateAppointmentStatusSchema, body),
      this.getRequestContext(request)
    );
  }

  @Post("clinics/:clinicId/appointments/:appointmentId/cancel")
  cancelClinicAppointment(
    @Param("clinicId") clinicId: string,
    @Param("appointmentId") appointmentId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.appointmentOperationsService.cancelClinicAppointment(
      this.requireUser(request),
      clinicId,
      appointmentId,
      this.parseBody(cancelAppointmentSchema, body),
      this.getRequestContext(request)
    );
  }

  @Post("clinics/:clinicId/appointments/:appointmentId/record-payment")
  recordOfflinePayment(
    @Param("clinicId") clinicId: string,
    @Param("appointmentId") appointmentId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.appointmentOperationsService.recordOfflinePayment(
      this.requireUser(request),
      clinicId,
      appointmentId,
      this.parseBody(recordOfflinePaymentSchema, body),
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

  private requireUser(request: RequestWithUser) {
    if (!request.user) {
      throw new BadRequestException("Missing authenticated user");
    }

    return request.user;
  }

  private requireIdempotencyKey(value: string | string[] | undefined) {
    const key = Array.isArray(value) ? value[0] : value;
    const normalized = key?.trim();

    if (!normalized || normalized.length < 8 || normalized.length > 120) {
      throw new BadRequestException("Idempotency-Key header must be between 8 and 120 characters");
    }

    return normalized;
  }

  private getRequestContext(request: RequestWithUser): RequestContext {
    return {
      ipAddress: request.ip ?? null,
      userAgent: request.get?.("user-agent") ?? null
    };
  }
}
