import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import {
  AppointmentStatus,
  ClinicAssociationStatus,
  ClinicStatus,
  DocumentReviewStatus,
  DoctorStatus,
  FileVisibility,
  PaymentMode,
  PaymentStatus,
  PrismaClient,
  SlotHoldStatus,
  UserStatus
} from "@prisma/client";

const prisma = new PrismaClient();
const scrypt = promisify(scryptCallback);

const fixture = {
  patientEmail: "e2e.patient@doctobook-staging.techstageit.com",
  patientName: "E2E Booking Patient",
  doctorEmail: "e2e.doctor@doctobook-staging.techstageit.com",
  doctorName: "Dr. E2E Booking",
  doctorSlug: "e2e-doctor",
  doctorLicenseNumber: "E2E-BOOKING-LICENSE",
  clinicSlug: "e2e-booking-clinic",
  clinicName: "E2E Booking Clinic",
  locationName: "E2E Main Location",
  documentObjectKey: "fixtures/e2e-booking-doctor/license.pdf",
  documentType: "medical_license",
  specialtySlug: "e2e-general-medicine",
  specialtyName: "E2E General Medicine",
  serviceSlug: "e2e-general-consultation",
  serviceName: "E2E General Consultation",
  durationMinutes: 30,
  slotIntervalMinutes: 30,
  feeMinor: 250000n,
  currency: "LKR",
  timezone: "Asia/Colombo"
} as const;

const onlineFixture = {
  serviceCode: "E2E_ONLINE_CONSULTATION",
  serviceSlug: "e2e-online-consultation",
  serviceName: "E2E Online Consultation",
  feeMinor: 10000n,
  currency: "LKR"
} as const;

const colomboOffsetMinutes = 330;
const slotLocalHours = [10, 10.5, 11, 11.5] as const;
const onlineSlotLocalHours = [14, 14.5, 15, 15.5] as const;
const blockingAppointmentStatuses = [
  AppointmentStatus.PENDING_PAYMENT,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.CHECKED_IN,
  AppointmentStatus.WAITING,
  AppointmentStatus.IN_PROGRESS,
  AppointmentStatus.COMPLETED
];

type FixtureSlot = {
  localDate: string;
  startsAt: Date;
  endsAt: Date;
};

async function main() {
  if (process.argv[2] === "cleanup") {
    await cleanupFixture();
    return;
  }

  await createFixture();
}

