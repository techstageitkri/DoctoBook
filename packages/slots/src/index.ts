import {
  AppointmentStatus,
  ClinicAssociationStatus,
  ClinicStatus,
  DoctorStatus,
  Prisma,
  PrismaClient
} from "@doctobook/database";

export const SLOT_GENERATION_QUEUE_NAME = "slot-generation";
export const SLOT_GENERATE_RANGE_JOB = "slot.generate-range";
export const SLOT_REGENERATE_ASSOCIATION_JOB = "slot.regenerate-association";
export const SLOT_REGENERATE_LOCATION_JOB = "slot.regenerate-location";
export const SLOT_DEACTIVATE_SERVICE_JOB = "slot.deactivate-service";
export const SLOT_SCHEDULED_GENERATION_JOB = "slot.generate-scheduled";
export const DEFAULT_SLOT_GENERATION_DAYS = 60;

export type SlotGenerationReason =
  | "scheduled"
  | "availability_changed"
  | "break_changed"
  | "time_off_changed"
  | "clinic_hours_changed"
  | "clinic_closure_changed"
  | "service_changed"
  | "doctor_clinic_changed"
  | "manual";

export type GenerateSlotsJob = {
  doctorClinicId: string;
  fromDate: string;
  toDate: string;
  reason: SlotGenerationReason;
};

export type SlotGenerationResult = {
  doctorClinicId: string;
  fromDate: string;
  toDate: string;
  desiredCount: number;
  insertedCount: number;
  reactivatedCount: number;
  retainedCount: number;
  deactivatedCount: number;
  skippedForConflicts: number;
  skippedInactiveServices: number;
  skippedPast: number;
};

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

const activeAppointmentStatuses = [
  AppointmentStatus.PENDING_PAYMENT,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.CHECKED_IN,
  AppointmentStatus.WAITING,
  AppointmentStatus.IN_PROGRESS
];

export function getSlotGenerationJobId(payload: GenerateSlotsJob) {
  return `slot-generation|${payload.doctorClinicId}|${payload.fromDate}|${payload.toDate}`;
}

export function getTodayDateString() {
  return dateToYmd(new Date());
}

export function addDaysToDateString(dateString: string, days: number) {
  const date = parseYmd(dateString);
  date.setUTCDate(date.getUTCDate() + days);

  return dateToYmd(date);
}

export class SlotGenerationService {
  constructor(private readonly prisma: PrismaClient) {}

