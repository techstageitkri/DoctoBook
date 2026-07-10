import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import { ZodSchema } from "zod";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { RequestContext, RequestWithUser } from "../auth/auth.types.js";
import { PermissionsGuard } from "../authorization/permissions.guard.js";
import { RequirePermissions } from "../authorization/permissions.decorator.js";
import { ClinicService } from "./clinic.service.js";
import {
  assignClinicAdminSchema,
  createClinicLocationSchema,
  createClinicSchema,
  createClosureSchema,
  listClinicsQuerySchema,
  setLocationHoursSchema,
  updateClinicLocationSchema,
  updateClinicSchema,
  updateClinicStatusSchema
} from "./clinic.schemas.js";

@UseGuards(AccessTokenGuard)
@Controller("v1")
export class ClinicController {
  constructor(private readonly clinicService: ClinicService) {}

  @UseGuards(PermissionsGuard)
  @RequirePermissions({ code: "clinic.create", scope: "platform" })
  @Post("admin/clinics")
  createClinic(@Body() body: unknown, @Req() request: RequestWithUser) {
    return this.clinicService.createClinic(
      this.requireUser(request),
      this.parseBody(createClinicSchema, body),
      this.getRequestContext(request)
    );
  }

  @Get("admin/clinics")
  listClinics(@Query() query: unknown, @Req() request: RequestWithUser) {
    return this.clinicService.listClinics(
      this.requireUser(request),
      this.parseBody(listClinicsQuerySchema, query)
    );
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions({ code: "clinic.read", scope: "clinic", param: "clinicId" })
  @Get("admin/clinics/:clinicId")
  getClinic(@Param("clinicId") clinicId: string, @Req() request: RequestWithUser) {
    return this.clinicService.getClinic(this.requireUser(request), clinicId);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions({ code: "clinic.update", scope: "clinic", param: "clinicId" })
  @Patch("admin/clinics/:clinicId")
  updateClinic(
    @Param("clinicId") clinicId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.clinicService.updateClinic(
      this.requireUser(request),
      clinicId,
      this.parseBody(updateClinicSchema, body),
      this.getRequestContext(request)
    );
  }

  @Patch("admin/clinics/:clinicId/status")
  updateClinicStatus(
    @Param("clinicId") clinicId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.clinicService.updateClinicStatus(
      this.requireUser(request),
      clinicId,
      this.parseBody(updateClinicStatusSchema, body),
      this.getRequestContext(request)
    );
  }

  @Delete("admin/clinics/:clinicId")
  deleteClinic(@Param("clinicId") clinicId: string, @Req() request: RequestWithUser) {
    return this.clinicService.deleteClinic(
      this.requireUser(request),
      clinicId,
      this.getRequestContext(request)
    );
  }

  @Post("clinics/:clinicId/locations")
  createLocation(
    @Param("clinicId") clinicId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.clinicService.createLocation(
      this.requireUser(request),
      clinicId,
      this.parseBody(createClinicLocationSchema, body),
      this.getRequestContext(request)
    );
  }

  @Get("clinics/:clinicId/locations")
  listLocations(@Param("clinicId") clinicId: string, @Req() request: RequestWithUser) {
    return this.clinicService.listLocations(this.requireUser(request), clinicId);
  }

  @Patch("clinics/:clinicId/locations/:locationId")
  updateLocation(
    @Param("clinicId") clinicId: string,
    @Param("locationId") locationId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.clinicService.updateLocation(
      this.requireUser(request),
      clinicId,
      locationId,
      this.parseBody(updateClinicLocationSchema, body),
      this.getRequestContext(request)
    );
  }

  @Delete("clinics/:clinicId/locations/:locationId")
  deleteLocation(
    @Param("clinicId") clinicId: string,
    @Param("locationId") locationId: string,
    @Req() request: RequestWithUser
  ) {
    return this.clinicService.deleteLocation(
      this.requireUser(request),
      clinicId,
      locationId,
      this.getRequestContext(request)
    );
  }

  @Put("clinics/:clinicId/locations/:locationId/hours")
  setLocationHours(
    @Param("clinicId") clinicId: string,
    @Param("locationId") locationId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.clinicService.setLocationHours(
      this.requireUser(request),
      clinicId,
      locationId,
      this.parseBody(setLocationHoursSchema, body),
      this.getRequestContext(request)
    );
  }

  @Post("clinics/:clinicId/locations/:locationId/closures")
  createClosure(
    @Param("clinicId") clinicId: string,
    @Param("locationId") locationId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.clinicService.createClosure(
      this.requireUser(request),
      clinicId,
      locationId,
      this.parseBody(createClosureSchema, body),
      this.getRequestContext(request)
    );
  }

  @Delete("clinics/:clinicId/locations/:locationId/closures/:closureId")
  deleteClosure(
    @Param("clinicId") clinicId: string,
    @Param("locationId") locationId: string,
    @Param("closureId") closureId: string,
    @Req() request: RequestWithUser
  ) {
    return this.clinicService.deleteClosure(
      this.requireUser(request),
      clinicId,
      locationId,
      closureId,
      this.getRequestContext(request)
    );
  }

  @Post("clinics/:clinicId/admins")
  assignClinicAdmin(
    @Param("clinicId") clinicId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.clinicService.assignClinicAdmin(
      this.requireUser(request),
      clinicId,
      this.parseBody(assignClinicAdminSchema, body),
      this.getRequestContext(request)
    );
  }

  @Delete("clinics/:clinicId/admins/:userId")
  removeClinicAdmin(
    @Param("clinicId") clinicId: string,
    @Param("userId") userId: string,
    @Req() request: RequestWithUser
  ) {
    return this.clinicService.removeClinicAdmin(
      this.requireUser(request),
      clinicId,
      userId,
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
