import { spawn } from "node:child_process";

const processes = [
  spawn(process.platform === "win32" ? "npx.cmd" : "npx", [
    "--yes",
    "wrangler@4.127.1",
    "dev",
    "--config",
    "worker/portfolio/wrangler.local.toml",
    "--local",
    "--persist-to",
    ".wrangler/portfolio",
    "--port",
    "8787",
  ], { stdio: "inherit" }),
  spawn(process.execPath, ["node_modules/astro/astro.js", "dev", "--host"], { stdio: "inherit" }),
];

setTimeout(() => {
  const seed = spawn(process.execPath, ["scripts/seed-local-portfolio.mjs"], { stdio: "inherit" });
  seed.on("exit", (code) => {
    if (code) console.error("Local portfolio seeding failed; the API may need attention.");
  });
}, 3000);

function stopAll() {
  for (const child of processes) {
    if (!child.killed) child.kill();
  }
}

for (const child of processes) child.on("exit", stopAll);
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
