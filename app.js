/*
 * app.js — Pengendali UI Cari Tempat (fondasi MVP).
 * Alur: titik acuan + radius + filter -> kueri Overpass (failover endpoint)
 *       -> normalisasi (places.js) -> filter -> daftar + peta (Leaflet/OSM).
 * Tanpa kunci API; data © OpenStreetMap contributors (ODbL).
 */
import { buildQuery, fetchOverpass } from "./overpass.js";
import { normalizeElement, filterPlaces, formatClose } from "./places.js";

const $ = (id) => document.getElementById(id);
const els = {
  preset: $("sel-preset"), lat: $("in-lat"), lon: $("in-lon"), geo: $("btn-geo"),
  radius: $("in-radius"), radiusOut: $("radius-out"),
  kafe: $("ck-kafe"), alam: $("ck-alam"), seat: $("sel-seat"), close: $("sel-close"),
  unkSeat: $("ck-unknown-seat"), unkHours: $("ck-unknown-hours"), named: $("ck-named"),
  search: $("btn-search"), status: $("status"), notice: $("notice"),
  summary: $("summary"), list: $("list"), netstat: $("netstat"),
};

/* ---------- peta ---------- */
const map = L.map("map").setView([-7.7929, 110.3658], 14);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap contributors",
}).addTo(map);
let centerMarker = L.marker([-7.7929, 110.3658]).addTo(map).bindPopup("Titik acuan");
let radiusCircle = L.circle([-7.7929, 110.3658], { radius: 5000, color: "#6b7f5e", weight: 1 }).addTo(map);
let placeLayer = L.layerGroup().addTo(map);

function currentCenter() {
  return { lat: parseFloat(els.lat.value), lon: parseFloat(els.lon.value) };
}
function syncMapCenter(fit = false) {
  const c = currentCenter();
  centerMarker.setLatLng([c.lat, c.lon]);
  radiusCircle.setLatLng([c.lat, c.lon]);
  radiusCircle.setRadius(parseFloat(els.radius.value) * 1000);
  if (fit) map.fitBounds(radiusCircle.getBounds());
  else map.setView([c.lat, c.lon], map.getZoom());
}

/* ---------- label jujur per tempat ---------- */
function seatLabel(p) {
  if (p.category === "alam") return "Luar ruang (alam)";
  return {
    outdoor: "Ada area outdoor",
    indoor: "Ada area indoor",
    keduanya: "Ada indoor + outdoor",
    "tidak-diketahui": null,
  }[p.seat];
}
function hoursLabel(p) {
  if (p.closing) return `Buka s.d. ${formatClose(p.closing)}`;
  return null;
}

