const path = require("node:path");
const fs = require("node:fs");

const rootDir = path.resolve(__dirname, "../..");
const envFile = loadEnvFile(path.join(rootDir, ".env"));
const webHost = process.env.WEB_HOST || envFile.WEB_HOST || "127.0.0.1";
const webPort = process.env.WEB_PORT || envFile.WEB_PORT || "3002";
const apiHost = process.env.API_HOST || envFile.API_HOST || "127.0.0.1";
const apiPort = process.env.API_PORT || envFile.API_PORT || "4001";
const nodeEnv = "production";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/u)
      .flatMap((line) => {
        const trimmed = line.trim();

        if (!trimmed || trimmed.startsWith("#")) {
          return [];
        }

        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);

        if (!match) {
          return [];
        }

        const [, key, rawValue] = match;
        const value = rawValue.trim().replace(/^(['"])(.*)\1$/u, "$2");

        return [[key, value]];
      })
  );
}

const common = {
  cwd: rootDir,
  script: "pnpm",
  interpreter: "none",
  autorestart: true,
  kill_timeout: 15000,
  max_restarts: 10,
  restart_delay: 5000,
  time: true,
  merge_logs: false,
  env: {
    ...envFile,
    NODE_ENV: nodeEnv
  }
};

module.exports = {
  apps: [
    {
      ...common,
      name: "doctobook-web",
      args: `--filter @doctobook/web exec next start -H ${webHost} -p ${webPort}`,
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "768M",
      out_file: "./logs/doctobook-web.out.log",
      error_file: "./logs/doctobook-web.error.log",
      env: {
        ...common.env,
        PORT: webPort,
        WEB_HOST: webHost,
        WEB_PORT: webPort,
        NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "https://doctobook.example.com",
        WEB_PUBLIC_URL: process.env.WEB_PUBLIC_URL || "https://doctobook-staging.techstageit.com"
      }
    },
    {
      ...common,
      name: "doctobook-api",
      args: "--filter @doctobook/api start",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "1024M",
      out_file: "./logs/doctobook-api.out.log",
      error_file: "./logs/doctobook-api.error.log",
      env: {
        ...common.env,
        API_HOST: apiHost,
        API_PORT: apiPort,
        API_TRUST_PROXY: process.env.API_TRUST_PROXY || "true",
        API_BODY_LIMIT: process.env.API_BODY_LIMIT || "1mb",
        API_WEBHOOK_BODY_LIMIT: process.env.API_WEBHOOK_BODY_LIMIT || "256kb"
      }
    },
    {
      ...common,
      name: "doctobook-worker",
      args: "--filter @doctobook/worker start",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "1024M",
      out_file: "./logs/doctobook-worker.out.log",
      error_file: "./logs/doctobook-worker.error.log",
      env: {
        ...common.env
      }
    }
  ]
};
