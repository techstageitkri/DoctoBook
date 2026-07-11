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
import { ReviewService } from "./review.service.js";
import {
  createReviewSchema,
  listAdminReviewsQuerySchema,
  listPublicReviewsQuerySchema,
  moderateReviewSchema,
  updateReviewSchema
} from "./review.schemas.js";

@Controller("v1")
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  @UseGuards(AccessTokenGuard)
  @Get("patient/appointments/:appointmentId/review")
  getPatientAppointmentReview(
    @Param("appointmentId") appointmentId: string,
    @Req() request: RequestWithUser
  ) {
    return this.reviewService.getPatientAppointmentReview(this.requireUser(request), appointmentId);
  }

  @UseGuards(AccessTokenGuard)
  @Post("patient/appointments/:appointmentId/review")
  createPatientReview(
    @Param("appointmentId") appointmentId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.reviewService.createPatientReview(
      this.requireUser(request),
      appointmentId,
      this.parseBody(createReviewSchema, body),
      this.getRequestContext(request)
    );
  }

  @UseGuards(AccessTokenGuard)
  @Patch("patient/reviews/:reviewId")
  updatePatientReview(
    @Param("reviewId") reviewId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.reviewService.updatePatientReview(
      this.requireUser(request),
      reviewId,
      this.parseBody(updateReviewSchema, body),
      this.getRequestContext(request)
    );
  }

  @UseGuards(AccessTokenGuard)
  @Delete("patient/reviews/:reviewId")
  deletePatientReview(@Param("reviewId") reviewId: string, @Req() request: RequestWithUser) {
    return this.reviewService.deletePatientReview(
      this.requireUser(request),
      reviewId,
      this.getRequestContext(request)
    );
  }

  @Get("public/doctors/:doctorId/reviews")
  listPublicDoctorReviews(@Param("doctorId") doctorId: string, @Query() query: unknown) {
    return this.reviewService.listPublicDoctorReviews(
      doctorId,
      this.parseBody(listPublicReviewsQuerySchema, query)
    );
  }

  @Get("public/doctors/:doctorId/rating-summary")
  getPublicDoctorRatingSummary(@Param("doctorId") doctorId: string) {
    return this.reviewService.getPublicDoctorRatingSummary(doctorId);
  }

  @UseGuards(AccessTokenGuard)
  @Get("admin/reviews")
  listAdminReviews(@Query() query: unknown, @Req() request: RequestWithUser) {
    return this.reviewService.listAdminReviews(
      this.requireUser(request),
      this.parseBody(listAdminReviewsQuerySchema, query)
    );
  }

  @UseGuards(AccessTokenGuard)
  @Get("admin/reviews/:reviewId")
  getAdminReview(@Param("reviewId") reviewId: string, @Req() request: RequestWithUser) {
    return this.reviewService.getAdminReview(this.requireUser(request), reviewId);
  }

  @UseGuards(AccessTokenGuard)
  @Patch("admin/reviews/:reviewId/moderation")
  moderateReview(
    @Param("reviewId") reviewId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.reviewService.moderateReview(
      this.requireUser(request),
      reviewId,
      this.parseBody(moderateReviewSchema, body),
      this.getRequestContext(request)
    );
  }

  private parseBody<T>(schema: ZodSchema<T>, body: unknown): T {
    const result = schema.safeParse(body);

    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
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
    const userAgent = request.headers["user-agent"];

    return {
      ipAddress: request.ip,
      userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent
    };
  }
}
