import { describe, expect, it } from "vitest";
import { buildClinicCreatePayload, doctorReadinessChecks, paginate } from "./admin-domain";
import { activeNavigationGroup, adminNavigation, breadcrumbLabels, hasAdminAccess, hasAdminPermission } from "./admin-navigation";
import type { Doctor } from "./admin-types";

describe("Super Admin navigation and authorization visibility", () => {
  it("exposes all configured navigation to a Super Admin without hash routes", () => {
    const items = adminNavigation.flatMap((group) => group.items);
    expect(items.length).toBeGreaterThan(30);
    expect(items.every((item) => item.href.startsWith("/admin") && !item.href.includes("#"))).toBe(true);
    expect(items.every((item) => hasAdminPermission(["super_admin"], item.permission))).toBe(true);
  });

  it("keeps platform settings hidden from clinic-scoped administrators", () => {
    expect(hasAdminAccess(["clinic_admin"])).toBe(true);
    expect(hasAdminPermission(["clinic_admin"], "clinic.read")).toBe(true);
    expect(hasAdminPermission(["clinic_admin"], "settings.manage")).toBe(false);
    expect(hasAdminAccess(["doctor"])).toBe(false);
  });

  it("resolves active navigation and safe dynamic breadcrumbs", () => {
    expect(activeNavigationGroup("/admin/clinics/123/locations")).toBe("Clinics");
    expect(breadcrumbLabels("/admin/doctors/7d36eb61-2653-4d20-880f-62db9781d9e0/documents")).toEqual(["Doctors", "Details", "Documents"]);
  });
});

describe("Admin forms and workflow helpers", () => {
  it("normalizes optional clinic fields and numeric policy values", () => {
    const payload = buildClinicCreatePayload({ name: "Central Care", slug: "central-care", description: "", email: "", phone: "", websiteUrl: "", defaultPaymentMode: "PAY_AT_CLINIC", cancellationWindowMinutes: "30", refundProcessingDays: "7" });
    expect(payload).toMatchObject({ description: null, email: null, phone: null, websiteUrl: null, cancellationWindowMinutes: 30, refundProcessingDays: 7 });
  });

  it("explains doctor listing readiness from approval, documents, specialty, and assignment", () => {
    const doctor = { status: "APPROVED", documents: [{ platformStatus: "APPROVED" }], specialties: [{ specialty: { id: "1", name: "Cardiology", slug: "cardiology" }, isPrimary: true }], clinicAssociations: [{ status: "APPROVED" }] } as Doctor;
    expect(doctorReadinessChecks(doctor).publicListingReady).toBe(true);
    expect(doctorReadinessChecks({ ...doctor, documents: [] }).publicListingReady).toBe(false);
  });

  it("paginates dense table data without dropping page boundaries", () => {
    expect(paginate([1, 2, 3, 4, 5], 2, 2)).toEqual([3, 4]);
    expect(paginate([1, 2, 3], 0, 2)).toEqual([1, 2]);
  });
});
