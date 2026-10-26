// AutoGoPay — QRIS dinamis (pola sama dengan toko Storm/IBC).
// Auth: header Authorization Bearer, key dari env AUTOGOPAY_KEY (diisi Arka
// di dashboard Vercel, TIDAK PERNAH lewat chat). Header User-Agent browser
// WAJIB (tanpa itu AutoGoPay 403). Expiry QRIS 15 menit, Rp1–10.000.000.
const AG_BASE = "https://v1-gateway.autogopay.site";
const UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
export const INVOICE_TIMEOUT_MS = 900_000;
export const AG_MIN_AMOUNT = 1;
export const AG_MAX_AMOUNT = 10_000_000;

function key() {
  return (process.env.AUTOGOPAY_KEY || "").trim();
}
export function agConfigured() {
  return !!key();
}

async function agReq(path, body) {
  const res = await fetch(AG_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key(), "User-Agent": UA },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`AutoGoPay respon tidak valid (${res.status})`); }
  if (!res.ok) throw new Error(`AutoGoPay HTTP ${res.status}`);
  return data;
}

export async function agCreate(orderId, amount) {
  const res = await agReq("/qris/generate", { amount });
  const d = res.data || {};
  if (!d.transaction_id) throw new Error("AutoGoPay gagal membuat QRIS (merchant belum terhubung?)");
  return {
    transactionId: d.transaction_id,
    totalAmount: amount,
    qrisString: d.qr_string || "",
    paymentUrl: d.checkout_url || "",
  };
}

export async function agStatus(txid) {
  const res = await agReq("/qris/status", { transaction_id: txid });
  const raw = String(((res.data || {}).transaction_status) || "").toLowerCase();
  return { settlement: "sukses", expire: "expired", cancel: "cancel", pending: "pending" }[raw] || raw;
}

export async function agCancel(txid) {
  try { await agReq("/qris/cancel", { transaction_id: txid }); } catch {}
}
