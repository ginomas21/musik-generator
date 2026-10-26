// Musik Generator — lapisan data (PostgreSQL via DATABASE_URL, mis. Neon
// dari integrasi Vercel). Tanpa DATABASE_URL semua endpoint mengembalikan
// 503 "Database belum terhubung". TIDAK ADA mode demo: kredit harus nyata.
let pool = null;
async function db() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL belum diatur");
  if (!pool) {
    const { default: pg } = await import("pg");
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? undefined : { rejectUnauthorized: false },
      max: 3,
    });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users(
        id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL,
        credits INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS sessions(
        token TEXT PRIMARY KEY, user_id TEXT, role TEXT NOT NULL DEFAULT 'user',
        expires_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS credit_orders(
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, pack TEXT NOT NULL,
        credits INTEGER NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
        txid TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), paid_at TIMESTAMPTZ);
      CREATE TABLE IF NOT EXISTS generations(
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, task_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT 'V6', mode TEXT NOT NULL DEFAULT 'sederhana',
        instrumental BOOLEAN NOT NULL DEFAULT FALSE, status TEXT NOT NULL DEFAULT 'generating',
        audio_urls TEXT NOT NULL DEFAULT '[]', error TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), done_at TIMESTAMPTZ);
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0);
      INSERT INTO meta(key,value) VALUES('order_seq',0) ON CONFLICT(key) DO NOTHING;
      CREATE INDEX IF NOT EXISTS idx_orders_user ON credit_orders(user_id);
      CREATE INDEX IF NOT EXISTS idx_gen_user ON generations(user_id);
    `);
  }
  return pool;
}

const uid = () => "U" + Math.floor(100000 + Math.random() * 900000);
const gid = () => "G" + Math.floor(100000 + Math.random() * 900000);

// ---------------- users ----------------
export async function createUser(email, passHash) {
  const p = await db();
  const id = uid();
  try {
    await p.query(`INSERT INTO users(id,email,pass_hash) VALUES($1,$2,$3)`, [id, email, passHash]);
  } catch (e) {
    if (String(e.message || "").includes("duplicate") || e.code === "23505") return null;
    throw e;
  }
  return { id, email, credits: 0 };
}
export async function getUserByEmail(email) {
  const p = await db();
  const r = await p.query(`SELECT * FROM users WHERE email=$1`, [email]);
  return r.rows[0] || null;
}
export async function getUserById(id) {
  const p = await db();
  const r = await p.query(`SELECT * FROM users WHERE id=$1`, [id]);
  return r.rows[0] || null;
}
export function publicUser(u) {
  return u ? { id: u.id, email: u.email, credits: Number(u.credits || 0) } : null;
}
// Potong 1 kredit hanya bila saldo cukup (atomik). Kembalikan true/false.
export async function deductCredit(userId) {
  const p = await db();
  const r = await p.query(`UPDATE users SET credits=credits-1 WHERE id=$1 AND credits>=1 RETURNING credits`, [userId]);
  return r.rows.length > 0;
}
// Tambah/kurang kredit; pengurangan tidak boleh membuat saldo negatif.
export async function addCredits(userId, delta) {
  const p = await db();
  const r = await p.query(`UPDATE users SET credits=credits+$2 WHERE id=$1 AND credits+$2>=0 RETURNING credits`, [userId, delta]);
  return r.rows.length ? Number(r.rows[0].credits) : null;
}

// ---------------- sessions ----------------
export async function createSession(userId, role, token, expiresAt) {
  const p = await db();
  await p.query(`INSERT INTO sessions(token,user_id,role,expires_at) VALUES($1,$2,$3,$4)`, [token, userId, role, expiresAt]);
}
export async function getSession(token) {
  const p = await db();
  const r = await p.query(`SELECT * FROM sessions WHERE token=$1 AND expires_at>now()`, [token]);
  return r.rows[0] || null;
}
export async function deleteSession(token) {
  const p = await db();
  await p.query(`DELETE FROM sessions WHERE token=$1`, [token]);
}

// ---------------- credit orders ----------------
export async function nextOrderId() {
  const p = await db();
  const r = await p.query(`UPDATE meta SET value=value+1 WHERE key='order_seq' RETURNING value`);
  return `MG-${String(r.rows[0].value).padStart(4, "0")}`;
}
export async function createCreditOrder({ id, userId, pack, credits, amount }) {
  const p = await db();
  await p.query(`INSERT INTO credit_orders(id,user_id,pack,credits,amount) VALUES($1,$2,$3,$4,$5)`, [id, userId, pack, credits, amount]);
  return getCreditOrder(id);
}
export async function getCreditOrder(id) {
  const p = await db();
  const r = await p.query(`SELECT * FROM credit_orders WHERE id=$1`, [id]);
  return r.rows[0] || null;
}
export async function setOrderTxid(id, txid) {
  const p = await db();
  await p.query(`UPDATE credit_orders SET txid=$2 WHERE id=$1`, [id, txid]);
  return getCreditOrder(id);
}
// Tandai lunas + tambah kredit — idempoten: hanya berjalan bila masih pending.
export async function settleOrderPaid(id) {
  const p = await db();
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query(`SELECT * FROM credit_orders WHERE id=$1 FOR UPDATE`, [id]);
    const o = cur.rows[0];
    if (!o) { await client.query("ROLLBACK"); return null; }
    if (o.status !== "pending") { await client.query("COMMIT"); return { order: o, added: false }; }
    await client.query(`UPDATE credit_orders SET status='paid', paid_at=now() WHERE id=$1`, [id]);
    await client.query(`UPDATE users SET credits=credits+$2 WHERE id=$1`, [o.user_id, o.credits]);
    await client.query("COMMIT");
    return { order: await getCreditOrder(id), added: true };
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}
export async function setOrderStatus(id, status) {
  const p = await db();
  await p.query(`UPDATE credit_orders SET status=$2 WHERE id=$1 AND status='pending'`, [id, status]);
  return getCreditOrder(id);
}
export async function listOrders(limit = 100) {
  const p = await db();
  const r = await p.query(`SELECT o.*, u.email AS user_email FROM credit_orders o LEFT JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC LIMIT $1`, [limit]);
  return r.rows;
}

// ---------------- generations ----------------
export async function createGeneration({ userId, taskId, title, model, mode, instrumental }) {
  const p = await db();
  const id = gid();
  await p.query(`INSERT INTO generations(id,user_id,task_id,title,model,mode,instrumental) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [id, userId, taskId, title, model, mode, !!instrumental]);
  return getGeneration(id);
}
export async function getGeneration(id) {
  const p = await db();
  const r = await p.query(`SELECT * FROM generations WHERE id=$1`, [id]);
  return r.rows[0] || null;
}
export async function listGenerations(userId, limit = 30) {
  const p = await db();
  const r = await p.query(`SELECT * FROM generations WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`, [userId, limit]);
  return r.rows;
}
export async function listAllGenerations(limit = 100) {
  const p = await db();
  const r = await p.query(`SELECT g.*, u.email AS user_email FROM generations g LEFT JOIN users u ON u.id=g.user_id ORDER BY g.created_at DESC LIMIT $1`, [limit]);
  return r.rows;
}
export async function setGenerationDone(id, urls) {
  const p = await db();
  await p.query(`UPDATE generations SET status='done', audio_urls=$2, done_at=now() WHERE id=$1`, [id, JSON.stringify(urls)]);
  return getGeneration(id);
}
// Tandai gagal + kembalikan 1 kredit — idempoten (hanya bila masih generating).
export async function setGenerationFailedRefund(id, errMsg) {
  const p = await db();
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query(`SELECT * FROM generations WHERE id=$1 FOR UPDATE`, [id]);
    const g = cur.rows[0];
    if (!g) { await client.query("ROLLBACK"); return null; }
    if (g.status !== "generating") { await client.query("COMMIT"); return { gen: g, refunded: false }; }
    await client.query(`UPDATE generations SET status='failed', error=$2, done_at=now() WHERE id=$1`, [id, String(errMsg || "gagal").slice(0, 300)]);
    await client.query(`UPDATE users SET credits=credits+1 WHERE id=$1`, [g.user_id]);
    await client.query("COMMIT");
    return { gen: await getGeneration(id), refunded: true };
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}

