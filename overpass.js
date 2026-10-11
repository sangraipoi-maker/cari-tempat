/*
 * overpass.js — Pembangun kueri + klien Overpass API (OpenStreetMap).
 * Gratis, TANPA kunci API. Sumber data: © OpenStreetMap contributors (ODbL).
 *
 * TEMUAN UJI NYATA (2026-10-11, dari VM tim): instance publik utama
 * (overpass-api.de) sempat menjawab "server is probably too busy" beberapa
 * kali sebelum berhasil — instance publik memang berbagi beban sedunia.
 * Maka klien ini WAJIB: (1) daftar endpoint cadangan + failover berurutan,
 * (2) timeout per percobaan, (3) pesan kegagalan yang jujur mencantumkan
 * semua endpoint yang dicoba. Pengguna akhir menjalankan ini dari
 * browsernya sendiri (beban & hasil bisa berbeda dari uji VM).
 */

export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.nchc.org.tw/api/interpreter",
];

const CAFE_QUERY = (r, lat, lon) => `
  node["amenity"="cafe"](around:${r},${lat},${lon});
  way["amenity"="cafe"](around:${r},${lat},${lon});`;

const NATURE_QUERY = (r, lat, lon) => `
  node["leisure"~"^(park|garden|nature_reserve|common)$"](around:${r},${lat},${lon});
  way["leisure"~"^(park|garden|nature_reserve|common)$"](around:${r},${lat},${lon});
  node["tourism"~"^(viewpoint|camp_site|attraction|picnic_site)$"](around:${r},${lat},${lon});
  way["tourism"~"^(viewpoint|camp_site|attraction|picnic_site)$"](around:${r},${lat},${lon});
  node["natural"~"^(beach|waterfall|wood)$"](around:${r},${lat},${lon});
  way["natural"~"^(beach|waterfall|wood)$"](around:${r},${lat},${lon});
  node["waterway"="waterfall"](around:${r},${lat},${lon});`;

/**
 * Bangun kueri Overpass QL.
 * param: { lat, lon, radiusM, categories: ['kafe'|'alam', ...] }
 */
export function buildQuery({ lat, lon, radiusM, categories }) {
  const parts = [];
  if (categories.includes("kafe")) parts.push(CAFE_QUERY(radiusM, lat, lon));
  if (categories.includes("alam")) parts.push(NATURE_QUERY(radiusM, lat, lon));
  return `[out:json][timeout:25];\n(\n${parts.join("\n")}\n);\nout center tags;`;
}

/**
 * Jalankan kueri dengan failover antar-endpoint.
 * onAttempt(endpoint, index) dipanggil tiap percobaan (untuk status UI).
 * Sukses -> { elements, endpoint }. Gagal total -> throw Error yang
 * mencantumkan semua endpoint + sebab terakhir (jujur, bukan disembunyikan).
 */
export async function fetchOverpass(query, { timeoutMs = 45000, onAttempt } = {}) {
  const errors = [];
  for (let i = 0; i < OVERPASS_ENDPOINTS.length; i++) {
    const endpoint = OVERPASS_ENDPOINTS[i];
    onAttempt?.(endpoint, i);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        signal: ctl.signal,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Accept: "application/json",
        },
        body: "data=" + encodeURIComponent(query),
      });
      clearTimeout(timer);
      const text = await res.text();
      // Instance yang sibuk menjawab HTTP 200/429/504 dengan halaman XML
      // berisi "Error" — perlakukan sebagai kegagalan dan lanjut failover.
      if (!res.ok || text.trimStart().startsWith("<")) {
        throw new Error(`HTTP ${res.status}${text.includes("too busy") ? " (server sibuk)" : ""}`);
      }
      const json = JSON.parse(text);
      if (!Array.isArray(json.elements)) throw new Error("Respons tidak berisi elements[]");
      return { elements: json.elements, endpoint };
    } catch (e) {
      clearTimeout(timer);
      errors.push(`${endpoint}: ${e.name === "AbortError" ? `timeout ${timeoutMs}ms` : e.message}`);
    }
  }
  throw new Error(
    "Semua server Overpass gagal dihubungi. " + errors.join(" · ") +
    " — instance publik kadang penuh; coba lagi sebentar lagi."
  );
}
