const MANIFEST_KEY = "_manifest.json";
const PROJECTS_MANIFEST_KEY = "_projects_manifest.json";

const COLLECTIONS = {
  portfolio: { manifestKey: MANIFEST_KEY, keyPrefix: "" },
  projects: { manifestKey: PROJECTS_MANIFEST_KEY, keyPrefix: "projects/" },
};

const ALLOWED_ORIGINS = [
  "https://paisleys.work",
  "http://localhost:4321",
  "http://localhost:3000",
];

const IMAGE_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function normalizePalette(palette) {
  if (palette === undefined) return undefined;
  if (!Array.isArray(palette) || palette.length !== 4 || !palette.every((color) => typeof color === "string" && HEX_COLOR.test(color))) {
    return null;
  }
  return palette.map((color) => color.toUpperCase());
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return corsResponse(204, null, origin);
    }

    try {
      if (path === "/api/images" && request.method === "GET") {
        return handleListImages(env, url, origin);
      }
      if (path === "/api/projects" && request.method === "GET") {
        return handleListProjects(env, url, origin);
      }

      if (path.startsWith("/images/") && (request.method === "GET" || request.method === "HEAD")) {
        return handleServeImage(path, env, request.method);
      }

      if (path === "/admin" || path === "/admin/") {
        return serveAdminHTML();
      }

      if (path === "/api/admin/login" && request.method === "POST") {
        return handleLogin(request, env, origin);
      }

      if (path.startsWith("/api/admin/")) {
        const authError = checkAuth(request, env);
        if (authError) return corsResponse(401, { error: "Unauthorized" }, origin);

        if (path === "/api/admin/images" && request.method === "GET") {
          return handleAdminListImages(env, url, origin);
        }
        if (path === "/api/admin/upload" && request.method === "POST") {
          return handleUpload(request, env, url, origin);
        }
        if (path.startsWith("/api/admin/images/") && request.method === "DELETE") {
          return handleDelete(path, env, url, origin);
        }
        if (path === "/api/admin/manifest" && request.method === "PUT") {
          return handleUpdateManifest(request, env, url, origin);
        }
      }

      return corsResponse(404, { error: "Not found" }, origin);
    } catch (err) {
      console.error("Worker error:", err);
      return corsResponse(500, { error: "Internal server error" }, origin);
    }
  },
};

function checkAuth(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token || token !== env.ADMIN_PASSWORD) return true;
  return null;
}

function getCollection(url) {
  const name = url.searchParams.get("collection") || "portfolio";
  return COLLECTIONS[name] ? name : null;
}

async function getManifest(env, collection = "portfolio") {
  const obj = await env.PORTFOLIO_BUCKET.get(COLLECTIONS[collection].manifestKey);
  if (!obj) return { images: [] };
  return obj.json();
}

