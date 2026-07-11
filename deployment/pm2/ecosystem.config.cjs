const path = require("node:path");

const rootDir = path.resolve(__dirname, "../..");
const webHost = process.env.WEB_HOST || "127.0.0.1";
const webPort = process.env.WEB_PORT || "3002";
const apiHost = process.env.API_HOST || "127.0.0.1";
const apiPort = process.env.API_PORT || "4001";
const nodeEnv = "production";

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
        NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "https://doctobook.example.com"
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
