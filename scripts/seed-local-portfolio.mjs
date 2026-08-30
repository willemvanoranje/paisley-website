import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const imageDir = join(root, "public", "portfolio");
const apiUrl = process.env.LOCAL_PORTFOLIO_API_URL || "http://localhost:8787";
const password = process.env.LOCAL_PORTFOLIO_PASSWORD || "local-dev-password";

let existing;
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    existing = await fetch(`${apiUrl}/api/images`);
    if (existing.ok) break;
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!existing?.ok) throw new Error("Local portfolio API did not start in time");
if ((await existing.json()).images?.length) process.exit(0);

const login = await fetch(`${apiUrl}/api/admin/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password }),
});
if (!login.ok) throw new Error("Could not log in to the local portfolio API");

const files = (await readdir(imageDir)).filter((file) => [".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif"].includes(extname(file).toLowerCase()));
const form = new FormData();
for (const file of files) {
  const bytes = await readFile(join(imageDir, file));
  form.append("files", new Blob([bytes]), file);
}

const upload = await fetch(`${apiUrl}/api/admin/upload`, {
  method: "POST",
  headers: { Authorization: `Bearer ${password}` },
  body: form,
});
if (!upload.ok) throw new Error(`Could not seed local portfolio (${upload.status})`);
console.log(`Seeded local portfolio with ${files.length} sample images`);
