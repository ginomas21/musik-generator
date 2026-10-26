// kie.ai Suno — dipakai SERVER-SIDE saja. Kunci dari env KIE_API_KEY
// (diisi Arka di dashboard Vercel, tidak pernah dikirim ke browser).
// Alur (docs.kie.ai/suno-api/generate-music): createTask -> taskId, lalu
// polling recordInfo sampai success/fail. File kie.ai hanya 14 hari.
const KIE_BASE = "https://api.kie.ai";
function key() { return (process.env.KIE_API_KEY || "").trim(); }
export function kieConfigured() { return !!key(); }

export async function createMusicTask({ custom_mode, instrumental, model, prompt, title, style, lyrics }) {
  const input = { custom_mode: !!custom_mode, instrumental: !!instrumental, model };
  if (prompt) input.prompt = prompt;
  if (title) input.title = title;
  if (style) input.style = style;
  if (lyrics) input.lyrics = lyrics;
  const res = await fetch(KIE_BASE + "/api/v1/jobs/createTask", {
    method: "POST",
    headers: { "Authorization": "Bearer " + key(), "Content-Type": "application/json" },
    body: JSON.stringify({ model: "ai-music-api/generate", input }),
  });
  const data = await res.json().catch(() => ({}));
  if (data.code !== 200 || !data.data || !data.data.taskId) {
    throw new Error("kie.ai: " + (data.msg || data.message || ("HTTP " + res.status)));
  }
  return data.data.taskId;
}

export async function getTaskStatus(taskId) {
  const res = await fetch(KIE_BASE + "/api/v1/jobs/recordInfo?taskId=" + encodeURIComponent(taskId), {
    headers: { "Authorization": "Bearer " + key() },
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok === false || (data.code !== undefined && data.code !== 200)) {
    throw new Error(data.msg || data.message || ("HTTP " + res.status));
  }
  const d = data.data || {};
  let result = d.resultJson;
  if (typeof result === "string") {
    try { result = JSON.parse(result); } catch { result = null; }
  }
  return { state: String(d.state || ""), result, raw: JSON.stringify(data) };
}

// Ekstraksi URL audio yang toleran: bentuk resultJson kie.ai tidak
// dipublikasikan lengkap, jadi telusuri tabel (kunci mengandung "audio"
// atau sama dengan "url") + pindai URL .mp3/.wav/.m4a di teks mentah.
export function extractAudioUrls(resultObj, rawText) {
  const found = [];
  const push = (u) => {
    if (typeof u === "string" && /^https?:\/\//.test(u) && !found.includes(u)) found.push(u);
  };
  const walk = (node, depth) => {
    if (depth > 6 || node === null || node === undefined) return;
    if (typeof node === "string") return;
    if (Array.isArray(node)) { for (const v of node) walk(v, depth + 1); return; }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        const lk = String(k).toLowerCase();
        if (typeof v === "string" && (lk.includes("audio") || lk === "url")) push(v);
        else walk(v, depth + 1);
      }
    }
  };
  walk(resultObj, 0);
  if (rawText) {
    const re = /https?:\/\/[^\s"'\\]+?\.(mp3|wav|m4a)(\?[^\s"'\\]*)?/gi;
    let m;
    while ((m = re.exec(rawText)) !== null) push(m[0]);
  }
  return found;
}

// Sisa kredit kie.ai (dipakai panel admin saja, kunci tidak pernah ke browser).
// Bentuk respons tidak dipublikasikan lengkap, jadi ambil angka dari kunci
// sisa/saldo yang dikenal, atau total-dipakai; kalau tak dikenal, kembalikan
// mentahnya supaya admin bisa melapor.
export async function getKieCredit() {
  const res = await fetch(KIE_BASE + "/api/v1/chat/credit", {
    headers: { "Authorization": "Bearer " + key() },
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok === false || (data.code !== undefined && data.code !== 200)) {
    throw new Error(data.msg || data.message || ("HTTP " + res.status));
  }
  const d = data.data;
  if (typeof d === "number") return { remaining: d };
  if (d && typeof d === "object") {
    for (const k of ["remaining_credits", "remainingCredits", "remaining", "balance", "available_credits", "availableCredits", "available", "credit_balance", "creditBalance", "left", "credits"]) {
      if (typeof d[k] === "number") return { remaining: d[k] };
    }
    if (typeof d.total === "number" && typeof d.used === "number") return { remaining: d.total - d.used };
    if (typeof d.total_credits === "number" && typeof d.used_credits === "number") return { remaining: d.total_credits - d.used_credits };
  }
  return { remaining: null, raw: JSON.stringify(data).slice(0, 300) };
}
