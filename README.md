# Musik Generator v1.0

Situs buat lagu AI (Suno via kie.ai) dengan sistem kredit. Kunci kie.ai
dan AutoGoPay hanya dipakai di server — tidak pernah dikirim ke browser.

## Cara kerja

- User daftar (email + kata sandi, hash scrypt) → beli paket kredit →
  bayar QRIS AutoGoPay (15 menit, polling status) → kredit masuk otomatis.
- Buat lagu = 1 kredit (model apa pun: V6 / V6 Mini / V6 Wild).
  Alur: createTask kie.ai → polling recordInfo (browser, 10 detik) →
  sukses → putar/unduh; gagal → 1 kredit dikembalikan otomatis.
- File lagu di kie.ai hanya 14 hari — user wajib unduh segera.
- Admin (/admin): statistik, pesanan kredit, lagu terakhir, atur kredit
  manual (tambah/kurang per email).

## Harga awal (di lib/packs.js, gampang diubah)

- 10 kredit Rp20.000 · 30 kredit Rp50.000 · 100 kredit Rp150.000

## Yang perlu Arka siapkan di dashboard (tidak pernah lewat chat)

1. GitHub: buat repo `ginomas21/musik-generator` (boleh privat), lalu
   tambahkan ke akses GitHub App Muse (Settings → Applications).
   Setelah itu Muse push kode dan deploy dari repo tersebut.
2. Vercel: buat project dari repo itu, lalu Storage → buat database
   Neon baru dan hubungkan ke project (DATABASE_URL terisi otomatis).
3. Vercel → Settings → Environment Variables (Production):
   - `KIE_API_KEY` — kunci API kie.ai milik Arka.
   - `AUTOGOPAY_KEY` — kunci AutoGoPay (merchant yang sama dengan toko).
   - `ADMIN_KEY` — kata sandi login halaman /admin (bebas, yang kuat).
   - `SESSION_SECRET` — string acak panjang untuk cookie (bebas).
4. Redeploy setelah env diisi, lalu tes: daftar → beli paket kecil →
   bayar QRIS → buat 1 lagu (pakai model V6 Mini dulu, paling hemat).

## Struktur

- `index.html` — halaman utama (auth, generator, beli kredit, riwayat).
- `admin.html` — panel admin.
- `api/index.js` — SATU dispatcher (hemat fungsi Vercel Hobby).
- `lib/db.js` — users, sessions, credit_orders, generations (PostgreSQL).
- `lib/kie.js` — createTask + recordInfo + ekstraksi URL audio.
- `lib/autogopay.js` — QRIS (pola sama dengan toko Storm/IBC).
- `lib/auth.js` — hash scrypt + sesi cookie.
- `lib/packs.js` — daftar paket & harga.
