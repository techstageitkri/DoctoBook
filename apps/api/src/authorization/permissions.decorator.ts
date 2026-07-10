import { SetMetadata } from "@nestjs/common";
import { PermissionRequirement } from "./authorization.types.js";

export const PERMISSION_REQUIREMENTS_KEY = "permission_requirements";

export function RequirePermissions(...requirements: PermissionRequirement[]) {
  return SetMetadata(PERMISSION_REQUIREMENTS_KEY, requirements);
}
