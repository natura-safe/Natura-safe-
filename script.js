const pages = ["home","peta","data","risiko","karhutla","satwa","pembelajaran","simulasi","mitigasi","emergency","checklist","kuis","tentang"];
let map = null;
let markersLayer = null;
let mountainMarkersLayer = null;
const mountainRows = Array.isArray(window.NATURA_MOUNTAINS) ? window.NATURA_MOUNTAINS : [];

const $ = (id) => document.getElementById(id);

function showPage(page){
  pages.forEach(p => {
    const el = $("page-"+p);
    if(el) el.classList.toggle("active", p === page);
  });
  document.querySelectorAll(".nav-link").forEach(btn => btn.classList.toggle("active", btn.dataset.page === page));
  document.querySelector(".nav")?.classList.remove("open");
  window.scrollTo({top:0, behavior:"smooth"});
  if(page === "peta") setTimeout(() => { initMap(); map?.invalidateSize(); }, 50);
}

document.querySelectorAll(".nav-link").forEach(btn => btn.addEventListener("click", () => showPage(btn.dataset.page)));
document.querySelectorAll("[data-go]").forEach(btn => btn.addEventListener("click", () => showPage(btn.dataset.go)));
$("menuToggle")?.addEventListener("click", () => document.querySelector(".nav")?.classList.toggle("open"));


// Tombol tambahan pada tampilan V3
document.querySelector(".brand")?.addEventListener("click", e=>{ e.preventDefault(); showPage("home"); });
document.querySelector(".header-actions span:first-child")?.addEventListener("click", ()=>{
  const q = prompt("Cari bagian NATURA-SAFE (mis. peta, simulasi, karhutla):");
  if(!q) return;
  const text=q.toLowerCase();
  const target = text.includes("peta") ? "peta" : text.includes("simulasi") ? "simulasi" : text.includes("risiko") || text.includes("analisis") ? "risiko" : text.includes("karhutla") ? "karhutla" : text.includes("satwa") ? "satwa" : text.includes("pembelajaran") ? "pembelajaran" : text.includes("data") ? "data" : text.includes("kuis") ? "kuis" : text.includes("tentang") ? "tentang" : "home";
  showPage(target);
});
document.querySelector(".header-actions span:last-child")?.addEventListener("click", ()=>showPage("peta"));
document.querySelector(".play-dot")?.addEventListener("click", ()=>showPage("karhutla"));

async function loadHotspots(){
  try{
    let rows;
    try {
      const response = await fetch("hotspots.json", {cache:"no-store"});
      if(!response.ok) throw new Error("hotspots.json tidak dapat dibaca.");
      rows = await response.json();
    } catch(fetchErr) {
      // Fallback untuk index.html yang dibuka langsung dari file://
      rows = Array.isArray(window.NATURA_HOTSPOTS) ? window.NATURA_HOTSPOTS : null;
      if(!rows) throw fetchErr;
    }
    hotspots = rows.map(r => ({
      Provinsi: r.province ?? r.Provinsi ?? "",
      "Kab Kota": r.regency ?? r["Kab Kota"] ?? "",
      Kecamatan: r.district ?? r.Kecamatan ?? "",
      Desa: r.village ?? r.Desa ?? "",
      Tanggal: r.date ?? r.Tanggal ?? "",
      Waktu: r.time ?? r.Waktu ?? "",
      Satelit: r.satellite ?? r.Satelit ?? "",
      Confidence: r.confidence ?? r.Confidence ?? "",
      Latitude: Number(r.lat ?? r.Latitude),
      Longitude: Number(r.lon ?? r.Longitude)
    })).filter(r => Number.isFinite(r.Latitude) && Number.isFinite(r.Longitude));

    if($("statHotspot")) $("statHotspot").textContent = hotspots.length.toLocaleString("id-ID");
    const provinceCount = new Set(hotspots.map(r => r.Provinsi).filter(Boolean)).size;
    if($("statProvince")) $("statProvince").textContent = provinceCount;
    if($("dataHotspotCount")) $("dataHotspotCount").textContent = hotspots.length.toLocaleString("id-ID");
    if($("dataProvinceCount")) $("dataProvinceCount").textContent = provinceCount;
    const preview = $("homeHotspotPreview");
    if(preview) preview.textContent = hotspots.length.toLocaleString("id-ID") + " titik";

    populateFilters();
    renderMarkers();
    loadHotspotMetadata();
  }catch(err){
    if($("statHotspot")) $("statHotspot").textContent = "—";
    if($("statProvince")) $("statProvince").textContent = "—";
    const panel = $("hotspotDetail");
    if(panel){
      panel.classList.remove("hidden");
      panel.innerHTML = `<div class="info-box">⚠️ <b>Data hotspot belum terbaca.</b><br>${escapeHtml(err.message || "Terjadi kesalahan saat memuat data.")}<br><br>Data cadangan lokal juga tidak tersedia.</div>`;
    }
  }
}

