import { Module, forwardRef } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuditModule } from "../audit/audit.module.js";
import { NotificationModule } from "../notifications/notification.module.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { AccessTokenGuard } from "./access-token.guard.js";
import { PasswordService } from "./password.service.js";
import { TokenService } from "./token.service.js";

@Module({
  imports: [AuditModule, JwtModule.register({}), forwardRef(() => NotificationModule)],
  controllers: [AuthController],
  providers: [AuthService, AccessTokenGuard, PasswordService, TokenService],
  exports: [AuthService, AccessTokenGuard, JwtModule, PasswordService, TokenService]
})
export class AuthModule {}
