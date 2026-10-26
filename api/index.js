// Musik Generator — SATU dispatcher (hemat fungsi Vercel Hobby, maks 12).
// Semua endpoint lewat /api?action=<nama>. Kunci kie.ai & AutoGoPay hanya
// dipakai di server, tidak pernah dikirim ke browser.
//   GET  packs, me, generations, gen-status, buy-status,
//        admin-stats, admin-orders, admin-generations
//   POST register, login, logout, generate, buy, buy-cancel,
//        admin-login, admin-logout, admin-adjust
import QRCode from "qrcode";
import { readJson, bad, dbDown } from "../lib/http.js";
import { hashPassword, verifyPassword, newToken, expiryHours, userCookie, adminCookie, clearUserCookie, clearAdminCookie, readUserToken, readAdminToken, checkAdminKey } from "../lib/auth.js";
import { createUser, getUserByEmail, getUserById, publicUser, deductCredit, addCredits, createSession, getSession, deleteSession, nextOrderId, createCreditOrder, getCreditOrder, setOrderTxid, settleOrderPaid, setOrderStatus, listOrders, createGeneration, getGeneration, listGenerations, listAllGenerations, setGenerationDone, setGenerationFailedRefund, getStats } from "../lib/db.js";
import { PACKS, CREDIT_PER_SONG, getPack } from "../lib/packs.js";
import { kieConfigured, createMusicTask, getTaskStatus, extractAudioUrls, getKieCredit } from "../lib/kie.js";
import { agConfigured, agCreate, agStatus, agCancel, INVOICE_TIMEOUT_MS, AG_MAX_AMOUNT } from "../lib/autogopay.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MODELS = ["V6", "V6_MINI", "V6_WILD"];

