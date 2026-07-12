import { Injectable } from "@nestjs/common";
import {
  AppointmentStatus,
  ClinicAssociationStatus,
  ClinicStatus,
  DoctorStatus,
  PaymentMode,
  Prisma,
  ScopeType,
  SlotHoldStatus
} from "@doctobook/database";
import { PrismaService } from "../database/prisma.service.js";
import {
  DoctorClinicAvailabilityQuery,
  ListPublicClinicsQuery,
  ListPublicDoctorsQuery,
  PublicAvailabilityQuery
} from "./public-marketplace.schemas.js";

const blockingAppointmentStatuses = [
  AppointmentStatus.PENDING_PAYMENT,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.CHECKED_IN,
  AppointmentStatus.WAITING,
  AppointmentStatus.IN_PROGRESS
];

@Injectable()
export class PublicMarketplaceService {
  constructor(private readonly prisma: PrismaService) {}

  async listSpecialties() {
    const specialties = await this.prisma.specialty.findMany({
      where: { isActive: true },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        parentId: true
      }
    });

    return { specialties };
  }

  async listServices() {
    const services = await this.prisma.service.findMany({
      where: { isActive: true },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        defaultDurationMinutes: true
      }
    });

    return { services };
  }

  async listClinics(query: ListPublicClinicsQuery) {
    const clinics = await this.prisma.clinic.findMany({
      where: this.buildClinicWhere(query),
      orderBy: [{ name: "asc" }],
      take: query.limit,
      include: this.clinicListInclude()
    });

    return {
      clinics: clinics.map((clinic) => this.serializeClinicSummary(clinic))
    };
  }

  async getClinic(clinicSlug: string) {
    const clinic = await this.prisma.clinic.findFirst({
      where: {
        slug: clinicSlug,
        status: ClinicStatus.ACTIVE,
        deletedAt: null
      },
      include: this.clinicDetailInclude()
    });

    if (!clinic) {
      return null;
    }

    return this.serializeClinicDetail(clinic);
  }

  async listDoctors(query: ListPublicDoctorsQuery) {
    const doctors = await this.prisma.doctor.findMany({
      where: this.buildDoctorWhere(query),
      orderBy: [{ user: { fullName: "asc" } }],
      take: Math.min(query.limit * 4, 500),
      include: this.doctorListInclude()
    });
    const filteredDoctors = doctors
      .filter((doctor) => this.matchesFeeFilter(doctor, query))
      .slice(0, query.limit);

    return {
      doctors: filteredDoctors.map((doctor) => this.serializeDoctorSummary(doctor))
    };
  }

  async getDoctor(doctorSlug: string) {
    const doctor = await this.prisma.doctor.findFirst({
      where: {
        slug: doctorSlug,
        status: DoctorStatus.APPROVED,
        deletedAt: null,
        clinics: {
          some: this.activeDoctorClinicWhere()
        }
      },
      include: this.doctorDetailInclude()
    });

    if (!doctor) {
      return null;
    }

    return this.serializeDoctorDetail(doctor);
  }

  async listDoctorClinics(doctorId: string) {
    const doctorClinics = await this.prisma.doctorClinic.findMany({
      where: {
        doctorId,
        ...this.activeDoctorClinicWhere(),
        doctor: {
          status: DoctorStatus.APPROVED,
          deletedAt: null
        }
      },
      orderBy: [{ clinic: { name: "asc" } }],
      include: {
        clinic: true,
        clinicLocation: true
      }
    });

    return {
      doctorClinics: doctorClinics.map((doctorClinic) =>
        this.serializeDoctorClinicSummary(doctorClinic)
      )
    };
  }

  async listDoctorServices(doctorId: string) {
    const platformPaymentMode = await this.getPlatformDefaultPaymentMode();
    const doctorClinics = await this.prisma.doctorClinic.findMany({
      where: {
        doctorId,
        ...this.activeDoctorClinicWhere(),
        doctor: {
          status: DoctorStatus.APPROVED,
          deletedAt: null
        }
      },
      orderBy: [{ clinic: { name: "asc" } }],
      include: this.doctorClinicWithServicesInclude()
    });

    return {
      doctorServices: doctorClinics.flatMap((doctorClinic) =>
        doctorClinic.doctorClinicServices.map((doctorClinicService) =>
          this.serializeDoctorClinicService(doctorClinic, doctorClinicService, platformPaymentMode)
        )
      )
    };
  }

  async listAvailability(query: PublicAvailabilityQuery) {
    return this.listAvailabilityForWhere(this.buildAvailabilityWhere(query), query);
  }

  async listDoctorClinicAvailability(
    doctorClinicId: string,
    query: DoctorClinicAvailabilityQuery
  ) {
    return this.listAvailabilityForWhere(
      this.buildAvailabilityWhere({
        ...query,
        doctorClinicId
      }),
      query
    );
  }

  private async listAvailabilityForWhere(
    where: Prisma.AppointmentSlotWhereInput,
    query: PublicAvailabilityQuery | DoctorClinicAvailabilityQuery
  ) {
    const platformPaymentMode = await this.getPlatformDefaultPaymentMode();
    const normalizedRange = this.normalizeDateRange(query.fromDate, query.toDate);
    const slots = await this.prisma.appointmentSlot.findMany({
      where,
      orderBy: [{ startsAt: "asc" }],
      take: Math.min(query.limit * 4, 500),
      include: this.slotInclude()
    });
    const dateFilteredSlots = slots.filter((slot) =>
      this.isSlotInsideLocalDateRange(
        slot.startsAt,
        slot.doctorClinic.clinicLocation.timezone,
        normalizedRange.fromDate,
        normalizedRange.toDate
      )
    );
    const availableSlots = await this.filterSlotsWithoutDoctorConflicts(dateFilteredSlots);

    return {
      availability: availableSlots.slice(0, query.limit).map((slot) =>
        this.serializeAvailabilitySlot(slot, platformPaymentMode)
      )
    };
  }

  private buildClinicWhere(query: ListPublicClinicsQuery): Prisma.ClinicWhereInput {
    return {
      status: ClinicStatus.ACTIVE,
      deletedAt: null,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { slug: { contains: query.search, mode: "insensitive" } }
            ]
          }
        : {}),
      ...(query.city || query.district
        ? {
            locations: {
              some: {
                status: ClinicStatus.ACTIVE,
                deletedAt: null,
                ...(query.city ? { city: { contains: query.city, mode: "insensitive" } } : {}),
                ...(query.district
                  ? { district: { contains: query.district, mode: "insensitive" } }
                  : {})
              }
            }
          }
        : {}),
      ...(query.specialtyId || query.serviceId
        ? {
            doctorClinics: {
              some: {
                ...this.activeDoctorClinicWhere(),
                doctor: {
                  status: DoctorStatus.APPROVED,
                  deletedAt: null,
                  ...(query.specialtyId
                    ? { specialties: { some: { specialtyId: query.specialtyId } } }
                    : {})
                },
                ...(query.serviceId
                  ? {
                      doctorClinicServices: {
                        some: this.activeDoctorClinicServiceWhere(query.serviceId)
                      }
                    }
                  : {})
              }
            }
          }
        : {})
    };
  }

  private buildDoctorWhere(query: ListPublicDoctorsQuery): Prisma.DoctorWhereInput {
    const hasAssociationFilter =
      query.clinicId || query.city || query.district || query.serviceId || query.availableDate;

    return {
      status: DoctorStatus.APPROVED,
      deletedAt: null,
      ...(query.search
        ? {
            OR: [
              { slug: { contains: query.search, mode: "insensitive" } },
              { user: { fullName: { contains: query.search, mode: "insensitive" } } }
            ]
          }
        : {}),
      ...(query.specialtyId ? { specialties: { some: { specialtyId: query.specialtyId } } } : {}),
      ...(query.language ? { languages: { has: query.language } } : {}),
      ...(query.minRating !== undefined
        ? { ratingSummary: { averageRating: { gte: query.minRating } } }
        : {}),
      clinics: {
        some: {
          ...this.activeDoctorClinicWhere(),
          ...(hasAssociationFilter ? this.buildDoctorAssociationSearchWhere(query) : {})
        }
      }
    };
  }

  private buildDoctorAssociationSearchWhere(
    query: ListPublicDoctorsQuery
  ): Prisma.DoctorClinicWhereInput {
    return {
      ...(query.clinicId ? { clinicId: query.clinicId } : {}),
      ...(query.city || query.district
        ? {
            clinicLocation: {
              status: ClinicStatus.ACTIVE,
              deletedAt: null,
              ...(query.city ? { city: { contains: query.city, mode: "insensitive" } } : {}),
              ...(query.district
                ? { district: { contains: query.district, mode: "insensitive" } }
                : {})
            }
          }
        : {}),
      ...(query.serviceId
        ? {
            doctorClinicServices: {
              some: this.activeDoctorClinicServiceWhere(query.serviceId)
            }
          }
        : {}),
      ...(query.availableDate
        ? {
            appointmentSlots: {
              some: this.activeSlotWhere({
                fromDate: query.availableDate,
                toDate: query.availableDate,
                serviceId: query.serviceId
              })
            }
          }
        : {})
    };
  }

  private buildAvailabilityWhere(
    query: PublicAvailabilityQuery & { doctorClinicId?: string }
  ): Prisma.AppointmentSlotWhereInput {
    const normalizedRange = this.normalizeDateRange(query.fromDate, query.toDate);

    return {
      ...this.activeSlotWhere({
        fromDate: normalizedRange.fromDate,
        toDate: normalizedRange.toDate,
        serviceId: query.serviceId
      }),
      ...(query.doctorClinicId ? { doctorClinicId: query.doctorClinicId } : {}),
      doctorClinic: {
        ...this.activeDoctorClinicWhere(),
        ...(query.doctorId ? { doctorId: query.doctorId } : {}),
        ...(query.clinicId ? { clinicId: query.clinicId } : {}),
        ...(query.clinicLocationId ? { clinicLocationId: query.clinicLocationId } : {}),
        doctor: {
          status: DoctorStatus.APPROVED,
          deletedAt: null,
          ...(query.specialtyId
            ? { specialties: { some: { specialtyId: query.specialtyId } } }
            : {})
        }
      }
    };
  }

  private activeSlotWhere(input: {
    fromDate: string;
    toDate: string;
    serviceId?: string;
  }): Prisma.AppointmentSlotWhereInput {
    const now = new Date();
    const broadRange = this.toBroadUtcRange(input.fromDate, input.toDate);

    return {
      isActive: true,
      startsAt: {
        gte: broadRange.startsAt > now ? broadRange.startsAt : now,
        lt: broadRange.endsAt
      },
      ...(input.serviceId
        ? {
            doctorClinicService: {
              ...this.activeDoctorClinicServiceWhere(input.serviceId)
            }
          }
        : {
            doctorClinicService: this.activeDoctorClinicServiceWhere()
          }),
      appointments: {
        none: {
          status: { in: blockingAppointmentStatuses }
        }
      },
      holds: {
        none: {
          status: SlotHoldStatus.ACTIVE,
          expiresAt: { gt: now }
        }
      }
    };
  }

  private activeDoctorClinicWhere(): Prisma.DoctorClinicWhereInput {
    return {
      status: ClinicAssociationStatus.APPROVED,
      deletedAt: null,
      clinic: {
        status: ClinicStatus.ACTIVE,
        deletedAt: null
      },
      clinicLocation: {
        status: ClinicStatus.ACTIVE,
        deletedAt: null
      }
    };
  }

  private activeDoctorClinicServiceWhere(serviceId?: string): Prisma.DoctorClinicServiceWhereInput {
    return {
      isActive: true,
      deletedAt: null,
      clinicService: {
        isActive: true,
        ...(serviceId ? { serviceId } : {}),
        service: {
          isActive: true
        }
      }
    };
  }

  private clinicListInclude() {
    return {
      locations: {
        where: { status: ClinicStatus.ACTIVE, deletedAt: null },
        orderBy: [{ isPrimary: "desc" }, { name: "asc" }]
      },
      clinicServices: {
        where: {
          isActive: true,
          service: { isActive: true }
        },
        include: { service: true },
        orderBy: [{ service: { name: "asc" } }]
      },
      doctorClinics: {
        where: {
          ...this.activeDoctorClinicWhere(),
          doctor: {
            status: DoctorStatus.APPROVED,
            deletedAt: null
          }
        },
        select: { id: true }
      }
    } satisfies Prisma.ClinicInclude;
  }

  private clinicDetailInclude() {
    return {
      ...this.clinicListInclude(),
      doctorClinics: {
        where: {
          ...this.activeDoctorClinicWhere(),
          doctor: {
            status: DoctorStatus.APPROVED,
            deletedAt: null
          }
        },
        include: {
          doctor: {
            include: {
              user: { select: { fullName: true } },
              specialties: { include: { specialty: true } },
              ratingSummary: true
            }
          },
          clinicLocation: true
        },
        orderBy: [{ doctor: { user: { fullName: "asc" } } }]
      }
    } satisfies Prisma.ClinicInclude;
  }

  private doctorListInclude() {
    return {
      user: { select: { fullName: true } },
      specialties: {
        include: { specialty: true }
      },
      ratingSummary: true,
      clinics: {
        where: this.activeDoctorClinicWhere(),
        include: this.doctorClinicWithServicesInclude(),
        orderBy: [{ clinic: { name: "asc" } }]
      }
    } satisfies Prisma.DoctorInclude;
  }

  private doctorDetailInclude() {
    return this.doctorListInclude();
  }

  private doctorClinicWithServicesInclude() {
    return {
      clinic: true,
      clinicLocation: true,
      doctorClinicServices: {
        where: this.activeDoctorClinicServiceWhere(),
        include: {
          clinicService: {
            include: {
              service: true
            }
          }
        },
        orderBy: [{ clinicService: { service: { name: "asc" } } }]
      }
    } satisfies Prisma.DoctorClinicInclude;
  }

  private slotInclude() {
    return {
      doctorClinicService: {
        include: {
          clinicService: {
            include: {
              service: true
            }
          }
        }
      },
      doctorClinic: {
        include: {
          clinic: true,
          clinicLocation: true,
          doctor: {
            include: {
              user: { select: { fullName: true } },
              ratingSummary: true
            }
          }
        }
      }
    } satisfies Prisma.AppointmentSlotInclude;
  }

  private async filterSlotsWithoutDoctorConflicts(slots: AvailabilitySlotRecord[]) {
    const availableSlots: AvailabilitySlotRecord[] = [];

    for (const slot of slots) {
      const conflictingAppointment = await this.prisma.appointment.findFirst({
        where: {
          doctorId: slot.doctorClinic.doctorId,
          status: { in: blockingAppointmentStatuses },
          startsAt: { lt: slot.endsAt },
          endsAt: { gt: slot.startsAt }
        },
        select: { id: true }
      });

      if (!conflictingAppointment) {
        availableSlots.push(slot);
      }
    }

    return availableSlots;
  }

  private serializeClinicSummary(clinic: ClinicListRecord) {
    return {
      id: clinic.id,
      name: clinic.name,
      slug: clinic.slug,
      description: clinic.description,
      email: clinic.email,
      phone: clinic.phone,
      websiteUrl: clinic.websiteUrl,
      locations: clinic.locations.map((location) => this.serializeLocation(location)),
      services: clinic.clinicServices.map((clinicService) =>
        this.serializeClinicServiceSummary(clinicService)
      ),
      activeDoctorCount: clinic.doctorClinics.length
    };
  }

  private serializeClinicDetail(clinic: ClinicDetailRecord) {
    return {
      ...this.serializeClinicSummary(clinic),
      doctors: clinic.doctorClinics.map((doctorClinic) => ({
        doctorClinicId: doctorClinic.id,
        doctorId: doctorClinic.doctor.id,
        doctorSlug: doctorClinic.doctor.slug,
        fullName: doctorClinic.doctor.user.fullName,
        specialties: doctorClinic.doctor.specialties
          .filter((entry) => entry.specialty.isActive)
          .map((entry) => this.serializeSpecialty(entry.specialty)),
        ratingSummary: this.serializeRatingSummary(doctorClinic.doctor.ratingSummary),
        location: this.serializeLocation(doctorClinic.clinicLocation)
      }))
    };
  }

  private serializeDoctorSummary(doctor: DoctorListRecord) {
    return {
      id: doctor.id,
      slug: doctor.slug,
      fullName: doctor.user.fullName,
      bio: doctor.bio,
      qualifications: doctor.qualifications,
      yearsExperience: doctor.yearsExperience,
      languages: doctor.languages,
      specialties: doctor.specialties
        .filter((entry) => entry.specialty.isActive)
        .map((entry) => this.serializeSpecialty(entry.specialty)),
      ratingSummary: this.serializeRatingSummary(doctor.ratingSummary),
      clinics: doctor.clinics.map((doctorClinic) =>
        this.serializeDoctorClinicSummary(doctorClinic)
      )
    };
  }

  private serializeDoctorDetail(doctor: DoctorDetailRecord) {
    return {
      ...this.serializeDoctorSummary(doctor),
      services: doctor.clinics.flatMap((doctorClinic) =>
        doctorClinic.doctorClinicServices.map((doctorClinicService) => ({
          doctorClinicId: doctorClinic.id,
          clinicId: doctorClinic.clinicId,
          clinicName: doctorClinic.clinic.name,
          clinicLocationId: doctorClinic.clinicLocationId,
          clinicLocationName: doctorClinic.clinicLocation.name,
          doctorClinicServiceId: doctorClinicService.id,
          serviceId: doctorClinicService.clinicService.serviceId,
          serviceName:
            doctorClinicService.clinicService.displayName ??
            doctorClinicService.clinicService.service.name,
          durationMinutes: doctorClinicService.durationMinutes,
          feeMinor: this.resolveFeeMinor(doctorClinic, doctorClinicService).toString(),
          currency: this.resolveCurrency(doctorClinic, doctorClinicService)
        }))
      )
    };
  }

  private serializeDoctorClinicSummary(doctorClinic: DoctorClinicSummaryRecord) {
    return {
      doctorClinicId: doctorClinic.id,
      clinicId: doctorClinic.clinicId,
      clinicSlug: doctorClinic.clinic.slug,
      clinicName: doctorClinic.clinic.name,
      clinicLocationId: doctorClinic.clinicLocationId,
      clinicLocationName: doctorClinic.clinicLocation.name,
      location: this.serializeLocation(doctorClinic.clinicLocation)
    };
  }

  private serializeDoctorClinicService(
    doctorClinic: DoctorClinicServiceParentRecord,
    doctorClinicService: DoctorClinicServiceRecord,
    platformPaymentMode: PaymentMode
  ) {
    return {
      doctorClinicId: doctorClinic.id,
      clinicId: doctorClinic.clinicId,
      clinicSlug: doctorClinic.clinic.slug,
      clinicName: doctorClinic.clinic.name,
      clinicLocationId: doctorClinic.clinicLocationId,
      clinicLocationName: doctorClinic.clinicLocation.name,
      doctorClinicServiceId: doctorClinicService.id,
      serviceId: doctorClinicService.clinicService.serviceId,
      serviceName:
        doctorClinicService.clinicService.displayName ??
        doctorClinicService.clinicService.service.name,
      durationMinutes: doctorClinicService.durationMinutes,
      feeMinor: this.resolveFeeMinor(doctorClinic, doctorClinicService).toString(),
      currency: this.resolveCurrency(doctorClinic, doctorClinicService),
      paymentMode: this.toWirePaymentMode(
        this.resolvePaymentMode(doctorClinic, doctorClinicService, platformPaymentMode)
      )
    };
  }

  private serializeAvailabilitySlot(
    slot: AvailabilitySlotRecord,
    platformPaymentMode: PaymentMode
  ) {
    const doctorClinic = slot.doctorClinic;
    const doctorClinicService = slot.doctorClinicService;

    return {
      slotId: slot.id,
      doctorClinicId: slot.doctorClinicId,
      doctorClinicServiceId: slot.doctorClinicServiceId,
      startsAt: slot.startsAt.toISOString(),
      endsAt: slot.endsAt.toISOString(),
      clinicTimezone: doctorClinic.clinicLocation.timezone,
      doctorId: doctorClinic.doctorId,
      doctorName: doctorClinic.doctor.user.fullName,
      clinicId: doctorClinic.clinicId,
      clinicName: doctorClinic.clinic.name,
      clinicLocationId: doctorClinic.clinicLocationId,
      clinicLocationName: doctorClinic.clinicLocation.name,
      serviceId: doctorClinicService.clinicService.serviceId,
      serviceName:
        doctorClinicService.clinicService.displayName ??
        doctorClinicService.clinicService.service.name,
      durationMinutes: doctorClinicService.durationMinutes,
      feeMinor: this.resolveFeeMinor(doctorClinic, doctorClinicService).toString(),
      currency: this.resolveCurrency(doctorClinic, doctorClinicService),
      paymentMode: this.toWirePaymentMode(
        this.resolvePaymentMode(doctorClinic, doctorClinicService, platformPaymentMode)
      )
    };
  }

  private serializeLocation(location: LocationRecord) {
    return {
      id: location.id,
      name: location.name,
      address: location.address,
      city: location.city,
      district: location.district,
      province: location.province,
      country: location.country,
      timezone: location.timezone,
      latitude: location.latitude?.toString() ?? null,
      longitude: location.longitude?.toString() ?? null,
      phone: location.phone,
      isPrimary: location.isPrimary
    };
  }

  private serializeClinicServiceSummary(clinicService: ClinicServiceSummaryRecord) {
    return {
      clinicServiceId: clinicService.id,
      serviceId: clinicService.serviceId,
      name: clinicService.displayName ?? clinicService.service.name,
      slug: clinicService.service.slug,
      description: clinicService.description ?? clinicService.service.description,
      defaultDurationMinutes: clinicService.service.defaultDurationMinutes
    };
  }

  private serializeSpecialty(specialty: SpecialtyRecord) {
    return {
      id: specialty.id,
      name: specialty.name,
      slug: specialty.slug,
      description: specialty.description,
      parentId: specialty.parentId
    };
  }

  private serializeRatingSummary(ratingSummary: RatingSummaryRecord | null) {
    return {
      averageRating: ratingSummary ? Number(ratingSummary.averageRating) : 0,
      reviewCount: ratingSummary?.reviewCount ?? 0
    };
  }

  private matchesFeeFilter(doctor: DoctorListRecord, query: ListPublicDoctorsQuery) {
    if (query.minFeeMinor === undefined && query.maxFeeMinor === undefined) {
      return true;
    }

    return doctor.clinics.some((doctorClinic) =>
      doctorClinic.doctorClinicServices.some((doctorClinicService) => {
        if (
          query.serviceId &&
          doctorClinicService.clinicService.serviceId !== query.serviceId
        ) {
          return false;
        }

        const feeMinor = this.resolveFeeMinor(doctorClinic, doctorClinicService);

        return (
          (query.minFeeMinor === undefined || feeMinor >= BigInt(query.minFeeMinor)) &&
          (query.maxFeeMinor === undefined || feeMinor <= BigInt(query.maxFeeMinor))
        );
      })
    );
  }

  private resolveFeeMinor(
    doctorClinic: FeeFallbackDoctorClinic,
    doctorClinicService: FeeFallbackDoctorClinicService
  ) {
    return doctorClinicService.feeMinor ?? doctorClinic.defaultConsultationFeeMinor ?? 0n;
  }

  private resolveCurrency(
    doctorClinic: FeeFallbackDoctorClinic,
    doctorClinicService: FeeFallbackDoctorClinicService
  ) {
    return doctorClinicService.feeMinor === null && doctorClinic.defaultConsultationFeeMinor !== null
      ? doctorClinic.currency
      : doctorClinicService.currency;
  }

  private resolvePaymentMode(
    doctorClinic: PaymentFallbackDoctorClinic,
    doctorClinicService: PaymentFallbackDoctorClinicService,
    platformPaymentMode: PaymentMode
  ) {
    return (
      doctorClinicService.paymentMode ??
      doctorClinic.paymentMode ??
      doctorClinic.clinic.defaultPaymentMode ??
      platformPaymentMode
    );
  }

  private async getPlatformDefaultPaymentMode() {
    const setting = await this.prisma.systemSetting.findFirst({
      where: {
        scopeType: ScopeType.PLATFORM,
        scopeId: null,
        key: "booking.default_payment_mode"
      },
      select: { value: true }
    });
    const value =
      setting?.value && typeof setting.value === "object" && "value" in setting.value
        ? setting.value.value
        : null;

    if (value === "online_required" || value === PaymentMode.ONLINE_REQUIRED) {
      return PaymentMode.ONLINE_REQUIRED;
    }

    if (value === "pay_at_clinic" || value === PaymentMode.PAY_AT_CLINIC) {
      return PaymentMode.PAY_AT_CLINIC;
    }

    return PaymentMode.ONLINE_OPTIONAL;
  }

  private toWirePaymentMode(paymentMode: PaymentMode) {
    if (paymentMode === PaymentMode.ONLINE_REQUIRED) {
      return "online_required";
    }

    if (paymentMode === PaymentMode.PAY_AT_CLINIC) {
      return "pay_at_clinic";
    }

    return "online_optional";
  }

  private normalizeDateRange(fromDate?: string, toDate?: string) {
    const normalizedFromDate = fromDate ?? dateToYmd(new Date());
    const normalizedToDate = toDate ?? addDaysToDateString(normalizedFromDate, 14);

    return {
      fromDate: normalizedFromDate,
      toDate: normalizedToDate
    };
  }

  private toBroadUtcRange(fromDate: string, toDate: string) {
    return {
      startsAt: parseYmd(addDaysToDateString(fromDate, -1)),
      endsAt: parseYmd(addDaysToDateString(toDate, 2))
    };
  }

  private isSlotInsideLocalDateRange(
    startsAt: Date,
    timeZone: string,
    fromDate: string,
    toDate: string
  ) {
    const localDate = getZonedDateString(startsAt, timeZone);

    return localDate >= fromDate && localDate <= toDate;
  }
}

