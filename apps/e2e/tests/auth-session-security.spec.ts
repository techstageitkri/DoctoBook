import { expect, test } from "@playwright/test";
import { apiUrl, e2eConfig, hasPatientCredentials } from "./support/env.js";
import { loginPatient, setCookieHeader } from "./support/api.js";

test.describe("browser authentication security", () => {
  test.skip(!e2eConfig.enabled, "Set E2E_RUN=true to run staging/production E2E checks");
  test.skip(!hasPatientCredentials(), "Set E2E_PATIENT_EMAIL and E2E_PATIENT_PASSWORD");

  test("login and refresh use HttpOnly refresh cookies without exposing refresh tokens", async ({
    request
  }) => {
    const loginResponse = await request.post(apiUrl("/v1/auth/login"), {
      headers: {
        Origin: e2eConfig.trustedOrigin
      },
      data: {
        email: e2eConfig.patientEmail,
        password: e2eConfig.patientPassword,
        deviceName: "DoctoBook E2E"
      }
    });
    const loginCookie = setCookieHeader(loginResponse.headers());
    const loginPayload = await loginResponse.json();

    expect(loginResponse.ok()).toBeTruthy();
    expect(loginPayload.accessToken).toEqual(expect.any(String));
    expect(loginPayload.refreshToken).toBeUndefined();
    expect(loginCookie).toContain("doctobook_refresh_token=");
    expect(loginCookie.toLowerCase()).toContain("httponly");
    expect(loginCookie.toLowerCase()).toContain("samesite=lax");

    const refreshResponse = await request.post(apiUrl("/v1/auth/refresh"), {
      headers: {
        Origin: e2eConfig.trustedOrigin
      },
      data: {}
    });
    const refreshCookie = setCookieHeader(refreshResponse.headers());
    const refreshPayload = await refreshResponse.json();

    expect(refreshResponse.ok()).toBeTruthy();
    expect(refreshPayload.accessToken).toEqual(expect.any(String));
    expect(refreshPayload.refreshToken).toBeUndefined();
    expect(refreshCookie).toContain("doctobook_refresh_token=");
    expect(refreshCookie).not.toEqual(loginCookie);

    const meResponse = await request.get(apiUrl("/v1/auth/me"), {
      headers: {
        Authorization: `Bearer ${refreshPayload.accessToken}`
      }
    });

    expect(meResponse.ok()).toBeTruthy();
    expect(await meResponse.json()).toEqual(
      expect.objectContaining({
        user: expect.objectContaining({
          email: e2eConfig.patientEmail?.toLowerCase()
        })
      })
    );
  });

  test("cookie-authenticated mutation rejects untrusted origins and logout clears cookie", async ({
    request
  }) => {
    await loginPatient(request);

    const rejected = await request.post(apiUrl("/v1/auth/logout"), {
      headers: {
        Origin: "https://evil.example"
      },
      data: {}
    });

    expect(rejected.status()).toBe(403);
    expect(await rejected.json()).toEqual(
      expect.objectContaining({
        code: "CSRF_ORIGIN_DENIED"
      })
    );

    const logout = await request.post(apiUrl("/v1/auth/logout"), {
      headers: {
        Origin: e2eConfig.trustedOrigin
      },
      data: {}
    });
    const logoutCookie = setCookieHeader(logout.headers());

    expect(logout.ok()).toBeTruthy();
    expect(logoutCookie).toContain("doctobook_refresh_token=");
    expect(logoutCookie.toLowerCase()).toMatch(/max-age=0|expires=thu, 01 jan 1970/u);

    const refreshAfterLogout = await request.post(apiUrl("/v1/auth/refresh"), {
      headers: {
        Origin: e2eConfig.trustedOrigin
      },
      data: {}
    });

    expect(refreshAfterLogout.status()).toBe(401);
  });
});