async function createFixture() {
  assertCreateAllowed();
  const patientPassword = requiredEnv("E2E_PATIENT_PASSWORD");
  const doctorPassword = requiredEnv("E2E_DOCTOR_PASSWORD");
  const patientRole = await requireRole("patient");
  const doctorRole = await requireRole("doctor");
  const now = new Date();
  const slotPlan = buildSlotPlan(now);
  const onlineSlotPlan = buildSlotPlan(now, onlineSlotLocalHours);

  if (!slotPlan[0] || !onlineSlotPlan[0]) {
    throw new Error("Unable to compute fixture slots");
  }

  const result = await prisma.$transaction(async (tx) => {
    const patientUser = await upsertUser(tx, {
      email: fixture.patientEmail,
      fullName: fixture.patientName,
      password: patientPassword
    });
    await tx.userRole.upsert({
      where: {
        userId_roleId: {
          userId: patientUser.id,
          roleId: patientRole.id
        }
      },
      update: {},
      create: {
        userId: patientUser.id,
        roleId: patientRole.id
      }
    });
    const patient = await tx.patient.upsert({
      where: { userId: patientUser.id },
      update: {
        city: "Colombo",
        district: "Colombo",
        country: "LK"
      },
      create: {
        userId: patientUser.id,
        city: "Colombo",
        district: "Colombo",
        country: "LK"
      }
    });

    const doctorUser = await upsertUser(tx, {
      email: fixture.doctorEmail,
      fullName: fixture.doctorName,
      password: doctorPassword
    });
    await tx.userRole.upsert({
      where: {
        userId_roleId: {
          userId: doctorUser.id,
          roleId: doctorRole.id
        }
      },
      update: {},
      create: {
        userId: doctorUser.id,
        roleId: doctorRole.id
      }
    });
    const doctor = await upsertDoctor(tx, doctorUser.id, now);
    const specialty = await tx.specialty.upsert({
      where: { slug: fixture.specialtySlug },
      update: {
        name: fixture.specialtyName,
        description: "Stable specialty for staging booking E2E.",
        isActive: true
      },
      create: {
        name: fixture.specialtyName,
        slug: fixture.specialtySlug,
        description: "Stable specialty for staging booking E2E.",
        isActive: true
      }
    });
    await tx.doctorSpecialty.upsert({
      where: {
        doctorId_specialtyId: {
          doctorId: doctor.id,
          specialtyId: specialty.id
        }
      },
      update: {
        isPrimary: true
      },
      create: {
        doctorId: doctor.id,
        specialtyId: specialty.id,
        isPrimary: true
      }
    });

    const clinic = await upsertClinic(tx);
    const location = await upsertClinicLocation(tx, clinic.id);
    await replaceClinicHours(tx, location.id);

    const service = await tx.service.upsert({
      where: { slug: fixture.serviceSlug },
      update: {
        name: fixture.serviceName,
        description: "Stable service for staging booking E2E.",
        defaultDurationMinutes: fixture.durationMinutes,
        isActive: true
      },
      create: {
        name: fixture.serviceName,
        slug: fixture.serviceSlug,
        description: "Stable service for staging booking E2E.",
        defaultDurationMinutes: fixture.durationMinutes,
        isActive: true
      }
    });
    const clinicService = await tx.clinicService.upsert({
      where: {
        clinicId_serviceId: {
          clinicId: clinic.id,
          serviceId: service.id
        }
      },
      update: {
        displayName: fixture.serviceName,
        description: "Stable clinic service for staging booking E2E.",
        isActive: true
      },
      create: {
        clinicId: clinic.id,
        serviceId: service.id,
        displayName: fixture.serviceName,
        description: "Stable clinic service for staging booking E2E.",
        isActive: true
      }
    });

    const doctorClinic = await upsertDoctorClinic(tx, {
      doctorId: doctor.id,
      clinicId: clinic.id,
      locationId: location.id,
      now
    });
    const doctorDocument = await upsertApprovedDoctorDocument(tx, {
      doctorId: doctor.id,
      uploadedByUserId: doctorUser.id,
      reviewedByUserId: doctorUser.id,
      now
    });
    await upsertApprovedClinicDocumentReview(tx, {
      doctorDocumentId: doctorDocument.id,
      clinicId: clinic.id,
      doctorClinicId: doctorClinic.id,
      reviewedByUserId: doctorUser.id,
      now
    });
    await replaceDoctorAvailability(tx, doctorClinic.id);
    const doctorClinicService = await upsertDoctorClinicService(tx, {
      doctorClinicId: doctorClinic.id,
      clinicServiceId: clinicService.id,
      feeMinor: fixture.feeMinor,
      currency: fixture.currency,
      paymentMode: PaymentMode.PAY_AT_CLINIC
    });
    const slotResult = await refreshSlots(tx, {
      doctorId: doctor.id,
      doctorClinicId: doctorClinic.id,
      doctorClinicServiceId: doctorClinicService.id,
      slotPlan,
      now
    });
    const onlineService = await tx.service.upsert({
      where: { slug: onlineFixture.serviceSlug },
      update: {
        name: onlineFixture.serviceName,
        description: "Stable online service for PayHere staging E2E.",
        defaultDurationMinutes: fixture.durationMinutes,
        isActive: true
      },
      create: {
        name: onlineFixture.serviceName,
        slug: onlineFixture.serviceSlug,
        description: "Stable online service for PayHere staging E2E.",
        defaultDurationMinutes: fixture.durationMinutes,
        isActive: true
      }
    });
    const onlineClinicService = await tx.clinicService.upsert({
      where: {
        clinicId_serviceId: {
          clinicId: clinic.id,
          serviceId: onlineService.id
        }
      },
      update: {
        displayName: onlineFixture.serviceName,
        description: "Stable online clinic service for PayHere staging E2E.",
        isActive: true
      },
      create: {
        clinicId: clinic.id,
        serviceId: onlineService.id,
        displayName: onlineFixture.serviceName,
        description: "Stable online clinic service for PayHere staging E2E.",
        isActive: true
      }
    });
    const onlineDoctorClinicService = await upsertDoctorClinicService(tx, {
      doctorClinicId: doctorClinic.id,
      clinicServiceId: onlineClinicService.id,
      feeMinor: onlineFixture.feeMinor,
      currency: onlineFixture.currency,
      paymentMode: PaymentMode.ONLINE_REQUIRED
    });
    const onlineSlotResult = await refreshSlots(tx, {
      doctorId: doctor.id,
      doctorClinicId: doctorClinic.id,
      doctorClinicServiceId: onlineDoctorClinicService.id,
      slotPlan: onlineSlotPlan,
      now
    });

    return {
      patient,
      doctor,
      clinic,
      location,
      service,
      onlineService,
      doctorClinic,
      doctorClinicService,
      onlineDoctorClinicService,
      firstAvailableBookingDate: slotResult.firstAvailableBookingDate,
      availableSlotCount: slotResult.availableSlotCount,
      generatedSlotCount: slotResult.generatedSlotCount,
      onlineFirstAvailableBookingDate: onlineSlotResult.firstAvailableBookingDate,
      onlineAvailableSlotCount: onlineSlotResult.availableSlotCount,
      onlineGeneratedSlotCount: onlineSlotResult.generatedSlotCount
    };
  });

  console.log(
    JSON.stringify(
      {
        patientEmail: fixture.patientEmail,
        doctorEmail: fixture.doctorEmail,
        doctorId: result.doctor.id,
        doctorSlug: fixture.doctorSlug,
        clinicId: result.clinic.id,
        clinicSlug: fixture.clinicSlug,
        clinicLocationId: result.location.id,
        serviceId: result.service.id,
        serviceSlug: fixture.serviceSlug,
        doctorClinicId: result.doctorClinic.id,
        doctorClinicServiceId: result.doctorClinicService.id,
        bookingDate: result.firstAvailableBookingDate,
        availableSlotCount: result.availableSlotCount,
        generatedSlotCount: result.generatedSlotCount,
        online: {
          serviceCode: onlineFixture.serviceCode,
          serviceId: result.onlineService.id,
          serviceSlug: onlineFixture.serviceSlug,
          doctorClinicServiceId: result.onlineDoctorClinicService.id,
          bookingDate: result.onlineFirstAvailableBookingDate,
          paymentMode: "online_required",
          feeMinor: onlineFixture.feeMinor.toString(),
          currency: onlineFixture.currency,
          availableSlotCount: result.onlineAvailableSlotCount,
          generatedSlotCount: result.onlineGeneratedSlotCount
        },
        patientId: result.patient.id
      },
      null,
      2
    )
  );
}

