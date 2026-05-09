export interface Env {
  FEEDBACK_KV: KVNamespace;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

interface Feedback {
  id: string;
  name: string | null;
  message: string;
  created_at: string;
}

// ─── CORS helpers ────────────────────────────────────────────────────────────

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function corsResponse(body: string, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function jsonOk(data: unknown): Response {
  return corsResponse(JSON.stringify(data), 200);
}

function jsonError(message: string, status: number): Response {
  return corsResponse(JSON.stringify({ error: message }), status);
}

// ─── Supabase REST helpers ────────────────────────────────────────────────────

function supabaseHeaders(env: Env): Record<string, string> {
  return {
    apikey: env.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
  };
}

async function insertFeedback(
  env: Env,
  name: string,
  message: string
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/feedbacks`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(env),
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ name, message }),
  });

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: text };
  }
  return { ok: true };
}

async function fetchLatestFromSupabase(env: Env, limit: number): Promise<Feedback[]> {
  const url = `${env.SUPABASE_URL}/rest/v1/feedbacks?select=*&order=created_at.desc&limit=${limit}`;
  const res = await fetch(url, {
    method: "GET",
    headers: supabaseHeaders(env),
  });

  if (!res.ok) {
    throw new Error(`Supabase fetch failed: ${res.status} ${await res.text()}`);
  }

  return (await res.json()) as Feedback[];
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────

async function checkRateLimit(env: Env, request: Request): Promise<Response | null> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const key = `rate:${ip}`;
  const count = parseInt((await env.FEEDBACK_KV.get(key)) ?? "0", 10);

  if (count >= 5) {
    return jsonError("Too many requests. Please wait a minute before submitting again.", 429);
  }

  await env.FEEDBACK_KV.put(key, String(count + 1), { expirationTtl: 60 });
  return null;
}

// ─── Route handlers ───────────────────────────────────────────────────────────

async function handleSubmit(request: Request, env: Env): Promise<Response> {
  // Rate limit check
  const rateLimitResponse = await checkRateLimit(env, request);
  if (rateLimitResponse) return rateLimitResponse;

  // Parse body
  let body: { name?: string; message?: string };
  try {
    body = (await request.json()) as { name?: string; message?: string };
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  // Validate
  const rawMessage = body.message?.trim() ?? "";
  if (!rawMessage) {
    return jsonError("Message is required and cannot be empty.", 400);
  }
  if (rawMessage.length > 500) {
    return jsonError("Message must be 500 characters or fewer.", 400);
  }

  const name = body.name?.trim() || "Anonymous";

  // Insert into Supabase
  const { ok, error } = await insertFeedback(env, name, rawMessage);
  if (!ok) {
    console.error("Supabase insert error:", error);
    return jsonError("Failed to save feedback. Please try again.", 500);
  }

  // Refresh KV cache with the latest 10 messages
  try {
    const latest = await fetchLatestFromSupabase(env, 10);
    await env.FEEDBACK_KV.put("latest_messages", JSON.stringify(latest), {
      expirationTtl: 60,
    });
  } catch (err) {
    // Non-fatal: cache refresh failure shouldn't fail the submission
    console.error("KV cache refresh failed:", err);
  }

  return jsonOk({ success: true, message: "Feedback submitted!" });
}

async function handleMessages(env: Env): Promise<Response> {
  // Try KV cache first
  const cached = await env.FEEDBACK_KV.get("latest_messages");
  if (cached) {
    const data = JSON.parse(cached) as Feedback[];
    return jsonOk(data);
  }

  // Cache miss — fetch from Supabase
  try {
    const messages = await fetchLatestFromSupabase(env, 50);
    // Store in KV
    await env.FEEDBACK_KV.put("latest_messages", JSON.stringify(messages), {
      expirationTtl: 60,
    });
    return jsonOk(messages);
  } catch (err) {
    console.error("Supabase fetch error:", err);
    return jsonError("Failed to fetch messages. Please try again.", 500);
  }
}

// ─── Main fetch handler ───────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();

    // Handle CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Route: POST /api/submit
    if (pathname === "/api/submit" && method === "POST") {
      return handleSubmit(request, env);
    }

    // Route: GET /api/messages
    if (pathname === "/api/messages" && method === "GET") {
      return handleMessages(env);
    }

    // 404
    return jsonError("Not found.", 404);
  },
};
