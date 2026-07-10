import { BadRequestException, Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { ZodSchema } from "zod";
import { AccessTokenGuard } from "./access-token.guard.js";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  requestEmailVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema
} from "./auth.schemas.js";
import { AuthService } from "./auth.service.js";
import { RequestContext, RequestWithUser } from "./auth.types.js";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  register(@Body() body: unknown, @Req() request: RequestWithUser) {
    return this.authService.register(
      this.parseBody(registerSchema, body),
      this.getRequestContext(request)
    );
  }

  @Post("login")
  login(@Body() body: unknown, @Req() request: RequestWithUser) {
    return this.authService.login(
      this.parseBody(loginSchema, body),
      this.getRequestContext(request)
    );
  }

  @Post("refresh")
  refresh(@Body() body: unknown, @Req() request: RequestWithUser) {
    return this.authService.refresh(
      this.parseBody(refreshSchema, body),
      this.getRequestContext(request)
    );
  }

  @Post("logout")
  logout(@Body() body: unknown, @Req() request: RequestWithUser) {
    return this.authService.logout(
      this.parseBody(logoutSchema, body),
      this.getRequestContext(request)
    );
  }

  @UseGuards(AccessTokenGuard)
  @Post("logout-all")
  logoutAll(@Req() request: RequestWithUser) {
    return this.authService.logoutAll(this.requireUser(request), this.getRequestContext(request));
  }

  @UseGuards(AccessTokenGuard)
  @Get("sessions")
  sessions(@Req() request: RequestWithUser) {
    return this.authService.listSessions(this.requireUser(request));
  }

  @Post("email-verification/request")
  requestEmailVerification(@Body() body: unknown, @Req() request: RequestWithUser) {
    return this.authService.requestEmailVerification(
      this.parseBody(requestEmailVerificationSchema, body),
      this.getRequestContext(request)
    );
  }

  @Post("email-verification/confirm")
  verifyEmail(@Body() body: unknown, @Req() request: RequestWithUser) {
    return this.authService.verifyEmail(
      this.parseBody(verifyEmailSchema, body),
      this.getRequestContext(request)
    );
  }

  @Post("password/forgot")
  forgotPassword(@Body() body: unknown, @Req() request: RequestWithUser) {
    return this.authService.forgotPassword(
      this.parseBody(forgotPasswordSchema, body),
      this.getRequestContext(request)
    );
  }

  @Post("password/reset")
  resetPassword(@Body() body: unknown, @Req() request: RequestWithUser) {
    return this.authService.resetPassword(
      this.parseBody(resetPasswordSchema, body),
      this.getRequestContext(request)
    );
  }

  @UseGuards(AccessTokenGuard)
  @Post("password/change")
  changePassword(@Body() body: unknown, @Req() request: RequestWithUser) {
    return this.authService.changePassword(
      this.requireUser(request),
      this.parseBody(changePasswordSchema, body),
      this.getRequestContext(request)
    );
  }

  private parseBody<T>(schema: ZodSchema<T>, body: unknown): T {
    const result = schema.safeParse(body);

    if (!result.success) {
      throw new BadRequestException({
        message: "Invalid request body",
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      });
    }

    return result.data;
  }

  private getRequestContext(request: RequestWithUser): RequestContext {
    return {
      ipAddress: request.ip ?? null,
      userAgent: request.get?.("user-agent") ?? null
    };
  }

  private requireUser(request: RequestWithUser) {
    if (!request.user) {
      throw new BadRequestException("Missing authenticated user");
    }

    return request.user;
  }
}
