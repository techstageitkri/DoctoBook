import { BadRequestException, Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import { ZodSchema } from "zod";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { RequestWithUser } from "../auth/auth.types.js";
import { RequirePermissions } from "../authorization/permissions.decorator.js";
import { PermissionsGuard } from "../authorization/permissions.guard.js";
import { reportQuerySchema } from "./report.schemas.js";
import { ReportService } from "./report.service.js";

@UseGuards(AccessTokenGuard, PermissionsGuard)
@Controller("v1")
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @RequirePermissions({ code: "report.read", scope: "platform" })
  @Get("admin/reports/overview")
  getAdminOverview(@Query() query: unknown, @Req() request: RequestWithUser) {
    return this.reportService.getAdminOverview(
      this.requireUser(request),
      this.parseQuery(reportQuerySchema, query)
    );
  }

  @RequirePermissions({ code: "report.read", scope: "platform" })
  @Get("admin/reports/appointments")
  getAdminAppointments(@Query() query: unknown, @Req() request: RequestWithUser) {
    return this.reportService.getAdminAppointments(
      this.requireUser(request),
      this.parseQuery(reportQuerySchema, query)
    );
  }

  @RequirePermissions({ code: "report.read", scope: "platform" })
  @Get("admin/reports/revenue")
  getAdminRevenue(@Query() query: unknown, @Req() request: RequestWithUser) {
    return this.reportService.getAdminRevenue(
      this.requireUser(request),
      this.parseQuery(reportQuerySchema, query)
    );
  }

  @RequirePermissions({ code: "report.read", scope: "platform" })
  @Get("admin/reports/doctors")
  getAdminDoctors(@Query() query: unknown, @Req() request: RequestWithUser) {
    return this.reportService.getAdminDoctors(
      this.requireUser(request),
      this.parseQuery(reportQuerySchema, query)
    );
  }

  @RequirePermissions({ code: "report.read", scope: "platform" })
  @Get("admin/reports/notifications")
  getAdminNotifications(@Query() query: unknown, @Req() request: RequestWithUser) {
    return this.reportService.getAdminNotifications(
      this.requireUser(request),
      this.parseQuery(reportQuerySchema, query)
    );
  }

  @RequirePermissions({ code: "report.read", scope: "clinic", param: "clinicId" })
  @Get("clinics/:clinicId/reports/overview")
  getClinicOverview(
    @Param("clinicId") clinicId: string,
    @Query() query: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.reportService.getClinicOverview(
      this.requireUser(request),
      clinicId,
      this.parseQuery(reportQuerySchema, query)
    );
  }

  @RequirePermissions({ code: "report.read", scope: "clinic", param: "clinicId" })
  @Get("clinics/:clinicId/reports/appointments")
  getClinicAppointments(
    @Param("clinicId") clinicId: string,
    @Query() query: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.reportService.getClinicAppointments(
      this.requireUser(request),
      clinicId,
      this.parseQuery(reportQuerySchema, query)
    );
  }

  @RequirePermissions({ code: "report.read", scope: "clinic", param: "clinicId" })
  @Get("clinics/:clinicId/reports/revenue")
  getClinicRevenue(
    @Param("clinicId") clinicId: string,
    @Query() query: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.reportService.getClinicRevenue(
      this.requireUser(request),
      clinicId,
      this.parseQuery(reportQuerySchema, query)
    );
  }

  @RequirePermissions({ code: "report.read", scope: "clinic", param: "clinicId" })
  @Get("clinics/:clinicId/reports/doctors")
  getClinicDoctors(
    @Param("clinicId") clinicId: string,
    @Query() query: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.reportService.getClinicDoctors(
      this.requireUser(request),
      clinicId,
      this.parseQuery(reportQuerySchema, query)
    );
  }

  @RequirePermissions({ code: "report.read", scope: "clinic", param: "clinicId" })
  @Get("clinics/:clinicId/reports/services")
  getClinicServices(
    @Param("clinicId") clinicId: string,
    @Query() query: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.reportService.getClinicServices(
      this.requireUser(request),
      clinicId,
      this.parseQuery(reportQuerySchema, query)
    );
  }

  @Get("doctors/me/reports/overview")
  getDoctorOverview(@Query() query: unknown, @Req() request: RequestWithUser) {
    return this.reportService.getDoctorOverview(
      this.requireUser(request),
      this.parseQuery(reportQuerySchema, query)
    );
  }

  @Get("doctors/me/reports/appointments")
  getDoctorAppointments(@Query() query: unknown, @Req() request: RequestWithUser) {
    return this.reportService.getDoctorAppointments(
      this.requireUser(request),
      this.parseQuery(reportQuerySchema, query)
    );
  }

  @Get("doctors/me/reports/ratings")
  getDoctorRatings(@Query() query: unknown, @Req() request: RequestWithUser) {
    return this.reportService.getDoctorRatings(
      this.requireUser(request),
      this.parseQuery(reportQuerySchema, query)
    );
  }

  private parseQuery<T>(schema: ZodSchema<T>, query: unknown): T {
    const result = schema.safeParse(query);

    if (!result.success) {
      throw new BadRequestException({
        message: "Invalid report query",
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
}
