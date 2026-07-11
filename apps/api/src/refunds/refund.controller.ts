import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import { ZodSchema } from "zod";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { RequestContext, RequestWithUser } from "../auth/auth.types.js";
import { RequirePermissions } from "../authorization/permissions.decorator.js";
import { PermissionsGuard } from "../authorization/permissions.guard.js";
import {
  listRefundsQuerySchema,
  markManualRefundSchema,
  markRefundReconciliationSchema
} from "./refund.schemas.js";
import { RefundRecoveryService } from "./refund.service.js";

@UseGuards(AccessTokenGuard, PermissionsGuard)
@Controller("v1")
export class RefundController {
  constructor(private readonly refunds: RefundRecoveryService) {}

  @RequirePermissions({ code: "payment.read", scope: "platform" })
  @Get("admin/refunds")
  listAdminRefunds(@Query() query: unknown, @Req() request: RequestWithUser) {
    return this.refunds.listAdminRefunds(
      this.requireUser(request),
      this.parseQuery(listRefundsQuerySchema, query)
    );
  }

  @RequirePermissions({ code: "payment.read", scope: "platform" })
  @Get("admin/refunds/:refundId")
  getAdminRefund(@Param("refundId") refundId: string, @Req() request: RequestWithUser) {
    return this.refunds.getAdminRefund(this.requireUser(request), refundId);
  }

  @RequirePermissions({ code: "refund.process", scope: "platform" })
  @Post("admin/refunds/:refundId/retry")
  retryRefund(@Param("refundId") refundId: string, @Req() request: RequestWithUser) {
    return this.refunds.retryRefund(
      this.requireUser(request),
      refundId,
      this.getRequestContext(request)
    );
  }

  @RequirePermissions({ code: "refund.process", scope: "platform" })
  @Post("admin/refunds/:refundId/mark-manual")
  markRefundManual(
    @Param("refundId") refundId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.refunds.markRefundManual(
      this.requireUser(request),
      refundId,
      this.parseBody(markManualRefundSchema, body),
      this.getRequestContext(request)
    );
  }

  @RequirePermissions({ code: "refund.process", scope: "platform" })
  @Post("admin/refunds/:refundId/reconciliation")
  markRefundReconciliation(
    @Param("refundId") refundId: string,
    @Body() body: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.refunds.markRefundReconciliation(
      this.requireUser(request),
      refundId,
      this.parseBody(markRefundReconciliationSchema, body),
      this.getRequestContext(request)
    );
  }

  @RequirePermissions({ code: "payment.read", scope: "clinic", param: "clinicId" })
  @Get("clinics/:clinicId/refunds")
  listClinicRefunds(
    @Param("clinicId") clinicId: string,
    @Query() query: unknown,
    @Req() request: RequestWithUser
  ) {
    return this.refunds.listClinicRefunds(
      this.requireUser(request),
      clinicId,
      this.parseQuery(listRefundsQuerySchema, query)
    );
  }

  @RequirePermissions({ code: "payment.read", scope: "clinic", param: "clinicId" })
  @Get("clinics/:clinicId/refunds/:refundId")
  getClinicRefund(
    @Param("clinicId") clinicId: string,
    @Param("refundId") refundId: string,
    @Req() request: RequestWithUser
  ) {
    return this.refunds.getClinicRefund(this.requireUser(request), clinicId, refundId);
  }

  private parseQuery<T>(schema: ZodSchema<T>, query: unknown): T {
    const result = schema.safeParse(query);

    if (!result.success) {
      throw new BadRequestException({
        message: "Invalid refund query",
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      });
    }

    return result.data;
  }

  private parseBody<T>(schema: ZodSchema<T>, body: unknown): T {
    const result = schema.safeParse(body);

    if (!result.success) {
      throw new BadRequestException({
        message: "Invalid refund request",
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
    const userAgent = request.headers["user-agent"];

    return {
      ipAddress: request.ip,
      userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent
    };
  }
}
