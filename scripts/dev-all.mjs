import { spawn } from "node:child_process";
import { access, copyFile } from "node:fs/promises";

const runner = process.platform === "win32" ? "npx.cmd" : "npx";

await ensureLocalFile(".env", ".env.example");
await ensureLocalFile("worker/portfolio/.dev.vars", "worker/portfolio/.dev.vars.example");

const processes = [
  spawn(runner, [
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
  ], { stdio: "inherit", shell: process.platform === "win32" }),
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
    if (child.killed) continue;
    if (process.platform === "win32") {
      spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    } else {
      child.kill();
    }
  }
}

for (const child of processes) child.on("exit", stopAll);
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);

async function ensureLocalFile(file, example) {
  try {
    await access(file);
  } catch {
    await copyFile(example, file);
    console.log(`Created local ${file} from ${example}`);
  }
}
