import { Queue } from "bullmq";
import { parseWorkerEnv } from "@doctobook/config";

const env = parseWorkerEnv(process.env);

export const slotGenerationQueue = new Queue("slot-generation", {
  connection: {
    url: env.REDIS_URL
  }
});

console.log("DoctoBook worker started");
