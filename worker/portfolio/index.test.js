import assert from "node:assert/strict";
import test from "node:test";

import worker from "./index.js";

class MemoryBucket {
  constructor({ portfolio = { images: [] }, projects } = {}) {
    this.objects = new Map([["_manifest.json", JSON.stringify(portfolio)]]);
    if (projects) this.objects.set("_projects_manifest.json", JSON.stringify(projects));
    this.manifestWrites = new Map();
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
    this.objects.set(key, value);
    if (key.endsWith("manifest.json")) {
      this.manifestWrites.set(key, (this.manifestWrites.get(key) || 0) + 1);
    }
  }

  async delete(key) {
    this.objects.delete(key);
  }

  manifest(collection = "portfolio") {
    const key = collection === "projects" ? "_projects_manifest.json" : "_manifest.json";
    const value = this.objects.get(key);
    return value ? JSON.parse(value) : { images: [] };
  }

  writeCount(collection = "portfolio") {
    const key = collection === "projects" ? "_projects_manifest.json" : "_manifest.json";
    return this.manifestWrites.get(key) || 0;
  }
}

function createEnv(manifests) {
  return {
    ADMIN_PASSWORD: "test-password",
    PORTFOLIO_BUCKET: new MemoryBucket(manifests),
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

test("public APIs keep Portfolio and Projects separate", async () => {
  const env = createEnv({
    portfolio: {
      images: [
        {
          key: "portfolio.jpg",
          alt: "Portfolio",
          visible: true,
          palette: ["#111111", "#222222", "#333333", "#444444"],
        },
      ],
    },
    projects: {
      images: [
        {
          key: "projects/project.jpg",
          alt: "Project",
          visible: true,
          palette: ["#aabbcc", "#123456", "#ABCDEF", "#000000"],
        },
        {
          key: "projects/hidden.jpg",
          alt: "Hidden",
          visible: false,
          palette: ["#111111", "#222222", "#333333", "#444444"],
        },
        { key: "projects/invalid.jpg", alt: "Invalid", visible: true },
      ],
    },
  });

  const portfolioResponse = await worker.fetch(new Request("https://portfolio.test/api/images"), env);
  const projectsResponse = await worker.fetch(new Request("https://portfolio.test/api/projects"), env);

  assert.deepEqual(await portfolioResponse.json(), {
    images: [{
      src: "https://portfolio.test/images/portfolio.jpg",
      alt: "Portfolio",
    }],
  });
  assert.deepEqual(await projectsResponse.json(), {
    images: [{
      src: "https://portfolio.test/images/projects/project.jpg",
      alt: "Project",
      palette: ["#AABBCC", "#123456", "#ABCDEF", "#000000"],
    }],
  });
});

test("Portfolio saves remove legacy palettes while preserving order", async () => {
  const env = createEnv({
    portfolio: {
      images: [
        { key: "first.jpg", alt: "First", visible: true },
        {
          key: "second.jpg",
          alt: "Second",
          visible: true,
          palette: ["#111111", "#222222", "#333333", "#444444"],
        },
      ],
    },
  });

  const response = await worker.fetch(adminRequest("/api/admin/manifest?collection=portfolio", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      images: [
        { key: "second.jpg", alt: "Second image", visible: true },
        { key: "first.jpg", alt: "First image", visible: false },
      ],
    }),
  }), env);

  assert.equal(response.status, 200);
  assert.deepEqual(env.PORTFOLIO_BUCKET.manifest("portfolio"), {
    images: [
      { key: "second.jpg", alt: "Second image", visible: true },
      { key: "first.jpg", alt: "First image", visible: false },
    ],
  });
});

