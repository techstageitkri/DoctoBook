import { describe, expect, it, vi } from "vitest";
import { AppController } from "../src/app.controller.js";
import { HealthService } from "../src/security/health.service.js";

describe("api foundation", () => {
  it("has a test runner", () => {
    expect(true).toBe(true);
  });

  it("exposes live and ready health responses through the health service", async () => {
    const healthService = {
      live: vi.fn(() => ({ service: "api", status: "ok" })),
      ready: vi.fn(async () => ({
        service: "api",
        status: "ok",
        checks: {
          database: { status: "ok" },
          redis: { status: "ok" }
        }
      }))
    };
    const controller = new AppController(healthService as unknown as HealthService);

    expect(controller.health()).toEqual({ service: "api", status: "ok" });
    expect(controller.live()).toEqual({ service: "api", status: "ok" });
    await expect(controller.ready()).resolves.toEqual({
      service: "api",
      status: "ok",
      checks: {
        database: { status: "ok" },
        redis: { status: "ok" }
      }
    });
  });
});
