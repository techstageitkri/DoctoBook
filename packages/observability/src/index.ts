export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = Record<string, unknown>;

export type LoggerOptions = {
  service: string;
  environment?: string;
  sink?: (record: LogRecord, line: string, level: LogLevel) => void;
  includeStack?: boolean;
  now?: () => Date;
};

export type LogRecord = {
  timestamp: string;
  level: LogLevel;
  service: string;
  environment: string;
  message: string;
} & LogContext;

export type JsonLogger = {
  child(context: LogContext): JsonLogger;
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext, error?: unknown): void;
};

const sensitiveKeyPattern =
  /authorization|cookie|password|passwd|secret|token|signature|credential|private[_-]?key|merchant[_-]?secret|smtp|firebase|otp|reset|reason[_-]?for[_-]?visit|visit[_-]?reason|medical|diagnosis|clinical|patient[_-]?note/i;

const maxDepth = 8;
const maxArrayLength = 50;
const maxStringLength = 4000;

export function createLogger(options: LoggerOptions): JsonLogger {
  return createLoggerWithContext(options, {});
}

export function redactSensitive(value: unknown): unknown {
  return redactValue(value, 0);
}

export function errorContext(error: unknown, includeStack = false): LogContext {
  if (error instanceof Error) {
    const record: LogContext = {
      errorName: error.name,
      errorMessage: error.message
    };
    const maybeCode = (error as { code?: unknown }).code;
    const maybeStatusCode = (error as { statusCode?: unknown }).statusCode;
    const maybeStatus = (error as { status?: unknown }).status;

    if (typeof maybeCode === "string" || typeof maybeCode === "number") {
      record.errorCode = maybeCode;
    }

    if (typeof maybeStatusCode === "number") {
      record.statusCode = maybeStatusCode;
    } else if (typeof maybeStatus === "number") {
      record.statusCode = maybeStatus;
    }

    if (includeStack && error.stack) {
      record.stack = error.stack;
    }

    return redactSensitive(record) as LogContext;
  }

  return {
    errorMessage: typeof error === "string" ? error : "Unknown error",
    errorValue: redactSensitive(error)
  };
}

function createLoggerWithContext(options: LoggerOptions, baseContext: LogContext): JsonLogger {
  const environment = options.environment ?? process.env.NODE_ENV ?? "development";
  const includeStack = options.includeStack ?? environment !== "production";
  const now = options.now ?? (() => new Date());
  const sink = options.sink ?? defaultSink;

  const write = (level: LogLevel, message: string, context: LogContext = {}, error?: unknown) => {
    const redactedBaseContext = redactSensitive(baseContext) as LogContext;
    const redactedContext = redactSensitive(context) as LogContext;
    const record = {
      timestamp: now().toISOString(),
      level,
      service: options.service,
      environment,
      message,
      ...redactedBaseContext,
      ...redactedContext,
      ...(error ? errorContext(error, includeStack) : {})
    } satisfies LogRecord;
    const line = JSON.stringify(record);

    sink(record, line, level);
  };

  return {
    child(context) {
      return createLoggerWithContext(options, {
        ...baseContext,
        ...context
      });
    },
    debug(message, context) {
      write("debug", message, context);
    },
    info(message, context) {
      write("info", message, context);
    },
    warn(message, context) {
      write("warn", message, context);
    },
    error(message, context, error) {
      write("error", message, context, error);
    }
  };
}

function defaultSink(_record: LogRecord, line: string, level: LogLevel) {
  if (_record.environment === "test" && process.env.OBSERVABILITY_TEST_LOGS !== "true") {
    return;
  }

  if (level === "error") {
    process.stderr.write(`${line}\n`);
    return;
  }

  process.stdout.write(`${line}\n`);
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > maxDepth) {
    return "[max-depth]";
  }

  if (typeof value === "string") {
    return truncateString(value);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return errorContext(value, false);
  }

  if (Array.isArray(value)) {
    return value.slice(0, maxArrayLength).map((item) => redactValue(item, depth + 1));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      isSensitiveKey(key) ? "[redacted]" : redactValue(entry, depth + 1)
    ])
  );
}

function isSensitiveKey(key: string) {
  return sensitiveKeyPattern.test(key);
}

function truncateString(value: string) {
  if (value.length <= maxStringLength) {
    return value;
  }

  return `${value.slice(0, maxStringLength)}...[truncated]`;
}
