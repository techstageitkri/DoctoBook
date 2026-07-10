import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { DoctorStatus, Prisma, UserStatus } from "@doctobook/database";
import { parseServerEnv } from "@doctobook/config";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  LogoutInput,
  RefreshInput,
  RegisterInput,
  RequestEmailVerificationInput,
  ResetPasswordInput,
  VerifyEmailInput
} from "./auth.schemas.js";
import { AuthenticatedUser, RequestContext } from "./auth.types.js";
import { PasswordService } from "./password.service.js";
import { TokenService } from "./token.service.js";

type UserForAuth = Prisma.UserGetPayload<{
  include: {
    roles: {
      include: {
        role: true;
      };
    };
  };
}>;

type TokenResponse = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  user: {
    id: string;
    email: string | null;
    fullName: string;
    status: UserStatus;
    roles: string[];
  };
};

const accessTokenTtlSeconds = 15 * 60;
const refreshTokenTtlDays = 30;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly auditService: AuditService
  ) {}

  async register(input: RegisterInput, context: RequestContext) {
    const existingUser = await this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        OR: [{ email: input.email }, ...(input.phone ? [{ phone: input.phone }] : [])]
      },
      select: { id: true }
    });

    if (existingUser) {
      throw new ConflictException("An account already exists for this email or phone");
    }

    const passwordHash = await this.passwordService.hash(input.password);
    const result = await this.prisma.$transaction(async (tx) => {
      const role = await tx.role.findUnique({
        where: { code: input.accountType },
        select: { id: true }
      });

      if (!role) {
        throw new BadRequestException(`Missing seeded role: ${input.accountType}`);
      }

      const user = await tx.user.create({
        data: {
          email: input.email,
          phone: input.phone,
          fullName: input.fullName,
          passwordHash,
          status: UserStatus.PENDING_VERIFICATION
        },
        select: {
          id: true,
          email: true,
          fullName: true,
          status: true
        }
      });

      if (input.accountType === "patient") {
        await tx.patient.create({
          data: { userId: user.id }
        });
      } else {
        await tx.doctor.create({
          data: {
            userId: user.id,
            slug: this.createDoctorSlug(input.fullName),
            status: DoctorStatus.PENDING_APPROVAL
          }
        });
      }

      await tx.userRole.create({
        data: {
          userId: user.id,
          roleId: role.id
        }
      });

      const verificationToken = await this.createVerificationToken(tx, {
        purpose: "email_verification",
        userId: user.id,
        email: input.email,
        expiresAt: this.addMinutes(new Date(), 60)
      });

      return { user, verificationToken };
    });

    await this.auditService.record({
      actorUserId: result.user.id,
      actionCode: "auth.register",
      entityType: "user",
      entityId: result.user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { accountType: input.accountType }
    });

    return {
      user: result.user,
      verificationToken: this.exposeDevelopmentToken(result.verificationToken)
    };
  }

  async login(input: LoginInput, context: RequestContext): Promise<TokenResponse> {
    const user = await this.prisma.user.findFirst({
      where: {
        email: input.email,
        deletedAt: null
      },
      include: {
        roles: {
          include: {
            role: true
          }
        }
      }
    });

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const passwordMatches = await this.passwordService.verify(input.password, user.passwordHash);

    if (!passwordMatches) {
      throw new UnauthorizedException("Invalid credentials");
    }

    return this.createSession(user, input, context);
  }

  async refresh(input: RefreshInput, context: RequestContext): Promise<TokenResponse> {
    const refreshTokenHash = this.tokenService.hashToken(input.refreshToken);
    const session = await this.prisma.authSession.findUnique({
      where: { refreshTokenHash },
      include: {
        user: {
          include: {
            roles: {
              include: {
                role: true
              }
            }
          }
        }
      }
    });

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.status !== UserStatus.ACTIVE ||
      session.user.deletedAt
    ) {
      throw new UnauthorizedException("Invalid refresh token");
    }

    const nextRefreshToken = this.tokenService.createOpaqueToken();
    await this.prisma.authSession.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: this.tokenService.hashToken(nextRefreshToken),
        lastUsedAt: new Date(),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent
      }
    });

    await this.auditService.record({
      actorUserId: session.userId,
      actionCode: "auth.session.rotate",
      entityType: "auth_session",
      entityId: session.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent
    });

    return this.createTokenResponse(session.user, session.id, nextRefreshToken);
  }

  async logout(input: LogoutInput, context: RequestContext) {
    const refreshTokenHash = this.tokenService.hashToken(input.refreshToken);
    const session = await this.prisma.authSession.findUnique({
      where: { refreshTokenHash },
      select: { id: true, userId: true, revokedAt: true }
    });

    if (!session || session.revokedAt) {
      return { revoked: false };
    }

    await this.prisma.authSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() }
    });

    await this.auditService.record({
      actorUserId: session.userId,
      actionCode: "auth.logout",
      entityType: "auth_session",
      entityId: session.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent
    });

    return { revoked: true };
  }

  async logoutAll(user: AuthenticatedUser, context: RequestContext) {
    const result = await this.prisma.authSession.updateMany({
      where: {
        userId: user.id,
        revokedAt: null
      },
      data: { revokedAt: new Date() }
    });

    await this.auditService.record({
      actorUserId: user.id,
      actorRole: user.roles[0] ?? null,
      actionCode: "auth.logout_all",
      entityType: "user",
      entityId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { revokedSessions: result.count }
    });

    return { revokedSessions: result.count };
  }

  async listSessions(user: AuthenticatedUser) {
    const sessions = await this.prisma.authSession.findMany({
      where: {
        userId: user.id,
        revokedAt: null,
        expiresAt: { gt: new Date() }
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        deviceId: true,
        deviceName: true,
        ipAddress: true,
        userAgent: true,
        expiresAt: true,
        lastUsedAt: true,
        createdAt: true
      }
    });

    return {
      sessions: sessions.map((session) => ({
        ...session,
        current: session.id === user.sessionId
      }))
    };
  }

  async requestEmailVerification(input: RequestEmailVerificationInput, context: RequestContext) {
    const user = await this.prisma.user.findFirst({
      where: {
        email: input.email,
        deletedAt: null
      },
      select: {
        id: true,
        email: true,
        emailVerifiedAt: true
      }
    });

    if (!user || user.emailVerifiedAt || !user.email) {
      return { sent: true };
    }

    const verificationToken = await this.createVerificationToken(this.prisma, {
      purpose: "email_verification",
      userId: user.id,
      email: user.email,
      expiresAt: this.addMinutes(new Date(), 60)
    });

    await this.auditService.record({
      actorUserId: user.id,
      actionCode: "auth.email_verification.request",
      entityType: "user",
      entityId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent
    });

    return {
      sent: true,
      verificationToken: this.exposeDevelopmentToken(verificationToken)
    };
  }

  async verifyEmail(input: VerifyEmailInput, context: RequestContext) {
    const tokenHash = this.tokenService.hashToken(input.token);
    const result = await this.prisma.$transaction(async (tx) => {
      const verificationToken = await tx.verificationToken.findUnique({
        where: { tokenHash },
        include: {
          user: true
        }
      });

      if (
        !verificationToken ||
        verificationToken.purpose !== "email_verification" ||
        verificationToken.usedAt ||
        verificationToken.expiresAt <= new Date() ||
        !verificationToken.user
      ) {
        throw new BadRequestException("Invalid verification token");
      }

      const user = await tx.user.update({
        where: { id: verificationToken.user.id },
        data: {
          emailVerifiedAt: new Date(),
          status:
            verificationToken.user.status === UserStatus.PENDING_VERIFICATION
              ? UserStatus.ACTIVE
              : verificationToken.user.status
        },
        select: {
          id: true,
          email: true,
          fullName: true,
          status: true
        }
      });

      await tx.verificationToken.update({
        where: { id: verificationToken.id },
        data: { usedAt: new Date() }
      });

      return user;
    });

    await this.auditService.record({
      actorUserId: result.id,
      actionCode: "auth.email.verify",
      entityType: "user",
      entityId: result.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent
    });

    return { user: result };
  }

  async forgotPassword(input: ForgotPasswordInput, context: RequestContext) {
    const user = await this.prisma.user.findFirst({
      where: {
        email: input.email,
        deletedAt: null
      },
      select: {
        id: true,
        email: true,
        status: true
      }
    });

    if (!user || !user.email || user.status !== UserStatus.ACTIVE) {
      return { sent: true };
    }

    const resetToken = await this.createVerificationToken(this.prisma, {
      purpose: "password_reset",
      userId: user.id,
      email: user.email,
      expiresAt: this.addMinutes(new Date(), 30)
    });

    await this.auditService.record({
      actorUserId: user.id,
      actionCode: "password.reset.request",
      entityType: "user",
      entityId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent
    });

    return {
      sent: true,
      resetToken: this.exposeDevelopmentToken(resetToken)
    };
  }

  async resetPassword(input: ResetPasswordInput, context: RequestContext) {
    const tokenHash = this.tokenService.hashToken(input.token);
    const passwordHash = await this.passwordService.hash(input.newPassword);
    const userId = await this.prisma.$transaction(async (tx) => {
      const resetToken = await tx.verificationToken.findUnique({
        where: { tokenHash },
        include: { user: true }
      });

      if (
        !resetToken ||
        resetToken.purpose !== "password_reset" ||
        resetToken.usedAt ||
        resetToken.expiresAt <= new Date() ||
        !resetToken.user ||
        resetToken.user.deletedAt
      ) {
        throw new BadRequestException("Invalid reset token");
      }

      await tx.user.update({
        where: { id: resetToken.user.id },
        data: { passwordHash }
      });
      await tx.verificationToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() }
      });
      await tx.authSession.updateMany({
        where: {
          userId: resetToken.user.id,
          revokedAt: null
        },
        data: { revokedAt: new Date() }
      });

      return resetToken.user.id;
    });

    await this.auditService.record({
      actorUserId: userId,
      actionCode: "password.reset",
      entityType: "user",
      entityId: userId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent
    });

    return { reset: true };
  }

  async changePassword(
    user: AuthenticatedUser,
    input: ChangePasswordInput,
    context: RequestContext
  ) {
    const storedUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        passwordHash: true,
        status: true,
        deletedAt: true
      }
    });

    if (
      !storedUser ||
      storedUser.status !== UserStatus.ACTIVE ||
      storedUser.deletedAt ||
      !(await this.passwordService.verify(input.currentPassword, storedUser.passwordHash))
    ) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const passwordHash = await this.passwordService.hash(input.newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash }
      }),
      this.prisma.authSession.updateMany({
        where: {
          userId: user.id,
          revokedAt: null
        },
        data: { revokedAt: new Date() }
      })
    ]);

    await this.auditService.record({
      actorUserId: user.id,
      actorRole: user.roles[0] ?? null,
      actionCode: "password.change",
      entityType: "user",
      entityId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent
    });

    return { changed: true };
  }

  async revokeUserSessions(
    userId: string,
    actor: AuthenticatedUser | null,
    context: RequestContext
  ) {
    const result = await this.prisma.authSession.updateMany({
      where: {
        userId,
        revokedAt: null
      },
      data: { revokedAt: new Date() }
    });

    await this.auditService.record({
      actorUserId: actor?.id ?? null,
      actorRole: actor?.roles[0] ?? null,
      actionCode: "auth.session.revoke",
      entityType: "user",
      entityId: userId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { revokedSessions: result.count }
    });

    return { revokedSessions: result.count };
  }

  private async createSession(
    user: UserForAuth,
    input: Pick<LoginInput, "deviceId" | "deviceName">,
    context: RequestContext
  ): Promise<TokenResponse> {
    const refreshToken = this.tokenService.createOpaqueToken();
    const session = await this.prisma.authSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: this.tokenService.hashToken(refreshToken),
        deviceId: input.deviceId,
        deviceName: input.deviceName,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        expiresAt: this.addDays(new Date(), refreshTokenTtlDays)
      }
    });

    await this.auditService.record({
      actorUserId: user.id,
      actorRole: this.getRoleCodes(user)[0] ?? null,
      actionCode: "auth.login",
      entityType: "auth_session",
      entityId: session.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent
    });

    return this.createTokenResponse(user, session.id, refreshToken);
  }

  private async createTokenResponse(
    user: UserForAuth,
    sessionId: string,
    refreshToken: string
  ): Promise<TokenResponse> {
    const roles = this.getRoleCodes(user);
    const env = parseServerEnv(process.env);
    const accessToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        sessionId,
        roles,
        type: "access"
      },
      {
        secret: env.JWT_ACCESS_TOKEN_SECRET,
        expiresIn: accessTokenTtlSeconds
      }
    );

    return {
      accessToken,
      refreshToken,
      expiresInSeconds: accessTokenTtlSeconds,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        status: user.status,
        roles
      }
    };
  }

  private async createVerificationToken(
    client: Prisma.TransactionClient | PrismaService,
    input: {
      purpose: string;
      userId: string;
      email: string;
      expiresAt: Date;
    }
  ) {
    const token = this.tokenService.createOpaqueToken();

    await client.verificationToken.create({
      data: {
        userId: input.userId,
        email: input.email,
        purpose: input.purpose,
        tokenHash: this.tokenService.hashToken(token),
        expiresAt: input.expiresAt
      }
    });

    return token;
  }

  private getRoleCodes(user: UserForAuth): string[] {
    return user.roles.map((userRole) => userRole.role.code);
  }

  private createDoctorSlug(fullName: string): string {
    const base = fullName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
    const suffix = this.tokenService.createOpaqueToken(6).toLowerCase();
    return `${base || "doctor"}-${suffix}`;
  }

  private exposeDevelopmentToken(token: string) {
    return process.env.NODE_ENV === "production" ? undefined : token;
  }

  private addMinutes(date: Date, minutes: number) {
    return new Date(date.getTime() + minutes * 60 * 1000);
  }

  private addDays(date: Date, days: number) {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
  }
}