async function loadHotspotMetadata(){
  const el=$("hotspotUpdateStatus"); if(!el) return;
  try{
    const r=await fetch("hotspots-meta.json",{cache:"no-store"});
    if(!r.ok) throw new Error("metadata tidak tersedia");
    const m=await r.json();
    if(m.updated_at_utc){
      const d=new Date(m.updated_at_utc);
      el.textContent=`${m.record_count||"—"} rekaman · terakhir diperbarui ${d.toLocaleString("id-ID",{timeZone:"Asia/Jakarta"})} WIB`;
    }else{
      el.textContent=`${m.record_count||hotspots.length} rekaman · snapshot lokal; workflow otomatis belum menghasilkan waktu pembaruan` ;
    }
  }catch(e){ el.textContent="metadata pembaruan belum tersedia; data yang tampil adalah snapshot lokal"; }
}
function populateFilters(){
  const select = $("provinceFilter");
  if(!select) return;
  const provinces = [...new Set(hotspots.map(x => x.Provinsi).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  select.innerHTML = '<option value="">Semua provinsi</option>' + provinces.map(p => `<option>${escapeHtml(p)}</option>`).join("");
}

function initMap(){
  const mapEl = $("map");
  if(!mapEl) return;
  if(typeof L === "undefined"){
    mapEl.innerHTML = '<div class="map-error">Peta membutuhkan koneksi internet untuk memuat Leaflet dan peta dasar.</div>';
    return;
  }
  if(map){ map.invalidateSize(); return; }
  map = L.map("map", {preferCanvas:true, zoomControl:true}).setView([-2.5,118],5);

  // Peta utama: citra satelit agar lokasi hotspot terlihat realistis.
  // OpenStreetMap tetap tersedia sebagai alternatif melalui kontrol layer.
  const satelliteLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom:18,
      minZoom:3,
      attribution:"© Esri, Maxar, Earthstar Geographics, and the GIS User Community"
    }
  ).addTo(map);

  const streetLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom:19,
      minZoom:3,
      attribution:"© Esri"
    }
  );

  // Overlay jalan transparan di atas citra satelit.
  // Citra tetap menjadi base map; jalan tidak lagi menutup citra dengan tile OSM penuh.
  const roadsLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom:18,
      minZoom:3,
      opacity:0.95,
      attribution:"© Esri"
    }
  ).addTo(map);

  // Label administratif terpisah agar nama wilayah tetap terbaca.
  const labelsLayer = L.tileLayer(
    "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom:18,
      minZoom:3,
      opacity:0.9,
      attribution:"© Esri"
    }
  ).addTo(map);

  L.control.layers(
    {
      "🛰️ Citra Satelit": satelliteLayer,
      "🗺️ Peta Jalan": streetLayer
    },
    {
      "🛣️ Jalan": roadsLayer,
      "🏷️ Nama Wilayah": labelsLayer
    },
    {
      collapsed:true,
      position:"topright"
    }
  ).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
  mountainMarkersLayer = L.layerGroup();
  renderMountainMarkers();
  setMountainMarkersVisible(false);

  $("provinceFilter")?.addEventListener("change", renderMarkers);
  $("confidenceFilter")?.addEventListener("change", renderMarkers);
  $("resetMap")?.addEventListener("click",()=>{$("provinceFilter").value="";$("confidenceFilter").value="";renderMarkers();});
  setTimeout(()=>map.invalidateSize(),150);
  loadHotspots();
}
function renderMarkers(){
  if(!map || !markersLayer) return;
  markersLayer.clearLayers();
  const province = $("provinceFilter")?.value || "";
  const confidence = $("confidenceFilter")?.value || "";
  const filtered = hotspots.filter(r => (!province || r.Provinsi === province) && (!confidence || String(r.Confidence).toLowerCase() === confidence.toLowerCase()));

  filtered.forEach(row=>{
    const color = confidenceColor(row.Confidence);
    const marker = L.circleMarker([row.Latitude,row.Longitude],{
      radius: 5,
      color: color,
      weight: 1.5,
      fillColor: color,
      fillOpacity: 0.82,
      title: `Hotspot ${row.Provinsi} - ${row["Kab Kota"]}`
    });
    marker.bindTooltip(`🔥 Hotspot • ${escapeHtml(row.Provinsi)}`, {direction:"top", offset:[0,-10]});
    marker.bindPopup(`
      <div style="font-family:Arial;line-height:1.55;min-width:210px">
        <b style="color:#557765">🔥 HOTSPOT SIPONGI</b><br>
        <b>${escapeHtml(row.Provinsi)}</b><br>
        ${escapeHtml(row["Kab Kota"])} • ${escapeHtml(row.Kecamatan)}<br>
        ${escapeHtml(row.Desa)}<br>
        <small>${escapeHtml(row.Tanggal)} • ${escapeHtml(row.Waktu)} • ${escapeHtml(row.Confidence)}</small>
        <br><button type="button" onclick="showHotspotByKey(${JSON.stringify(row.Latitude)},${JSON.stringify(row.Longitude)})" style="margin-top:8px;padding:7px 10px;border:0;border-radius:8px;background:#dcebe0;color:#40534a;font-weight:700;cursor:pointer">Lihat detail</button>
      </div>`);
    marker.on("click",()=>showHotspot(row));
    marker.addTo(markersLayer);
  });
}

function hotspotIcon(color){
  return L.divIcon({
    className:"natura-hotspot-marker",
    html:`<span style="--hotspot-color:${color}">●</span>`,
    iconSize:[18,18],
    iconAnchor:[9,9],
    popupAnchor:[0,-8]
  });
}

window.showHotspotByKey = function(lat,lon){
  const row = hotspots.find(r => Math.abs(r.Latitude-Number(lat)) < 1e-8 && Math.abs(r.Longitude-Number(lon)) < 1e-8);
  if(row) showHotspot(row);
};

function confidenceColor(value){
  const v = String(value).toLowerCase();
  if(v==="high") return "#D9534F";
  if(v==="medium") return "#E9A23B";
  return "#E6C84A";
}

function showHotspot(row){
  const panel = $("hotspotDetail");
  panel.classList.remove("hidden");
  panel.innerHTML = `
    <article class="card">
      <div class="badge pink">🟠 DETAIL INDIKASI HOTSPOT</div>
      <h2>${escapeHtml(row.Provinsi)} — ${escapeHtml(row["Kab Kota"])}</h2>
      <div class="detail-grid">
        ${detail("Provinsi",row.Provinsi)}
        ${detail("Kab/Kota",row["Kab Kota"])}
        ${detail("Kecamatan",row.Kecamatan)}
        ${detail("Desa",row.Desa)}
        ${detail("Tanggal",row.Tanggal)}
        ${detail("Waktu",row.Waktu)}
        ${detail("Satelit",row.Satelit)}
        ${detail("Confidence",row.Confidence)}
        ${detail("Latitude",row.Latitude)}
        ${detail("Longitude",row.Longitude)}
      </div>
      <div class="info-box">🌦️ <b>Data lingkungan</b><br>Versi website ini tidak mengarang data suhu, kelembapan, curah hujan, atau angin historis. Data tersebut perlu diambil dari sumber resmi yang sesuai.</div>
      <div class="info-box">📡 <b>Sumber hotspot:</b> SiPongi Kementerian Kehutanan. Data yang ditampilkan berasal dari data hotspot SiPongi yang diekspor ke <b>hotspots.json</b>. <a href="https://sipongi.gakkum.kehutanan.go.id/sebaran-titik-panas" target="_blank" rel="noopener">Buka SiPongi →</a></div>
    </article>`;
  panel.scrollIntoView({behavior:"smooth",block:"start"});
}

function detail(label,value){ return `<div class="detail-item"><b>${escapeHtml(label)}</b><span>${escapeHtml(value)}</span></div>`; }
function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}

/* =========================================================
   DATA SATWA — rekap semua satwa terdampak terdokumentasi
========================================================= */
let wildlifeData = [];
let wildlifeFiltered = [];

// Cadangan data agar halaman SATWA tetap bisa dibuka saat index.html dijalankan langsung.
// Jika wildlife.json tersedia, data tersebut tetap menjadi sumber utama.
const EMBEDDED_WILDLIFE_DATA = [];

async function loadWildlife(){
  try{
    // Sumber utama: wildlife.json.
    const response = await fetch("wildlife.json", {cache:"no-store"});
    if(!response.ok) throw new Error("HTTP " + response.status);
    const parsed = await response.json();
    if(!Array.isArray(parsed)) throw new Error("Format wildlife.json tidak sesuai.");
    wildlifeData = parsed;
  }catch(err){
    // Fallback untuk mode file:// atau server yang belum menyajikan JSON.
    wildlifeData = EMBEDDED_WILDLIFE_DATA.slice();
    console.info("wildlife.json belum dapat diambil; memakai data cadangan yang tertanam.", err);
  }

  wildlifeFiltered = wildlifeData.slice();
  populateWildlifeFilters();
  renderWildlifeData();
}

