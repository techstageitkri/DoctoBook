import { expect, test } from "@playwright/test";
import { e2eConfig } from "./support/env.js";

test.describe("email verification page", () => {
  test.skip(!e2eConfig.enabled, "Set E2E_RUN=true with a running web app to run E2E checks");

  test("verifies a link token and supports manual token fallback", async ({ page }) => {
    const requests: string[] = [];

    await page.route("**/v1/auth/email-verification/confirm", async (route) => {
      const request = route.request();
      const payload = JSON.parse(request.postData() ?? "{}") as { token?: string };
      requests.push(payload.token ?? "");

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: "user-test",
            email: "patient@example.test",
            fullName: "Patient Test",
            status: "ACTIVE"
          }
        })
      });
    });

    await page.goto("/verify-email#token=link-token-12345678901234567890123456789012");
    await expect(page.getByRole("heading", { name: "Email verified" })).toBeVisible();
    expect(requests).toContain("link-token-12345678901234567890123456789012");
    await expect(page).toHaveURL(/\/verify-email$/u);

    await page.goto("/verify-email");
    await page.getByLabel("Manual token").fill("manual-token-123456789012345678901234567890");
    await page.getByRole("button", { name: /Verify email/u }).click();
    await expect(page.getByRole("heading", { name: "Email verified" })).toBeVisible();
    expect(requests).toContain("manual-token-123456789012345678901234567890");
  });
});
