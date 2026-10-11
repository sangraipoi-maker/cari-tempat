/*
 * places.js — Logika murni Cari Tempat (Divisi Programming — Damar/Kirana/Bagas).
 * Normalisasi elemen OpenStreetMap → objek "tempat", klasifikasi kafe/alam,
 * parser jam buka sederhana, dan filter (radius, indoor/outdoor, jam tutup).
 *
 * Modul ini TIDAK menyentuh DOM/jaringan — bisa diimpor & diuji di Node.
 *
 * KEJUJURAN DATA (hasil uji nyata Jogja, 2026-10-11 — lihat catatan
 * rancangan): tag yang jadi bahan filter TIDAK selalu ada di OSM.
 * Radius 1,5 km dari Malioboro: 44 kafe, hanya 9 (20%) punya opening_hours
 * dan 5 (11%) punya outdoor_seating. Maka aturan emas modul ini:
 *   nilai yang tidak ada di data = "tidak diketahui" (null), DITANDAI,
 *   tidak pernah ditebak/dikarang. Filter menyediakan pilihan eksplisit
 *   "sertakan yang belum diketahui" agar pengguna yang memutuskan.
 */

export const EARTH_RADIUS_KM = 6371.0088;

/** Jarak garis lurus dua koordinat (km). */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/* ---------------------------------------------------------------------------
 * Parser opening_hours — SEDERHANA dan disengaja terbatas.
 * Spesifikasi opening_hours OSM sangat kaya (aturan per hari, minggu,
 * libur, dsb.). Parser ini hanya membaca pola yang paling umum:
 *   "24/7"                        -> { open24: true }
 *   "Mo-Su 10:00-22:00"           -> tutup 22:00 (1320)
 *   "Mo-Su 19:30-05:30"           -> lintas tengah malam, tutup 05:30 besoknya
 *                                    (dilambangkan 330 + 1440 = 1770)
 *   "Mo-Fr 08:00-17:00; Sa 09:00-15:00" -> diambil tutup PALING LARUT di antara
 *                                    rentang (pendekatan "paling lama buka dalam
 *                                    seminggu"), dicatat apa adanya di catatan rancangan
 * Yang tidak cocok pola -> null ("belum bisa dibaca"), BUKAN tebakan.
 * ------------------------------------------------------------------------- */
export function parseClosingMinutes(openingHours) {
  if (!openingHours || typeof openingHours !== "string") return null;
  const s = openingHours.trim();
  if (/^24\/7/.test(s)) return { open24: true, close: Infinity };
  const ranges = [...s.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)];
  if (!ranges.length) return null;
  let latest = null;
  for (const m of ranges) {
    const open = Number(m[1]) * 60 + Number(m[2]);
    let close = Number(m[3]) * 60 + Number(m[4]);
    if (close <= open) close += 1440; // tutup lewat tengah malam
    if (latest === null || close > latest) latest = close;
  }
  return { open24: false, close: latest };
}

/** Format menit-tutup menjadi label manusiawi: 1320 -> "22.00", 1770 -> "05.30 (besok)". */
export function formatClose(parsed) {
  if (!parsed) return null;
  if (parsed.open24) return "24 jam";
  const c = parsed.close;
  const hh = String(Math.floor((c % 1440) / 60)).padStart(2, "0");
  const mm = String(c % 60).padStart(2, "0");
  return c >= 1440 ? `${hh}.${mm} (lewat tengah malam)` : `${hh}.${mm}`;
}

/* ------------------------- klasifikasi tempat --------------------------- */

const NATURE_RULES = [
  [(t) => t.natural === "beach", "Pantai"],
  [(t) => t.waterway === "waterfall" || t.natural === "waterfall", "Air terjun"],
  [(t) => t.tourism === "camp_site", "Bumi perkemahan"],
  [(t) => t.tourism === "viewpoint", "Titik pandang"],
  [(t) => t.tourism === "picnic_site", "Area piknik"],
  [(t) => t.leisure === "nature_reserve", "Cagar alam"],
  [(t) => t.leisure === "park", "Taman"],
  [(t) => t.leisure === "garden", "Kebun/taman"],
  [(t) => t.leisure === "common", "Tanah lapang bersama"],
  [(t) => t.natural === "wood", "Hutan/kawasan hijau"],
  [(t) => t.tourism === "attraction", "Wisata alam/atraksi"],
];

/**
 * Normalisasi satu elemen Overpass (node/way dengan center) menjadi tempat.
 * center = { lat, lon } titik acuan pengguna untuk hitung jarak.
 * Mengembalikan null bila elemen tak punya koordinat.
 */
export function normalizeElement(el, center) {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;
  const t = el.tags || {};

  let category = null;
  let subkind = null;
  if (t.amenity === "cafe") {
    category = "kafe";
    subkind = "Kafe";
  } else {
    for (const [test, label] of NATURE_RULES) {
      if (test(t)) {
        category = "alam";
        subkind = label;
        break;
      }
    }
  }
  if (!category) return null;

  // Area duduk: khusus kafe dari tag OSM; tempat alam = luar ruang secara sifat.
  let seat = "tidak-diketahui";
  if (category === "alam") seat = "outdoor";
  else {
    const out = t.outdoor_seating === "yes";
    const ind = t.indoor_seating === "yes";
    if (out && ind) seat = "keduanya";
    else if (out) seat = "outdoor";
    else if (ind) seat = "indoor";
  }

  const closing = parseClosingMinutes(t.opening_hours);
  return {
    id: `${el.type}/${el.id}`,
    name: t.name || null, // null = tanpa nama di OSM (ditandai, bukan dikarang)
    category,
    subkind,
    lat,
    lon,
    distanceKm: center ? haversineKm(center.lat, center.lon, lat, lon) : null,
    seat, // 'outdoor' | 'indoor' | 'keduanya' | 'tidak-diketahui'
    openingHoursRaw: t.opening_hours || null,
    closing, // null = tidak ada / belum bisa dibaca
    website: t.website || t["contact:website"] || null,
    cuisine: t.cuisine || null,
    osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
  };
}

/**
 * Terapkan filter pengguna.
 * opts: { categories: ['kafe','alam'] , radiusKm, seat: 'semua'|'outdoor'|'indoor',
 *         minCloseMinutes: null | number (mis. 1320 = buka s.d. >= 22.00; 1440 = tengah malam),
 *         open24Only: bool, includeUnknownSeat: bool, includeUnknownHours: bool,
 *         namedOnly: bool }
 * Tempat yang info filternya TIDAK DIKETAHUI hanya lolos bila sakelar
 * includeUnknown* terkait menyala — dan tetap ditandai di tampilan.
 */
export function filterPlaces(places, opts) {
  return places
    .filter((p) => opts.categories.includes(p.category))
    .filter((p) => opts.radiusKm == null || p.distanceKm == null || p.distanceKm <= opts.radiusKm)
    .filter((p) => !opts.namedOnly || p.name)
    .filter((p) => {
      if (opts.seat === "semua") return true;
      if (p.seat === "tidak-diketahui") return opts.includeUnknownSeat;
      if (opts.seat === "outdoor") return p.seat === "outdoor" || p.seat === "keduanya";
      if (opts.seat === "indoor") return p.seat === "indoor" || p.seat === "keduanya";
      return true;
    })
    .filter((p) => {
      if (opts.open24Only) return !!p.closing?.open24;
      if (opts.minCloseMinutes == null) return true;
      if (!p.closing) return opts.includeUnknownHours;
      if (p.closing.open24) return true;
      return p.closing.close >= opts.minCloseMinutes;
    })
    .sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
}
