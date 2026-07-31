import assert from "node:assert/strict";
import test from "node:test";

import worker from "./index.js";

class MemoryBucket {
  constructor(manifest) {
    this.objects = new Map([["_manifest.json", JSON.stringify(manifest)]]);
    this.manifestWrites = 0;
  }

  async get(key) {
    const value = this.objects.get(key);
    if (value === undefined) return null;
    return {
      body: value,
      json: async () => JSON.parse(value),
    };
  }

  async put(key, value) {
    this.objects.set(key, typeof value === "string" ? value : value);
    if (key === "_manifest.json") this.manifestWrites++;
  }

  manifest() {
    return JSON.parse(this.objects.get("_manifest.json"));
  }
}

function createEnv(manifest) {
  return {
    ADMIN_PASSWORD: "test-password",
    PORTFOLIO_BUCKET: new MemoryBucket(manifest),
  };
}

function adminRequest(path, options = {}) {
  return new Request(`https://portfolio.test${path}`, {
    ...options,
    headers: {
      Authorization: "Bearer test-password",
      ...(options.headers || {}),
    },
  });
}

test("manifest update persists optional palettes and image order", async () => {
  const env = createEnv({
    images: [
      { key: "first.jpg", alt: "First", visible: true },
      { key: "second.jpg", alt: "Second", visible: true },
    ],
  });

  const response = await worker.fetch(adminRequest("/api/admin/manifest", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      images: [
        {
          key: "second.jpg",
          alt: "Second image",
          visible: true,
          palette: ["#aabbcc", "#123456", "#ABCDEF", "#000000"],
        },
        { key: "first.jpg", alt: "First image", visible: false },
      ],
    }),
  }), env);

  assert.equal(response.status, 200);
  assert.deepEqual(env.PORTFOLIO_BUCKET.manifest(), {
    images: [
      {
        key: "second.jpg",
        alt: "Second image",
        visible: true,
        palette: ["#AABBCC", "#123456", "#ABCDEF", "#000000"],
      },
      { key: "first.jpg", alt: "First image", visible: false },
    ],
  });
});

test("manifest update rejects invalid palettes without changing data", async () => {
  const initialManifest = {
    images: [{ key: "photo.jpg", alt: "Photo", visible: true }],
  };
  const env = createEnv(initialManifest);

  const response = await worker.fetch(adminRequest("/api/admin/manifest", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      images: [{
        key: "photo.jpg",
        alt: "Changed",
        visible: true,
        palette: ["#112233", "#445566", "not-a-color", "#AABBCC"],
      }],
    }),
  }), env);

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /exactly four six-digit hex colors/);
  assert.deepEqual(env.PORTFOLIO_BUCKET.manifest(), initialManifest);
  assert.equal(env.PORTFOLIO_BUCKET.manifestWrites, 0);
});

test("public image API keeps its existing src and alt response shape", async () => {
  const env = createEnv({
    images: [
      {
        key: "visible.jpg",
        alt: "Visible",
        visible: true,
        palette: ["#112233", "#445566", "#778899", "#AABBCC"],
      },
      { key: "hidden.jpg", alt: "Hidden", visible: false },
    ],
  });

  const response = await worker.fetch(new Request("https://portfolio.test/api/images"), env);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    images: [{
      src: "https://portfolio.test/images/visible.jpg",
      alt: "Visible",
    }],
  });
});

test("admin page exposes palette generation and editing controls", async () => {
  const env = createEnv({ images: [] });
  const response = await worker.fetch(new Request("https://portfolio.test/admin"), env);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /Add color palette/);
  assert.match(html, /Generate from image/);
  assert.match(html, /extractDominantPalette/);
  assert.match(html, /type: "color"/);
  assert.match(html, /handle: "\.drag-handle"/);
  assert.match(html, /delayOnTouchOnly: true/);

  const inlineScript = html.match(/<script>\n([\s\S]*?)<\/script>/)?.[1];
  assert.ok(inlineScript);
  assert.doesNotThrow(() => new Function(inlineScript));
});
