export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return corsResponse(204);
    }

    if (request.method !== "POST") {
      return corsResponse(405, { error: "Method not allowed" });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return corsResponse(400, { error: "Invalid JSON" });
    }

    const token = body["cf-turnstile-response"];
    if (!token) {
      return corsResponse(400, { error: "Missing Turnstile token" });
    }

    const verifyRes = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret: env.TURNSTILE_SECRET_KEY,
          response: token,
          remoteip: request.headers.get("CF-Connecting-IP") || "",
        }),
      }
    );

    const verifyData = await verifyRes.json();

    if (!verifyData.success) {
      return corsResponse(403, { error: "Turnstile verification failed" });
    }

    const { name, email, subject, message } = body;
    console.log("Contact form submission:", { name, email, subject, message });

    return corsResponse(200, { success: true });
  },
};

function corsResponse(status, body) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (status === 204) {
    return new Response(null, { status, headers });
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
