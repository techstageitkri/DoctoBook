import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { RequestWithUser } from "../auth/auth.types.js";
import { PaymentService } from "./payment.service.js";

@Controller("v1")
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @UseGuards(AccessTokenGuard)
  @Get("patient/appointments/:appointmentId/payment")
  getAppointmentPayment(@Param("appointmentId") appointmentId: string, @Req() request: RequestWithUser) {
    return this.paymentService.getPatientAppointmentPayment(this.requireUser(request), appointmentId);
  }

  @Post("payments/webhooks/:provider")
  processWebhook(
    @Param("provider") provider: string,
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>
  ) {
    return this.paymentService.processWebhook(provider, body, headers);
  }

  private requireUser(request: RequestWithUser) {
    if (!request.user) {
      throw new BadRequestException("Missing authenticated user");
    }

    return request.user;
  }
}