async function cleanupFixture() {
  assertCleanupAllowed();
  const appointmentCleanupAllowed = process.env.E2E_FIXTURE_CLEAN_APPOINTMENTS === "true";
  const services = await prisma.service.findMany({
    where: { slug: { in: [fixture.serviceSlug, onlineFixture.serviceSlug] } },
    select: { id: true, slug: true }
  });
  const clinic = await prisma.clinic.findFirst({
    where: { slug: fixture.clinicSlug, deletedAt: null }
  });
  const doctor = await prisma.doctor.findFirst({
    where: { slug: fixture.doctorSlug, deletedAt: null }
  });
  const patientUser = await prisma.user.findFirst({
    where: { email: fixture.patientEmail, deletedAt: null },
    include: { patientProfile: true }
  });
  const doctorUser = await prisma.user.findFirst({
    where: { email: fixture.doctorEmail, deletedAt: null }
  });

  if (services.length === 0 || !clinic || !doctor) {
    console.log(JSON.stringify({ cleanup: "nothing_to_delete" }, null, 2));
    return;
  }

  const serviceIds = services.map((service) => service.id);
  const doctorClinicServices = await prisma.doctorClinicService.findMany({
    where: {
      clinicService: {
        serviceId: { in: serviceIds },
        clinicId: clinic.id
      },
      doctorClinic: {
        doctorId: doctor.id,
        clinicId: clinic.id
      }
    },
    select: { id: true, doctorClinicId: true, clinicServiceId: true }
  });
  const doctorClinicServiceIds = doctorClinicServices.map((entry) => entry.id);
  const doctorClinicIds = [...new Set(doctorClinicServices.map((entry) => entry.doctorClinicId))];
  const clinicServiceIds = [...new Set(doctorClinicServices.map((entry) => entry.clinicServiceId))];

  await prisma.$transaction(async (tx) => {
    const unbookedSlotDelete = await tx.appointmentSlot.deleteMany({
      where: {
        doctorClinicServiceId: { in: doctorClinicServiceIds },
        appointments: { none: {} }
      }
    });

    let deletedAppointments = 0;
    if (appointmentCleanupAllowed && patientUser?.patientProfile) {
      const appointments = await tx.appointment.findMany({
        where: {
          patientId: patientUser.patientProfile.id,
          doctorClinicServiceId: { in: doctorClinicServiceIds }
        },
        select: { id: true }
      });
      const appointmentIds = appointments.map((appointment) => appointment.id);
      deletedAppointments = appointmentIds.length;

      if (appointmentIds.length > 0) {
        const payments = await tx.payment.findMany({
          where: { appointmentId: { in: appointmentIds } },
          select: { id: true }
        });
        const paymentIds = payments.map((payment) => payment.id);
        const refunds = await tx.refund.findMany({
          where: { paymentId: { in: paymentIds } },
          select: { id: true }
        });
        const refundIds = refunds.map((refund) => refund.id);

        await tx.notificationLog.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
        await tx.appointmentSlotHold.deleteMany({
          where: { appointmentId: { in: appointmentIds } }
        });
        await tx.review.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
        await tx.refundStatusHistory.deleteMany({ where: { refundId: { in: refundIds } } });
        await tx.refund.deleteMany({ where: { id: { in: refundIds } } });
        await tx.paymentStatusHistory.deleteMany({ where: { paymentId: { in: paymentIds } } });
        await tx.payment.deleteMany({ where: { id: { in: paymentIds } } });
        await tx.appointmentStatusHistory.deleteMany({
          where: { appointmentId: { in: appointmentIds } }
        });
        await tx.appointmentRescheduleRequest.deleteMany({
          where: { appointmentId: { in: appointmentIds } }
        });
        await tx.appointment.deleteMany({ where: { id: { in: appointmentIds } } });
      }
    }

    const remainingAppointments = await tx.appointment.count({
      where: { doctorClinicServiceId: { in: doctorClinicServiceIds } }
    });

    if (remainingAppointments === 0) {
      await tx.appointmentSlot.deleteMany({
        where: { doctorClinicServiceId: { in: doctorClinicServiceIds } }
      });
      await tx.doctorTimeOff.deleteMany({
        where: { doctorClinicId: { in: doctorClinicIds } }
      });
      await tx.doctorAvailabilityRule.deleteMany({
        where: { doctorClinicId: { in: doctorClinicIds } }
      });
      await tx.doctorClinicService.deleteMany({
        where: { id: { in: doctorClinicServiceIds } }
      });
      await tx.clinicService.deleteMany({ where: { id: { in: clinicServiceIds } } });
      await tx.doctorClinic.deleteMany({ where: { id: { in: doctorClinicIds } } });
      await tx.clinicLocationHour.deleteMany({
        where: { location: { clinicId: clinic.id } }
      });
      await tx.clinicLocationClosure.deleteMany({
        where: { location: { clinicId: clinic.id } }
      });
      await tx.clinicLocation.deleteMany({ where: { clinicId: clinic.id } });
      await tx.clinic.delete({ where: { id: clinic.id } });
      await tx.doctorSpecialty.deleteMany({ where: { doctorId: doctor.id } });
      await tx.doctorRatingSummary.deleteMany({ where: { doctorId: doctor.id } });
      await tx.doctor.delete({ where: { id: doctor.id } });
      if (patientUser?.patientProfile) {
        await tx.patient.delete({ where: { id: patientUser.patientProfile.id } });
      }
      await tx.doctorDocumentClinicReview.deleteMany({
        where: { doctorClinicId: { in: doctorClinicIds } }
      });
      await tx.doctorDocument.deleteMany({ where: { doctorId: doctor.id } });
      await tx.uploadedFile.deleteMany({ where: { objectKey: fixture.documentObjectKey } });
      await tx.authSession.deleteMany({
        where: { userId: { in: [patientUser?.id, doctorUser?.id].filter(Boolean) as string[] } }
      });
      await tx.verificationToken.deleteMany({
        where: { userId: { in: [patientUser?.id, doctorUser?.id].filter(Boolean) as string[] } }
      });
      await tx.userRole.deleteMany({
        where: { userId: { in: [patientUser?.id, doctorUser?.id].filter(Boolean) as string[] } }
      });
      if (patientUser) {
        await tx.user.delete({ where: { id: patientUser.id } });
      }
      if (doctorUser) {
        await tx.user.delete({ where: { id: doctorUser.id } });
      }
      await tx.service.deleteMany({ where: { id: { in: serviceIds } } });
      await tx.specialty.deleteMany({ where: { slug: fixture.specialtySlug } });
    }

    console.log(
      JSON.stringify(
        {
          cleanup: "completed",
          deletedUnbookedSlots: unbookedSlotDelete.count,
          deletedAppointments,
          remainingAppointments,
          domainDeleted: remainingAppointments === 0
        },
        null,
        2
      )
    );
  });
}