function renderList(places, totalRaw, hiddenUnnamed) {
  els.list.innerHTML = "";
  placeLayer.clearLayers();
  for (const p of places) {
    const card = document.createElement("article");
    card.className = "place";
    const name = p.name || "(tanpa nama di data OSM)";
    const sl = seatLabel(p);
    const hl = hoursLabel(p);
    card.innerHTML = `
      <h3>${escapeHtml(name)} <span class="dist">· ${p.distanceKm != null ? p.distanceKm.toFixed(1).replace(".", ",") + " km" : "jarak ?"}</span></h3>
      <div class="meta">
        <span class="badge">${escapeHtml(p.subkind)}</span>
        ${sl ? `<span class="badge">${sl}</span>` : `<span class="badge unknown">area duduk belum tersedia di data</span>`}
        ${hl ? `<span class="badge">${hl}</span>` : `<span class="badge unknown">jam buka belum tersedia di data</span>`}
      </div>
      ${p.cuisine ? `<p>Jenis sajian: ${escapeHtml(p.cuisine)}</p>` : ""}
      ${p.openingHoursRaw ? `<p class="raw">opening_hours (OSM): ${escapeHtml(p.openingHoursRaw)}</p>` : ""}
      <p><a href="${p.osmUrl}" target="_blank" rel="noopener">Lihat / perbaiki datanya di OpenStreetMap</a></p>`;
    els.list.appendChild(card);
    L.marker([p.lat, p.lon])
      .addTo(placeLayer)
      .bindPopup(`<strong>${escapeHtml(name)}</strong><br>${escapeHtml(p.subkind)}${hl ? "<br>" + hl : ""}`);
  }
  els.summary.textContent =
    `Menampilkan ${places.length} tempat dari ${totalRaw} data OSM di dalam radius` +
    (hiddenUnnamed ? ` · ${hiddenUnnamed} tempat tanpa nama disembunyikan (matikan sakelar "hanya yang bernama" untuk melihatnya)` : "") +
    ". Diurutkan dari yang terdekat.";
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- pencarian ---------- */
async function runSearch() {
  const center = currentCenter();
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lon)) {
    setNotice("Latitude/longitude tidak valid.");
    return;
  }
  const categories = [
    ...(els.kafe.checked ? ["kafe"] : []),
    ...(els.alam.checked ? ["alam"] : []),
  ];
  if (!categories.length) {
    setNotice("Pilih minimal satu kategori (kafe / tempat main alam).");
    return;
  }
  setNotice("");
  els.search.disabled = true;
  els.status.textContent = "Menghubungi server Overpass…";
  try {
    const radiusM = Math.round(parseFloat(els.radius.value) * 1000);
    const query = buildQuery({ ...center, radiusM, categories });
    const { elements, endpoint } = await fetchOverpass(query, {
      onAttempt: (_ep, i) => {
        if (i > 0) els.status.textContent = "Server sebelumnya sibuk/gagal — mencoba server Overpass cadangan…";
      },
    });
    els.netstat.textContent = `data: Overpass (${new URL(endpoint).hostname})`;
    // dedupe (elemen yang sama bisa muncul dari node+way) + normalisasi
    const seen = new Set();
    const places = [];
    for (const el of elements) {
      const key = `${el.type}/${el.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const p = normalizeElement(el, center);
      if (p) places.push(p);
    }
    const closeVal = els.close.value;
    const filtered = filterPlaces(places, {
      categories,
      radiusKm: parseFloat(els.radius.value),
      seat: els.seat.value,
      open24Only: closeVal === "24",
      minCloseMinutes: closeVal === "" || closeVal === "24" ? null : Number(closeVal),
      includeUnknownSeat: els.unkSeat.checked,
      includeUnknownHours: els.unkHours.checked,
      namedOnly: els.named.checked,
    });
    const hiddenUnnamed = els.named.checked
      ? places.filter((p) => !p.name).length
      : 0;
    syncMapCenter(true);
    renderList(filtered, places.length, hiddenUnnamed);
    els.status.textContent = `Selesai — ${filtered.length} tempat cocok dengan filtermu.`;
    if (!filtered.length) {
      setNotice("Tidak ada yang cocok. Coba longgarkan filter (radius lebih besar, atau sertakan data yang belum diketahui) — data OSM memang tidak lengkap, lihat catatan di kaki halaman.");
    }
  } catch (e) {
    els.status.textContent = "Pencarian gagal.";
    setNotice(e.message || String(e));
  } finally {
    els.search.disabled = false;
  }
}

/* ---------- peristiwa ---------- */
els.preset.addEventListener("change", () => {
  const [lat, lon] = els.preset.value.split(",").map(Number);
  els.lat.value = lat;
  els.lon.value = lon;
  syncMapCenter();
});
els.radius.addEventListener("input", () => {
  els.radiusOut.textContent = `${els.radius.value} km`;
  radiusCircle.setRadius(parseFloat(els.radius.value) * 1000);
});
els.lat.addEventListener("change", syncMapCenter);
els.lon.addEventListener("change", syncMapCenter);
els.geo.addEventListener("click", () => {
  if (!navigator.geolocation) {
    setNotice("Peramban ini tidak menyediakan geolokasi — isi latitude/longitude manual.");
    return;
  }
  els.status.textContent = "Meminta lokasi dari peramban…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      els.lat.value = pos.coords.latitude.toFixed(5);
      els.lon.value = pos.coords.longitude.toFixed(5);
      syncMapCenter();
      els.status.textContent = "Titik acuan diganti ke lokasimu. Tekan Cari tempat.";
    },
    () => setNotice("Izin lokasi ditolak/gagal — titik acuan tidak berubah.")
  );
});
els.search.addEventListener("click", runSearch);

function setNotice(t) {
  els.notice.hidden = !t;
  els.notice.textContent = t || "";
}
