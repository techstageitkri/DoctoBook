import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthorizationService } from "./authorization.service.js";
import { PERMISSION_REQUIREMENTS_KEY } from "./permissions.decorator.js";
import { PermissionRequirement } from "./authorization.types.js";
import { RequestWithUser } from "../auth/auth.types.js";

type ScopedRequest = RequestWithUser & {
  params?: Record<string, string | undefined>;
  query?: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
};

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorizationService: AuthorizationService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirements =
      this.reflector.getAllAndOverride<PermissionRequirement[]>(PERMISSION_REQUIREMENTS_KEY, [
        context.getHandler(),
        context.getClass()
      ]) ?? [];

    if (requirements.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<ScopedRequest>();

    if (!request.user) {
      throw new ForbiddenException("Missing authenticated user");
    }

    for (const requirement of requirements) {
      const allowed = await this.authorizationService.can(request.user, requirement.code, {
        scope: requirement.scope,
        scopeId: this.resolveScopeId(requirement, request)
      });

      if (!allowed) {
        throw new ForbiddenException("Missing required permission");
      }
    }

    return true;
  }

  private resolveScopeId(requirement: PermissionRequirement, request: ScopedRequest) {
    if (requirement.scope === "platform") {
      return null;
    }

    if (requirement.scopeId) {
      return requirement.scopeId;
    }

    const key =
      requirement.param ??
      requirement.query ??
      requirement.body ??
      this.defaultScopeKey(requirement);

    if (requirement.param && request.params?.[key]) {
      return request.params[key] ?? null;
    }

    if (requirement.query && request.query?.[key]) {
      const value = request.query[key];
      return Array.isArray(value) ? (value[0] ?? null) : value;
    }

    if (requirement.body && request.body?.[key]) {
      return String(request.body[key]);
    }

    return (
      request.params?.[key] ??
      this.scalarQueryValue(request.query?.[key]) ??
      this.bodyValue(request, key)
    );
  }

  private defaultScopeKey(requirement: PermissionRequirement) {
    if (requirement.scope === "self") {
      return "userId";
    }

    return `${requirement.scope.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase())}Id`;
  }

  private scalarQueryValue(value: string | string[] | undefined) {
    if (!value) {
      return null;
    }

    return Array.isArray(value) ? (value[0] ?? null) : value;
  }

  private bodyValue(request: ScopedRequest, key: string) {
    const value = request.body?.[key];
    return value ? String(value) : null;
  }
}