async function upsertUser(
  tx: PrismaClientLike,
  input: { email: string; fullName: string; password: string }
) {
  const passwordHash = await hashPassword(input.password);
  const existing = await tx.user.findFirst({
    where: { email: input.email, deletedAt: null },
    select: { id: true }
  });

  if (existing) {
    return tx.user.update({
      where: { id: existing.id },
      data: {
        fullName: input.fullName,
        passwordHash,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date()
      }
    });
  }

  return tx.user.create({
    data: {
      email: input.email,
      fullName: input.fullName,
      passwordHash,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date()
    }
  });
}

async function upsertDoctor(tx: PrismaClientLike, userId: string, now: Date) {
  const existing = await tx.doctor.findFirst({
    where: { slug: fixture.doctorSlug, deletedAt: null },
    select: { id: true }
  });
  const data = {
    userId,
    slug: fixture.doctorSlug,
    licenseNumber: fixture.doctorLicenseNumber,
    status: DoctorStatus.APPROVED,
    bio: "Stable doctor profile for staging booking E2E.",
    qualifications: "MBBS",
    yearsExperience: 8,
    languages: ["en"],
    approvedAt: now,
    rejectionReason: null
  };

  if (existing) {
    return tx.doctor.update({
      where: { id: existing.id },
      data
    });
  }

  return tx.doctor.create({ data });
}