// ---------------- stats ----------------
export async function getStats() {
  const p = await db();
  const u = await p.query(`SELECT COUNT(*) total, COALESCE(SUM(credits),0) credits_in_wallets FROM users`);
  const o = await p.query(`SELECT COUNT(*) total, COUNT(*) FILTER (WHERE status='paid') paid,
    COALESCE(SUM(amount) FILTER (WHERE status='paid'),0) revenue,
    COALESCE(SUM(credits) FILTER (WHERE status='paid'),0) credits_sold FROM credit_orders`);
  const g = await p.query(`SELECT COUNT(*) total, COUNT(*) FILTER (WHERE status='done') done,
    COUNT(*) FILTER (WHERE status='failed') failed,
    COUNT(*) FILTER (WHERE status='generating') generating FROM generations`);
  return {
    users: { total: Number(u.rows[0].total), credits_in_wallets: Number(u.rows[0].credits_in_wallets) },
    orders: { total: Number(o.rows[0].total), paid: Number(o.rows[0].paid), revenue: Number(o.rows[0].revenue), credits_sold: Number(o.rows[0].credits_sold) },
    generations: { total: Number(g.rows[0].total), done: Number(g.rows[0].done), failed: Number(g.rows[0].failed), generating: Number(g.rows[0].generating) },
  };
}
