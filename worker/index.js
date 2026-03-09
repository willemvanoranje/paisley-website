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
      console.error("Turnstile verify response:", JSON.stringify(verifyData));
      return corsResponse(403, { error: "Turnstile verification failed" });
    }

    const { name, email, subject, message } = body;

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Contact Form <hello@paisleys.work>",
        to: "hello@paisleys.work",
        subject: subject || `New message from ${name}`,
        reply_to: email,
        text: [
          `Name: ${name}`,
          `Email: ${email}`,
          `Subject: ${subject || "(none)"}`,
          "",
          message,
        ].join("\n"),
      }),
    });

    if (!emailRes.ok) {
      console.error("Resend error:", await emailRes.text());
      return corsResponse(500, { error: "Failed to send message" });
    }

    const confirmRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Paisley <hello@paisleys.work>",
        to: email,
        subject: "Thanks for reaching out!",
        text: [
          `Hi ${name},`,
          "",
          "Thanks for getting in touch! I've received your message and will get back to you as soon as I can.",
          "",
          "Best,",
          "Paisley",
        ].join("\n"),
      }),
    });

    if (!confirmRes.ok) {
      console.error("Confirmation email error:", await confirmRes.text());
    }

    return corsResponse(200, { success: true });
  },
};

function corsResponse(status, body) {
  const headers = {
    "Access-Control-Allow-Origin": "https://paisleys.work",
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
