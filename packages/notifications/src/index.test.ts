import { describe, expect, it } from "vitest";
import { getNotificationProviderHealth, renderNotificationTemplate } from "./index.js";

describe("notification template rendering", () => {
  it("replaces nested placeholders and leaves missing values empty", () => {
    expect(
      renderNotificationTemplate(
        "Hello {{ user.fullName }}, appointment {{appointment.number}} {{missing.value}}",
        {
          user: { fullName: "Amina Patient" },
          appointment: { number: "APT-1001" }
        }
      )
    ).toBe("Hello Amina Patient, appointment APT-1001 ");
  });
});

describe("notification provider health", () => {
  it("keeps mock providers ready and reports missing production configuration", () => {
    const health = getNotificationProviderHealth({
      EMAIL_PROVIDER: "smtp",
      SMS_PROVIDER: "mock_sms",
      PUSH_PROVIDER: "firebase"
    });

    expect(health.find((provider) => provider.channel === "sms")).toMatchObject({
      provider: "mock_sms",
      mode: "mock",
      ready: true
    });
    expect(health.find((provider) => provider.channel === "email")).toMatchObject({
      provider: "smtp",
      mode: "production",
      ready: false,
      missing: ["SMTP_HOST", "EMAIL_FROM_EMAIL"]
    });
    expect(health.find((provider) => provider.channel === "push")?.missing).toContain(
      "FIREBASE_PROJECT_ID"
    );
  });
});
