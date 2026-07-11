import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { parseServerEnv } from "@doctobook/config";
import { AppModule } from "./app.module.js";
import {
  configureRequestHardening,
  isCorsOriginAllowed
} from "./security/bootstrap-security.js";
import { SafeHttpExceptionFilter } from "./security/safe-http-exception.filter.js";

async function bootstrap() {
  const env = parseServerEnv(process.env);
  const app = await NestFactory.create(AppModule, {
    bodyParser: false
  });

  configureRequestHardening(app, env);

  app.enableCors({
    origin(origin: string | undefined, callback: (error: Error | null, allowed?: boolean) => void) {
      callback(null, isCorsOriginAllowed(origin, env));
    },
    credentials: true
  });
  app.useGlobalFilters(new SafeHttpExceptionFilter());

  await app.listen(env.API_PORT);
}

void bootstrap();
