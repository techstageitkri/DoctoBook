import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { parseServerEnv } from "@doctobook/config";
import { createLogger } from "@doctobook/observability";
import { AppModule } from "./app.module.js";
import {
  configureRequestHardening,
  isCorsOriginAllowed
} from "./security/bootstrap-security.js";
import { SafeHttpExceptionFilter } from "./security/safe-http-exception.filter.js";

async function bootstrap() {
  const env = parseServerEnv(process.env);
  const logger = createLogger({
    service: "api",
    environment: env.NODE_ENV
  });
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: false
  });

  registerProcessErrorHandlers(logger);
  configureRequestHardening(app, env, logger);

  app.enableCors({
    origin(origin: string | undefined, callback: (error: Error | null, allowed?: boolean) => void) {
      callback(null, isCorsOriginAllowed(origin, env));
    },
    credentials: true
  });
  app.useGlobalFilters(new SafeHttpExceptionFilter(logger));

  await app.listen(env.API_PORT, env.API_HOST);
  logger.info("api.started", { host: env.API_HOST, port: env.API_PORT });
}

bootstrap().catch((error) => {
  createLogger({
    service: "api",
    environment: process.env.NODE_ENV ?? "development"
  }).error("api.start_failed", {}, error);
  process.exitCode = 1;
});

function registerProcessErrorHandlers(logger: ReturnType<typeof createLogger>) {
  process.on("unhandledRejection", (reason) => {
    logger.error("api.unhandled_rejection", {}, reason);
  });
  process.on("uncaughtException", (error) => {
    logger.error("api.uncaught_exception", {}, error);
    process.exitCode = 1;
  });
}
