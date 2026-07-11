import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { NotificationChannel, PrismaClient, ScopeType, UserStatus } from "@prisma/client";

const prisma = new PrismaClient();
const scrypt = promisify(scryptCallback);

const roles = [
  {
    code: "super_admin",
    name: "Super Admin",
    description: "Platform owner with unrestricted operational access."
  },
  {
    code: "clinic_admin",
    name: "Clinic Admin",
    description: "Clinic-level manager scoped to assigned clinics."
  },
  {
    code: "doctor",
    name: "Doctor",
    description: "Healthcare provider managing profile, services, and appointments."
  },
  {
    code: "receptionist",
    name: "Receptionist",
    description: "Clinic front-desk operator scoped to assigned clinic/location."
  },
  {
    code: "patient",
    name: "Patient",
    description: "End user booking appointments for self or dependents."
  }
] as const;

const permissions = [
  ["auth.login", "auth", "Authenticate into the platform."],
  ["auth.logout", "auth", "Logout the current session."],
  ["auth.logout_all", "auth", "Logout all active sessions for the current user."],
  ["auth.session.read", "auth", "View active sessions."],
  ["auth.session.revoke", "auth", "Revoke user sessions."],
  ["account.read", "account", "Read own account profile."],
  ["account.update", "account", "Update own account profile."],
  ["password.change", "auth", "Change own password."],
  ["user.read", "user", "Read user accounts."],
  ["user.create", "user", "Create user accounts."],
  ["user.update", "user", "Update user accounts."],
  ["user.suspend", "user", "Suspend or reactivate user accounts."],
  ["clinic.read", "clinic", "Read clinic records."],
  ["clinic.create", "clinic", "Create clinics."],
  ["clinic.update", "clinic", "Update clinic profile and settings."],
  ["clinic.suspend", "clinic", "Suspend or reactivate clinics."],
  ["clinic.location.manage", "clinic", "Manage clinic locations."],
  ["clinic.admin.manage", "clinic", "Manage clinic administrators."],
  ["receptionist.manage", "clinic", "Manage receptionist accounts."],
  ["doctor.read", "doctor", "Read doctor records."],
  ["doctor.account.verify", "doctor", "Approve or reject doctor accounts."],
  ["doctor.account.suspend", "doctor", "Suspend doctors globally."],
  ["doctor.profile.update", "doctor", "Update doctor profile."],
  ["doctor.documents.upload", "doctor", "Upload doctor verification documents."],
  [
    "doctor.documents.review_for_clinic",
    "doctor",
    "Review doctor documents for clinic association."
  ],
  ["doctor.documents.verify_platform", "doctor", "Verify doctor documents at platform level."],
  ["doctor_clinic.request", "doctor_clinic", "Request association with a clinic."],
  ["doctor_clinic.approve", "doctor_clinic", "Approve or reject doctor-clinic association."],
  ["doctor_clinic.disable", "doctor_clinic", "Disable doctor at a clinic."],
  ["specialty.read", "specialty", "Read specialties."],
  ["specialty.manage", "specialty", "Manage specialties."],
  ["service.read", "service", "Read appointment services."],
  ["service.manage", "service", "Manage appointment services."],
  ["availability.read", "availability", "Read availability and generated slots."],
  ["availability.manage", "availability", "Manage clinic or doctor availability."],
  ["appointment.read", "appointment", "Read appointment records."],
  ["appointment.create", "appointment", "Create appointments."],
  ["appointment.reschedule", "appointment", "Reschedule appointments."],
  ["appointment.cancel", "appointment", "Cancel appointments."],
  ["appointment.override_cancellation", "appointment", "Override cancellation policy."],
  ["appointment.status.check_in", "appointment", "Mark appointment checked in."],
  ["appointment.status.complete", "appointment", "Advance appointment workflow status."],
  ["appointment.queue.manage", "appointment", "Manage queue or token workflow."],
  ["payment.read", "payment", "Read payment records."],
  ["payment.initiate", "payment", "Initiate online payments."],
  ["payment.offline_mark", "payment", "Mark pay-at-clinic payment state."],
  ["payment.webhook.process", "payment", "Process payment webhooks."],
  ["payment.settings.manage", "payment", "Manage payment operating settings."],
  ["payment.credentials.manage", "payment", "Manage payment provider credentials."],
  ["refund.request", "refund", "Request refunds."],
  ["refund.approve", "refund", "Approve refunds."],
  ["refund.reject", "refund", "Reject refunds."],
  ["refund.process", "refund", "Mark gateway refund processing state."],
  ["refund.partial", "refund", "Approve partial refunds."],
  ["refund.override_policy", "refund", "Override refund policy."],
  ["review.submit", "review", "Submit appointment review."],
  ["review.moderate", "review", "Moderate reviews."],
  ["notification.settings.manage", "notification", "Manage notification operational settings."],
  ["notification.templates.manage", "notification", "Manage notification templates."],
  ["notification.credentials.manage", "notification", "Manage notification provider credentials."],
  ["settings.read", "settings", "Read system settings."],
  ["settings.manage", "settings", "Manage system settings."],
  ["provider_configuration.manage", "settings", "Manage provider configurations."],
  ["audit.read", "audit", "Read audit logs."],
  ["permission.read", "permission", "Read permissions."],
  ["permission.grant", "permission", "Grant permissions."],
  ["permission.revoke", "permission", "Revoke permissions."],
  ["role.manage", "permission", "Manage roles and role permissions."],
  ["report.read", "report", "Read operational reports."],
  ["data.export", "compliance", "Export authorized data."],
  ["patient.basic_identity.view", "patient", "View patient basic identity."],
  ["patient.contact.view", "patient", "View patient contact details."],
  ["patient.booking_reason.view", "patient", "View patient booking reason."],
  ["patient.medical_information.view", "patient", "View sensitive patient medical information."],
  ["patient.payment_information.view", "patient", "View patient payment information."],
  ["patient.documents.view", "patient", "View patient documents."]
] as const;