async function upsertClinic(tx: PrismaClientLike) {
  const existing = await tx.clinic.findFirst({
    where: { slug: fixture.clinicSlug, deletedAt: null },
    select: { id: true }
  });
  const data = {
    name: fixture.clinicName,
    slug: fixture.clinicSlug,
    description: "Stable clinic for staging booking E2E.",
    status: ClinicStatus.ACTIVE,
    email: "e2e.clinic@doctobook-staging.techstageit.com",
    phone: "+94110000000",
    defaultPaymentMode: PaymentMode.PAY_AT_CLINIC,
    cancellationWindowMinutes: 30,
    refundProcessingDays: 7
  };

  if (existing) {
    return tx.clinic.update({
      where: { id: existing.id },
      data
    });
  }

  return tx.clinic.create({ data });
}

async function upsertClinicLocation(tx: PrismaClientLike, clinicId: string) {
  const existing = await tx.clinicLocation.findFirst({
    where: { clinicId, name: fixture.locationName, deletedAt: null },
    select: { id: true }
  });
  const data = {
    clinicId,
    name: fixture.locationName,
    address: "1 E2E Booking Street",
    city: "Colombo",
    district: "Colombo",
    province: "Western",
    country: "LK",
    timezone: fixture.timezone,
    phone: "+94110000001",
    isPrimary: true,
    status: ClinicStatus.ACTIVE
  };

  if (existing) {
    await tx.clinicLocation.updateMany({
      where: { clinicId, id: { not: existing.id } },
      data: { isPrimary: false }
    });

    return tx.clinicLocation.update({
      where: { id: existing.id },
      data
    });
  }

  await tx.clinicLocation.updateMany({
    where: { clinicId },
    data: { isPrimary: false }
  });

  return tx.clinicLocation.create({ data });
}

