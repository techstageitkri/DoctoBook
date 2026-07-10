import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { UserStatus } from "@doctobook/database";
import { parseServerEnv } from "@doctobook/config";
import { PrismaService } from "../database/prisma.service.js";
import { AccessTokenPayload, RequestWithUser } from "./auth.types.js";

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException("Missing access token");
    }

    const env = parseServerEnv(process.env);
    const payload = await this.jwtService
      .verifyAsync<AccessTokenPayload>(token, {
        secret: env.JWT_ACCESS_TOKEN_SECRET
      })
      .catch(() => {
        throw new UnauthorizedException("Invalid access token");
      });

    if (payload.type !== "access") {
      throw new UnauthorizedException("Invalid access token");
    }

    const session = await this.prisma.authSession.findUnique({
      where: { id: payload.sessionId },
      include: { user: true }
    });

    if (
      !session ||
      session.userId !== payload.sub ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.status !== UserStatus.ACTIVE ||
      session.user.deletedAt
    ) {
      throw new UnauthorizedException("Session is no longer active");
    }

    request.user = {
      id: payload.sub,
      sessionId: payload.sessionId,
      roles: payload.roles
    };

    return true;
  }

  private extractBearerToken(request: RequestWithUser): string | null {
    const authorization = request.headers.authorization;
    const value = Array.isArray(authorization) ? authorization[0] : authorization;

    if (!value?.startsWith("Bearer ")) {
      return null;
    }

    return value.slice("Bearer ".length).trim();
  }
}
