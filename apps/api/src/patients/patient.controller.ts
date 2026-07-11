import { BadRequestException, Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { RequestWithUser } from "../auth/auth.types.js";
import { PatientService } from "./patient.service.js";

@UseGuards(AccessTokenGuard)
@Controller("v1/patient")
export class PatientController {
  constructor(private readonly patientService: PatientService) {}

  @Get("me")
  getMe(@Req() request: RequestWithUser) {
    return this.patientService.getMe(this.requireUser(request));
  }

  @Get("appointments")
  listAppointments(@Req() request: RequestWithUser) {
    return this.patientService.listAppointments(this.requireUser(request));
  }

  @Get("appointments/:appointmentId")
  getAppointment(@Param("appointmentId") appointmentId: string, @Req() request: RequestWithUser) {
    return this.patientService.getAppointment(this.requireUser(request), appointmentId);
  }

  private requireUser(request: RequestWithUser) {
    if (!request.user) {
      throw new BadRequestException("Missing authenticated user");
    }

    return request.user;
  }
}