async function getUserFromReq(req) {
  const token = readUserToken(req);
  if (!token) return null;
  const s = await getSession(token);
  if (!s || s.role !== "user" || !s.user_id) return null;
  return getUserById(s.user_id);
}
async function isAdminReq(req) {
  const token = readAdminToken(req);
  if (!token) return false;
  const s = await getSession(token);
  return !!(s && s.role === "admin");
}
function parseGen(g) {
  let urls = [];
  try { urls = JSON.parse(g.audio_urls || "[]"); } catch {}
  return { id: g.id, title: g.title, model: g.model, mode: g.mode, instrumental: !!g.instrumental, status: g.status, audio_urls: urls, error: g.error || "", created_at: g.created_at, done_at: g.done_at, task_id: g.task_id, user_email: g.user_email };
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    const action = url.searchParams.get("action") || "";

    // ---------- GET publik ----------
    if (req.method === "GET" && action === "packs") {
      return res.status(200).json({
        packs: PACKS, credit_per_song: CREDIT_PER_SONG,
        payment_active: agConfigured(), kie_active: kieConfigured(),
      });
    }

    // ---------- GET butuh login ----------
    if (req.method === "GET" && action === "me") {
      const u = await getUserFromReq(req);
      if (!u) return bad(res, 401, "Belum login");
      return res.status(200).json({ user: publicUser(u) });
    }
    if (req.method === "GET" && action === "generations") {
      const u = await getUserFromReq(req);
      if (!u) return bad(res, 401, "Belum login");
      const list = await listGenerations(u.id, 30);
      return res.status(200).json({ generations: list.map(parseGen) });
    }
    if (req.method === "GET" && action === "gen-status") {
      const u = await getUserFromReq(req);
      if (!u) return bad(res, 401, "Belum login");
      const g = await getGeneration(String(url.searchParams.get("id") || ""));
      if (!g || g.user_id !== u.id) return bad(res, 404, "Lagu tidak ditemukan");
      if (g.status === "done" || g.status === "failed") return res.status(200).json({ generation: parseGen(g) });
      if (!kieConfigured()) return bad(res, 503, "Mesin musik belum aktif");
      let st;
      try { st = await getTaskStatus(g.task_id); } catch (e) { return bad(res, 502, "Gagal memeriksa ke kie.ai: " + e.message); }
      const state = st.state.toLowerCase();
      if (state.includes("success") || state.includes("succeed") || state === "completed" || state === "done") {
        const urls = extractAudioUrls(st.result, st.raw);
        if (!urls.length) {
          const f = await setGenerationFailedRefund(g.id, "kie.ai tidak mengembalikan URL audio");
          return res.status(200).json({ generation: parseGen(f.gen), refunded: f.refunded });
        }
        const done = await setGenerationDone(g.id, urls);
        return res.status(200).json({ generation: parseGen(done) });
      }
      if (state === "fail" || state === "failed" || state.includes("fail") || state.includes("error") || state.includes("timeout") || state.includes("cancel")) {
        const f = await setGenerationFailedRefund(g.id, "kie.ai gagal membuat lagu (kredit dikembalikan)");
        return res.status(200).json({ generation: parseGen(f.gen), refunded: f.refunded });
      }
      return res.status(200).json({ generation: parseGen(g), kie_state: state });
    }
    if (req.method === "GET" && action === "buy-status") {
      const u = await getUserFromReq(req);
      if (!u) return bad(res, 401, "Belum login");
      const o = await getCreditOrder(String(url.searchParams.get("order_id") || ""));
      if (!o || o.user_id !== u.id) return bad(res, 404, "Pesanan tidak ditemukan");
      if (o.status !== "pending") {
        const me = await getUserById(u.id);
        return res.status(200).json({ status: o.status, balance: Number(me.credits || 0) });
      }
      if (!agConfigured()) return bad(res, 503, "Pembayaran belum aktif");
      const st = await agStatus(o.txid);
      if (st === "sukses") {
        const r = await settleOrderPaid(o.id);
        const me = await getUserById(u.id);
        return res.status(200).json({ status: "paid", added: r.added, balance: Number(me.credits || 0) });
      }
      if (st === "expired" || st === "cancel") {
        const upd = await setOrderStatus(o.id, st === "expired" ? "expired" : "cancelled");
        return res.status(200).json({ status: upd.status });
      }
      return res.status(200).json({ status: "pending" });
    }

    // ---------- GET admin ----------
    if (req.method === "GET" && action === "admin-stats") {
      if (!(await isAdminReq(req))) return bad(res, 401, "Belum login admin");
      const stats = await getStats();
      let kie_credit = null;
      if (kieConfigured()) {
        try { kie_credit = await getKieCredit(); } catch (e) { kie_credit = { error: e.message }; }
      }
      return res.status(200).json({ ...stats, kie_credit });
    }
    if (req.method === "GET" && action === "admin-orders") {
      if (!(await isAdminReq(req))) return bad(res, 401, "Belum login admin");
      return res.status(200).json({ orders: await listOrders(100) });
    }
    if (req.method === "GET" && action === "admin-generations") {
      if (!(await isAdminReq(req))) return bad(res, 401, "Belum login admin");
      const list = await listAllGenerations(100);
      return res.status(200).json({ generations: list.map(parseGen) });
    }

    if (req.method !== "POST") return bad(res, 405, "Method tidak diizinkan");
    const body = await readJson(req);

    // ---------- POST auth ----------
    if (action === "register") {
      const email = String(body.email || "").trim().toLowerCase().slice(0, 120);
      const password = String(body.password || "");
      if (!EMAIL_RE.test(email)) return bad(res, 400, "Masukkan alamat email yang benar");
      if (password.length < 6) return bad(res, 400, "Kata sandi minimal 6 karakter");
      const created = await createUser(email, hashPassword(password));
      if (!created) return bad(res, 400, "Email sudah terdaftar, silakan masuk");
      const token = newToken();
      await createSession(created.id, "user", token, expiryHours(24 * 30));
      res.setHeader("Set-Cookie", userCookie(token));
      return res.status(200).json({ user: publicUser(created) });
    }
    if (action === "login") {
      const email = String(body.email || "").trim().toLowerCase().slice(0, 120);
      const password = String(body.password || "");
      const u = await getUserByEmail(email);
      if (!u || !verifyPassword(password, u.pass_hash)) return bad(res, 401, "Email atau kata sandi salah");
      const token = newToken();
      await createSession(u.id, "user", token, expiryHours(24 * 30));
      res.setHeader("Set-Cookie", userCookie(token));
      return res.status(200).json({ user: publicUser(u) });
    }
    if (action === "logout") {
      const token = readUserToken(req);
      if (token) await deleteSession(token);
      res.setHeader("Set-Cookie", clearUserCookie());
      return res.status(200).json({ ok: true });
    }

    // ---------- POST generate ----------
    if (action === "generate") {
      const u = await getUserFromReq(req);
      if (!u) return bad(res, 401, "Belum login");
      const title = String(body.title || "").trim().slice(0, 80);
      const prompt = String(body.prompt || "").trim().slice(0, 3000);
      const lyrics = String(body.lyrics || "").trim().slice(0, 5000);
      const style = String(body.style || "").trim().slice(0, 1000);
      const custom = body.mode === "custom";
      const instrumental = !!body.instrumental;
      const model = MODELS.includes(body.model) ? body.model : "V6";
      if (!prompt && !lyrics && !style) return bad(res, 400, "Deskripsi, lirik, atau gaya harus diisi");
      if (custom && !title) return bad(res, 400, "Mode custom wajib isi judul");
      if (custom && !style && !lyrics) return bad(res, 400, "Mode custom wajib isi gaya atau lirik");
      if (!kieConfigured()) return bad(res, 503, "Mesin musik belum aktif. Coba lagi sebentar lagi ya.");
      const fresh = await getUserById(u.id);
      if (Number(fresh.credits || 0) < CREDIT_PER_SONG) return bad(res, 402, "Kredit tidak cukup, silakan beli kredit dulu");
      let taskId;
      try {
        taskId = await createMusicTask({ custom_mode: custom, instrumental, model, prompt, title: title || "Lagu", style, lyrics });
      } catch (e) {
        return bad(res, 502, "Gagal mengirim tugas ke mesin musik: " + String(e.message || e).slice(0, 200));
      }
      const deducted = await deductCredit(u.id);
      if (!deducted) return bad(res, 402, "Kredit tidak cukup (saldo berubah), tugas tidak jadi diproses");
      const g = await createGeneration({ userId: u.id, taskId, title: title || "Lagu", model, mode: custom ? "custom" : "sederhana", instrumental });
      return res.status(200).json({ generation: parseGen(g) });
    }

    // ---------- POST buy ----------
    if (action === "buy") {
      const u = await getUserFromReq(req);
      if (!u) return bad(res, 401, "Belum login");
      const pack = getPack(String(body.pack || ""));
      if (!pack) return bad(res, 400, "Paket tidak dikenal");
      if (pack.price < 1 || pack.price > AG_MAX_AMOUNT) return bad(res, 400, "Nominal paket di luar jangkauan QRIS");
      if (!agConfigured()) return bad(res, 503, "Pembayaran sedang belum aktif. Coba lagi sebentar lagi ya.");
      const orderId = await nextOrderId();
      const order = await createCreditOrder({ id: orderId, userId: u.id, pack: pack.id, credits: pack.credits, amount: pack.price });
      try {
        const data = await agCreate(order.id, pack.price);
        await setOrderTxid(order.id, data.transactionId || "");
        let qr = "";
        if (data.qrisString) { try { qr = await QRCode.toDataURL(data.qrisString, { margin: 1, width: 360 }); } catch {} }
        return res.status(200).json({ order_id: order.id, total: pack.price, credits: pack.credits, qris_image: qr, payment_url: data.paymentUrl || "", timeout_ms: INVOICE_TIMEOUT_MS });
      } catch (e) {
        await setOrderStatus(order.id, "gagal");
        return bad(res, 502, "Gagal membuat tagihan. Coba lagi sebentar lagi ya.");
      }
    }
    if (action === "buy-cancel") {
      const u = await getUserFromReq(req);
      if (!u) return bad(res, 401, "Belum login");
      const o = await getCreditOrder(String(body.order_id || ""));
      if (!o || o.user_id !== u.id) return bad(res, 404, "Pesanan tidak ditemukan");
      if (o.status === "pending") {
        if (o.txid) await agCancel(o.txid);
        await setOrderStatus(o.id, "cancelled");
      }
      return res.status(200).json({ status: (await getCreditOrder(o.id)).status });
    }

    // ---------- POST admin ----------
    if (action === "admin-login") {
      if (!checkAdminKey(body.key)) return bad(res, 401, "Kunci admin salah");
      const token = newToken();
      await createSession(null, "admin", token, expiryHours(12));
      res.setHeader("Set-Cookie", adminCookie(token));
      return res.status(200).json({ ok: true });
    }
    if (action === "admin-logout") {
      const token = readAdminToken(req);
      if (token) await deleteSession(token);
      res.setHeader("Set-Cookie", clearAdminCookie());
      return res.status(200).json({ ok: true });
    }
    if (action === "admin-adjust") {
      if (!(await isAdminReq(req))) return bad(res, 401, "Belum login admin");
      const target = await getUserByEmail(String(body.email || "").trim().toLowerCase());
      if (!target) return bad(res, 404, "Email tidak ditemukan");
      const delta = Math.trunc(Number(body.delta || 0));
      if (!delta || Math.abs(delta) > 100000) return bad(res, 400, "Jumlah tidak valid");
      const balance = await addCredits(target.id, delta);
      if (balance === null) return bad(res, 400, "Saldo tidak boleh negatif");
      return res.status(200).json({ email: target.email, balance });
    }

    return bad(res, 404, "Aksi tidak dikenal");
  } catch (e) {
    try { return dbDown(res, e); } catch { return bad(res, 500, "Terjadi kesalahan server"); }
  }
}
