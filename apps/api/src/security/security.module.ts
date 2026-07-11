import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { HealthService } from "./health.service.js";
import { RateLimitGuard } from "./rate-limit.guard.js";

@Module({
  providers: [
    HealthService,
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard
    }
  ],
  exports: [HealthService]
})
export class SecurityModule {}
