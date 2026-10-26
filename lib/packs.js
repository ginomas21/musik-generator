// Paket kredit Musik Generator — HARGA AWAL, gampang diubah di sini.
// 1 kredit = 1 lagu (model apa pun). Harga per lagu turun di paket besar.
// Ubah angka di bawah, tidak perlu ubah kode lain (frontend mengambil
// daftar ini dari endpoint ?action=packs).
export const CREDIT_PER_SONG = 1;
export const PACKS = [
  { id: "pack10", credits: 10, price: 20000 },
  { id: "pack30", credits: 30, price: 50000 },
  { id: "pack100", credits: 100, price: 150000 },
];
export function getPack(id) {
  return PACKS.find(p => p.id === id) || null;
}
