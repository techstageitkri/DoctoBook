import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuditModule } from "../audit/audit.module.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { AccessTokenGuard } from "./access-token.guard.js";
import { PasswordService } from "./password.service.js";
import { TokenService } from "./token.service.js";

@Module({
  imports: [AuditModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, AccessTokenGuard, PasswordService, TokenService],
  exports: [AuthService, AccessTokenGuard, PasswordService, TokenService]
})
export class AuthModule {}