function populateWildlifeFilters(){
  const regionSelect = $("wildlifeRegionFilter");
  const statusSelect = $("wildlifeStatusFilter");
  if(regionSelect){
    const regions = [...new Set(wildlifeData.flatMap(a => a.events.map(e => e.location)).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    regionSelect.innerHTML = '<option value="">Semua daerah</option>' + regions.map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("");
  }
  if(statusSelect){
    const statuses = [...new Set(wildlifeData.map(a=>a.status).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    statusSelect.innerHTML = '<option value="">Semua status</option>' + statuses.map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("");
  }
  $("wildlifeSearch")?.addEventListener("input", filterWildlife);
  $("wildlifeRegionFilter")?.addEventListener("change", filterWildlife);
  $("wildlifeStatusFilter")?.addEventListener("change", filterWildlife);
}

function filterWildlife(){
  const q = ($("wildlifeSearch")?.value || "").trim().toLowerCase();
  const region = $("wildlifeRegionFilter")?.value || "";
  const status = $("wildlifeStatusFilter")?.value || "";
  wildlifeFiltered = wildlifeData.filter(animal=>{
    const haystack = [animal.name,animal.scientificName,animal.region,animal.status,...animal.events.flatMap(e=>[e.location,e.type,e.source])].join(" ").toLowerCase();
    const matchesSearch = !q || haystack.includes(q);
    const matchesRegion = !region || animal.events.some(e=>e.location === region);
    const matchesStatus = !status || animal.status === status;
    return matchesSearch && matchesRegion && matchesStatus;
  });
  renderWildlifeData();
}

function renderWildlifeData(){
  const grid = $("wildlifeGrid");
  const count = $("wildlifeCount");
  const empty = $("wildlifeEmpty");
  if(!grid) return;
  if(count) count.textContent = `${wildlifeFiltered.length.toLocaleString("id-ID")} satwa`;
  if(empty){ empty.classList.toggle("hidden", wildlifeFiltered.length > 0); if(wildlifeFiltered.length===0) empty.innerHTML="Belum ada catatan satwa terdampak yang sudah dihubungkan dengan kejadian karhutla dan sumber spesifik yang terverifikasi. Data satwa akan ditambahkan setelah data kejadian kebakaran yang mendukung tersedia."; }
  grid.innerHTML = wildlifeFiltered.map((animal,index)=>{
    const locations = [...new Set(animal.events.map(e=>e.location))];
    return `<button type="button" class="wildlife-card" data-wildlife-index="${index}">
      <div class="wildlife-photo-wrap"><img class="wildlife-photo" src="${escapeHtml(animal.photo)}" alt="${escapeHtml(animal.name)}" loading="lazy" onerror="this.style.display='none';this.parentElement.classList.add('photo-fallback')"><span class="wildlife-photo-fallback">🐾</span></div>
      <div class="wildlife-card-body"><span class="wildlife-status">${escapeHtml(animal.status || "Status belum tersedia")}</span><h3>${escapeHtml(animal.name)}</h3><p class="scientific-name">${escapeHtml(animal.scientificName)}</p><p class="wildlife-region">📍 ${escapeHtml(locations.join(" • "))}</p><span class="wildlife-detail-link">Lihat detail & riwayat →</span></div>
    </button>`;
  }).join("");
  grid.querySelectorAll("[data-wildlife-index]").forEach(btn=>btn.addEventListener("click",()=>showWildlifeDetail(wildlifeFiltered[Number(btn.dataset.wildlifeIndex)])));
}

function showWildlifeDetail(animal){
  const panel = $("wildlifeDetail");
  if(!panel || !animal) return;
  panel.classList.remove("hidden");
  panel.innerHTML = `<article class="card wildlife-detail-card">
    <button type="button" class="wildlife-close" id="closeWildlifeDetail" aria-label="Tutup">×</button>
    <div class="wildlife-detail-top">
      <div class="wildlife-detail-photo-wrap"><img src="${escapeHtml(animal.photo)}" alt="${escapeHtml(animal.name)}" class="wildlife-detail-photo" onerror="this.style.display='none';this.parentElement.classList.add('photo-fallback')"><span class="wildlife-photo-fallback">🐾</span></div>
      <div><span class="section-kicker">🐾 DATA TERDOKUMENTASI</span><h2>${escapeHtml(animal.name)}</h2><p class="scientific-name large">${escapeHtml(animal.scientificName)}</p><span class="wildlife-status">${escapeHtml(animal.status || "Status belum tersedia")}</span><p class="detail-intro">Wilayah yang tercatat: <b>${escapeHtml(animal.region)}</b></p></div>
    </div>
    <div class="wildlife-history"><div class="section-heading-row"><div><span class="section-kicker">📚 RIWAYAT</span><h2>Riwayat Kejadian</h2></div><span class="event-count">${animal.events.length} kejadian tercatat</span></div>
      ${animal.events.map((e,i)=>`<article class="wildlife-event"><div class="event-number">${i+1}</div><div><h3>${escapeHtml(e.location)}</h3><div class="event-meta">${escapeHtml(e.period)} · ${escapeHtml(e.type)}</div><div class="detail-grid"><div class="detail-item"><b>Jumlah</b><span>${escapeHtml(e.count || "Tidak tersedia")}</span></div><div class="detail-item"><b>Kondisi</b><span>${escapeHtml(e.condition || "Tidak tersedia")}</span></div><div class="detail-item"><b>Penanganan</b><span>${escapeHtml(e.handling || "Tidak tersedia")}</span></div></div><p class="event-source">Sumber: <a href="${escapeHtml(e.url)}" target="_blank" rel="noopener">${escapeHtml(e.source)}</a></p></div></article>`).join("")}
    </div>
    <div class="info-box">ℹ️ NATURA-SAFE hanya menampilkan jumlah, kondisi, dan penanganan yang didukung catatan sumber. Data yang belum tersedia tidak dibuat-buat.</div>
  </article>`;
  $("closeWildlifeDetail")?.addEventListener("click",()=>{panel.classList.add("hidden");panel.innerHTML="";});
  panel.scrollIntoView({behavior:"smooth",block:"start"});
}

loadWildlife();

/* =========================================================
   SIMULASI PENGHENTIAN & PENYELAMATAN
   Bukan simulasi pemadaman teknis. Fokus pada keputusan aman:
   mengenali tanda bahaya, melapor, menjauh, evakuasi, dan mengikuti petugas.
========================================================= */
const simulationScenarios = [
  {title:"Asap Terlihat",text:"Kamu melihat asap tebal dari area hutan/lahan. Apa tindakan pertama yang paling aman?",choices:["Mendekati sumber asap untuk memastikan","Melapor melalui jalur resmi dan menjauh dari area berbahaya","Masuk ke lokasi untuk mengambil video","Menunggu sampai api terlihat besar"],answer:1},
  {title:"Arah Angin Berubah",text:"Angin mulai bertiup ke arah tempat kamu berada dan asap semakin tebal. Apa yang harus diprioritaskan?",choices:["Tetap berada di lokasi agar bisa memantau","Mengikuti arahan evakuasi dan menuju tempat yang lebih aman","Mencoba menerobos asap","Berjalan mendekati arah datangnya asap"],answer:1},
  {title:"Ada Warga di Sekitar",text:"Beberapa warga berada dekat area yang terdampak. Apa peran yang paling tepat?",choices:["Mengajak semua orang mendekati api","Membantu mengingatkan warga agar mengikuti informasi dan arahan petugas","Membuat jalur sendiri menuju api","Menyebarkan kabar yang belum terverifikasi"],answer:1},
  {title:"Informasi Resmi",text:"Kamu menerima beberapa pesan tentang lokasi kebakaran, tetapi belum semuanya jelas. Apa yang dilakukan?",choices:["Meneruskan semua pesan","Memeriksa sumber resmi sebelum membagikan informasi","Menghapus semua informasi","Memilih pesan yang paling menakutkan"],answer:1},
  {title:"Prioritas Penyelamatan",text:"Situasi semakin tidak aman. Apa yang menjadi prioritas utama?",choices:["Menyelamatkan barang terlebih dahulu","Keselamatan diri dan orang di sekitar","Mendokumentasikan kejadian","Mendekati lokasi agar lebih jelas"],answer:1},
  {title:"Setelah Evakuasi",text:"Kamu sudah berada di tempat aman. Apa langkah berikutnya?",choices:["Kembali ke lokasi tanpa arahan","Tetap mengikuti informasi resmi dan arahan petugas","Mengajak teman kembali melihat kondisi","Menganggap situasi pasti sudah selesai"],answer:1}
];
let simIndex=0, simScore=0;
function renderSimulation(){
  const box=$("simulationBox"); if(!box)return;
  const s=simulationScenarios[simIndex];
  box.innerHTML=`<div class="sim-question">
    <div class="sim-progress">${simulationScenarios.map((_,i)=>`<span class="${i<=simIndex?'done':''}"></span>`).join("")}</div>
    <span class="section-kicker">LEVEL ${simIndex+1} DARI ${simulationScenarios.length}</span>
    <h2>${s.title}</h2><p>${s.text}</p>
    ${s.choices.map((c,i)=>`<button class="sim-choice" data-sim-answer="${i}">${String.fromCharCode(65+i)}. ${escapeHtml(c)}</button>`).join("")}
  </div>`;
  box.querySelectorAll(".sim-choice").forEach(btn=>btn.addEventListener("click",()=>{
    const ok=Number(btn.dataset.simAnswer)===s.answer;
    if(ok) simScore++;
    simIndex++;
    if(simIndex<simulationScenarios.length) renderSimulation();
    else renderSimulationResult();
  }));
}
function renderSimulationResult(){
  const box=$("simulationBox"); if(!box)return;
  box.innerHTML=`<div class="sim-question"><span class="section-kicker">SIMULASI SELESAI</span><h2>🌿 Simulasi Penghentian & Penyelamatan</h2><p>Skormu <b>${simScore}/${simulationScenarios.length}</b>. Fokus utama simulasi ini adalah keselamatan, pelaporan, evakuasi, dan mengikuti arahan resmi.</p><div class="info-box">⚠️ NATURA-SAFE bukan panduan pemadaman teknis. Saat terjadi kebakaran nyata, utamakan keselamatan dan ikuti petugas/instansi berwenang.</div><button class="btn btn-pink" id="retrySimulation">Ulangi Simulasi</button></div>`;
  $("retrySimulation")?.addEventListener("click",()=>{simIndex=0;simScore=0;renderSimulation();});
}
renderSimulation();

const quizQuestions=[
  {q:"Apa yang dimaksud hotspot dalam konteks NATURA-SAFE?",o:["Titik panas yang terdeteksi sistem/satelit","Batas administrasi desa","Lokasi gunung tertinggi","Data jumlah satwa"],a:0},
  {q:"Mengapa data hotspot perlu dibaca bersama konteks lingkungan?",o:["Agar interpretasi tidak hanya berdasarkan satu indikator","Agar semua titik dianggap kebakaran besar","Agar penyebab kebakaran bisa ditebak","Agar data cuaca tidak diperlukan"],a:0},
  {q:"Apa prioritas ketika situasi kebakaran menjadi tidak aman?",o:["Mendekati api","Keselamatan diri dan mengikuti arahan resmi","Mengambil video dari dekat","Menunggu tanpa informasi"],a:1},
  {q:"Sumber utama data hotspot lokal yang digunakan versi ini adalah…",o:["hotspots.json","cuaca.txt","gunung.csv","satwa.json"],a:0}
];
let quizIndex=0, quizScore=0;
function renderQuiz(){
  const box=$("quizBox"); if(!box)return;
  const q=quizQuestions[quizIndex];
  box.innerHTML=`<article class="card"><div class="badge">SOAL ${quizIndex+1}/${quizQuestions.length}</div><h2>${q.q}</h2>${q.o.map((x,i)=>`<button class="quiz-option" data-answer="${i}">${String.fromCharCode(65+i)}. ${escapeHtml(x)}</button>`).join("")}</article>`;
  box.querySelectorAll(".quiz-option").forEach(btn=>btn.addEventListener("click",()=>{
    if(Number(btn.dataset.answer)===q.a) quizScore++;
    quizIndex++;
    if(quizIndex<quizQuestions.length) renderQuiz();
    else box.innerHTML=`<article class="card"><h2>🌿 Kuis selesai!</h2><div class="quiz-result">Skormu: <b>${quizScore}/${quizQuestions.length}</b></div><button class="btn btn-primary" style="margin-top:16px" id="retryQuiz">Coba Lagi</button></article>`;
    $("retryQuiz")?.addEventListener("click",()=>{quizIndex=0;quizScore=0;renderQuiz();});
  }));
}
renderQuiz();

// Semua tombol navigasi yang dibuat dinamis tetap bisa dipakai.
document.addEventListener("click", e=>{
  const btn=e.target.closest("[data-go]");
  if(btn) showPage(btn.dataset.go);
});

/* =========================================================
   NATURA-SAFE V11 — Integrasi Data Terbuka BMKG
========================================================= */
function normalizeBmkgRows(payload){
  const rows=[];
  const data=Array.isArray(payload?.data) ? payload.data : [];
  for(const block of data){
    const lokasi=block?.lokasi || {};
    const cuaca=Array.isArray(block?.cuaca) ? block.cuaca : [];
    for(const group of cuaca){
      const items=Array.isArray(group) ? group : [];
      for(const item of items){
        rows.push({
          local_datetime:item?.local_datetime || "",
          utc_datetime:item?.utc_datetime || "",
          t:item?.t,
          hu:item?.hu,
          weather_desc:item?.weather_desc || "",
          ws:item?.ws,
          wd:item?.wd || "",
          tcc:item?.tcc,
          vs_text:item?.vs_text || "",
          analysis_date:item?.analysis_date || "",
          lokasi
        });
      }
    }
  }
  return rows;
}
function renderBmkgData(rows){
  const current=$("bmkgCurrent"), forecast=$("bmkgForecast");
  if(!current || !forecast) return;
  if(!rows.length){
    current.innerHTML=""; forecast.innerHTML=`<div class="info-box">⚠️ Data prakiraan BMKG belum tersedia untuk kode tersebut.</div>`; return;
  }
  const first=rows[0];
  const loc=first.lokasi||{};
  const fmt=(v,suffix="")=>Number.isFinite(Number(v)) ? `${Number(v)}${suffix}` : "—";
  current.innerHTML=`
    <div class="environment-metric"><span>🌡️ Suhu</span><strong>${fmt(first.t,"°C")}</strong></div>
    <div class="environment-metric"><span>💧 Kelembapan</span><strong>${fmt(first.hu,"%")}</strong></div>
    <div class="environment-metric"><span>💨 Angin</span><strong>${fmt(first.ws," km/j")}</strong></div>
    <div class="environment-metric"><span>🌦️ Cuaca</span><strong style="font-size:15px">${escapeHtml(first.weather_desc||"—")}</strong></div>`;
  const limited=rows.slice(0,8);
  forecast.innerHTML=limited.map(r=>`<article class="environment-forecast-card"><small>${escapeHtml((r.local_datetime||"").replace(" "," · "))}</small><b>${escapeHtml(r.weather_desc||"Data cuaca")}</b><p>🌡️ ${fmt(r.t,"°C")} · 💧 ${fmt(r.hu,"%")}</p><p>💨 ${fmt(r.ws," km/j")} · ${escapeHtml(r.wd||"—")}</p></article>`).join("");
  const status=$("bmkgStatus");
  if(status) status.innerHTML=`✅ Data BMKG berhasil dimuat untuk <b>${escapeHtml(loc.desa||loc.kecamatan||loc.kotkab||"wilayah terpilih")}</b>. ${escapeHtml(loc.provinsi||"")} · Pembaruan data: ${escapeHtml(first.analysis_date||"—")}`;
}
async function loadBmkgForecast(){
  const input=$("bmkgAdm4"), status=$("bmkgStatus"), btn=$("loadBmkg");
  if(!input || !status) return;
  const adm4=input.value.trim();
  if(!/^\d{2}\.\d{2}\.\d{2}\.\d{4}$/.test(adm4)){
    status.innerHTML="⚠️ Format kode ADM4 belum benar. Contoh format: <b>31.71.03.1001</b>"; return;
  }
  if(btn) btn.disabled=true;
  status.textContent="⏳ Mengambil data dari BMKG…";
  try{
    const response=await fetch(`https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=${encodeURIComponent(adm4)}`,{cache:"no-store"});
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload=await response.json();
    const rows=normalizeBmkgRows(payload);
    renderBmkgData(rows);
  }catch(err){
    status.innerHTML=`⚠️ Data BMKG belum dapat dimuat dari browser ini. <br><small>${escapeHtml(err.message||"Periksa koneksi dan kode ADM4.")}</small>`;
  }finally{ if(btn) btn.disabled=false; }
}
$("loadBmkg")?.addEventListener("click",loadBmkgForecast);
$("bmkgAdm4")?.addEventListener("keydown",e=>{if(e.key==="Enter") loadBmkgForecast();});


/* RIWAYAT KARHUTLA — data agregat provinsi, bukan titik kejadian */
let nsFireHistoryV2 = null;
async function nsLoadFireHistoryV2(){
  try{
    const r=await fetch("fire-history.json",{cache:"no-store"});
    if(!r.ok) throw new Error("fire-history.json tidak dapat dimuat");
    nsFireHistoryV2=await r.json();
    nsRenderFireHistorySummaryV2();
  }catch(e){ console.warn("NATURA-SAFE riwayat karhutla:",e); }
}
function nsRenderFireHistorySummaryV2(){
  const host=document.getElementById("fireHistorySummary");
  if(!host || !nsFireHistoryV2) return;
  const rows=Array.isArray(nsFireHistoryV2.riwayat_provinsi)?nsFireHistoryV2.riwayat_provinsi:[];
  const sorted=rows.slice().sort((a,b)=>(Number(b.total_luas_ha_2018_2026)||0)-(Number(a.total_luas_ha_2018_2026)||0));
  host.innerHTML=`<div class="section-heading-row"><div><span class="section-kicker">RIWAYAT KARHUTLA</span><h2>Rekap menurut provinsi</h2><p>Data ini berupa rekap luas per provinsi pada 2018–2026, bukan koordinat lokasi kejadian. Karena itu, data ini tidak ditempatkan sebagai pin kejadian di peta.</p></div></div><div class="table-scroll"><table class="data-table"><thead><tr><th>Provinsi</th><th>Tahun tercatat</th><th>Total luas tercatat (ha)</th><th>Sumber</th></tr></thead><tbody>${sorted.map(r=>`<tr><td>${escapeHtml(r.provinsi||"—")}</td><td>${escapeHtml((r.tahun_tercatat||[]).join(", ")||"—")}</td><td>${Number.isFinite(Number(r.total_luas_ha_2018_2026))?Number(r.total_luas_ha_2018_2026).toLocaleString("id-ID",{maximumFractionDigits:2}):"—"}</td><td>${escapeHtml(r.sumber||nsFireHistoryV2.metadata?.sumber||"Sumber belum tercantum")}</td></tr>`).join("")}</tbody></table></div><p class="map-note">Untuk menambahkan pin kejadian, NATURA-SAFE memerlukan catatan kejadian yang memiliki koordinat dan sumber spesifik. Hotspot satelit tetap ditampilkan sebagai lapisan terpisah.</p>`;
}
nsLoadFireHistoryV2();

/* NATURA-SAFE: lapisan gunung opsional agar tidak menutupi hotspot */
let mountainMarkersVisible = false;
let mountainSelectedOnly = false;
function setMountainMarkersVisible(visible){
  mountainMarkersVisible = Boolean(visible);
  if(!map || !mountainMarkersLayer) return;
  if(mountainMarkersVisible){
    if(!mountainSelectedOnly) renderMountainMarkers();
    mountainMarkersLayer.addTo(map);
  } else if(map.hasLayer(mountainMarkersLayer)){ map.removeLayer(mountainMarkersLayer); }
  const button = $("mountainCatalogButton");
  if(button){
    button.setAttribute("aria-pressed", String(mountainMarkersVisible));
    button.setAttribute("title", mountainMarkersVisible ? "Sembunyikan ikon gunung" : "Tampilkan ikon gunung");
    button.setAttribute("aria-label", mountainMarkersVisible ? "Sembunyikan ikon gunung pada peta" : "Tampilkan ikon gunung pada peta");
    button.classList.toggle("is-active", mountainMarkersVisible);
  }
}
function renderMountainMarkers(){
  if(!map || !mountainMarkersLayer || typeof L === "undefined") return;
  mountainMarkersLayer.clearLayers();
  mountainRows.forEach(m => {
    if(!Number.isFinite(Number(m.lat)) || !Number.isFinite(Number(m.lon))) return;
    const marker = L.marker([Number(m.lat), Number(m.lon)], {
      title: m.name,
      alt: `Gunung ${m.name}`,
      icon: L.divIcon({className:"mountain-map-marker", html:'<span aria-hidden="true">⛰️</span>', iconSize:[30,30], iconAnchor:[15,15]})
    });
    marker.bindTooltip(`${escapeHtml(m.name)} · ${Number(m.elevation_m).toLocaleString("id-ID")} mdpl`);
    marker.on("click", () => {
      // Saat satu gunung dipilih, sisakan hanya marker gunung tersebut agar hotspot tetap terbaca.
      mountainMarkersLayer.clearLayers();
      marker.addTo(mountainMarkersLayer);
      mountainSelectedOnly = true;
      mountainMarkersVisible = true;
      if(!map.hasLayer(mountainMarkersLayer)) mountainMarkersLayer.addTo(map);
      const button = $("mountainCatalogButton");
      if(button){ button.setAttribute("aria-pressed","true"); button.setAttribute("title","Sembunyikan ikon gunung"); button.classList.add("is-active"); }
      showMountainProfile(m.id, false);
    });
    marker.addTo(mountainMarkersLayer);
  });
}

function showMountainProfile(id, zoomTo){
  const m = mountainRows.find(row => row.id === id);
  const panel = $("mountainProfile");
  if(!m || !panel) return;
  panel.classList.remove("hidden");
  panel.innerHTML = `
    <article class="card mountain-profile-card">
      <div class="mountain-profile-head"><div><span class="section-kicker">⛰️ INFO GUNUNG • FITUR PENDUKUNG</span><h2>${escapeHtml(m.name)}</h2><p>📍 ${escapeHtml(m.region)}</p></div><span class="mountain-elevation">${Number(m.elevation_m).toLocaleString("id-ID")}<small>mdpl*</small></span></div>
      <div class="mountain-profile-grid">
        <div class="detail-item"><b>Status verifikasi data</b>${escapeHtml(m.verification_status || "Belum diverifikasi satu per satu")}</div>
        <div class="detail-item"><b>Bidang yang dicocokkan</b>${m.verified_fields?.length ? m.verified_fields.map(escapeHtml).join(" · ") : "Belum ada bidang yang dinyatakan cocok"}</div>
        <div class="detail-item"><b>Tipe</b>${escapeHtml(m.type)}</div>
        <div class="detail-item"><b>Pulau</b>${escapeHtml(m.island)}</div>
        <div class="detail-item"><b>Koordinat perkiraan</b>${Number(m.lat).toFixed(5)}, ${Number(m.lon).toFixed(5)}</div>
        <div class="detail-item"><b>Musim / cuaca</b>${escapeHtml(m.best_season)}</div>
        <div class="detail-item"><b>Status aktivitas</b>${escapeHtml(m.activity_status)}</div>
        <div class="detail-item"><b>Status jalur</b>${escapeHtml(m.trail_status)}</div>
        <div class="detail-item"><b>Tingkat kesulitan</b>${escapeHtml(m.difficulty)}</div>
        <div class="detail-item"><b>Jalur populer (perlu verifikasi)</b>${m.popular_routes.map(escapeHtml).join(" · ")}</div>
      </div>
      <h3>Rute, basecamp, dan pos</h3>
      <div class="mountain-profile-grid">
        <div class="detail-item"><b>Jalur yang tercatat</b>${m.popular_routes?.length ? m.popular_routes.map(escapeHtml).join(" · ") : "Belum terverifikasi"}</div>
        <div class="detail-item"><b>Basecamp / pintu masuk</b>${escapeHtml(m.basecamp || "Belum diverifikasi dari pengelola resmi")}</div>
        <div class="detail-item"><b>Jarak jalur</b>${escapeHtml(m.route_distance || "Belum diverifikasi")}</div>
        <div class="detail-item"><b>Estimasi waktu</b>${escapeHtml(m.route_duration || "Belum diverifikasi; bergantung jalur dan kondisi")}</div>
        <div class="detail-item"><b>Pos dan elevasi tiap pos</b>${escapeHtml(m.post_details || "Belum tersedia dalam data terverifikasi")}</div>
        <div class="detail-item"><b>Kontak pengelola</b>${escapeHtml(m.basecamp_contact || "Belum diverifikasi")}</div>
        <div class="detail-item"><b>Koordinat puncak</b>${Number.isFinite(Number(m.lat)) && Number.isFinite(Number(m.lon)) ? `${Number(m.lat).toFixed(5)}, ${Number(m.lon).toFixed(5)}` : "Belum diverifikasi"}</div>
        <div class="detail-item"><b>Sumber dan pembaruan</b>${escapeHtml(m.data_updated || "Data katalog awal; perlu pengecekan sumber resmi")}</div>
      </div>
      <div class="info-box">${escapeHtml(m.source_note || "Informasi teknis perlu diverifikasi")} ${escapeHtml(m.verification_note || "Data yang belum tersedia ditandai, bukan diperkirakan.")} Status aktivitas gunung api perlu dicek melalui MAGMA Indonesia; status pembukaan jalur harus dicek terpisah kepada pengelola.</div>
      <p class="map-note">Ketinggian/koordinat yang bertanda perkiraan bukan data navigasi. Jangan menjadikan profil ini pengganti pengumuman resmi sebelum berkunjung.</p>
      <div class="mountain-profile-actions"><button class="btn btn-soft" type="button" onclick="window.open('https://magma.esdm.go.id/','_blank','noopener')">Cek MAGMA Indonesia</button><button class="btn btn-soft" type="button" onclick="window.open(${JSON.stringify(m.verification_source_url || m.geographic_source_url || "https://www.geonames.org/advanced-search.html?country=ID")},'_blank','noopener')">Buka sumber geografis</button><button class="btn btn-soft" type="button" onclick="window.open('https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(${JSON.stringify(m.name+' '+m.region)}),'_blank','noopener')">Bandingkan lokasi peta</button></div>
      <button class="btn btn-soft" type="button" id="closeMountainProfile">Tutup profil</button>
    </article>`;
  $("closeMountainProfile")?.addEventListener("click", () => { panel.classList.add("hidden"); panel.innerHTML=""; });
  if(zoomTo && map) map.setView([m.lat,m.lon],8,{animate:true});
  panel.scrollIntoView({behavior:"smooth",block:"nearest"});
}


/* Katalog gunung pendukung: daftar nama diperluas, profil rinci hanya untuk data yang sudah tersedia. */
const extraMountainCatalog = [
["Kerinci","Sumatra","Jambi / Sumatra Barat"],["Leuser","Sumatra","Aceh"],["Marapi","Sumatra","Sumatra Barat"],["Singgalang","Sumatra","Sumatra Barat"],["Tandikat","Sumatra","Sumatra Barat"],["Talang","Sumatra","Sumatra Barat"],["Dempo","Sumatra","Sumatra Selatan"],["Kaba","Sumatra","Bengkulu"],["Talamau","Sumatra","Sumatra Barat"],["Sibayak","Sumatra","Sumatra Utara"],["Sinabung","Sumatra","Sumatra Utara"],["Pusuk Buhit","Sumatra","Sumatra Utara"],["Peuet Sague","Sumatra","Aceh"],["Seulawah Agam","Sumatra","Aceh"],
["Ciremai","Jawa","Jawa Barat"],["Papandayan","Jawa","Jawa Barat"],["Guntur","Jawa","Jawa Barat"],["Galunggung","Jawa","Jawa Barat"],["Tangkuban Parahu","Jawa","Jawa Barat"],["Patuha","Jawa","Jawa Barat"],["Burangrang","Jawa","Jawa Barat"],["Cikuray","Jawa","Jawa Barat"],["Sumbing","Jawa","Jawa Tengah"],["Sindoro","Jawa","Jawa Tengah"],["Merbabu","Jawa","Jawa Tengah"],["Telomoyo","Jawa","Jawa Tengah"],["Andong","Jawa","Jawa Tengah"],["Ungaran","Jawa","Jawa Tengah"],["Muriah","Jawa","Jawa Tengah"],["Argopuro","Jawa","Jawa Timur"],["Raung","Jawa","Jawa Timur"],["Arjuno","Jawa","Jawa Timur"],["Welirang","Jawa","Jawa Timur"],["Ijen","Jawa","Jawa Timur"],["Wilis","Jawa","Jawa Timur"],["Penanggungan","Jawa","Jawa Timur"],["Anjasmoro","Jawa","Jawa Timur"],["Pundak","Jawa","Jawa Timur"],
["Agung","Bali","Bali"],["Batur","Bali","Bali"],["Abang","Bali","Bali"],
["Rinjani","Nusa Tenggara","Lombok, Nusa Tenggara Barat"],["Tambora","Nusa Tenggara","Sumbawa, Nusa Tenggara Barat"],["Sangeang Api","Nusa Tenggara","Nusa Tenggara Barat"],["Inerie","Nusa Tenggara","Flores, Nusa Tenggara Timur"],["Kelimutu","Nusa Tenggara","Flores, Nusa Tenggara Timur"],["Egon","Nusa Tenggara","Flores, Nusa Tenggara Timur"],["Iya","Nusa Tenggara","Flores, Nusa Tenggara Timur"],["Lewotobi","Nusa Tenggara","Flores, Nusa Tenggara Timur"],["Ile Ape","Nusa Tenggara","Lembata, Nusa Tenggara Timur"],["Mutis","Nusa Tenggara","Timor, Nusa Tenggara Timur"],
["Bukit Raya","Kalimantan","Kalimantan Barat / Kalimantan Tengah"],["Halau-Halau","Kalimantan","Kalimantan Selatan"],["Saran","Kalimantan","Kalimantan Barat"],["Bawang","Kalimantan","Kalimantan Tengah"],
["Latimojong / Rantemario","Sulawesi","Sulawesi Selatan"],["Lokon","Sulawesi","Sulawesi Utara"],["Mahawu","Sulawesi","Sulawesi Utara"],["Soputan","Sulawesi","Sulawesi Utara"],["Klabat","Sulawesi","Sulawesi Utara"],["Karangetang","Sulawesi","Kepulauan Siau"],["Awu","Sulawesi","Kepulauan Sangihe"],["Ambang","Sulawesi","Sulawesi Utara"],["Mekongga","Sulawesi","Sulawesi Tenggara"],["Wawo Muda","Sulawesi","Nusa Tenggara?"],
["Binaiya","Maluku","Pulau Seram, Maluku"],["Gamalama","Maluku","Ternate, Maluku Utara"],["Dukono","Maluku","Halmahera, Maluku Utara"],["Ibu","Maluku","Halmahera, Maluku Utara"],["Kie Besi","Maluku","Makian, Maluku Utara"],["Banda Api","Maluku","Kepulauan Banda, Maluku"],
["Puncak Jaya / Carstensz","Papua","Papua Tengah"],["Trikora","Papua","Papua Pegunungan"],["Mandala","Papua","Papua Pegunungan"],["Yamin","Papua","Papua Pegunungan"],["Cyclops","Papua","Papua"],["Arfak","Papua","Papua Barat"],["Wandammen","Papua","Papua Barat"],["Foja","Papua","Papua"],["Togwomeri","Papua","Papua Pegunungan"]
].map(([name,island,region])=>({id:"catalog-"+name.toLowerCase().replace(/[^a-z0-9]+/g,"-"),name:name.startsWith("Gunung ")?name:"Gunung "+name,island,region, catalogOnly:true}));
const allMountainCatalog = [...mountainRows, ...extraMountainCatalog.filter(x => !mountainRows.some(m => m.name.toLowerCase() === x.name.toLowerCase() || m.name.toLowerCase() === ("Gunung "+x.name).toLowerCase()))];
function renderMountainCatalog(){
 const list=$("mountainCatalogList"); if(!list) return;
 const query=($("mountainCatalogSearch")?.value||"").trim().toLocaleLowerCase("id-ID");
 const island=$("mountainIslandFilter")?.value||"";
 const rows=allMountainCatalog.filter(m=>(!island||m.island===island)&&(!query||`${m.name} ${m.region} ${m.island}`.toLocaleLowerCase("id-ID").includes(query))).sort((a,b)=>a.name.localeCompare(b.name,"id"));
 $("mountainCatalogCount").textContent=`${rows.length} gunung/pegunungan dalam katalog awal`;
 list.innerHTML=rows.map(m=>`<button type="button" class="mountain-catalog-item" data-mountain-id="${escapeHtml(m.id)}"><span class="mountain-catalog-name"><span class="mountain-catalog-emoji" aria-hidden="true">⛰️</span><span><b>${escapeHtml(m.name)}</b><small>${escapeHtml(m.region)} · ${escapeHtml(m.island)}</small></span></span><span class="mountain-catalog-arrow">${m.catalogOnly?"Lihat info":"Buka profil"} →</span></button>`).join("")||'<p class="map-note">Tidak ada hasil. Coba kata kunci lain.</p>';
 list.querySelectorAll("[data-mountain-id]").forEach(btn=>btn.addEventListener("click",()=>{
  const m=allMountainCatalog.find(x=>x.id===btn.dataset.mountainId); if(!m)return;
  const modal=$("mountainCatalogModal"); modal.classList.add("hidden");
  if(!m.catalogOnly){ showPage("peta"); setTimeout(()=>showMountainProfile(m.id,true),100); }
  else { showPage("peta"); const panel=$("mountainProfile"); if(!panel)return; panel.classList.remove("hidden"); panel.innerHTML=`<article class="card mountain-profile-card"><div class="mountain-profile-head"><div><span class="section-kicker">⛰️ PROFIL KATALOG GUNUNG</span><h2>${escapeHtml(m.name)}</h2><p>${escapeHtml(m.region)} · ${escapeHtml(m.island)}</p></div></div><div class="mountain-profile-grid"><div class="detail-item"><b>Ketinggian</b>Belum diverifikasi</div><div class="detail-item"><b>Koordinat</b>Belum diverifikasi</div><div class="detail-item"><b>Tipe / karakter</b>Perlu verifikasi dari sumber geologi atau pengelola</div><div class="detail-item"><b>Status aktivitas</b>Periksa MAGMA Indonesia jika gunung api</div><div class="detail-item"><b>Status jalur</b>Periksa pengelola kawasan atau basecamp</div><div class="detail-item"><b>Jalur dan basecamp</b>Belum ditambahkan ke basis data terverifikasi</div><div class="detail-item"><b>Jarak dan pos</b>Belum diverifikasi</div><div class="detail-item"><b>Musim dan kesulitan</b>Ikuti informasi pengelola dan prakiraan cuaca</div></div><div class="info-box">Nama dan wilayah ini tercatat dalam katalog awal. Detail teknis tidak ditampilkan sebagai fakta sampai sumber yang sesuai ditemukan dan diverifikasi.</div><p class="map-note">Status aktivitas gunung dan status pembukaan jalur adalah dua informasi berbeda.</p><div class="mountain-profile-actions"><button class="btn btn-soft" type="button" onclick="window.open('https://magma.esdm.go.id/','_blank','noopener')">Buka MAGMA Indonesia</button><button class="btn btn-soft" type="button" onclick="window.open('https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(${JSON.stringify(m.name+' '+m.region)}),'_blank','noopener')">Cari lokasi peta</button></div><button class="btn btn-soft" type="button" id="closeMountainProfile">Tutup profil</button></article>`; $("closeMountainProfile")?.addEventListener("click",()=>{panel.classList.add("hidden");panel.innerHTML="";}); }
 }));
}
const mountainModal=$("mountainCatalogModal");
$("mountainCatalogOpenList")?.addEventListener("click",()=>{mountainModal?.classList.remove("hidden");renderMountainCatalog();});
$("mountainCatalogButton")?.addEventListener("click",()=>{
  if(mountainMarkersVisible){
    setMountainMarkersVisible(false);
  } else {
    mountainSelectedOnly = false;
    renderMountainMarkers();
    setMountainMarkersVisible(true);
  }
});
$("mountainCatalogSearch")?.addEventListener("input",renderMountainCatalog);
$("mountainIslandFilter")?.addEventListener("change",renderMountainCatalog);
document.querySelectorAll("[data-close-mountain-catalog]").forEach(el=>el.addEventListener("click",()=>mountainModal?.classList.add("hidden")));
document.addEventListener("keydown",e=>{if(e.key==="Escape")mountainModal?.classList.add("hidden");});
// ==========================================
// INTEGRASI DATA BMKG OTOMATIS (NATURA-SAFE)
// ==========================================
function muatDataCuacaBMKG() {
  console.log("⏳ Memasukkan data ke dalam wadah asli bmkgCurrent...");
  
  fetch('bmkg-weather.json')
    .then(response => response.json())
    .then(payload => {
      // LANGSUNG MENEMBAK ID WADAH ASLI YANG SUDAH ADA DI HTML ANDA
      const wadahAsli = document.getElementById('bmkgCurrent');
      const infoBox = document.getElementById('bmkgStatus');
      
      if (!wadahAsli || payload.status !== "success") return;

      // Sembunyikan atau ubah teks infoBox bawaan agar rapi
      if (infoBox) {
        infoBox.innerHTML = `⏱️ Sinkronisasi Otomatis Terakhir: <b>${payload.last_updated}</b>`;
        infoBox.style.background = '#e8f5e9';
        infoBox.style.color = '#2e7d32';
        infoBox.style.borderLeft = '4px solid #2e7d32';
      }

      // Atur gaya wadah asli agar grid kartu terlihat rapi dan proporsional
      wadahAsli.style.display = 'grid';
      wadahAsli.style.gridTemplateColumns = 'repeat(auto-fit, minmax(220px, 1fr))';
      wadahAsli.style.gap = '15px';
      wadahAsli.style.marginTop = '15px';
      wadahAsli.style.width = '100%';

      let htmlKonten = '';

      // Ekstraksi data provinsi hasil skrip Python BMKG
      payload.data.forEach(wilayah => {
        const angkaSuhu = parseFloat(wilayah.suhu);
        let warnaStatus = "#4caf50", teksStatus = "Kondisi Aman";
        
        if (angkaSuhu >= 33) { 
          warnaStatus = "#f44336"; 
          teksStatus = "Risiko Tinggi"; 
        } else if (angkaSuhu >= 31) { 
          warnaStatus = "#ff9800"; 
          teksStatus = "Waspada Siaga"; 
        }

        htmlKonten += `
          <div style="border: 1px solid #e0e0e0; border-radius: 8px; padding: 15px; background: #fff; position:relative; box-shadow:0 4px 6px rgba(0,0,0,0.02); box-sizing:border-box;">
            <div style="position:absolute; top:0; left:0; width:100%; height:4px; background:${warnaStatus};"></div>
            <strong style="display:block; font-size:14px; color:#333; margin-top:5px; font-family:'Quicksand',sans-serif;">${wilayah.provinsi}</strong>
            <span style="color:#777; font-size:11px; display:block; margin-bottom:10px;">📍 ${wilayah.kota}</span>
            <div style="display:grid; grid-template-columns: 1fr; gap:4px; font-size:11px; color:#444;">
              <div>Suhu: <strong>${wilayah.suhu}°C</strong></div>
              <div>Kelembapan: <strong>${wilayah.kelembapan}%</strong></div>
              <div>Angin: <strong>${wilayah.kecepatan_angin} km/j</strong></div>
              <div>Cuaca: <strong>${wilayah.kondisi}</strong></div>
            </div>
            <div style="margin-top:10px; padding-top:6px; border-top:1px solid #f0f0f0; font-size:10px; font-weight:bold; color:${warnaStatus}; text-transform:uppercase; letter-spacing:0.5px;">
              ⚠️ STATUS: ${teksStatus}
            </div>
          </div>
        `;
      });

      wadahAsli.innerHTML = htmlKonten;
    })
    .catch(err => console.error("❌ Gagal memuat data otomatis BMKG:", err));
}

// Memicu fungsi ketika menu halaman "Data" diklik oleh user
document.addEventListener("click", (e) => {
  if (e.target && e.target.getAttribute("data-page") === "data") {
    setTimeout(muatDataCuacaBMKG, 300);
  }
});

// Jalankan otomatis sebagai cadangan jika halaman dimuat ulang langsung pada tab Data
setTimeout(muatDataCuacaBMKG, 1500);