async function upsertDoctorClinic(
  tx: PrismaClientLike,
  input: { doctorId: string; clinicId: string; locationId: string; now: Date }
) {
  const existing = await tx.doctorClinic.findFirst({
    where: {
      doctorId: input.doctorId,
      clinicId: input.clinicId,
      clinicLocationId: input.locationId,
      deletedAt: null
    },
    select: { id: true }
  });
  const data = {
    doctorId: input.doctorId,
    clinicId: input.clinicId,
    clinicLocationId: input.locationId,
    status: ClinicAssociationStatus.APPROVED,
    defaultConsultationFeeMinor: fixture.feeMinor,
    currency: fixture.currency,
    paymentMode: PaymentMode.PAY_AT_CLINIC,
    defaultSlotIntervalMinutes: fixture.slotIntervalMinutes,
    bufferMinutes: 0,
    approvedAt: input.now
  };

  if (existing) {
    return tx.doctorClinic.update({
      where: { id: existing.id },
      data
    });
  }

  return tx.doctorClinic.create({ data });
}

async function upsertApprovedDoctorDocument(
  tx: PrismaClientLike,
  input: {
    doctorId: string;
    uploadedByUserId: string;
    reviewedByUserId: string;
    now: Date;
  }
) {
  const existingFile = await tx.uploadedFile.findFirst({
    where: { objectKey: fixture.documentObjectKey, deletedAt: null },
    select: { id: true }
  });
  const fileData = {
    uploadedByUserId: input.uploadedByUserId,
    storageProvider: "fixture",
    bucket: "doctobook-staging-fixtures",
    objectKey: fixture.documentObjectKey,
    originalFilename: "e2e-booking-doctor-license.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024n,
    checksum: "fixture-e2e-doctor-license",
    visibility: FileVisibility.PRIVATE
  };
  const file = existingFile
    ? await tx.uploadedFile.update({ where: { id: existingFile.id }, data: fileData })
    : await tx.uploadedFile.create({ data: fileData });
  const existingDocument = await tx.doctorDocument.findFirst({
    where: {
      doctorId: input.doctorId,
      documentType: fixture.documentType
    },
    select: { id: true }
  });
  const documentData = {
    doctorId: input.doctorId,
    fileId: file.id,
    documentType: fixture.documentType,
    platformStatus: DocumentReviewStatus.APPROVED,
    reviewedByUserId: input.reviewedByUserId,
    reviewedAt: input.now,
    rejectionReason: null
  };

  if (existingDocument) {
    return tx.doctorDocument.update({
      where: { id: existingDocument.id },
      data: documentData
    });
  }

  return tx.doctorDocument.create({ data: documentData });
}

async function upsertApprovedClinicDocumentReview(
  tx: PrismaClientLike,
  input: {
    doctorDocumentId: string;
    clinicId: string;
    doctorClinicId: string;
    reviewedByUserId: string;
    now: Date;
  }
) {
  return tx.doctorDocumentClinicReview.upsert({
    where: {
      doctorDocumentId_doctorClinicId: {
        doctorDocumentId: input.doctorDocumentId,
        doctorClinicId: input.doctorClinicId
      }
    },
    update: {
      clinicId: input.clinicId,
      status: DocumentReviewStatus.APPROVED,
      reviewedByUserId: input.reviewedByUserId,
      reviewedAt: input.now,
      reason: null
    },
    create: {
      doctorDocumentId: input.doctorDocumentId,
      clinicId: input.clinicId,
      doctorClinicId: input.doctorClinicId,
      status: DocumentReviewStatus.APPROVED,
      reviewedByUserId: input.reviewedByUserId,
      reviewedAt: input.now,
      reason: null
    }
  });
}