test("Projects saves require and persist four colors", async () => {
  const projects = {
    images: [{ key: "projects/photo.jpg", alt: "Photo", visible: true, palette: ["#111111", "#222222", "#333333", "#444444"] }],
  };
  const env = createEnv({ projects });

  const invalidResponse = await worker.fetch(adminRequest("/api/admin/manifest?collection=projects", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      images: [{
        key: "projects/photo.jpg",
        alt: "Changed",
        visible: true,
        palette: ["#112233", "#445566", "not-a-color", "#AABBCC"],
      }],
    }),
  }), env);

  assert.equal(invalidResponse.status, 400);
  assert.match((await invalidResponse.json()).error, /four six-digit hex colors/);
  assert.deepEqual(env.PORTFOLIO_BUCKET.manifest("projects"), projects);
  assert.equal(env.PORTFOLIO_BUCKET.writeCount("projects"), 0);

  const validResponse = await worker.fetch(adminRequest("/api/admin/manifest?collection=projects", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      images: [{
        key: "projects/photo.jpg",
        alt: "Changed",
        visible: true,
        palette: ["#aabbcc", "#123456", "#ABCDEF", "#000000"],
      }],
    }),
  }), env);

  assert.equal(validResponse.status, 200);
  assert.deepEqual(env.PORTFOLIO_BUCKET.manifest("projects"), {
    images: [{
      key: "projects/photo.jpg",
      alt: "Changed",
      visible: true,
      palette: ["#AABBCC", "#123456", "#ABCDEF", "#000000"],
    }],
  });
});

test("uploads add palettes only to Projects", async () => {
  const env = createEnv();

  const portfolioForm = new FormData();
  portfolioForm.append("files", new File(["portfolio"], "portfolio.jpg", { type: "image/jpeg" }));
  const portfolioResponse = await worker.fetch(adminRequest("/api/admin/upload?collection=portfolio", {
    method: "POST",
    body: portfolioForm,
  }), env);
  assert.equal(portfolioResponse.status, 200);
  assert.deepEqual(env.PORTFOLIO_BUCKET.manifest("portfolio"), {
    images: [{ key: "portfolio.jpg", alt: "portfolio", visible: true }],
  });

  const missingPaletteForm = new FormData();
  missingPaletteForm.append("files", new File(["project"], "project.jpg", { type: "image/jpeg" }));
  const missingPaletteResponse = await worker.fetch(adminRequest("/api/admin/upload?collection=projects", {
    method: "POST",
    body: missingPaletteForm,
  }), env);
  assert.equal(missingPaletteResponse.status, 400);
  assert.deepEqual(env.PORTFOLIO_BUCKET.manifest("projects"), { images: [] });

  const projectsForm = new FormData();
  projectsForm.append("files", new File(["project"], "project.jpg", { type: "image/jpeg" }));
  projectsForm.append("palettes", JSON.stringify([["#112233", "#445566", "#778899", "#aabbcc"]]));
  const projectsResponse = await worker.fetch(adminRequest("/api/admin/upload?collection=projects", {
    method: "POST",
    body: projectsForm,
  }), env);

  assert.equal(projectsResponse.status, 200);
  assert.deepEqual(env.PORTFOLIO_BUCKET.manifest("projects"), {
    images: [{
      key: "projects/project.jpg",
      alt: "project",
      visible: true,
      palette: ["#112233", "#445566", "#778899", "#AABBCC"],
    }],
  });
});

test("admin page exposes separate collection tabs and automatic palettes", async () => {
  const env = createEnv();
  const response = await worker.fetch(new Request("https://portfolio.test/admin"), env);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /renderCollectionTabs/);
  assert.match(html, /A four-color palette is generated for every image/);
  assert.match(html, /extractDominantPalette/);
  assert.match(html, /type: "color"/);
  assert.doesNotMatch(html, /Add color palette/);
  assert.doesNotMatch(html, />Remove</);
  assert.match(html, /handle: "\.drag-handle"/);
  assert.match(html, /delayOnTouchOnly: true/);

  const inlineScript = html.match(/<script>\n([\s\S]*?)<\/script>/)?.[1];
  assert.ok(inlineScript);
  assert.doesNotThrow(() => new Function(inlineScript));
});