const rolePermissions: Record<(typeof roles)[number]["code"], string[]> = {
  super_admin: permissions.map(([code]) => code),
  clinic_admin: [
    "auth.login",
    "auth.logout",
    "auth.logout_all",
    "auth.session.read",
    "account.read",
    "account.update",
    "password.change",
    "user.read",
    "clinic.read",
    "clinic.update",
    "clinic.location.manage",
    "receptionist.manage",
    "doctor.read",
    "doctor.documents.review_for_clinic",
    "doctor_clinic.approve",
    "doctor_clinic.disable",
    "specialty.read",
    "service.read",
    "service.manage",
    "availability.read",
    "availability.manage",
    "appointment.read",
    "appointment.create",
    "appointment.reschedule",
    "appointment.cancel",
    "appointment.override_cancellation",
    "appointment.status.check_in",
    "appointment.status.complete",
    "appointment.queue.manage",
    "payment.read",
    "payment.offline_mark",
    "payment.settings.manage",
    "refund.request",
    "refund.approve",
    "refund.reject",
    "refund.partial",
    "review.moderate",
    "notification.settings.manage",
    "notification.templates.manage",
    "settings.read",
    "audit.read",
    "permission.read",
    "permission.grant",
    "permission.revoke",
    "report.read",
    "data.export",
    "patient.basic_identity.view",
    "patient.contact.view",
    "patient.booking_reason.view",
    "patient.payment_information.view"
  ],
  doctor: [
    "auth.login",
    "auth.logout",
    "auth.logout_all",
    "auth.session.read",
    "account.read",
    "account.update",
    "password.change",
    "clinic.read",
    "doctor.read",
    "doctor.profile.update",
    "doctor.documents.upload",
    "doctor_clinic.request",
    "specialty.read",
    "service.read",
    "availability.read",
    "availability.manage",
    "appointment.read",
    "appointment.reschedule",
    "appointment.cancel",
    "appointment.status.complete",
    "appointment.queue.manage",
    "review.submit",
    "patient.basic_identity.view",
    "patient.contact.view",
    "patient.booking_reason.view"
  ],
  receptionist: [
    "auth.login",
    "auth.logout",
    "auth.logout_all",
    "auth.session.read",
    "account.read",
    "account.update",
    "password.change",
    "clinic.read",
    "doctor.read",
    "specialty.read",
    "service.read",
    "availability.read",
    "appointment.read",
    "appointment.create",
    "appointment.reschedule",
    "appointment.cancel",
    "appointment.status.check_in",
    "appointment.status.complete",
    "appointment.queue.manage",
    "payment.read",
    "payment.offline_mark",
    "refund.request",
    "patient.basic_identity.view",
    "patient.contact.view",
    "patient.booking_reason.view"
  ],
  patient: [
    "auth.login",
    "auth.logout",
    "auth.logout_all",
    "auth.session.read",
    "account.read",
    "account.update",
    "password.change",
    "clinic.read",
    "doctor.read",
    "specialty.read",
    "service.read",
    "availability.read",
    "appointment.read",
    "appointment.create",
    "appointment.reschedule",
    "appointment.cancel",
    "payment.read",
    "payment.initiate",
    "refund.request",
    "review.submit",
    "patient.basic_identity.view",
    "patient.contact.view",
    "patient.booking_reason.view",
    "patient.payment_information.view"
  ]
};

