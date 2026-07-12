import { describe, expect, it } from "vitest";
import {
  decryptNotificationDelivery,
  encryptNotificationDelivery,
  getNotificationProviderHealth,
  renderNotificationTemplate
} from "./index.js";

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

describe("sensitive notification delivery encryption", () => {
  it("encrypts rendered delivery bodies before queue persistence", () => {
    const delivery = {
      subject: "Verify",
      body: "https://doctobook.test/verify-email#token=secret-token",
      sensitive: true
    };
    const encrypted = encryptNotificationDelivery(delivery, "test-encryption-key", "log-id");

    expect(encrypted.ciphertext).not.toContain("secret-token");
    expect(JSON.stringify(encrypted)).not.toContain("secret-token");
    expect(decryptNotificationDelivery(encrypted, "test-encryption-key", "log-id")).toEqual(
      delivery
    );
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
