import { expect, test } from "@playwright/test";
import { apiUrl, e2eConfig } from "./support/env.js";

test.describe("production smoke checks", () => {
  test.skip(!e2eConfig.enabled, "Set E2E_RUN=true to run staging/production E2E checks");

  test("API health endpoints and web shell are reachable", async ({ page, request }) => {
    const live = await request.get(apiUrl("/health/live"));
    expect(live.ok()).toBeTruthy();
    expect(await live.json()).toEqual(
      expect.objectContaining({
        service: "api",
        status: "ok"
      })
    );

    const ready = await request.get(apiUrl("/health/ready"));
    expect(ready.ok()).toBeTruthy();
    expect(await ready.json()).toEqual(
      expect.objectContaining({
        service: "api",
        status: "ok"
      })
    );

    await page.goto("/");
    await expect(page).toHaveTitle(/DoctoBook/u);
    await expect(page.getByRole("heading", { name: /DoctoBook/u })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Search$/u })).toBeVisible();
  });

  test("public marketplace APIs return stable response shapes without sensitive fields", async ({
    request
  }) => {
    const [specialties, services, doctors, clinics] = await Promise.all([
      request.get(apiUrl("/v1/public/specialties")),
      request.get(apiUrl("/v1/public/services")),
      request.get(apiUrl("/v1/public/doctors?limit=5")),
      request.get(apiUrl("/v1/public/clinics?limit=5"))
    ]);

    for (const response of [specialties, services, doctors, clinics]) {
      expect(response.ok()).toBeTruthy();
    }

    const doctorPayload = await doctors.json();
    const clinicPayload = await clinics.json();

    expect(Array.isArray(doctorPayload.doctors)).toBe(true);
    expect(Array.isArray(clinicPayload.clinics)).toBe(true);

    for (const doctor of doctorPayload.doctors as Array<Record<string, unknown>>) {
      expect(doctor).not.toHaveProperty("email");
      expect(doctor).not.toHaveProperty("phone");
      expect(doctor).not.toHaveProperty("licenseNumber");
      expect(doctor).not.toHaveProperty("documents");
    }
  });
});
