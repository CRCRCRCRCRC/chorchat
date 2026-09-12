import { spawnSync } from "node:child_process";
import { join } from "node:path";

const projectRoot = process.cwd();

function run(scriptPath, args, env = process.env) {
  const result = spawnSync(process.execPath, [join(projectRoot, scriptPath), ...args], {
    cwd: projectRoot,
    env,
    stdio: "inherit"
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function getMigrationDatabaseUrl() {
  const configuredDirectUrl = process.env.DIRECT_URL || process.env.DATABASE_URL_UNPOOLED;

  if (configuredDirectUrl) {
    return configuredDirectUrl;
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the Vercel build.");
  }

  const parsedUrl = new URL(databaseUrl);

  if (parsedUrl.hostname.includes("-pooler.")) {
    parsedUrl.hostname = parsedUrl.hostname.replace("-pooler.", ".");
  }

  return parsedUrl.toString();
}

run("node_modules/prisma/build/index.js", ["generate"]);
run("node_modules/prisma/build/index.js", ["migrate", "deploy"], {
  ...process.env,
  DATABASE_URL: getMigrationDatabaseUrl(),
  PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: "1"
});
run("node_modules/next/dist/bin/next", ["build"]);
