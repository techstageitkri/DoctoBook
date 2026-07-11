import {
  BadRequestException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Query
} from "@nestjs/common";
import { ZodSchema } from "zod";
import {
  doctorClinicAvailabilityQuerySchema,
  listPublicClinicsQuerySchema,
  listPublicDoctorsQuerySchema,
  publicAvailabilityQuerySchema
} from "./public-marketplace.schemas.js";
import { PublicMarketplaceService } from "./public-marketplace.service.js";

@Controller("v1/public")
export class PublicMarketplaceController {
  constructor(private readonly publicMarketplaceService: PublicMarketplaceService) {}

  @Header("Cache-Control", "public, max-age=300")
  @Get("specialties")
  listSpecialties() {
    return this.publicMarketplaceService.listSpecialties();
  }

  @Header("Cache-Control", "public, max-age=300")
  @Get("services")
  listServices() {
    return this.publicMarketplaceService.listServices();
  }

  @Header("Cache-Control", "public, max-age=120")
  @Get("clinics")
  listClinics(@Query() query: unknown) {
    return this.publicMarketplaceService.listClinics(
      this.parseQuery(listPublicClinicsQuerySchema, query)
    );
  }

  @Header("Cache-Control", "public, max-age=300")
  @Get("clinics/:clinicSlug")
  async getClinic(@Param("clinicSlug") clinicSlug: string) {
    const clinic = await this.publicMarketplaceService.getClinic(clinicSlug);

    if (!clinic) {
      throw new NotFoundException("Clinic not found");
    }

    return clinic;
  }

  @Header("Cache-Control", "public, max-age=120")
  @Get("doctors")
  listDoctors(@Query() query: unknown) {
    return this.publicMarketplaceService.listDoctors(
      this.parseQuery(listPublicDoctorsQuerySchema, query)
    );
  }

  @Header("Cache-Control", "public, max-age=300")
  @Get("doctors/:doctorSlug")
  async getDoctor(@Param("doctorSlug") doctorSlug: string) {
    const doctor = await this.publicMarketplaceService.getDoctor(doctorSlug);

    if (!doctor) {
      throw new NotFoundException("Doctor not found");
    }

    return doctor;
  }

  @Header("Cache-Control", "public, max-age=120")
  @Get("doctors/:doctorId/clinics")
  listDoctorClinics(@Param("doctorId") doctorId: string) {
    return this.publicMarketplaceService.listDoctorClinics(doctorId);
  }

  @Header("Cache-Control", "public, max-age=120")
  @Get("doctors/:doctorId/services")
  listDoctorServices(@Param("doctorId") doctorId: string) {
    return this.publicMarketplaceService.listDoctorServices(doctorId);
  }

  @Header("Cache-Control", "no-store")
  @Get("availability")
  listAvailability(@Query() query: unknown) {
    return this.publicMarketplaceService.listAvailability(
      this.parseQuery(publicAvailabilityQuerySchema, query)
    );
  }

  @Header("Cache-Control", "no-store")
  @Get("doctor-clinics/:doctorClinicId/availability")
  listDoctorClinicAvailability(
    @Param("doctorClinicId") doctorClinicId: string,
    @Query() query: unknown
  ) {
    return this.publicMarketplaceService.listDoctorClinicAvailability(
      doctorClinicId,
      this.parseQuery(doctorClinicAvailabilityQuerySchema, query)
    );
  }

  private parseQuery<T>(schema: ZodSchema<T>, query: unknown): T {
    const result = schema.safeParse(query);

    if (!result.success) {
      throw new BadRequestException({
        message: "Invalid request",
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      });
    }

    return result.data;
  }
}