function parseYmd(value: string) {
  const [year, month, day] = value.split("-").map(Number);

  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
}

function dateToYmd(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function addDaysToDateString(dateString: string, days: number) {
  const date = parseYmd(dateString);
  date.setUTCDate(date.getUTCDate() + days);

  return dateToYmd(date);
}

function getZonedDateString(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

type ClinicListRecord = Prisma.ClinicGetPayload<{
  include: ReturnType<PublicMarketplaceService["clinicListInclude"]>;
}>;

type ClinicDetailRecord = Prisma.ClinicGetPayload<{
  include: ReturnType<PublicMarketplaceService["clinicDetailInclude"]>;
}>;

type DoctorListRecord = Prisma.DoctorGetPayload<{
  include: ReturnType<PublicMarketplaceService["doctorListInclude"]>;
}>;

type DoctorDetailRecord = DoctorListRecord;

type DoctorClinicSummaryRecord = Prisma.DoctorClinicGetPayload<{
  include: {
    clinic: true;
    clinicLocation: true;
  };
}>;

type DoctorClinicServiceParentRecord = Prisma.DoctorClinicGetPayload<{
  include: ReturnType<PublicMarketplaceService["doctorClinicWithServicesInclude"]>;
}>;

type DoctorClinicServiceRecord = DoctorClinicServiceParentRecord["doctorClinicServices"][number];

type AvailabilitySlotRecord = Prisma.AppointmentSlotGetPayload<{
  include: ReturnType<PublicMarketplaceService["slotInclude"]>;
}>;

type LocationRecord = Prisma.ClinicLocationGetPayload<Record<string, never>>;

type ClinicServiceSummaryRecord = Prisma.ClinicServiceGetPayload<{
  include: { service: true };
}>;

type SpecialtyRecord = Prisma.SpecialtyGetPayload<Record<string, never>>;
type RatingSummaryRecord = Prisma.DoctorRatingSummaryGetPayload<Record<string, never>>;

type FeeFallbackDoctorClinic = {
  defaultConsultationFeeMinor: bigint | null;
  currency: string;
};

type FeeFallbackDoctorClinicService = {
  feeMinor: bigint | null;
  currency: string;
};

type PaymentFallbackDoctorClinic = {
  paymentMode: PaymentMode | null;
  clinic: {
    defaultPaymentMode: PaymentMode | null;
  };
};

type PaymentFallbackDoctorClinicService = {
  paymentMode: PaymentMode | null;
};
