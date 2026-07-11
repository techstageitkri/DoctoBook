import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import { ZodSchema } from "zod";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { RequestContext, RequestWithUser } from "../auth/auth.types.js";
import {
  createAvailabilityBreakSchema,
  createAvailabilityRuleSchema,
  createDoctorTimeOffSchema,
  updateAvailabilityRuleSchema
} from "./availability.schemas.js";
import { DoctorAvailabilityService } from "./availability.service.js";

@UseGuards(AccessTokenGuard)
@Controller("v1")
export class AvailabilityController {
  constructor(private readonly availabilityService: DoctorAvailabilityService) {}

  @Get("doctors/me/clinic-associations/:associationId/availability")
  listMyAvailability(@Param("associationId") associationId: string, @Req() request: RequestWithUser) {
    return this.availabilityService.listMyAvailability(this.requireUser(request), associationId);
  }

  @Post("doctors/me/clinic-associations/:associationId/availability")
  createMyAvailabilityRule(
    @Param("associationId") associationId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.availabilityService.createMyAvailabilityRule(
      this.requireUser(request),
      associationId,
      this.parseBody(createAvailabilityRuleSchema, body),
      this.getRequestContext(request)
    );
  }

  @Patch("doctors/me/availability/:ruleId")
  updateMyAvailabilityRule(
    @Param("ruleId") ruleId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.availabilityService.updateMyAvailabilityRule(
      this.requireUser(request),
      ruleId,
      this.parseBody(updateAvailabilityRuleSchema, body),
      this.getRequestContext(request)
    );
  }

  @Delete("doctors/me/availability/:ruleId")
  deleteMyAvailabilityRule(@Param("ruleId") ruleId: string, @Req() request: RequestWithUser) {
    return this.availabilityService.deleteMyAvailabilityRule(
      this.requireUser(request),
      ruleId,
      this.getRequestContext(request)
    );
  }

  @Post("doctors/me/availability/:ruleId/breaks")
  createMyAvailabilityBreak(
    @Param("ruleId") ruleId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.availabilityService.createMyAvailabilityBreak(
      this.requireUser(request),
      ruleId,
      this.parseBody(createAvailabilityBreakSchema, body),
      this.getRequestContext(request)
    );
  }

  @Delete("doctors/me/availability/breaks/:breakId")
  deleteMyAvailabilityBreak(@Param("breakId") breakId: string, @Req() request: RequestWithUser) {
    return this.availabilityService.deleteMyAvailabilityBreak(
      this.requireUser(request),
      breakId,
      this.getRequestContext(request)
    );
  }

  @Get("doctors/me/clinic-associations/:associationId/time-off")
  listMyTimeOff(@Param("associationId") associationId: string, @Req() request: RequestWithUser) {
    return this.availabilityService.listMyTimeOff(this.requireUser(request), associationId);
  }

  @Post("doctors/me/clinic-associations/:associationId/time-off")
  createMyTimeOff(
    @Param("associationId") associationId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.availabilityService.createMyTimeOff(
      this.requireUser(request),
      associationId,
      this.parseBody(createDoctorTimeOffSchema, body),
      this.getRequestContext(request)
    );
  }

  @Delete("doctors/me/time-off/:timeOffId")
  deleteMyTimeOff(@Param("timeOffId") timeOffId: string, @Req() request: RequestWithUser) {
    return this.availabilityService.deleteMyTimeOff(
      this.requireUser(request),
      timeOffId,
      this.getRequestContext(request)
    );
  }

  @Get("clinics/:clinicId/doctor-associations/:associationId/availability")
  listClinicAvailability(
    @Param("clinicId") clinicId: string,
    @Param("associationId") associationId: string,
    @Req() request: RequestWithUser
  ) {
    return this.availabilityService.listClinicAvailability(
      this.requireUser(request),
      clinicId,
      associationId
    );
  }

  @Post("clinics/:clinicId/doctor-associations/:associationId/availability")
  createClinicAvailabilityRule(
    @Param("clinicId") clinicId: string,
    @Param("associationId") associationId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.availabilityService.createClinicAvailabilityRule(
      this.requireUser(request),
      clinicId,
      associationId,
      this.parseBody(createAvailabilityRuleSchema, body),
      this.getRequestContext(request)
    );
  }

  @Patch("clinics/:clinicId/availability/:ruleId")
  updateClinicAvailabilityRule(
    @Param("clinicId") clinicId: string,
    @Param("ruleId") ruleId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.availabilityService.updateClinicAvailabilityRule(
      this.requireUser(request),
      clinicId,
      ruleId,
      this.parseBody(updateAvailabilityRuleSchema, body),
      this.getRequestContext(request)
    );
  }

  @Delete("clinics/:clinicId/availability/:ruleId")
  deleteClinicAvailabilityRule(
    @Param("clinicId") clinicId: string,
    @Param("ruleId") ruleId: string,
    @Req() request: RequestWithUser
  ) {
    return this.availabilityService.deleteClinicAvailabilityRule(
      this.requireUser(request),
      clinicId,
      ruleId,
      this.getRequestContext(request)
    );
  }

  @Post("clinics/:clinicId/availability/:ruleId/breaks")
  createClinicAvailabilityBreak(
    @Param("clinicId") clinicId: string,
    @Param("ruleId") ruleId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.availabilityService.createClinicAvailabilityBreak(
      this.requireUser(request),
      clinicId,
      ruleId,
      this.parseBody(createAvailabilityBreakSchema, body),
      this.getRequestContext(request)
    );
  }

  @Delete("clinics/:clinicId/availability/breaks/:breakId")
  deleteClinicAvailabilityBreak(
    @Param("clinicId") clinicId: string,
    @Param("breakId") breakId: string,
    @Req() request: RequestWithUser
  ) {
    return this.availabilityService.deleteClinicAvailabilityBreak(
      this.requireUser(request),
      clinicId,
      breakId,
      this.getRequestContext(request)
    );
  }

  @Get("clinics/:clinicId/doctor-associations/:associationId/time-off")
  listClinicTimeOff(
    @Param("clinicId") clinicId: string,
    @Param("associationId") associationId: string,
    @Req() request: RequestWithUser
  ) {
    return this.availabilityService.listClinicTimeOff(
      this.requireUser(request),
      clinicId,
      associationId
    );
  }

  @Post("clinics/:clinicId/doctor-associations/:associationId/time-off")
  createClinicTimeOff(
    @Param("clinicId") clinicId: string,
    @Param("associationId") associationId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.availabilityService.createClinicTimeOff(
      this.requireUser(request),
      clinicId,
      associationId,
      this.parseBody(createDoctorTimeOffSchema, body),
      this.getRequestContext(request)
    );
  }

  @Delete("clinics/:clinicId/time-off/:timeOffId")
  deleteClinicTimeOff(
    @Param("clinicId") clinicId: string,
    @Param("timeOffId") timeOffId: string,
    @Req() request: RequestWithUser
  ) {
    return this.availabilityService.deleteClinicTimeOff(
      this.requireUser(request),
      clinicId,
      timeOffId,
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

  private getRequestContext(request: RequestWithUser): RequestContext {
    return {
      ipAddress: request.ip ?? null,
      userAgent: request.get?.("user-agent") ?? null
    };
  }
}