  async generateRange(input: GenerateSlotsJob): Promise<SlotGenerationResult> {
    validateDateRange(input.fromDate, input.toDate);

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`slot-generation:${input.doctorClinicId}`}))`;

      return this.generateRangeInTransaction(tx, input);
    });
  }

  private async generateRangeInTransaction(
    tx: Prisma.TransactionClient,
    input: GenerateSlotsJob
  ): Promise<SlotGenerationResult> {
    const association = await this.getAssociation(tx, input.doctorClinicId);

    if (!association) {
      throw new Error("Doctor clinic association not found");
    }

    const timezone = association.clinicLocation.timezone;
    const rangeStartUtc = zonedDateTimeToUtc(input.fromDate, 0, timezone);
    const rangeEndUtc = zonedDateTimeToUtc(addDaysToDateString(input.toDate, 1), 0, timezone);
    const now = new Date();
    const effectiveStartUtc = rangeStartUtc > now ? rangeStartUtc : now;
    const existingSlots = await tx.appointmentSlot.findMany({
      where: {
        doctorClinicId: input.doctorClinicId,
        startsAt: {
          gte: effectiveStartUtc,
          lt: rangeEndUtc
        }
      },
      include: {
        appointments: {
          select: {
            id: true,
            status: true
          }
        }
      }
    });
    const activeAppointments = await tx.appointment.findMany({
      where: {
        doctorId: association.doctorId,
        startsAt: { lt: rangeEndUtc },
        endsAt: { gt: effectiveStartUtc },
        status: { in: activeAppointmentStatuses }
      },
      select: {
        id: true,
        slotId: true,
        startsAt: true,
        endsAt: true
      }
    });
    const result = emptyResult(input);

    if (
      association.deletedAt ||
      association.status !== ClinicAssociationStatus.APPROVED ||
      association.clinic.deletedAt ||
      association.clinic.status !== ClinicStatus.ACTIVE ||
      association.clinicLocation.deletedAt ||
      association.clinicLocation.status !== ClinicStatus.ACTIVE ||
      association.doctor.status !== DoctorStatus.APPROVED
    ) {
      result.deactivatedCount = await this.deactivateObsoleteSlots(tx, existingSlots, new Set());
      return result;
    }

    const desiredSlots = this.calculateDesiredSlots(
      association,
      input.fromDate,
      input.toDate,
      effectiveStartUtc,
      activeAppointments,
      result
    );
    const desiredKeys = new Set(desiredSlots.map((slot) => slotKey(slot)));
    const existingByKey = new Map(existingSlots.map((slot) => [slotKey(slot), slot]));
    const slotsToInsert = desiredSlots.filter((slot) => !existingByKey.has(slotKey(slot)));
    const slotsToReactivate = desiredSlots.filter((slot) => {
      const existing = existingByKey.get(slotKey(slot));

      return existing ? !existing.isActive : false;
    });

    if (slotsToInsert.length > 0) {
      const inserted = await tx.appointmentSlot.createMany({
        data: slotsToInsert,
        skipDuplicates: true
      });
      result.insertedCount = inserted.count;
    }

    for (const slot of slotsToReactivate) {
      const existing = existingByKey.get(slotKey(slot));

      if (!existing || this.hasActiveAppointmentConflict(activeAppointments, slot, existing.id)) {
        result.skippedForConflicts += 1;
        continue;
      }

      await tx.appointmentSlot.update({
        where: { id: existing.id },
        data: { isActive: true }
      });
      result.reactivatedCount += 1;
    }

    result.retainedCount = desiredSlots.length - slotsToInsert.length - slotsToReactivate.length;
    result.deactivatedCount = await this.deactivateObsoleteSlots(tx, existingSlots, desiredKeys);
    result.desiredCount = desiredSlots.length;

    return result;
  }

  private calculateDesiredSlots(
    association: AssociationRecord,
    fromDate: string,
    toDate: string,
    effectiveStartUtc: Date,
    activeAppointments: ActiveAppointmentRecord[],
    result: SlotGenerationResult
  ) {
    const desiredSlots: DesiredSlot[] = [];
    const timezone = association.clinicLocation.timezone;

    for (const localDate of enumerateDateStrings(fromDate, toDate)) {
      const dayOfWeek = getDayOfWeek(localDate);
      const clinicHours = association.clinicLocation.hours.filter(
        (hour) =>
          hour.dayOfWeek === dayOfWeek &&
          !hour.isClosed &&
          isDateWithinEffectiveRange(localDate, hour.effectiveFrom, hour.effectiveTo)
      );
      const availabilityRules = association.availabilityRules.filter(
        (rule) =>
          rule.dayOfWeek === dayOfWeek &&
          rule.isActive &&
          isDateWithinEffectiveRange(localDate, rule.effectiveFrom, rule.effectiveTo)
      );

      for (const rule of availabilityRules) {
        const windows = subtractBreaks(
          intersectWindows(
            {
              start: timeDateToMinutes(rule.startsAt),
              end: timeDateToMinutes(rule.endsAt)
            },
            clinicHours
              .filter((hour) => hour.opensAt && hour.closesAt)
              .map((hour) => ({
                start: timeDateToMinutes(hour.opensAt as Date),
                end: timeDateToMinutes(hour.closesAt as Date)
              }))
          ),
          rule.breaks.map((availabilityBreak) => ({
            start: timeDateToMinutes(availabilityBreak.startsAt),
            end: timeDateToMinutes(availabilityBreak.endsAt)
          }))
        );
        const intervalMinutes =
          rule.slotIntervalMinutes ?? association.defaultSlotIntervalMinutes;

        for (const doctorClinicService of association.doctorClinicServices) {
          if (!doctorClinicService.isActive || doctorClinicService.deletedAt) {
            result.skippedInactiveServices += 1;
            continue;
          }

          for (const window of windows) {
            for (
              let startsAtMinute = window.start;
              startsAtMinute + doctorClinicService.durationMinutes <= window.end;
              startsAtMinute += intervalMinutes
            ) {
              const endsAtMinute = startsAtMinute + doctorClinicService.durationMinutes;
              const startsAt = zonedDateTimeToUtc(localDate, startsAtMinute, timezone);
              const endsAt = zonedDateTimeToUtc(localDate, endsAtMinute, timezone);

              if (startsAt < effectiveStartUtc) {
                result.skippedPast += 1;
                continue;
              }

              const candidate = {
                doctorClinicId: association.id,
                doctorClinicServiceId: doctorClinicService.id,
                startsAt,
                endsAt,
                capacity: rule.maxPatients,
                isActive: true
              };

              if (
                this.overlapsClosures(association.clinicLocation.closures, startsAt, endsAt) ||
                this.overlapsTimeOff(
                  association.timeOff,
                  doctorClinicService.id,
                  startsAt,
                  endsAt
                ) ||
                this.hasActiveAppointmentConflict(activeAppointments, candidate)
              ) {
                result.skippedForConflicts += 1;
                continue;
              }

              desiredSlots.push(candidate);
            }
          }
        }
      }
    }

    return dedupeSlots(desiredSlots);
  }

  private async deactivateObsoleteSlots(
    tx: Prisma.TransactionClient,
    existingSlots: ExistingSlotRecord[],
    desiredKeys: Set<string>
  ) {
    const obsoleteUnbookedSlotIds = existingSlots
      .filter(
        (slot) =>
          slot.isActive &&
          !desiredKeys.has(slotKey(slot)) &&
          slot.appointments.length === 0
      )
      .map((slot) => slot.id);

    if (obsoleteUnbookedSlotIds.length === 0) {
      return 0;
    }

    const deactivated = await tx.appointmentSlot.updateMany({
      where: { id: { in: obsoleteUnbookedSlotIds } },
      data: { isActive: false }
    });

    return deactivated.count;
  }

  private overlapsClosures(closures: ClosureRecord[], startsAt: Date, endsAt: Date) {
    return closures.some((closure) => rangesOverlap(startsAt, endsAt, closure.startsAt, closure.endsAt));
  }

  private overlapsTimeOff(
    timeOff: TimeOffRecord[],
    doctorClinicServiceId: string,
    startsAt: Date,
    endsAt: Date
  ) {
    return timeOff.some(
      (timeOffEntry) =>
        (!timeOffEntry.doctorClinicServiceId ||
          timeOffEntry.doctorClinicServiceId === doctorClinicServiceId) &&
        rangesOverlap(startsAt, endsAt, timeOffEntry.startsAt, timeOffEntry.endsAt)
    );
  }

  private hasActiveAppointmentConflict(
    activeAppointments: ActiveAppointmentRecord[],
    slot: SlotKeyInput,
    existingSlotId?: string
  ) {
    return activeAppointments.some(
      (appointment) =>
        appointment.slotId !== existingSlotId &&
        rangesOverlap(slot.startsAt, slot.endsAt, appointment.startsAt, appointment.endsAt)
    );
  }

  private async getAssociation(tx: PrismaExecutor, doctorClinicId: string) {
    return tx.doctorClinic.findUnique({
      where: { id: doctorClinicId },
      include: {
        doctor: {
          select: {
            id: true,
            status: true
          }
        },
        clinic: {
          select: {
            id: true,
            status: true,
            deletedAt: true
          }
        },
        clinicLocation: {
          include: {
            hours: true,
            closures: true
          }
        },
        availabilityRules: {
          where: { isActive: true },
          include: {
            breaks: true
          }
        },
        doctorClinicServices: {
          where: {
            deletedAt: null,
            isActive: true,
            clinicService: {
              isActive: true,
              service: {
                isActive: true
              }
            }
          }
        },
        timeOff: true
      }
    });
  }
}

function emptyResult(input: GenerateSlotsJob): SlotGenerationResult {
  return {
    doctorClinicId: input.doctorClinicId,
    fromDate: input.fromDate,
    toDate: input.toDate,
    desiredCount: 0,
    insertedCount: 0,
    reactivatedCount: 0,
    retainedCount: 0,
    deactivatedCount: 0,
    skippedForConflicts: 0,
    skippedInactiveServices: 0,
    skippedPast: 0
  };
}

function validateDateRange(fromDate: string, toDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    throw new Error("Slot generation dates must use YYYY-MM-DD");
  }

  if (parseYmd(toDate) < parseYmd(fromDate)) {
    throw new Error("Slot generation toDate must be on or after fromDate");
  }
}

function enumerateDateStrings(fromDate: string, toDate: string) {
  const dates: string[] = [];
  let current = fromDate;

  while (current <= toDate) {
    dates.push(current);
    current = addDaysToDateString(current, 1);
  }

  return dates;
}

function intersectWindows(base: MinuteWindow, windows: MinuteWindow[]) {
  return windows
    .map((window) => ({
      start: Math.max(base.start, window.start),
      end: Math.min(base.end, window.end)
    }))
    .filter((window) => window.start < window.end);
}

function subtractBreaks(windows: MinuteWindow[], breaks: MinuteWindow[]) {
  let result = windows;

  for (const availabilityBreak of breaks) {
    result = result.flatMap((window) => subtractWindow(window, availabilityBreak));
  }

  return result;
}

function subtractWindow(window: MinuteWindow, blocker: MinuteWindow) {
  if (!minutesOverlap(window, blocker)) {
    return [window];
  }

  const pieces: MinuteWindow[] = [];

  if (blocker.start > window.start) {
    pieces.push({ start: window.start, end: blocker.start });
  }

  if (blocker.end < window.end) {
    pieces.push({ start: blocker.end, end: window.end });
  }

  return pieces;
}

function minutesOverlap(first: MinuteWindow, second: MinuteWindow) {
  return first.start < second.end && second.start < first.end;
}

function rangesOverlap(firstStart: Date, firstEnd: Date, secondStart: Date, secondEnd: Date) {
  return firstStart < secondEnd && secondStart < firstEnd;
}

function dedupeSlots(slots: DesiredSlot[]) {
  const seen = new Set<string>();
  const deduped: DesiredSlot[] = [];

  for (const slot of slots) {
    const key = slotKey(slot);

    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(slot);
    }
  }

  return deduped;
}

function slotKey(slot: SlotKeyInput) {
  return `${slot.doctorClinicServiceId}:${slot.startsAt.toISOString()}:${slot.endsAt.toISOString()}`;
}

function isDateWithinEffectiveRange(localDate: string, effectiveFrom: Date | null, effectiveTo: Date | null) {
  const date = parseYmd(localDate);

  return (!effectiveFrom || parseYmd(dateToYmd(effectiveFrom)) <= date) &&
    (!effectiveTo || parseYmd(dateToYmd(effectiveTo)) >= date);
}

function getDayOfWeek(localDate: string) {
  return parseYmd(localDate).getUTCDay();
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

function timeDateToMinutes(value: Date) {
  return value.getUTCHours() * 60 + value.getUTCMinutes() + value.getUTCSeconds() / 60;
}

function zonedDateTimeToUtc(localDate: string, minutes: number, timeZone: string) {
  const normalized = normalizeLocalDateAndMinutes(localDate, minutes);
  const [year, month, day] = normalized.date.split("-").map(Number);
  const hour = Math.floor(normalized.minutes / 60);
  const minute = normalized.minutes % 60;
  const targetUtc = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour, minute, 0);
  let guess = new Date(targetUtc);

  for (let index = 0; index < 4; index += 1) {
    const parts = getZonedParts(guess, timeZone);
    const zonedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    const difference = zonedAsUtc - targetUtc;
    const nextGuess = new Date(guess.getTime() - difference);

    if (nextGuess.getTime() === guess.getTime()) {
      return nextGuess;
    }

    guess = nextGuess;
  }

  return guess;
}

function normalizeLocalDateAndMinutes(localDate: string, minutes: number) {
  let date = localDate;
  let normalizedMinutes = minutes;

  while (normalizedMinutes >= 1440) {
    date = addDaysToDateString(date, 1);
    normalizedMinutes -= 1440;
  }

  while (normalizedMinutes < 0) {
    date = addDaysToDateString(date, -1);
    normalizedMinutes += 1440;
  }

  return { date, minutes: normalizedMinutes };
}

function getZonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

type MinuteWindow = {
  start: number;
  end: number;
};

type SlotKeyInput = {
  doctorClinicServiceId?: string;
  startsAt: Date;
  endsAt: Date;
};

type DesiredSlot = {
  doctorClinicId: string;
  doctorClinicServiceId: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  isActive: boolean;
};

type AssociationRecord = Prisma.PromiseReturnType<SlotGenerationService["getAssociation"]> extends infer T
  ? NonNullable<T>
  : never;

type ExistingSlotRecord = Prisma.AppointmentSlotGetPayload<{
  include: {
    appointments: {
      select: {
        id: true;
        status: true;
      };
    };
  };
}>;

type ActiveAppointmentRecord = Prisma.AppointmentGetPayload<{
  select: {
    id: true;
    slotId: true;
    startsAt: true;
    endsAt: true;
  };
}>;

type ClosureRecord = Prisma.ClinicLocationClosureGetPayload<Record<string, never>>;
type TimeOffRecord = Prisma.DoctorTimeOffGetPayload<Record<string, never>>;
