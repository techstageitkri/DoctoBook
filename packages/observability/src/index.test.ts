import { describe, expect, it } from "vitest";
import { LogRecord, createLogger, errorContext, redactSensitive } from "./index.js";

describe("observability logger", () => {
  it("redacts sensitive values recursively", () => {
    expect(
      redactSensitive({
        authorization: "Bearer token",
        nested: {
          refreshToken: "secret",
          reasonForVisit: "private visit reason",
          visible: "ok"
        },
        list: [{ smtpPassword: "smtp-secret" }]
      })
    ).toEqual({
      authorization: "[redacted]",
      nested: {
        refreshToken: "[redacted]",
        reasonForVisit: "[redacted]",
        visible: "ok"
      },
      list: [{ smtpPassword: "[redacted]" }]
    });
  });

  it("emits structured JSON records", () => {
    const records: LogRecord[] = [];
    const logger = createLogger({
      service: "api",
      environment: "test",
      now: () => new Date("2026-07-11T10:00:00.000Z"),
      sink(record) {
        records.push(record);
      }
    });

    logger.info("request completed", {
      requestId: "request-1",
      cookie: "refresh=value",
      statusCode: 200
    });

    expect(records).toEqual([
      {
        timestamp: "2026-07-11T10:00:00.000Z",
        level: "info",
        service: "api",
        environment: "test",
        message: "request completed",
        requestId: "request-1",
        cookie: "[redacted]",
        statusCode: 200
      }
    ]);
  });

  it("normalizes error metadata without leaking arbitrary objects", () => {
    const error = new Error("Provider failed") as Error & {
      code: string;
      statusCode: number;
    };

    error.code = "PROVIDER_FAILED";
    error.statusCode = 502;

    expect(errorContext(error, false)).toEqual({
      errorName: "Error",
      errorMessage: "Provider failed",
      errorCode: "PROVIDER_FAILED",
      statusCode: 502
    });
  });
});
