import { Module } from "@nestjs/common";
import { AuthorizationService } from "./authorization.service.js";
import { PermissionsGuard } from "./permissions.guard.js";

@Module({
  providers: [AuthorizationService, PermissionsGuard],
  exports: [AuthorizationService, PermissionsGuard]
})
export class AuthorizationModule {}