async function upsertDoctorClinicService(
  tx: PrismaClientLike,
  input: {
    doctorClinicId: string;
    clinicServiceId: string;
    feeMinor: bigint;
    currency: string;
    paymentMode: PaymentMode;
  }
) {
  const existing = await tx.doctorClinicService.findFirst({
    where: {
      doctorClinicId: input.doctorClinicId,
      clinicServiceId: input.clinicServiceId,
      deletedAt: null
    },
    select: { id: true }
  });
  const data = {
    doctorClinicId: input.doctorClinicId,
    clinicServiceId: input.clinicServiceId,
    durationMinutes: fixture.durationMinutes,
    feeMinor: input.feeMinor,
    currency: input.currency,
    paymentMode: input.paymentMode,
    cancellationWindowMinutes: 30,
    rescheduleWindowMinutes: 30,
    maxReschedules: 2,
    isActive: true
  };

  if (existing) {
    return tx.doctorClinicService.update({
      where: { id: existing.id },
      data
    });
  }

  return tx.doctorClinicService.create({ data });
}

async function replaceClinicHours(tx: PrismaClientLike, locationId: string) {
  await tx.clinicLocationHour.deleteMany({ where: { locationId } });

  for (let dayOfWeek = 1; dayOfWeek <= 5; dayOfWeek += 1) {
    await tx.clinicLocationHour.create({
      data: {
        locationId,
        dayOfWeek,
        opensAt: timeOnly(9, 0),
        closesAt: timeOnly(17, 0),
        isClosed: false
      }
    });
  }
}

async function replaceDoctorAvailability(tx: PrismaClientLike, doctorClinicId: string) {
  await tx.doctorAvailabilityRule.deleteMany({ where: { doctorClinicId } });

  for (let dayOfWeek = 1; dayOfWeek <= 5; dayOfWeek += 1) {
    for (const [startsAt, endsAt] of [
      [timeOnly(10, 0), timeOnly(12, 0)],
      [timeOnly(14, 0), timeOnly(16, 0)]
    ] as const) {
      await tx.doctorAvailabilityRule.create({
        data: {
          doctorClinicId,
          dayOfWeek,
          startsAt,
          endsAt,
          slotIntervalMinutes: fixture.slotIntervalMinutes,
          maxPatients: 1,
          isActive: true
        }
      });
    }
  }
}

async function refreshSlots(
  tx: PrismaClientLike,
  input: {
    doctorId: string;
    doctorClinicId: string;
    doctorClinicServiceId: string;
    slotPlan: FixtureSlot[];
    now: Date;
  }
) {
  const desiredSlotKeys = new Set(input.slotPlan.map((slot) => slot.startsAt.toISOString()));
  const existingFutureSlots = await tx.appointmentSlot.findMany({
    where: {
      doctorClinicServiceId: input.doctorClinicServiceId,
      startsAt: { gte: input.now }
    },
    include: {
      appointments: {
        where: { status: { in: blockingAppointmentStatuses } },
        select: { id: true }
      },
      holds: {
        where: {
          status: SlotHoldStatus.ACTIVE,
          expiresAt: { gt: input.now }
        },
        select: { id: true }
      }
    }
  });

  for (const slot of existingFutureSlots) {
    const isDesired = desiredSlotKeys.has(slot.startsAt.toISOString());
    const isBookedOrHeld = slot.appointments.length > 0 || slot.holds.length > 0;

    if (!isDesired && !isBookedOrHeld && slot.isActive) {
      await tx.appointmentSlot.update({
        where: { id: slot.id },
        data: { isActive: false }
      });
    }
  }

  let generatedSlotCount = 0;
  for (const slot of input.slotPlan) {
    const existing = await tx.appointmentSlot.findFirst({
      where: {
        doctorClinicId: input.doctorClinicId,
        doctorClinicServiceId: input.doctorClinicServiceId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt
      },
      select: { id: true }
    });

    if (existing) {
      await tx.appointmentSlot.update({
        where: { id: existing.id },
        data: {
          capacity: 1,
          isActive: true
        }
      });
    } else {
      generatedSlotCount += 1;
      await tx.appointmentSlot.create({
        data: {
          doctorClinicId: input.doctorClinicId,
          doctorClinicServiceId: input.doctorClinicServiceId,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          capacity: 1,
          isActive: true
        }
      });
    }
  }

  const availableSlotWhere = {
    doctorClinicServiceId: input.doctorClinicServiceId,
    startsAt: { gte: input.now },
    isActive: true,
    appointments: { none: { status: { in: blockingAppointmentStatuses } } },
    holds: {
      none: {
        status: SlotHoldStatus.ACTIVE,
        expiresAt: { gt: input.now }
      }
    }
  };
  const candidateSlots = await tx.appointmentSlot.findMany({
    where: availableSlotWhere,
    orderBy: { startsAt: "asc" },
    select: {
      startsAt: true,
      endsAt: true
    }
  });
  const availableSlots: typeof candidateSlots = [];

  for (const slot of candidateSlots) {
    const doctorOverlap = await tx.appointment.findFirst({
      where: {
        doctorId: input.doctorId,
        status: { in: blockingAppointmentStatuses },
        startsAt: { lt: slot.endsAt },
        endsAt: { gt: slot.startsAt }
      },
      select: { id: true }
    });

    if (!doctorOverlap) {
      availableSlots.push(slot);
    }
  }

  const availableSlotCount = availableSlots.length;
  const firstAvailableSlot = availableSlots[0] ?? null;

  if (availableSlotCount < 3 || !firstAvailableSlot) {
    throw new Error(`Expected at least 3 available fixture slots, found ${availableSlotCount}`);
  }

  return {
    availableSlotCount,
    generatedSlotCount,
    firstAvailableBookingDate: toColomboYmd(firstAvailableSlot.startsAt)
  };
}