const platformSettings = [
  ["platform.locale.default", { locale: "en" }],
  ["platform.locale.supported", { locales: ["en"] }],
  ["booking.default_payment_mode", { value: "online_optional" }],
  ["booking.cancellation_window_minutes", { value: 30 }],
  ["booking.max_active_slot_hold_minutes", { value: 10 }],
  ["refund.processing_days", { value: 7 }],
  ["security.access_token_ttl_seconds", { value: 900 }],
  ["security.refresh_token_ttl_days", { value: 30 }],
  ["security.password_hash_algorithm", { value: "scrypt" }],
  ["notification.enabled_channels", { channels: ["email", "sms", "push"] }],
  ["notification.default_locale", { locale: "en" }],
  ["notification.reminder_offsets_minutes", { offsets: [1440, 120] }],
  ["compliance.audit_retention_days", { value: 2555 }],
  ["compliance.privacy_mode", { value: "hipaa_grade" }]
] as const;

const notificationTemplates = [
  [
    "auth.email_verification",
    NotificationChannel.EMAIL,
    "Verify your DoctoBook email",
    "Hello {{user.fullName}}, use this verification code to activate your account: {{verification.token}}"
  ],
  [
    "password.reset",
    NotificationChannel.EMAIL,
    "Reset your DoctoBook password",
    "Hello {{user.fullName}}, use this password reset code: {{passwordReset.token}}"
  ],
  [
    "doctor.approved",
    NotificationChannel.EMAIL,
    "Doctor profile approved",
    "Hello {{user.fullName}}, your doctor profile has been approved."
  ],
  [
    "doctor.rejected",
    NotificationChannel.EMAIL,
    "Doctor profile needs updates",
    "Hello {{user.fullName}}, your doctor profile was rejected. Reason: {{doctor.rejectionReason}}"
  ],
  [
    "appointment.booked",
    NotificationChannel.EMAIL,
    "Appointment booked",
    "Your {{appointment.serviceName}} appointment with Dr. {{doctor.name}} at {{clinic.name}} is booked for {{appointment.startsAt}}."
  ],
  [
    "appointment.booked",
    NotificationChannel.SMS,
    null,
    "DoctoBook: Appointment {{appointment.number}} booked for {{appointment.startsAt}}."
  ],
  [
    "appointment.booked",
    NotificationChannel.PUSH,
    "Appointment booked",
    "Appointment {{appointment.number}} is booked for {{appointment.startsAt}}."
  ],
  [
    "payment.required",
    NotificationChannel.EMAIL,
    "Payment required",
    "Payment of {{payment.amount}} is required to confirm appointment {{appointment.number}}."
  ],
  [
    "payment.succeeded",
    NotificationChannel.EMAIL,
    "Payment successful",
    "Payment for appointment {{appointment.number}} was successful."
  ],
  [
    "payment.failed",
    NotificationChannel.EMAIL,
    "Payment failed",
    "Payment for appointment {{appointment.number}} failed. Please try again if the appointment is still active."
  ],
  [
    "payment.cancelled",
    NotificationChannel.EMAIL,
    "Payment cancelled",
    "Payment for appointment {{appointment.number}} was cancelled."
  ],
  [
    "appointment.cancelled",
    NotificationChannel.EMAIL,
    "Appointment cancelled",
    "Appointment {{appointment.number}} with Dr. {{doctor.name}} at {{clinic.name}} has been cancelled."
  ],
  [
    "appointment.reminder",
    NotificationChannel.EMAIL,
    "Upcoming appointment reminder",
    "Reminder: appointment {{appointment.number}} with Dr. {{doctor.name}} at {{clinic.name}} starts at {{appointment.startsAt}}."
  ],
  [
    "appointment.reminder",
    NotificationChannel.SMS,
    null,
    "DoctoBook reminder: appointment {{appointment.number}} starts at {{appointment.startsAt}}."
  ],
  [
    "reschedule.payment_required",
    NotificationChannel.EMAIL,
    "Additional payment required",
    "Additional payment is required to complete your reschedule from {{reschedule.oldStartsAt}} to {{reschedule.newStartsAt}}."
  ],
  [
    "reschedule.completed",
    NotificationChannel.EMAIL,
    "Appointment rescheduled",
    "Appointment {{appointment.number}} has been rescheduled to {{appointment.startsAt}}."
  ],
  [
    "reschedule.cancelled",
    NotificationChannel.EMAIL,
    "Reschedule cancelled",
    "Your pending reschedule request for appointment {{appointment.number}} was cancelled."
  ],
  [
    "refund.requested",
    NotificationChannel.EMAIL,
    "Refund requested",
    "A refund request was created for appointment {{appointment.number}}."
  ],
  [
    "refund.completed",
    NotificationChannel.EMAIL,
    "Refund completed",
    "Your refund for appointment {{appointment.number}} has been completed."
  ],
  [
    "refund.failed",
    NotificationChannel.EMAIL,
    "Refund failed",
    "Your refund for appointment {{appointment.number}} could not be completed and needs review."
  ],
  [
    "review.invitation",
    NotificationChannel.EMAIL,
    "How was your appointment?",
    "Your appointment {{appointment.number}} is complete. Please share your review for Dr. {{doctor.name}}."
  ],
  [
    "review.submitted",
    NotificationChannel.EMAIL,
    "New patient review",
    "A verified patient submitted a {{review.rating}} star review for appointment {{appointment.number}}."
  ],
  [
    "review.moderated",
    NotificationChannel.EMAIL,
    "Review moderation update",
    "Your review status is now {{review.status}}. Reason: {{review.moderationReason}}"
  ]
] as const;

