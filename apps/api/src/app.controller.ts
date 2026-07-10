import { Controller, Get } from "@nestjs/common";
import { APP_NAME } from "@doctobook/shared";

@Controller()
export class AppController {
  @Get("health")
  health() {
    return {
      app: APP_NAME,
      service: "api",
      status: "ok"
    };
  }
}
