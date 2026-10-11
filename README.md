# Cari Tempat — Fondasi MVP

Website untuk mencari **kafe** dan **tempat main alam** di sekitar sebuah titik:
filter radius, area duduk indoor/outdoor (kafe), dan jam tutup minimum.
Proyek kedua Arkasha — dibangun Divisi Programming (Damar, Kirana, Bagas).
Rancangan lengkap: `~/workspace/obsidian-vault/Research/Rancangan-Website-Cari-Tempat.md`

## Cara menjalankan

Tanpa build step — cukup server statis apa saja:

```bash
cd ~/workspace/website-cari-tempat
python3 -m http.server 8770
# buka http://127.0.0.1:8770
```

Peta (Leaflet + tile OpenStreetMap) dan data tempat (Overpass API) dimuat
langsung dari internet oleh browser — gratis, **tanpa kunci API apa pun**.

## Peta berkas

| Berkas | Isi |
|---|---|
| `index.html`, `styles.css`, `app.js` | UI: titik acuan (preset Yogyakarta / input lat-lon / geolokasi), slider radius, filter kategori/duduk/jam tutup, daftar hasil + peta Leaflet. |
| `overpass.js` | Pembangun kueri Overpass QL (`amenity=cafe`; `leisure`/`tourism`/`natural`/`waterway` untuk alam) + klien dengan **failover 3 endpoint publik** & timeout — instance publik kadang sibuk (terbukti saat uji), jadi failover itu wajib, bukan hiasan. |
| `places.js` | Logika murni (bisa diuji Node): normalisasi elemen OSM → tempat, parser `opening_hours` sederhana (termasuk lintas tengah malam & `24/7`), haversine, dan `filterPlaces`. |

## Aturan kejujuran data

Data OSM **tidak lengkap** dan fondasi ini tidak menyembunyikannya:
uji nyata radius 1,5 km dari Malioboro (2026-10-11) menemukan 47 kafe,
tapi hanya 10 yang mencatat `opening_hours` dan 5 yang mencatat
`outdoor_seating`. Nilai yang absen = **“belum tersedia di data”** (badge
kuning di kartu), tidak pernah ditebak. Filter ketat hanya meloloskan yang
terkonfirmasi; sakelar “sertakan yang belum diketahui” menyerahkannya ke
pengguna — dan tempatnya tetap ditandai.

## Status

- Fondasi MVP jadi & teruji dengan data OSM asli wilayah Yogyakarta
  (angka lengkap di catatan rancangan vault).
- Parser jam buka sengaja sederhana: pola rentang umum terbaca; aturan
  rumit (beda hari/libur) bisa jadi “belum bisa dibaca” — ditandai, bukan
  dikarang. Evaluator `opening_hours` penuh = pekerjaan lanjutan.
- Belum ada hosting publik (keputusan Arkasha, sama seperti website jurnal).
