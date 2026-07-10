import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
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
  associationDecisionSchema,
  clinicDocumentReviewSchema,
  createDoctorDocumentSchema,
  doctorStatusReasonSchema,
  inviteDoctorSchema,
  listDoctorAssociationsQuerySchema,
  listDoctorsQuerySchema,
  registerDoctorSchema,
  rejectDoctorSchema,
  requestClinicAssociationSchema,
  updateDoctorProfileSchema
} from "./doctor.schemas.js";
import { DoctorService } from "./doctor.service.js";

@Controller("v1")
export class DoctorController {
  constructor(private readonly doctorService: DoctorService) {}

  @Post("auth/register/doctor")
  registerDoctor(@Body() body: unknown, @Req() request: RequestWithUser) {
    return this.doctorService.registerDoctor(
      this.parseBody(registerDoctorSchema, body),
      this.getRequestContext(request)
    );
  }

  @Get("specialties")
  listSpecialties() {
    return this.doctorService.listSpecialties();
  }

  @UseGuards(AccessTokenGuard)
  @Get("doctors/me")
  getMyProfile(@Req() request: RequestWithUser) {
    return this.doctorService.getMyProfile(this.requireUser(request));
  }

  @UseGuards(AccessTokenGuard)
  @Patch("doctors/me")
  updateMyProfile(@Body() body: unknown, @Req() request: RequestWithUser) {
    return this.doctorService.updateMyProfile(
      this.requireUser(request),
      this.parseBody(updateDoctorProfileSchema, body),
      this.getRequestContext(request)
    );
  }

  @UseGuards(AccessTokenGuard)
  @Post("doctors/me/documents")
  createMyDocument(@Body() body: unknown, @Req() request: RequestWithUser) {
    return this.doctorService.createMyDocument(
      this.requireUser(request),
      this.parseBody(createDoctorDocumentSchema, body),
      this.getRequestContext(request)
    );
  }

  @UseGuards(AccessTokenGuard)
  @Delete("doctors/me/documents/:documentId")
  deleteMyDocument(@Param("documentId") documentId: string, @Req() request: RequestWithUser) {
    return this.doctorService.deleteMyDocument(
      this.requireUser(request),
      documentId,
      this.getRequestContext(request)
    );
  }

  @UseGuards(AccessTokenGuard)
  @Get("admin/doctors")
  listDoctors(@Query() query: unknown, @Req() request: RequestWithUser) {
    return this.doctorService.listDoctors(
      this.requireUser(request),
      this.parseBody(listDoctorsQuerySchema, query)
    );
  }

  @UseGuards(AccessTokenGuard)
  @Get("admin/doctors/:doctorId")
  getDoctor(@Param("doctorId") doctorId: string, @Req() request: RequestWithUser) {
    return this.doctorService.getDoctor(this.requireUser(request), doctorId);
  }

  @UseGuards(AccessTokenGuard)
  @Post("admin/doctors/:doctorId/approve")
  approveDoctor(@Param("doctorId") doctorId: string, @Req() request: RequestWithUser) {
    return this.doctorService.approveDoctor(
      this.requireUser(request),
      doctorId,
      this.getRequestContext(request)
    );
  }

  @UseGuards(AccessTokenGuard)
  @Post("admin/doctors/:doctorId/reject")
  rejectDoctor(
    @Param("doctorId") doctorId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.doctorService.rejectDoctor(
      this.requireUser(request),
      doctorId,
      this.parseBody(rejectDoctorSchema, body),
      this.getRequestContext(request)
    );
  }

  @UseGuards(AccessTokenGuard)
  @Post("admin/doctors/:doctorId/suspend")
  suspendDoctor(
    @Param("doctorId") doctorId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.doctorService.suspendDoctor(
      this.requireUser(request),
      doctorId,
      this.parseBody(doctorStatusReasonSchema, body),
      this.getRequestContext(request)
    );
  }

  @UseGuards(AccessTokenGuard)
  @Post("admin/doctors/:doctorId/reactivate")
  reactivateDoctor(@Param("doctorId") doctorId: string, @Req() request: RequestWithUser) {
    return this.doctorService.reactivateDoctor(
      this.requireUser(request),
      doctorId,
      this.getRequestContext(request)
    );
  }

  @UseGuards(AccessTokenGuard)
  @Post("doctors/me/clinic-associations")
  requestClinicAssociation(@Body() body: unknown, @Req() request: RequestWithUser) {
    return this.doctorService.requestClinicAssociation(
      this.requireUser(request),
      this.parseBody(requestClinicAssociationSchema, body),
      this.getRequestContext(request)
    );
  }

  @UseGuards(AccessTokenGuard)
  @Get("doctors/me/clinic-associations")
  listMyAssociations(@Query() query: unknown, @Req() request: RequestWithUser) {
    return this.doctorService.listMyAssociations(
      this.requireUser(request),
      this.parseBody(listDoctorAssociationsQuerySchema, query)
    );
  }

  @UseGuards(AccessTokenGuard)
  @Delete("doctors/me/clinic-associations/:associationId")
  removeMyAssociation(
    @Param("associationId") associationId: string,
    @Req() request: RequestWithUser
  ) {
    return this.doctorService.removeMyAssociation(
      this.requireUser(request),
      associationId,
      this.getRequestContext(request)
    );
  }

  @UseGuards(AccessTokenGuard)
  @Get("clinics/:clinicId/doctor-associations")
  listClinicAssociations(
    @Param("clinicId") clinicId: string,
    @Query() query: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.doctorService.listClinicAssociations(
      this.requireUser(request),
      clinicId,
      this.parseBody(listDoctorAssociationsQuerySchema, query)
    );
  }

  @UseGuards(AccessTokenGuard)
  @Post("clinics/:clinicId/doctor-associations/:associationId/approve")
  approveClinicAssociation(
    @Param("clinicId") clinicId: string,
    @Param("associationId") associationId: string,
    @Req() request: RequestWithUser
  ) {
    return this.doctorService.approveClinicAssociation(
      this.requireUser(request),
      clinicId,
      associationId,
      this.getRequestContext(request)
    );
  }

  @UseGuards(AccessTokenGuard)
  @Post("clinics/:clinicId/doctor-associations/:associationId/reject")
  rejectClinicAssociation(
    @Param("clinicId") clinicId: string,
    @Param("associationId") associationId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.doctorService.rejectClinicAssociation(
      this.requireUser(request),
      clinicId,
      associationId,
      this.parseBody(associationDecisionSchema, body),
      this.getRequestContext(request)
    );
  }

  @UseGuards(AccessTokenGuard)
  @Post("clinics/:clinicId/doctors/invite")
  inviteDoctor(
    @Param("clinicId") clinicId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.doctorService.inviteDoctor(
      this.requireUser(request),
      clinicId,
      this.parseBody(inviteDoctorSchema, body),
      this.getRequestContext(request)
    );
  }

  @UseGuards(AccessTokenGuard)
  @Post("clinics/:clinicId/doctor-associations/:associationId/documents/:documentId/review")
  reviewClinicDocument(
    @Param("clinicId") clinicId: string,
    @Param("associationId") associationId: string,
    @Param("documentId") documentId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.doctorService.reviewClinicDocument(
      this.requireUser(request),
      clinicId,
      associationId,
      documentId,
      this.parseBody(clinicDocumentReviewSchema, body),
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