async function saveManifest(env, collection, manifest) {
  await env.PORTFOLIO_BUCKET.put(COLLECTIONS[collection].manifestKey, JSON.stringify(manifest, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
}

function imageUrl(baseUrl, key) {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${baseUrl}/images/${encodedKey}`;
}

async function handleListImages(env, url, origin) {
  const manifest = await getManifest(env, "portfolio");
  const baseUrl = `${url.protocol}//${url.host}`;
  const images = manifest.images
    .filter((img) => img.visible !== false)
    .map((img) => ({
      src: imageUrl(baseUrl, img.key),
      alt: img.alt || "",
    }));
  return corsResponse(200, { images }, origin);
}

async function handleListProjects(env, url, origin) {
  const manifest = await getManifest(env, "projects");
  const baseUrl = `${url.protocol}//${url.host}`;
  const images = manifest.images
    .filter((img) => img.visible !== false)
    .map((img) => ({ ...img, palette: normalizePalette(img.palette) }))
    .filter((img) => img.palette)
    .map((img) => ({
      src: imageUrl(baseUrl, img.key),
      alt: img.alt || "",
      palette: img.palette,
    }));
  return corsResponse(200, { images }, origin);
}

async function handleServeImage(path, env, method) {
  const key = decodeURIComponent(path.replace("/images/", ""));
  const obj = await env.PORTFOLIO_BUCKET.get(key);
  if (!obj) return new Response("Not found", { status: 404 });

  const ext = "." + key.split(".").pop().toLowerCase();
  const contentType = IMAGE_TYPES[ext] || "application/octet-stream";
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=31536000, immutable",
    "Access-Control-Allow-Origin": "*",
  };

  if (method === "HEAD") return new Response(null, { headers });
  return new Response(obj.body, { headers });
}

async function handleLogin(request, env, origin) {
  const { password } = await request.json();
  if (password === env.ADMIN_PASSWORD) {
    return corsResponse(200, { success: true }, origin);
  }
  return corsResponse(401, { error: "Invalid password" }, origin);
}

async function handleAdminListImages(env, url, origin) {
  const collection = getCollection(url);
  if (!collection) return corsResponse(400, { error: "Invalid collection" }, origin);
  const manifest = await getManifest(env, collection);
  const baseUrl = `${url.protocol}//${url.host}`;
  const images = manifest.images.map((img) => {
    const entry = {
      key: img.key,
      alt: img.alt || "",
      visible: img.visible !== false,
      src: imageUrl(baseUrl, img.key),
    };
    if (collection === "projects") entry.palette = normalizePalette(img.palette);
    return entry;
  });
  return corsResponse(200, { images }, origin);
}

async function handleUpload(request, env, url, origin) {
  const collection = getCollection(url);
  if (!collection) return corsResponse(400, { error: "Invalid collection" }, origin);

  const formData = await request.formData();
  const files = formData.getAll("files");
  if (files.length === 0 || files.some((file) => !(file instanceof File))) {
    return corsResponse(400, { error: "At least one image file is required" }, origin);
  }

  let palettes = [];
  if (collection === "projects") {
    try {
      palettes = JSON.parse(formData.get("palettes") || "[]");
    } catch {
      return corsResponse(400, { error: "Project palettes must be valid JSON" }, origin);
    }
    if (!Array.isArray(palettes) || palettes.length !== files.length) {
      return corsResponse(400, { error: "Every project image requires a four-color palette" }, origin);
    }
    palettes = palettes.map(normalizePalette);
    if (palettes.some((palette) => !palette)) {
      return corsResponse(400, { error: "Every project palette must contain exactly four six-digit hex colors" }, origin);
    }
  }

  const manifest = await getManifest(env, collection);
  const uploaded = [];
  const pending = [];

  for (const [index, file] of files.entries()) {
    const ext = "." + file.name.split(".").pop().toLowerCase();
    if (!IMAGE_TYPES[ext]) {
      return corsResponse(400, { error: `Unsupported image type: ${file.name}` }, origin);
    }

    const sanitized = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
    const prefix = COLLECTIONS[collection].keyPrefix;
    let key = prefix + sanitized;
    let counter = 1;
    while (manifest.images.some((img) => img.key === key) || pending.some((item) => item.key === key)) {
      const base = sanitized.slice(0, -ext.length);
      key = `${prefix}${base}-${counter}${ext}`;
      counter++;
    }

    const name = sanitized.slice(0, -ext.length).replace(/[-_]/g, " ");
    const entry = { key, alt: name, visible: true };
    if (collection === "projects") entry.palette = palettes[index];
    pending.push({ file, ext, key, entry });
  }

  try {
    for (const item of pending) {
      await env.PORTFOLIO_BUCKET.put(item.key, item.file.stream(), {
        httpMetadata: { contentType: IMAGE_TYPES[item.ext] },
      });
      uploaded.push(item.entry);
    }
    manifest.images.push(...uploaded);
    await saveManifest(env, collection, manifest);
  } catch (error) {
    for (const entry of uploaded) await env.PORTFOLIO_BUCKET.delete(entry.key);
    throw error;
  }

  return corsResponse(200, { uploaded, total: manifest.images.length }, origin);
}

async function handleDelete(path, env, url, origin) {
  const collection = getCollection(url);
  if (!collection) return corsResponse(400, { error: "Invalid collection" }, origin);
  const key = decodeURIComponent(path.replace("/api/admin/images/", ""));
  const manifest = await getManifest(env, collection);
  if (!manifest.images.some((img) => img.key === key)) {
    return corsResponse(404, { error: "Image not found in collection" }, origin);
  }

  manifest.images = manifest.images.filter((img) => img.key !== key);
  await saveManifest(env, collection, manifest);
  await env.PORTFOLIO_BUCKET.delete(key);

  return corsResponse(200, { success: true, deleted: key }, origin);
}

async function handleUpdateManifest(request, env, url, origin) {
  const collection = getCollection(url);
  if (!collection) return corsResponse(400, { error: "Invalid collection" }, origin);
  const body = await request.json();
  if (!Array.isArray(body.images)) {
    return corsResponse(400, { error: "images array required" }, origin);
  }

  const manifest = await getManifest(env, collection);
  const existingKeys = new Set(manifest.images.map((img) => img.key));
  const submittedKeys = body.images.map((img) => img.key);
  if (submittedKeys.length !== existingKeys.size || new Set(submittedKeys).size !== submittedKeys.length || submittedKeys.some((key) => !existingKeys.has(key))) {
    return corsResponse(400, { error: "Manifest must include every image in the collection exactly once" }, origin);
  }

  const updated = [];
  for (const img of body.images) {
    const entry = {
      key: img.key,
      alt: img.alt || "",
      visible: img.visible !== false,
    };
    if (collection === "projects") {
      const palette = normalizePalette(img.palette);
      if (!palette) {
        return corsResponse(400, { error: `Palette for ${img.key} must contain exactly four six-digit hex colors` }, origin);
      }
      entry.palette = palette;
    }
    updated.push(entry);
  }

  await saveManifest(env, collection, { images: updated });
  return corsResponse(200, { success: true, count: updated.length }, origin);
}

function corsResponse(status, body, origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  const headers = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (status === 204) return new Response(null, { status, headers });
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function serveAdminHTML() {
  return new Response(ADMIN_HTML, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Portfolio Manager</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js"></script>
<style>
  .sortable-ghost { opacity: 0.3; }
  .sortable-chosen { outline: 2px solid #6b7280; outline-offset: 2px; transform: scale(1.03); transition: transform 0.15s ease, outline 0.15s ease; z-index: 10; }
  .sortable-drag { box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25); transform: scale(1.05); }
  .upload-zone.dragover { border-color: #374151; background: #f9fafb; }
  .toast { animation: slideIn 0.3s ease-out, fadeOut 0.3s ease-in 2.7s forwards; }
  .palette-color { appearance: none; border: 0; padding: 0; background: transparent; }
  .palette-color::-webkit-color-swatch-wrapper { padding: 0; }
  .palette-color::-webkit-color-swatch { border: 1px solid #d1d5db; border-radius: 0.375rem; }
  .palette-color::-moz-color-swatch { border: 1px solid #d1d5db; border-radius: 0.375rem; }
  @keyframes slideIn { from { transform: translateY(-1rem); opacity: 0; } }
  @keyframes fadeOut { to { opacity: 0; } }
</style>
</head>
<body class="bg-gray-50 min-h-screen text-gray-800">

<div id="app"></div>

<script>
const API = location.origin;
let password = sessionStorage.getItem("admin_pw") || "";
let collection = "portfolio";
let images = [];
let hasChanges = false;
let sortable = null;

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) Object.entries(attrs).forEach(([k, v]) => {
    if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "className") el.className = v;
    else if (k === "htmlFor") el.setAttribute("for", v);
    else el.setAttribute(k, v);
  });
  children.flat().forEach(c => {
    if (c == null) return;
    el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  });
  return el;
}

function toast(msg, type = "success") {
  const colors = { success: "bg-gray-800 text-white", error: "bg-red-600 text-white" };
  const t = h("div", { className: "toast fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm " + colors[type] }, msg);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function isHexColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function colorToHex(red, green, blue) {
  return "#" + [red, green, blue].map(value => Math.round(value).toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function extractDominantPalette(src) {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = src;
  await image.decode();

  const maxSize = 160;
  const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const buckets = new Map();
  for (let index = 0; index < pixels.length; index += 16) {
    if (pixels[index + 3] < 128) continue;
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const key = ((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4);
    const bucket = buckets.get(key) || { count: 0, red: 0, green: 0, blue: 0 };
    bucket.count++;
    bucket.red += red;
    bucket.green += green;
    bucket.blue += blue;
    buckets.set(key, bucket);
  }

  const candidates = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .map(bucket => ({
      count: bucket.count,
      red: bucket.red / bucket.count,
      green: bucket.green / bucket.count,
      blue: bucket.blue / bucket.count,
    }));

  const selected = [];
  for (const color of candidates) {
    const isDistinct = selected.every(existing => {
      const red = color.red - existing.red;
      const green = color.green - existing.green;
      const blue = color.blue - existing.blue;
      return red * red + green * green + blue * blue >= 1200;
    });
    if (isDistinct) selected.push(color);
    if (selected.length === 4) break;
  }
  for (const color of candidates) {
    if (selected.length === 4) break;
    if (!selected.includes(color)) selected.push(color);
  }
  if (selected.length === 0) throw new Error("No opaque colors found");
  while (selected.length < 4) selected.push(selected[selected.length - 1]);
  return selected.map(color => colorToHex(color.red, color.green, color.blue));
}

async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { Authorization: "Bearer " + password, ...(opts.headers || {}) },
  });
  if (res.status === 401) { password = ""; sessionStorage.removeItem("admin_pw"); render(); throw new Error("Unauthorized"); }
  return res;
}

async function loadImages() {
  const res = await apiFetch("/api/admin/images?collection=" + collection);
  const data = await res.json();
  images = data.images || [];
  hasChanges = false;
}

async function switchCollection(nextCollection) {
  if (nextCollection === collection) return;
  if (hasChanges && !confirm("Discard unsaved changes?")) return;
  collection = nextCollection;
  await loadImages();
  render();
}

function destroySortable() {
  if (sortable) {
    sortable.destroy();
    sortable = null;
  }
}

function render() {
  destroySortable();
  const app = document.getElementById("app");
  app.innerHTML = "";
  app.appendChild(password ? renderDashboard() : renderLogin());
  if (password && document.getElementById("image-grid")) initSortable();
}

function renderLogin() {
  const form = h("form", {
    className: "max-w-sm mx-auto mt-32 bg-white p-8 rounded-xl shadow-sm border border-gray-200",
    onSubmit: async (e) => {
      e.preventDefault();
      const pw = form.querySelector("input").value;
      try {
        const res = await fetch(API + "/api/admin/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: pw }),
        });
        if (res.ok) { password = pw; sessionStorage.setItem("admin_pw", pw); await loadImages(); render(); }
        else toast("Invalid password", "error");
      } catch { toast("Connection failed", "error"); }
    },
  },
    h("h1", { className: "text-2xl font-semibold text-center mb-6 tracking-wide" }, "Image Manager"),
    h("input", { type: "password", placeholder: "Password", required: "true", autocomplete: "current-password",
      className: "w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400 mb-4" }),
    h("button", { type: "submit", className: "w-full py-3 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium" }, "Sign In")
  );
  return form;
}

function renderDashboard() {
  const wrap = h("div", { className: "min-h-screen flex flex-col" });

  const header = h("header", { className: "bg-white border-b border-gray-200 sticky top-0 z-40" },
    h("div", { className: "max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between" },
      h("h1", { className: "text-lg font-semibold tracking-wide" }, "Image Manager"),
      h("div", { className: "flex items-center gap-3" },
        h("span", { className: "text-sm text-gray-500" }, images.length + " photo" + (images.length !== 1 ? "s" : "")),
        h("button", {
          className: "text-sm text-gray-500 hover:text-gray-800 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-100",
          onClick: () => { password = ""; sessionStorage.removeItem("admin_pw"); render(); }
        }, "Sign Out")
      )
    )
  );

  const uploadZone = h("div", {
    className: "upload-zone border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer transition-colors hover:border-gray-400",
    onClick: () => fileInput.click(),
    onDragover: (e) => { e.preventDefault(); uploadZone.classList.add("dragover"); },
    onDragleave: () => uploadZone.classList.remove("dragover"),
    onDrop: async (e) => { e.preventDefault(); uploadZone.classList.remove("dragover"); await uploadFiles(e.dataTransfer.files); },
  },
    h("div", { className: "text-gray-400 mb-2" },
      h("svg", { className: "w-10 h-10 mx-auto", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", "stroke-width": "1.5" },
        (() => { const p = document.createElementNS("http://www.w3.org/2000/svg","path"); p.setAttribute("stroke-linecap","round"); p.setAttribute("stroke-linejoin","round"); p.setAttribute("d","M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"); return p; })()
      )
    ),
    h("p", { className: "text-gray-600 font-medium" }, "Drop " + collectionLabel().toLowerCase() + " images here or click to upload"),
    h("p", { className: "text-sm text-gray-400 mt-1" },
      collection === "projects"
        ? "A four-color palette is generated for every image"
        : "JPG, PNG, WebP, AVIF, GIF"
    )
  );

  const fileInput = h("input", { type: "file", multiple: "true", accept: "image/*", className: "hidden",
    onChange: async (e) => { await uploadFiles(e.target.files); e.target.value = ""; }
  });

  const grid = h("div", { id: "image-grid", className: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" });
  images.forEach((img, i) => grid.appendChild(renderImageCard(img, i)));

  const emptyState = images.length === 0
    ? h("p", { className: "text-center text-gray-400 py-12 col-span-full" }, "No photos yet. Upload some above!")
    : null;
  if (emptyState) grid.appendChild(emptyState);

  const saveBar = hasChanges ? h("div", { className: "save-bar fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 p-4 z-40" },
    h("div", { className: "max-w-6xl mx-auto flex items-center justify-between" },
      h("span", { className: "text-sm text-gray-600" }, "You have unsaved changes"),
      h("button", {
        className: "px-6 py-2.5 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium text-sm",
        onClick: saveChanges,
      }, "Save Changes")
    )
  ) : null;

  const main = h("main", { className: "max-w-6xl mx-auto px-4 sm:px-6 py-8 flex-1 space-y-6" + (hasChanges ? " pb-24" : "") },
    renderCollectionTabs(), uploadZone, fileInput, grid
  );

  wrap.appendChild(header);
  wrap.appendChild(main);
  if (saveBar) wrap.appendChild(saveBar);
  return wrap;
}

function collectionLabel() {
  return collection === "projects" ? "Projects" : "Portfolio";
}

function renderCollectionTabs() {
  return h("div", { className: "inline-flex rounded-lg border border-gray-200 bg-white p-1" },
    ...["portfolio", "projects"].map(name =>
      h("button", {
        className: "px-5 py-2 rounded-md text-sm font-medium transition-colors " +
          (collection === name ? "bg-gray-800 text-white" : "text-gray-500 hover:text-gray-900"),
        onClick: () => switchCollection(name),
      }, name === "projects" ? "Projects" : "Portfolio")
    )
  );
}

function renderImageCard(img) {
  const card = h("div", {
    className: "group relative bg-white rounded-lg overflow-hidden shadow-sm border border-gray-200 hover:shadow-md transition-shadow",
    "data-key": img.key,
  },
    h("div", { className: "aspect-square overflow-hidden bg-gray-100" },
      h("img", { src: img.src, alt: img.alt || "", loading: "lazy", draggable: "false",
        className: "w-full h-full object-cover" })
    ),
    h("div", { className: "p-3 space-y-2" },
      h("input", {
        type: "text", value: img.alt || "", placeholder: "Alt text",
        className: "w-full text-sm px-2 py-1.5 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-gray-400",
        onInput: (e) => { img.alt = e.target.value; hasChanges = true; renderSaveBar(); },
      }),
      collection === "projects" ? renderPaletteEditor(img) : null,
      h("div", { className: "flex items-center justify-between" },
        h("label", { className: "flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer" },
          (() => {
            const cb = h("input", { type: "checkbox", className: "rounded cursor-pointer" });
            cb.checked = img.visible !== false;
            cb.addEventListener("change", () => { img.visible = cb.checked; hasChanges = true; renderSaveBar(); });
            return cb;
          })(),
          "Visible"
        ),
        h("button", {
          className: "text-xs text-red-400 hover:text-red-600 transition-colors p-1",
          onClick: () => deleteImage(img.key),
          title: "Delete image",
        }, "Delete")
      )
    ),
    h("div", { className: "drag-handle absolute top-2 left-2 opacity-60 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing bg-white/80 rounded p-1 touch-none", title: "Drag to reorder" },
      h("svg", { className: "w-4 h-4 text-gray-500", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", "stroke-width": "2" },
        (() => { const p = document.createElementNS("http://www.w3.org/2000/svg","path"); p.setAttribute("stroke-linecap","round"); p.setAttribute("stroke-linejoin","round"); p.setAttribute("d","M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"); return p; })()
      )
    )
  );
  return card;
}

function renderPaletteEditor(img) {
  if (!Array.isArray(img.palette) || img.palette.length !== 4 || !img.palette.every(isHexColor)) {
    return h("p", { className: "text-xs text-red-500" }, "This project is missing its required palette.");
  }

  const rows = img.palette.map((color, index) => {
    const textInput = h("input", {
      type: "text",
      value: color.toUpperCase(),
      maxlength: "7",
      "aria-label": "Palette color " + (index + 1),
      className: "min-w-0 flex-1 font-mono text-xs uppercase px-2 py-1.5 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-gray-400",
    });
    const colorInput = h("input", {
      type: "color",
      value: color,
      "aria-label": "Choose palette color " + (index + 1),
      className: "palette-color w-9 h-8 cursor-pointer",
      onInput: (event) => {
        const value = event.target.value.toUpperCase();
        img.palette[index] = value;
        textInput.value = value;
        hasChanges = true;
        renderSaveBar();
      },
    });
    textInput.addEventListener("input", (event) => {
      const value = event.target.value.trim().toUpperCase();
      if (!isHexColor(value)) return;
      img.palette[index] = value;
      colorInput.value = value;
      hasChanges = true;
      renderSaveBar();
    });
    textInput.addEventListener("blur", () => {
      if (!isHexColor(textInput.value.trim())) {
        textInput.value = img.palette[index];
        toast("Use a six-digit hex color such as #AABBCC", "error");
      }
    });
    return h("div", { className: "flex items-center gap-2" }, colorInput, textInput);
  });

  return h("div", { className: "pt-1 space-y-2" },
    h("span", { className: "block text-xs font-medium text-gray-600" }, "Color palette"),
    h("div", { className: "grid grid-cols-2 gap-2" }, rows),
    h("button", {
      className: "generate-palette w-full text-xs px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors",
      onClick: (event) => generatePalette(img, event.currentTarget),
    }, "Regenerate from image")
  );
}

async function generatePalette(img, button) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Generating...";
  try {
    img.palette = await extractDominantPalette(img.src);
    hasChanges = true;
    render();
    toast("Palette generated — review and save it");
  } catch (error) {
    button.disabled = false;
    button.textContent = originalText;
    toast("Could not read image colors: " + error.message, "error");
  }
}

function renderSaveBar() {
  const existing = document.querySelector(".save-bar");
  if (hasChanges && !existing) {
    const wrap = document.querySelector("#app > .min-h-screen");
    if (!wrap) return;
    const bar = h("div", { className: "save-bar fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 p-4 z-40" },
      h("div", { className: "max-w-6xl mx-auto flex items-center justify-between" },
        h("span", { className: "text-sm text-gray-600" }, "You have unsaved changes"),
        h("button", {
          className: "px-6 py-2.5 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium text-sm",
          onClick: saveChanges,
        }, "Save Changes")
      )
    );
    wrap.appendChild(bar);
    const main = wrap.querySelector("main");
    if (main) main.classList.add("pb-24");
  }
  if (!hasChanges && existing) {
    existing.remove();
    const main = document.querySelector("#app main");
    if (main) main.classList.remove("pb-24");
  }
}

function initSortable() {
  const grid = document.getElementById("image-grid");
  if (!grid) return;
  destroySortable();
  sortable = new Sortable(grid, {
    animation: 200,
    ghostClass: "sortable-ghost",
    dragClass: "sortable-drag",
    chosenClass: "sortable-chosen",
    handle: ".drag-handle",
    delay: 150,
    delayOnTouchOnly: true,
    touchStartThreshold: 8,
    filter: "input, button, label, a",
    preventOnFilter: false,
    onEnd: () => {
      const keys = [...grid.querySelectorAll("[data-key]")].map(el => el.dataset.key);
      const reordered = [];
      keys.forEach(key => {
        const img = images.find(i => i.key === key);
        if (img) reordered.push(img);
      });
      images = reordered;
      hasChanges = true;
      renderSaveBar();
    },
  });
}

async function uploadFiles(fileList) {
  if (!fileList || fileList.length === 0) return;
  const targetCollection = collection;
  const files = [...fileList];
  const form = new FormData();
  try {
    if (targetCollection === "projects") {
      toast("Generating palettes for " + files.length + " image(s)...");
      const palettes = [];
      for (const file of files) {
        const objectUrl = URL.createObjectURL(file);
        try {
          palettes.push(await extractDominantPalette(objectUrl));
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      }
      form.append("palettes", JSON.stringify(palettes));
    } else {
      toast("Uploading " + files.length + " file(s)...");
    }
    for (const file of files) form.append("files", file);
    const res = await apiFetch("/api/admin/upload?collection=" + targetCollection, { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    toast(data.uploaded.length + " image(s) uploaded");
    destroySortable();
    await loadImages();
    render();
  } catch (err) { toast("Upload failed: " + err.message, "error"); }
}

async function deleteImage(key) {
  if (!confirm("Delete this image?")) return;
  try {
    const res = await apiFetch("/api/admin/images/" + encodeURIComponent(key) + "?collection=" + collection, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Request failed");
    }
    toast("Image deleted");
    destroySortable();
    await loadImages();
    render();
  } catch (err) { toast("Delete failed: " + err.message, "error"); }
}

async function saveChanges() {
  try {
    const res = await apiFetch("/api/admin/manifest?collection=" + collection, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        images: images.map(i => ({
          key: i.key,
          alt: i.alt,
          visible: i.visible,
          ...(collection === "projects" ? { palette: i.palette } : {}),
        })),
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Request failed");
    }
    hasChanges = false;
    toast("Changes saved");
    renderSaveBar();
  } catch (err) { toast("Save failed: " + err.message, "error"); }
}

if (password) loadImages().then(render).catch(() => { password = ""; render(); });
else render();
</script>
</body>
</html>`;
