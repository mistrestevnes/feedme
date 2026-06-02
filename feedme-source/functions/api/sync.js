// Cloudflare Pages Function — read/write the Recomp app's saved state
// from a Cloudflare KV namespace.
//
// IMPORTANT: when you assemble your deploy folder, this file goes at
// `functions/api/sync.js` inside the upload — not at the root. The
// `functions/` directory is what Cloudflare Pages auto-detects.
//
// Setup (one-time):
//   1. Cloudflare dashboard → Workers & Pages → KV → Create namespace,
//      name it whatever (e.g., "recomp-state").
//   2. Your Pages project → Settings → Functions → KV namespace bindings →
//      Add binding. Variable name: RECOMP_KV. Namespace: the one above.
//   3. Trigger a fresh deploy (re-upload index.html or push a commit) so
//      the new binding takes effect.
//
// After that, the app's Settings → Cloud Sync section will work.
//
// Auth: the client sends a bearer token in the `Authorization` header.
// Each token is its own KV slot. The token is the only credential —
// keep it secret. Anyone who has your token can read/write your data.

const VALID_TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_BODY    = 200_000;       // 200KB cap on a single state blob
const CORS = {
  "access-control-allow-origin":  "*",
  "access-control-allow-methods": "GET, PUT, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
};

function getToken(req) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const t = m[1].trim();
  return VALID_TOKEN.test(t) ? t : null;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

export const onRequestOptions = async () => new Response("", { headers: CORS });

export const onRequestGet = async ({ request, env }) => {
  if (!env.RECOMP_KV) return json({ error: "KV namespace not bound. See sync.js setup notes." }, 500);
  const token = getToken(request);
  if (!token)         return json({ error: "Missing or malformed bearer token." }, 401);
  const value = await env.RECOMP_KV.get(`state:${token}`);
  if (!value)         return json({ error: "Not found" }, 404);
  return new Response(value, {
    headers: { ...CORS, "content-type": "application/json" },
  });
};

export const onRequestPut = async ({ request, env }) => {
  if (!env.RECOMP_KV) return json({ error: "KV namespace not bound. See sync.js setup notes." }, 500);
  const token = getToken(request);
  if (!token)         return json({ error: "Missing or malformed bearer token." }, 401);

  const ct = request.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    return json({ error: "Expected content-type application/json." }, 400);
  }
  const body = await request.text();
  if (body.length > MAX_BODY) return json({ error: "Payload too large." }, 413);
  try { JSON.parse(body); } catch { return json({ error: "Body is not valid JSON." }, 400); }

  await env.RECOMP_KV.put(`state:${token}`, body);
  return json({ ok: true });
};

export const onRequest = async ({ request }) => json({ error: `Method ${request.method} not allowed.` }, 405);