const specialties = [
  ["general-medicine", "General Medicine", "Primary care and common medical conditions."],
  ["family-medicine", "Family Medicine", "Family-centered primary care."],
  ["pediatrics", "Pediatrics", "Healthcare for infants, children, and adolescents."],
  ["cardiology", "Cardiology", "Heart and cardiovascular care."],
  ["dermatology", "Dermatology", "Skin, hair, and nail care."],
  ["ent", "ENT", "Ear, nose, and throat care."],
  ["gynecology", "Gynecology", "Women's reproductive healthcare."],
  ["orthopedics", "Orthopedics", "Bone, joint, and musculoskeletal care."],
  ["neurology", "Neurology", "Brain, nerve, and neurological care."],
  ["psychiatry", "Psychiatry", "Mental health diagnosis and treatment."],
  ["dentistry", "Dentistry", "Dental and oral healthcare."],
  ["ophthalmology", "Ophthalmology", "Eye and vision care."]
] as const;

const appointmentServices = [
  [
    "general-consultation",
    "General Consultation",
    30,
    "Standard in-person or online doctor consultation."
  ],
  [
    "follow-up-consultation",
    "Follow-up Consultation",
    15,
    "Follow-up visit for an existing concern."
  ],
  [
    "specialist-consultation",
    "Specialist Consultation",
    30,
    "Consultation with a specialist doctor."
  ],
  [
    "medical-certificate",
    "Medical Certificate Appointment",
    15,
    "Appointment for certificate review and issuance."
  ],
  [
    "teleconsultation",
    "Teleconsultation",
    20,
    "Remote consultation through video or phone workflow."
  ],
  [
    "procedure-consultation",
    "Procedure Consultation",
    45,
    "Longer consultation for procedure assessment."
  ]
] as const;

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:v1:16384:8:1:${salt}:${derivedKey.toString("base64url")}`;
}

async function seedRoles() {
  const seededRoles = new Map<string, { id: string }>();

  for (const role of roles) {
    const seededRole = await prisma.role.upsert({
      where: { code: role.code },
      update: {
        name: role.name,
        description: role.description,
        isSystem: true
      },
      create: {
        code: role.code,
        name: role.name,
        description: role.description,
        isSystem: true
      },
      select: { id: true }
    });

    seededRoles.set(role.code, seededRole);
  }

  return seededRoles;
}

async function seedPermissions() {
  const seededPermissions = new Map<string, { id: string }>();

  for (const [code, module, description] of permissions) {
    const permission = await prisma.permission.upsert({
      where: { code },
      update: { module, description },
      create: { code, module, description },
      select: { id: true }
    });

    seededPermissions.set(code, permission);
  }

  return seededPermissions;
}

async function seedRolePermissions(
  seededRoles: Map<string, { id: string }>,
  seededPermissions: Map<string, { id: string }>
) {
  for (const [roleCode, permissionCodes] of Object.entries(rolePermissions)) {
    const role = seededRoles.get(roleCode);

    if (!role) {
      throw new Error(`Missing seeded role: ${roleCode}`);
    }

    for (const permissionCode of permissionCodes) {
      const permission = seededPermissions.get(permissionCode);

      if (!permission) {
        throw new Error(`Missing seeded permission: ${permissionCode}`);
      }

      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permission.id
          }
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId: permission.id
        }
      });
    }
  }
}

async function upsertPlatformSetting(key: string, value: object) {
  const result = await prisma.systemSetting.updateMany({
    where: {
      scopeType: ScopeType.PLATFORM,
      scopeId: null,
      key
    },
    data: { value }
  });

  if (result.count === 0) {
    await prisma.systemSetting.create({
      data: {
        scopeType: ScopeType.PLATFORM,
        scopeId: null,
        key,
        value
      }
    });
  }
}

async function seedPlatformSettings() {
  for (const [key, value] of platformSettings) {
    await upsertPlatformSetting(key, value);
  }
}

async function seedSpecialties() {
  for (const [slug, name, description] of specialties) {
    await prisma.specialty.upsert({
      where: { slug },
      update: {
        name,
        description,
        isActive: true
      },
      create: {
        slug,
        name,
        description,
        isActive: true
      }
    });
  }
}

async function seedAppointmentServices() {
  for (const [slug, name, defaultDurationMinutes, description] of appointmentServices) {
    await prisma.service.upsert({
      where: { slug },
      update: {
        name,
        description,
        defaultDurationMinutes,
        isActive: true
      },
      create: {
        slug,
        name,
        description,
        defaultDurationMinutes,
        isActive: true
      }
    });
  }
}

async function upsertPlatformNotificationTemplate(
  eventCode: string,
  channel: NotificationChannel,
  subject: string | null,
  body: string
) {
  const result = await prisma.notificationTemplate.updateMany({
    where: {
      scopeType: ScopeType.PLATFORM,
      scopeId: null,
      eventCode,
      channel,
      locale: "en"
    },
    data: {
      subject,
      body,
      isActive: true
    }
  });

  if (result.count === 0) {
    await prisma.notificationTemplate.create({
      data: {
        scopeType: ScopeType.PLATFORM,
        scopeId: null,
        eventCode,
        channel,
        locale: "en",
        subject,
        body,
        isActive: true
      }
    });
  }
}

async function seedNotificationTemplates() {
  for (const [eventCode, channel, subject, body] of notificationTemplates) {
    await upsertPlatformNotificationTemplate(eventCode, channel, subject, body);
  }
}

async function seedOptionalSuperAdmin(seededRoles: Map<string, { id: string }>) {
  const email = process.env.SEED_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD;

  if (!email || !password) {
    return false;
  }

  const fullName = process.env.SEED_SUPER_ADMIN_FULL_NAME?.trim() || "Development Super Admin";
  const existingUser = await prisma.user.findFirst({
    where: {
      email,
      deletedAt: null
    },
    select: { id: true }
  });
  const passwordHash = await hashPassword(password);

  const user = existingUser
    ? await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          fullName,
          passwordHash,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date()
        },
        select: { id: true }
      })
    : await prisma.user.create({
        data: {
          email,
          fullName,
          passwordHash,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date()
        },
        select: { id: true }
      });

  const superAdminRole = seededRoles.get("super_admin");

  if (!superAdminRole) {
    throw new Error("Missing seeded super_admin role");
  }

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: user.id,
        roleId: superAdminRole.id
      }
    },
    update: {},
    create: {
      userId: user.id,
      roleId: superAdminRole.id
    }
  });

  return true;
}

async function main() {
  const seededRoles = await seedRoles();
  const seededPermissions = await seedPermissions();
  await seedRolePermissions(seededRoles, seededPermissions);
  await seedPlatformSettings();
  await seedSpecialties();
  await seedAppointmentServices();
  await seedNotificationTemplates();
  const createdSuperAdmin = await seedOptionalSuperAdmin(seededRoles);

  console.log(
    [
      `Seeded ${roles.length} roles`,
      `${permissions.length} permissions`,
      `${platformSettings.length} platform settings`,
      `${specialties.length} specialties`,
      `${appointmentServices.length} services`,
      `${notificationTemplates.length} notification templates`,
      `super admin ${createdSuperAdmin ? "enabled" : "skipped"}`
    ].join(", ")
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
