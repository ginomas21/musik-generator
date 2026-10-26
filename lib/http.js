export async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { return {}; }
}
export function bad(res, code, msg) { res.status(code).json({ error: msg }); }
export function dbDown(res, e) {
  if (String(e && e.message || "").includes("DATABASE_URL")) return bad(res, 503, "Database belum terhubung. Admin perlu menyiapkan database dulu.");
  throw e;
}
