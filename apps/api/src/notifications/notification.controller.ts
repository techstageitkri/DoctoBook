import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Put,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import { ZodSchema } from "zod";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { RequestContext, RequestWithUser } from "../auth/auth.types.js";
import { RequirePermissions } from "../authorization/permissions.decorator.js";
import { PermissionsGuard } from "../authorization/permissions.guard.js";
import { NotificationService } from "./notification.service.js";
import {
  listNotificationLogsQuerySchema,
  listNotificationTemplatesQuerySchema,
  upsertNotificationTemplateSchema
} from "./notification.schemas.js";

@UseGuards(AccessTokenGuard, PermissionsGuard)
@Controller("v1/admin")
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @RequirePermissions({ code: "notification.templates.manage", scope: "platform" })
  @Get("notification-templates")
  listTemplates(@Query() query: unknown) {
    return this.notificationService.listTemplates(
      this.parseBody(listNotificationTemplatesQuerySchema, query)
    );
  }

  @RequirePermissions({ code: "notification.templates.manage", scope: "platform" })
  @Put("notification-templates")
  upsertTemplate(@Body() body: unknown, @Req() request: RequestWithUser) {
    return this.notificationService.upsertTemplate(
      this.requireUser(request),
      this.parseBody(upsertNotificationTemplateSchema, body),
      this.getRequestContext(request)
    );
  }

  @RequirePermissions({ code: "notification.settings.manage", scope: "platform" })
  @Get("notification-logs")
  listLogs(@Query() query: unknown) {
    return this.notificationService.listLogs(this.parseBody(listNotificationLogsQuerySchema, query));
  }

  @RequirePermissions({ code: "notification.settings.manage", scope: "platform" })
  @Get("notification-provider-health")
  getProviderHealth() {
    return this.notificationService.getProviderHealth();
  }

  private parseBody<T>(schema: ZodSchema<T>, body: unknown) {
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }

    return parsed.data;
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