function buildSlotPlan(now: Date, localHours: readonly number[] = slotLocalHours): FixtureSlot[] {
  const slots: FixtureSlot[] = [];
  const localToday = toColomboLocalDateParts(now);
  let cursor = Date.UTC(localToday.year, localToday.month - 1, localToday.day + 1);

  while (slots.length < 20) {
    const date = new Date(cursor);
    const dayOfWeek = date.getUTCDay();

    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      const localDate = toYmd(date);

      for (const hour of localHours) {
        const startsAt = colomboLocalDateTimeToUtc(localDate, hour);
        const endsAt = new Date(startsAt.getTime() + fixture.durationMinutes * 60 * 1000);

        if (startsAt > now) {
          slots.push({ localDate, startsAt, endsAt });
        }
      }
    }

    cursor += 24 * 60 * 60 * 1000;
  }

  return slots;
}

function toColomboLocalDateParts(date: Date) {
  const local = new Date(date.getTime() + colomboOffsetMinutes * 60 * 1000);

  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate()
  };
}

function toColomboYmd(date: Date) {
  const local = toColomboLocalDateParts(date);

  return `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;
}

function colomboLocalDateTimeToUtc(ymd: string, hour: number) {
  const [year, month, day] = ymd.split("-").map((part) => Number(part));
  const wholeHour = Math.trunc(hour);
  const minute = Math.round((hour - wholeHour) * 60);

  return new Date(
    Date.UTC(year, month - 1, day, wholeHour, minute, 0, 0) -
      colomboOffsetMinutes * 60 * 1000
  );
}

function toYmd(date: Date) {
  return date.toISOString().slice(0, 10);
}

function timeOnly(hour: number, minute: number) {
  return new Date(Date.UTC(1970, 0, 1, hour, minute, 0, 0));
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;

  return `scrypt:v1:16384:8:1:${salt}:${derivedKey.toString("base64url")}`;
}

async function requireRole(code: string) {
  const role = await prisma.role.findUnique({
    where: { code },
    select: { id: true }
  });

  if (!role) {
    throw new Error(`Missing role '${code}'. Run prisma:seed before booking E2E fixtures.`);
  }

  return role;
}

function assertCreateAllowed() {
  if (process.env.ALLOW_E2E_FIXTURES !== "true") {
    throw new Error("Refusing to create booking E2E fixtures without ALLOW_E2E_FIXTURES=true");
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to create booking E2E fixtures when NODE_ENV=production");
  }
}

function assertCleanupAllowed() {
  if (process.env.ALLOW_E2E_FIXTURE_CLEANUP !== "true") {
    throw new Error(
      "Refusing to clean booking E2E fixtures without ALLOW_E2E_FIXTURE_CLEANUP=true"
    );
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to clean booking E2E fixtures when NODE_ENV=production");
  }
}

function requiredEnv(key: string) {
  const value = process.env[key]?.trim();

  if (!value) {
    throw new Error(`${key} is required`);
  }

  return value;
}

type PrismaClientLike = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
