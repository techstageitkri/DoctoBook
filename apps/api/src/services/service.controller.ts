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
  createClinicServiceSchema,
  createDoctorClinicServiceSchema,
  createMasterServiceSchema,
  updateClinicServiceSchema,
  updateDoctorClinicServiceSchema,
  updateMasterServiceSchema
} from "./service.schemas.js";
import { AppointmentServiceConfigService } from "./service.service.js";

@Controller("v1")
export class ServiceController {
  constructor(private readonly serviceConfigService: AppointmentServiceConfigService) {}

  @Get("services")
  listMasterServices() {
    return this.serviceConfigService.listMasterServices();
  }

  @UseGuards(AccessTokenGuard)
  @Post("admin/services")
  createMasterService(@Body() body: unknown, @Req() request: RequestWithUser) {
    return this.serviceConfigService.createMasterService(
      this.requireUser(request),
      this.parseBody(createMasterServiceSchema, body),
      this.getRequestContext(request)
    );
  }

  @UseGuards(AccessTokenGuard)
  @Patch("admin/services/:serviceId")
  updateMasterService(
    @Param("serviceId") serviceId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.serviceConfigService.updateMasterService(
      this.requireUser(request),
      serviceId,
      this.parseBody(updateMasterServiceSchema, body),
      this.getRequestContext(request)
    );
  }

  @UseGuards(AccessTokenGuard)
  @Get("clinics/:clinicId/services")
  listClinicServices(@Param("clinicId") clinicId: string, @Req() request: RequestWithUser) {
    return this.serviceConfigService.listClinicServices(this.requireUser(request), clinicId);
  }

  @UseGuards(AccessTokenGuard)
  @Post("clinics/:clinicId/services")
  createClinicService(
    @Param("clinicId") clinicId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.serviceConfigService.createClinicService(
      this.requireUser(request),
      clinicId,
      this.parseBody(createClinicServiceSchema, body),
      this.getRequestContext(request)
    );
  }

  @UseGuards(AccessTokenGuard)
  @Patch("clinics/:clinicId/services/:clinicServiceId")
  updateClinicService(
    @Param("clinicId") clinicId: string,
    @Param("clinicServiceId") clinicServiceId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.serviceConfigService.updateClinicService(
      this.requireUser(request),
      clinicId,
      clinicServiceId,
      this.parseBody(updateClinicServiceSchema, body),
      this.getRequestContext(request)
    );
  }

  @UseGuards(AccessTokenGuard)
  @Get("doctors/me/clinic-associations/:associationId/services")
  listMyDoctorClinicServices(
    @Param("associationId") associationId: string,
    @Req() request: RequestWithUser
  ) {
    return this.serviceConfigService.listMyDoctorClinicServices(
      this.requireUser(request),
      associationId
    );
  }

  @UseGuards(AccessTokenGuard)
  @Post("doctors/me/clinic-associations/:associationId/services")
  createMyDoctorClinicService(
    @Param("associationId") associationId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.serviceConfigService.createMyDoctorClinicService(
      this.requireUser(request),
      associationId,
      this.parseBody(createDoctorClinicServiceSchema, body),
      this.getRequestContext(request)
    );
  }

  @UseGuards(AccessTokenGuard)
  @Patch("doctors/me/clinic-services/:doctorClinicServiceId")
  updateMyDoctorClinicService(
    @Param("doctorClinicServiceId") doctorClinicServiceId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.serviceConfigService.updateMyDoctorClinicService(
      this.requireUser(request),
      doctorClinicServiceId,
      this.parseBody(updateDoctorClinicServiceSchema, body),
      this.getRequestContext(request)
    );
  }

  @UseGuards(AccessTokenGuard)
  @Delete("doctors/me/clinic-services/:doctorClinicServiceId")
  deleteMyDoctorClinicService(
    @Param("doctorClinicServiceId") doctorClinicServiceId: string,
    @Req() request: RequestWithUser
  ) {
    return this.serviceConfigService.deleteMyDoctorClinicService(
      this.requireUser(request),
      doctorClinicServiceId,
      this.getRequestContext(request)
    );
  }

  @UseGuards(AccessTokenGuard)
  @Get("clinics/:clinicId/doctor-associations/:associationId/services")
  listClinicDoctorServices(
    @Param("clinicId") clinicId: string,
    @Param("associationId") associationId: string,
    @Req() request: RequestWithUser
  ) {
    return this.serviceConfigService.listClinicDoctorServices(
      this.requireUser(request),
      clinicId,
      associationId
    );
  }

  @UseGuards(AccessTokenGuard)
  @Post("clinics/:clinicId/doctor-associations/:associationId/services")
  createClinicDoctorService(
    @Param("clinicId") clinicId: string,
    @Param("associationId") associationId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.serviceConfigService.createClinicDoctorService(
      this.requireUser(request),
      clinicId,
      associationId,
      this.parseBody(createDoctorClinicServiceSchema, body),
      this.getRequestContext(request)
    );
  }

  @UseGuards(AccessTokenGuard)
  @Patch("clinics/:clinicId/doctor-services/:doctorClinicServiceId")
  updateClinicDoctorService(
    @Param("clinicId") clinicId: string,
    @Param("doctorClinicServiceId") doctorClinicServiceId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.serviceConfigService.updateClinicDoctorService(
      this.requireUser(request),
      clinicId,
      doctorClinicServiceId,
      this.parseBody(updateDoctorClinicServiceSchema, body),
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
