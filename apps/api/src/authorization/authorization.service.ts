import { Injectable } from "@nestjs/common";
import {
  ClinicAssociationStatus,
  PermissionEffect,
  ScopeType,
  UserStatus
} from "@doctobook/database";
import { PrismaService } from "../database/prisma.service.js";
import { AuthenticatedUser } from "../auth/auth.types.js";
import { AuthorizationTarget } from "./authorization.types.js";

type ResolvedTarget = {
  scope: AuthorizationTarget["scope"];
  scopeId: string | null;
  clinicId?: string;
  clinicLocationId?: string;
  doctorId?: string;
  patientId?: string;
  appointmentId?: string;
  doctorClinicId?: string;
  selfUserId?: string;
};

type GrantScope = {
  scopeType: ScopeType;
  scopeId: string | null;
};

@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  async can(user: AuthenticatedUser, permissionCode: string, target: AuthorizationTarget) {
    const resolvedTarget = await this.resolveTarget(target);

    if (!resolvedTarget) {
      return false;
    }

    const storedUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: {
                    permission: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!storedUser || storedUser.status !== UserStatus.ACTIVE || storedUser.deletedAt) {
      return false;
    }

    const explicitDecision = await this.getExplicitPermissionDecision(
      user.id,
      permissionCode,
      resolvedTarget
    );

    if (explicitDecision !== null) {
      return explicitDecision;
    }

    const roleCodes = storedUser.roles.map((userRole) => userRole.role.code);
    const hasRolePermission = storedUser.roles.some((userRole) =>
      userRole.role.permissions.some(
        (rolePermission) => rolePermission.permission.code === permissionCode
      )
    );

    if (!hasRolePermission) {
      return false;
    }

    if (roleCodes.includes("super_admin")) {
      return true;
    }

    return this.isRoleScopeAllowed(user.id, roleCodes, resolvedTarget);
  }

  private async getExplicitPermissionDecision(
    userId: string,
    permissionCode: string,
    target: ResolvedTarget
  ) {
    const grants = await this.prisma.userPermissionGrant.findMany({
      where: {
        userId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        permission: { code: permissionCode }
      }
    });
    const applicableScopes = this.getApplicableGrantScopes(target);
    const applicableGrants = grants.filter((grant) =>
      applicableScopes.some(
        (scope) => scope.scopeType === grant.scopeType && scope.scopeId === grant.scopeId
      )
    );

    if (applicableGrants.some((grant) => grant.effect === PermissionEffect.DENY)) {
      return false;
    }

    if (applicableGrants.some((grant) => grant.effect === PermissionEffect.GRANT)) {
      return true;
    }

    return null;
  }

  private getApplicableGrantScopes(target: ResolvedTarget): GrantScope[] {
    const scopes: GrantScope[] = [{ scopeType: ScopeType.PLATFORM, scopeId: null }];

    if (target.clinicId) {
      scopes.push({ scopeType: ScopeType.CLINIC, scopeId: target.clinicId });
    }

    if (target.clinicLocationId) {
      scopes.push({ scopeType: ScopeType.CLINIC_LOCATION, scopeId: target.clinicLocationId });
    }

    if (target.doctorId) {
      scopes.push({ scopeType: ScopeType.DOCTOR, scopeId: target.doctorId });
    }

    if (target.patientId) {
      scopes.push({ scopeType: ScopeType.PATIENT, scopeId: target.patientId });
    }

    if (target.appointmentId) {
      scopes.push({ scopeType: ScopeType.APPOINTMENT, scopeId: target.appointmentId });
    }

    return scopes;
  }

  private async isRoleScopeAllowed(userId: string, roleCodes: string[], target: ResolvedTarget) {
    if (target.scope === "self") {
      return target.selfUserId === userId;
    }

    if (target.scope === "platform") {
      return false;
    }

    if (roleCodes.includes("clinic_admin") && target.clinicId) {
      return this.isClinicAdminForClinic(userId, target.clinicId);
    }

    if (roleCodes.includes("receptionist")) {
      if (target.clinicLocationId) {
        return this.isReceptionistForLocation(userId, target.clinicLocationId);
      }

      if (target.clinicId) {
        return this.isReceptionistForClinic(userId, target.clinicId);
      }
    }

    if (roleCodes.includes("doctor") && target.doctorId) {
      return this.isDoctorUser(userId, target.doctorId);
    }

    if (roleCodes.includes("doctor") && target.doctorClinicId) {
      return this.isDoctorUserForDoctorClinic(userId, target.doctorClinicId);
    }

    if (roleCodes.includes("patient") && target.patientId) {
      return this.isPatientUser(userId, target.patientId);
    }

    return false;
  }

  private async resolveTarget(target: AuthorizationTarget): Promise<ResolvedTarget | null> {
    if (target.scope === "platform") {
      return { scope: target.scope, scopeId: null };
    }

    const scopeId = target.scopeId;

    if (!scopeId) {
      return null;
    }

    if (target.scope === "self") {
      return { scope: target.scope, scopeId, selfUserId: scopeId };
    }

    if (target.scope === "clinic") {
      return { scope: target.scope, scopeId, clinicId: scopeId };
    }

    if (target.scope === "clinic_location") {
      const location = await this.prisma.clinicLocation.findUnique({
        where: { id: scopeId },
        select: { id: true, clinicId: true }
      });

      return location
        ? {
            scope: target.scope,
            scopeId,
            clinicId: location.clinicId,
            clinicLocationId: location.id
          }
        : null;
    }

    if (target.scope === "doctor") {
      return { scope: target.scope, scopeId, doctorId: scopeId };
    }

    if (target.scope === "patient") {
      return { scope: target.scope, scopeId, patientId: scopeId };
    }

    if (target.scope === "appointment") {
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: scopeId },
        select: {
          id: true,
          clinicId: true,
          clinicLocationId: true,
          doctorId: true,
          patientId: true,
          doctorClinicId: true
        }
      });

      return appointment
        ? {
            scope: target.scope,
            scopeId,
            appointmentId: appointment.id,
            clinicId: appointment.clinicId,
            clinicLocationId: appointment.clinicLocationId,
            doctorId: appointment.doctorId,
            patientId: appointment.patientId,
            doctorClinicId: appointment.doctorClinicId
          }
        : null;
    }

    const doctorClinic = await this.prisma.doctorClinic.findUnique({
      where: { id: scopeId },
      select: {
        id: true,
        clinicId: true,
        clinicLocationId: true,
        doctorId: true
      }
    });

    return doctorClinic
      ? {
          scope: target.scope,
          scopeId,
          doctorClinicId: doctorClinic.id,
          clinicId: doctorClinic.clinicId,
          clinicLocationId: doctorClinic.clinicLocationId,
          doctorId: doctorClinic.doctorId
        }
      : null;
  }

  private async isClinicAdminForClinic(userId: string, clinicId: string) {
    const admin = await this.prisma.clinicAdmin.findUnique({
      where: {
        clinicId_userId: {
          clinicId,
          userId
        }
      },
      select: { status: true }
    });

    return admin?.status === ClinicAssociationStatus.APPROVED;
  }

  private async isReceptionistForClinic(userId: string, clinicId: string) {
    const receptionist = await this.prisma.receptionist.findUnique({
      where: {
        clinicId_userId: {
          clinicId,
          userId
        }
      },
      select: { status: true }
    });

    return receptionist?.status === ClinicAssociationStatus.APPROVED;
  }

  private async isReceptionistForLocation(userId: string, clinicLocationId: string) {
    const location = await this.prisma.clinicLocation.findUnique({
      where: { id: clinicLocationId },
      select: { clinicId: true }
    });

    if (!location) {
      return false;
    }

    const receptionist = await this.prisma.receptionist.findUnique({
      where: {
        clinicId_userId: {
          clinicId: location.clinicId,
          userId
        }
      },
      select: { status: true, clinicLocationId: true }
    });

    return (
      receptionist?.status === ClinicAssociationStatus.APPROVED &&
      (!receptionist.clinicLocationId || receptionist.clinicLocationId === clinicLocationId)
    );
  }

  private async isDoctorUser(userId: string, doctorId: string) {
    const doctor = await this.prisma.doctor.findUnique({
      where: { id: doctorId },
      select: { userId: true }
    });

    return doctor?.userId === userId;
  }

  private async isDoctorUserForDoctorClinic(userId: string, doctorClinicId: string) {
    const doctorClinic = await this.prisma.doctorClinic.findUnique({
      where: { id: doctorClinicId },
      select: {
        doctor: {
          select: { userId: true }
        }
      }
    });

    return doctorClinic?.doctor.userId === userId;
  }

  private async isPatientUser(userId: string, patientId: string) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { userId: true }
    });

    return patient?.userId === userId;
  }
}
