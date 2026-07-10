import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { parseServerEnv } from "@doctobook/config";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const env = parseServerEnv(process.env);
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: true,
    credentials: true
  });

  await app.listen(env.API_PORT);
}

void bootstrap();
