import { Controller, Get } from "@nestjs/common";
import { HealthService } from "./security/health.service.js";

@Controller()
export class AppController {
  constructor(private readonly healthService: HealthService) {}

  @Get("health")
  health() {
    return this.healthService.live();
  }

  @Get("health/live")
  live() {
    return this.healthService.live();
  }

  @Get("health/ready")
  ready() {
    return this.healthService.ready();
  }
}
