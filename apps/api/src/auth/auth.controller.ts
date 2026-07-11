import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards
} from "@nestjs/common";
import { parseServerEnv } from "@doctobook/config";
import type { CookieOptions, Response } from "express";
import { ZodSchema } from "zod";
import { AccessTokenGuard } from "./access-token.guard.js";
import {
  legacyRefreshCookiePath,
  refreshCookieName,
  refreshCookiePath,
  refreshTokenTtlMs
} from "./auth.cookies.js";
import {
  browserLogoutSchema,
  browserRefreshSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  requestEmailVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema
} from "./auth.schemas.js";
import { AuthService } from "./auth.service.js";
import { RequestContext, RequestWithUser } from "./auth.types.js";

type BrowserTokenResponse = {
  accessToken: string;
  expiresInSeconds: number;
  user: {
    id: string;
    email: string | null;
    fullName: string;
    status: string;
    roles: string[];
  };
};

@Controller(["auth", "v1/auth"])
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
  async login(
    @Body() body: unknown,
    @Req() request: RequestWithUser,
    @Res({ passthrough: true }) response: Response
  ) {
    const result = await this.authService.login(
      this.parseBody(loginSchema, body),
      this.getRequestContext(request)
    );

    this.setRefreshCookie(response, result.refreshToken, request);
    return this.toBrowserTokenResponse(result);
  }

  @Post("refresh")
  async refresh(
    @Body() body: unknown,
    @Req() request: RequestWithUser,
    @Res({ passthrough: true }) response: Response
  ) {
    const input = this.parseBody(browserRefreshSchema, body ?? {});
    const refreshToken = input.refreshToken ?? this.readRefreshCookie(request);

    if (!refreshToken) {
      throw new UnauthorizedException("Missing refresh token");
    }

    const result = await this.authService.refresh({ refreshToken }, this.getRequestContext(request));

    this.setRefreshCookie(response, result.refreshToken, request);
    return this.toBrowserTokenResponse(result);
  }

  @Post("logout")
  async logout(
    @Body() body: unknown,
    @Req() request: RequestWithUser,
    @Res({ passthrough: true }) response: Response
  ) {
    const input = this.parseBody(browserLogoutSchema, body ?? {});
    const refreshToken = input.refreshToken ?? this.readRefreshCookie(request);

    this.clearRefreshCookie(response, request);

    if (!refreshToken) {
      return { revoked: false };
    }

    return this.authService.logout({ refreshToken }, this.getRequestContext(request));
  }

  @UseGuards(AccessTokenGuard)
  @Post("logout-all")
  async logoutAll(
    @Req() request: RequestWithUser,
    @Res({ passthrough: true }) response: Response
  ) {
    this.clearRefreshCookie(response, request);
    return this.authService.logoutAll(this.requireUser(request), this.getRequestContext(request));
  }

  @UseGuards(AccessTokenGuard)
  @Get("me")
  me(@Req() request: RequestWithUser) {
    return this.authService.me(this.requireUser(request));
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

  private toBrowserTokenResponse(response: BrowserTokenResponse & { refreshToken: string }) {
    return {
      accessToken: response.accessToken,
      expiresInSeconds: response.expiresInSeconds,
      user: response.user
    };
  }

  private setRefreshCookie(response: Response, refreshToken: string, request: RequestWithUser) {
    response.cookie(refreshCookieName, refreshToken, {
      ...this.refreshCookieOptions(request),
      maxAge: refreshTokenTtlMs
    });
  }

  private clearRefreshCookie(response: Response, request: RequestWithUser) {
    response.clearCookie(refreshCookieName, this.refreshCookieOptions(request));
  }

  private refreshCookieOptions(request: RequestWithUser): CookieOptions {
    const env = parseServerEnv(process.env);

    return {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      path: this.refreshCookiePathForRequest(request)
    };
  }

  private refreshCookiePathForRequest(request: RequestWithUser) {
    const path = request.originalUrl ?? request.url ?? "";

    return path.startsWith(refreshCookiePath) ? refreshCookiePath : legacyRefreshCookiePath;
  }

  private readRefreshCookie(request: RequestWithUser) {
    const cookieHeader = this.headerValue(request.headers.cookie);

    if (!cookieHeader) {
      return null;
    }

    for (const cookie of cookieHeader.split(";")) {
      const [rawName, ...rawValue] = cookie.trim().split("=");

      if (rawName === refreshCookieName) {
        return decodeURIComponent(rawValue.join("="));
      }
    }

    return null;
  }

  private headerValue(value: string | string[] | undefined) {
    return Array.isArray(value) ? value[0] : value;
  }
}
