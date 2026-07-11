import { expect, test } from "@playwright/test";
import { apiUrl, e2eConfig } from "./support/env.js";

test.describe("provider and security negative checks", () => {
  test.skip(!e2eConfig.enabled, "Set E2E_RUN=true to run staging/production E2E checks");
  test.skip(
    !e2eConfig.providerNegative,
    "Set E2E_PROVIDER_NEGATIVE=true to run provider failure E2E checks"
  );

  test("invalid payment webhook signatures are rejected", async ({ request }) => {
    test.skip(!e2eConfig.payhereMerchantId, "Set E2E_PAYHERE_MERCHANT_ID");

    const response = await request.post(apiUrl("/v1/payments/webhooks/payhere"), {
      headers: {
        "Content-Type": "application/json"
      },
      data: {
        merchant_id: e2eConfig.payhereMerchantId,
        order_id: crypto.randomUUID(),
        payment_id: `invalid-${crypto.randomUUID()}`,
        status_code: "2",
        payhere_amount: "1000.00",
        payhere_currency: "LKR",
        md5sig: "invalid-signature"
      }
    });

    expect(response.status()).toBe(401);
  });

  test("unknown API routes return sanitized errors", async ({ request }) => {
    const response = await request.get(apiUrl("/v1/this-route-does-not-exist"));
    const payload = await response.json();

    expect(response.status()).toBe(404);
    expect(payload).toEqual(
      expect.objectContaining({
        statusCode: 404,
        requestId: expect.any(String)
      })
    );
    expect(JSON.stringify(payload)).not.toMatch(/Prisma|DATABASE_URL|REDIS_URL|stack/u);
  });
});
