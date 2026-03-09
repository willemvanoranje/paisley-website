const MANIFEST_KEY = "_manifest.json";

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
          return handleUpload(request, env, origin);
        }
        if (path.startsWith("/api/admin/images/") && request.method === "DELETE") {
          return handleDelete(path, env, origin);
        }
        if (path === "/api/admin/manifest" && request.method === "PUT") {
          return handleUpdateManifest(request, env, origin);
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

async function getManifest(env) {
  const obj = await env.PORTFOLIO_BUCKET.get(MANIFEST_KEY);
  if (!obj) return { images: [] };
  return obj.json();
}

async function saveManifest(env, manifest) {
  await env.PORTFOLIO_BUCKET.put(MANIFEST_KEY, JSON.stringify(manifest, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
}

async function handleListImages(env, url, origin) {
  const manifest = await getManifest(env);
  const baseUrl = `${url.protocol}//${url.host}`;
  const images = manifest.images
    .filter((img) => img.visible !== false)
    .map((img) => ({
      src: `${baseUrl}/images/${img.key}`,
      alt: img.alt || "",
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
  const manifest = await getManifest(env);
  const baseUrl = `${url.protocol}//${url.host}`;
  const images = manifest.images.map((img) => ({
    ...img,
    src: `${baseUrl}/images/${img.key}`,
  }));
  return corsResponse(200, { images }, origin);
}

async function handleUpload(request, env, origin) {
  const formData = await request.formData();
  const files = formData.getAll("files");
  const manifest = await getManifest(env);
  const uploaded = [];

  for (const file of files) {
    if (!(file instanceof File)) continue;

    const ext = "." + file.name.split(".").pop().toLowerCase();
    if (!IMAGE_TYPES[ext]) continue;

    const sanitized = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
    let key = sanitized;
    let counter = 1;
    while (manifest.images.some((img) => img.key === key)) {
      const base = sanitized.replace(ext, "");
      key = `${base}-${counter}${ext}`;
      counter++;
    }

    await env.PORTFOLIO_BUCKET.put(key, file.stream(), {
      httpMetadata: { contentType: IMAGE_TYPES[ext] },
    });

    const name = key.replace(ext, "").replace(/[-_]/g, " ");
    const entry = { key, alt: name, visible: true };
    manifest.images.push(entry);
    uploaded.push(entry);
  }

  await saveManifest(env, manifest);
  return corsResponse(200, { uploaded, total: manifest.images.length }, origin);
}

async function handleDelete(path, env, origin) {
  const key = decodeURIComponent(path.replace("/api/admin/images/", ""));
  await env.PORTFOLIO_BUCKET.delete(key);

  const manifest = await getManifest(env);
  manifest.images = manifest.images.filter((img) => img.key !== key);
  await saveManifest(env, manifest);

  return corsResponse(200, { success: true, deleted: key }, origin);
}

async function handleUpdateManifest(request, env, origin) {
  const body = await request.json();
  if (!Array.isArray(body.images)) {
    return corsResponse(400, { error: "images array required" }, origin);
  }

  const manifest = await getManifest(env);
  const existingKeys = new Set(manifest.images.map((img) => img.key));

  const updated = body.images
    .filter((img) => existingKeys.has(img.key))
    .map((img) => ({
      key: img.key,
      alt: img.alt || "",
      visible: img.visible !== false,
    }));

  await saveManifest(env, { images: updated });
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
  @keyframes slideIn { from { transform: translateY(-1rem); opacity: 0; } }
  @keyframes fadeOut { to { opacity: 0; } }
</style>
</head>
<body class="bg-gray-50 min-h-screen text-gray-800">

<div id="app"></div>

<script>
const API = location.origin;
let password = sessionStorage.getItem("admin_pw") || "";
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

async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { Authorization: "Bearer " + password, ...(opts.headers || {}) },
  });
  if (res.status === 401) { password = ""; sessionStorage.removeItem("admin_pw"); render(); throw new Error("Unauthorized"); }
  return res;
}

async function loadImages() {
  const res = await apiFetch("/api/admin/images");
  const data = await res.json();
  images = data.images || [];
  hasChanges = false;
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
    h("h1", { className: "text-2xl font-semibold text-center mb-6 tracking-wide" }, "Portfolio Manager"),
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
      h("h1", { className: "text-lg font-semibold tracking-wide" }, "Portfolio Manager"),
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
    h("p", { className: "text-gray-600 font-medium" }, "Drop images here or click to upload"),
    h("p", { className: "text-sm text-gray-400 mt-1" }, "JPG, PNG, WebP, AVIF, GIF")
  );

  const fileInput = h("input", { type: "file", multiple: "true", accept: "image/*", className: "hidden",
    onChange: async (e) => { await uploadFiles(e.target.files); e.target.value = ""; }
  });

  const grid = h("div", { id: "image-grid", className: "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4" });
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
    uploadZone, fileInput, grid
  );

  wrap.appendChild(header);
  wrap.appendChild(main);
  if (saveBar) wrap.appendChild(saveBar);
  return wrap;
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
    h("div", { className: "absolute top-2 left-2 opacity-60 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing bg-white/80 rounded p-1", title: "Hold to drag & reorder" },
      h("svg", { className: "w-4 h-4 text-gray-500", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", "stroke-width": "2" },
        (() => { const p = document.createElementNS("http://www.w3.org/2000/svg","path"); p.setAttribute("stroke-linecap","round"); p.setAttribute("stroke-linejoin","round"); p.setAttribute("d","M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"); return p; })()
      )
    )
  );
  return card;
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
    delay: 400,
    delayOnTouchOnly: false,
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
  const form = new FormData();
  for (const f of fileList) form.append("files", f);
  toast("Uploading " + fileList.length + " file(s)...");
  try {
    const res = await apiFetch("/api/admin/upload", { method: "POST", body: form });
    const data = await res.json();
    toast(data.uploaded.length + " image(s) uploaded");
    destroySortable();
    await loadImages();
    render();
  } catch (err) { toast("Upload failed: " + err.message, "error"); }
}

async function deleteImage(key) {
  if (!confirm("Delete this image?")) return;
  try {
    await apiFetch("/api/admin/images/" + encodeURIComponent(key), { method: "DELETE" });
    toast("Image deleted");
    destroySortable();
    await loadImages();
    render();
  } catch (err) { toast("Delete failed: " + err.message, "error"); }
}

async function saveChanges() {
  try {
    await apiFetch("/api/admin/manifest", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images: images.map(i => ({ key: i.key, alt: i.alt, visible: i.visible })) }),
    });
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
