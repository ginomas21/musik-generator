// Musik Generator — sesi user (email+password, hash scrypt) dan sesi admin.
// Sesi = token acak yang disimpan di tabel sessions (bukan JWT), dikirim
// lewat cookie httpOnly. Kunci admin & secret sesi dari env Vercel
// (ADMIN_KEY / SESSION_SECRET — diisi Arka sendiri di dashboard).
import crypto from "node:crypto";

function secret() {
  return process.env.SESSION_SECRET || process.env.ADMIN_KEY || "dev-secret-ganti-di-vercel";
}
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
export function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored).split(":");
    const calc = crypto.scryptSync(String(password), salt, 64).toString("hex");
    const a = Buffer.from(calc), b = Buffer.from(hash);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}
export function newToken() {
  return crypto.randomBytes(32).toString("hex");
}
export function expiryHours(h) {
  return new Date(Date.now() + h * 3600 * 1000).toISOString();
}
function cookie(name, value, maxAgeSec) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}
export function userCookie(token) { return cookie("mg_user", token, 30 * 24 * 3600); }
export function adminCookie(token) { return cookie("mg_admin", token, 12 * 3600); }
export function clearUserCookie() { return `mg_user=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`; }
export function clearAdminCookie() { return `mg_admin=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`; }
function readCookie(req, name) {
  const c = req.headers.cookie || "";
  const m = c.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
export function readUserToken(req) { return readCookie(req, "mg_user"); }
export function readAdminToken(req) { return readCookie(req, "mg_admin"); }
export function checkAdminKey(key) {
  const k = process.env.ADMIN_KEY || "";
  if (!k) return false;
  const a = Buffer.from(String(key || "")), b = Buffer.from(k);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export function adminConfigured() { return !!process.env.ADMIN_KEY; }
export function sessionSecretSet() { return !!(process.env.SESSION_SECRET || process.env.ADMIN_KEY); }
