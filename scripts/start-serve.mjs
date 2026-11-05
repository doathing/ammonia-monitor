// Production-ish local/sandbox start: build, then serve the built worker on the
// PORT injected by the host (0.0.0.0). Data lives in the WorkBuddy cloud service,
// so no local schema step is needed any more.
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
process.chdir(projectRoot);

const port = process.env.PORT || "3000";
const persistTo = process.env.WRANGLER_PERSIST_TO || ".wrangler/state";
const configPath = "dist/server/wrangler.json";
const wrangler = "./node_modules/wrangler/bin/wrangler.js";

function run(args) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit", cwd: projectRoot });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.env.SKIP_BUILD === "1" && existsSync(configPath)) {
  console.log("[start] SKIP_BUILD=1, reusing existing build output");
} else {
  console.log("[start] building…");
  run(["./scripts/run-framework.mjs", "build"]);
}

// wrangler resolves `.dev.vars` relative to the config file, which lives in
// dist/server once the worker is built. Mirror the project-level file so the
// runtime secrets reach the built worker.
const devVars = ".dev.vars";
const builtDevVars = "dist/server/.dev.vars";
if (existsSync(devVars)) {
  copyFileSync(devVars, builtDevVars);
}

console.log(`[start] serving on 0.0.0.0:${port}`);
const child = spawn(
  process.execPath,
  [
    "--import",
    "./scripts/sites-env.mjs",
    wrangler,
    "dev",
    "--config",
    configPath,
    "--local",
    "--persist-to",
    persistTo,
    "--ip",
    "0.0.0.0",
    "--port",
    String(port),
    "--inspector-port",
    "0",
  ],
  { stdio: "inherit", cwd: projectRoot },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => process.exit(code ?? 1));
