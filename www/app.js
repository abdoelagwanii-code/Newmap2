(function () {
'use strict';
const $ = s => document.querySelector(s);
const CAP = window.Capacitor;
const NATIVE = !!(CAP && CAP.isNativePlatform && CAP.isNativePlatform());
const PLG = n => (CAP && CAP.Plugins && CAP.Plugins[n]) || null;
const TYPES = {
  well: ['بئر', '💧'], tank: ['خزان', '🛢️'], pump: ['مضخة / محطة ضخ', '⚙️'], spring: ['نبع / عين', '🌊'],
  ro: ['محطة تحلية / معالجة', '🧪'], pipe: ['شبكة / وصلة', '🔧'], dam: ['سد / حفرة مياه', '🏞️'], other: ['أخرى', '📍']
};
const STATUS = { ok: 'يعمل', stopped: 'متوقف', dry: 'جاف', unknown: 'غير معروف' };
const SCAT = {
  pipe: ['خط أنابيب', '#0ea5e9'], canal: ['قناة / مجرى', '#14b8a6'], road: ['طريق / مسار', '#f59e0b'],
  bound: ['حدود موقع', '#a855f7'], area: ['منطقة خزانات / منشآت', '#ef4444'], other: ['أخرى', '#64748b']
};
const ATTRS = [['depth', 'fDepth', 'عمق البئر', 'م', 'depth_m'], ['yield', 'fYield', 'التصريف', 'م³/س', 'yield_m3h'],
  ['tds', 'fTds', 'الملوحة TDS', 'mg/L', 'tds_mgl'], ['swl', 'fSwl', 'المنسوب الساكن', 'م', 'swl_m']];

const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('تعذر الحفظ على الجهاز'); } };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; };
function toast(m, ms) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, ms || 2600); }

let points = load('fm_points', []);
let shapes = load('fm_shapes', []);
let coordMode = load('fm_cmode', 'dd');
const view = load('fm_view', { c: [24.4539, 54.3773], z: 7, l: 'osm' });
const utmStr = (lat, lng) => { const u = Geo.toUTM(lat, lng); return u.zone + u.hemi + '  E ' + Math.round(u.e) + '  N ' + Math.round(u.n); };

/* ---------- Photos (IndexedDB) ---------- */
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => { const r = indexedDB.open('fieldmap', 1); r.onupgradeneeded = () => r.result.createObjectStore('photos'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return dbp;
}
async function pget(id) {
  try { const d = await db(); return await new Promise((res, rej) => { const q = d.transaction('photos').objectStore('photos').get(id); q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); }); } catch (e) { return []; }
}
async function pset(id, arr) {
  try {
    const d = await db();
    await new Promise((res, rej) => { const tx = d.transaction('photos', 'readwrite'); if (arr.length) tx.objectStore('photos').put(arr, id); else tx.objectStore('photos').delete(id); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  } catch (e) { toast('تعذر حفظ الصور'); }
}
async function pall() {
  try {
    const d = await db(); const out = {};
    await new Promise((res, rej) => { const q = d.transaction('photos').objectStore('photos').openCursor(); q.onsuccess = () => { const c = q.result; if (c) { out[c.key] = c.value; c.continue(); } else res(); }; q.onerror = () => rej(q.error); });
    return out;
  } catch (e) { return {}; }
}
function shrink(url) {
  return new Promise(res => {
    const i = new Image();
    i.onload = () => { const s = Math.min(1, 1280 / Math.max(i.width, i.height)), c = document.createElement('canvas'); c.width = Math.round(i.width * s); c.height = Math.round(i.height * s); c.getContext('2d').drawImage(i, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.7)); };
    i.onerror = () => res(url); i.src = url;
  });
}
async function takePhoto(src) {
  const P = PLG('Camera');
  if (NATIVE && P) {
    try { const r = await P.getPhoto({ quality: 70, width: 1280, resultType: 'dataUrl', source: src }); return r && r.dataUrl ? await shrink(r.dataUrl) : null; }
    catch (e) { if (!/cancel/i.test(String((e && e.message) || e))) toast('تعذر فتح الكاميرا — تأكد من إذن الكاميرا', 3800); return null; }
  }
  return new Promise(res => {
    const inp = $('#photoIn');
    if (src === 'CAMERA') inp.setAttribute('capture', 'environment'); else inp.removeAttribute('capture');
    inp.onchange = () => { const f = inp.files[0]; inp.value = ''; if (!f) return res(null); const r = new FileReader(); r.onload = () => shrink(r.result).then(res); r.readAsDataURL(f); };
    inp.click();
  });
}

/* ---------- Map ---------- */
const LAYERS = {
  osm: { name: 'خريطة الشوارع (OSM)', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', opt: { maxZoom: 19, attribution: '© OpenStreetMap contributors' } },
  sat: { name: 'أقمار صناعية (Esri World Imagery)', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', opt: { maxZoom: 20, maxNativeZoom: 19, attribution: 'Tiles © Esri — Maxar, Earthstar Geographics, GIS User Community' } },
  topo: { name: 'طبوغرافية (Esri)', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', opt: { maxZoom: 20, maxNativeZoom: 19, attribution: 'Tiles © Esri' } }
};
const LABELS_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const map = L.map('map', { zoomControl: false, center: view.c, zoom: view.z, maxZoom: 20 });
L.control.zoom({ position: 'topright' }).addTo(map);
L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);
const bases = {}; let currentKey = LAYERS[view.l] ? view.l : 'osm';
Object.keys(LAYERS).forEach(k => { bases[LAYERS[k].name] = L.tileLayer(LAYERS[k].url, Object.assign({ key: k }, LAYERS[k].opt)); });
const labels = L.tileLayer(LABELS_URL, { maxZoom: 20, maxNativeZoom: 19, attribution: 'Labels © Esri' });
bases[LAYERS[currentKey].name].addTo(map);
L.control.layers(bases, { 'أسماء الأماكن فوق الصور': labels }, { position: 'topleft' }).addTo(map);
map.on('baselayerchange', e => { currentKey = e.layer.options.key; if (currentKey === 'sat' && !map.hasLayer(labels)) labels.addTo(map); });
function saveView() { const c = map.getCenter(); store('fm_view', { c: [c.lat, c.lng], z: map.getZoom(), l: currentKey }); }
function showCenter() { const c = map.getCenter(); $('#coords').textContent = coordMode === 'utm' ? utmStr(c.lat, c.lng) : c.lat.toFixed(6) + ', ' + c.lng.toFixed(6); }
map.on('move', showCenter); map.on('moveend', saveView); showCenter();
$('#topbar').onclick = () => { coordMode = coordMode === 'utm' ? 'dd' : 'utm'; store('fm_cmode', coordMode); showCenter(); };

/* ---------- Points ---------- */
const group = L.layerGroup().addTo(map);
const markers = {};
function icon(p) { return L.divIcon({ className: '', html: '<div class="pin st-' + esc(p.status) + '"><span>' + (TYPES[p.type] ? TYPES[p.type][1] : '📍') + '</span></div>', iconSize: [34, 34], iconAnchor: [17, 34], popupAnchor: [0, -32] }); }
function attrLines(p) {
  const a = p.a || {}; const parts = [];
  ATTRS.forEach(x => { if (a[x[0]] != null && a[x[0]] !== '') parts.push(x[2] + ': ' + a[x[0]] + ' ' + x[3]); });
  return parts;
}
function popupHtml(p) {
  const t = TYPES[p.type] ? TYPES[p.type][0] : 'أخرى';
  return '<div class="pop"><b>' + esc(p.name || 'بدون اسم') + '</b>' +
    '<div>' + esc(t) + ' • ' + esc(STATUS[p.status] || '') + '</div>' +
    '<div dir="ltr" style="text-align:right">' + p.lat.toFixed(6) + ', ' + p.lng.toFixed(6) + (p.acc ? ' (±' + Math.round(p.acc) + 'm)' : '') + '</div>' +
    '<div dir="ltr" style="text-align:right">UTM ' + esc(utmStr(p.lat, p.lng)) + '</div>' +
    attrLines(p).map(l => '<div>' + esc(l) + '</div>').join('') +
    (p.notes ? '<div>' + esc(p.notes) + '</div>' : '') +
    '<div id="pp-' + p.id + '"></div>' +
    '<div class="a"><button data-act="edit" data-id="' + p.id + '">تعديل</button>' +
    '<a target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=' + p.lat + ',' + p.lng + '">توجيه</a></div></div>';
}
function render() {
  group.clearLayers(); Object.keys(markers).forEach(k => delete markers[k]);
  points.forEach(p => { markers[p.id] = L.marker([p.lat, p.lng], { icon: icon(p) }).bindPopup(popupHtml(p)).addTo(group); });
  $('#count').textContent = points.length + shapes.length;
  renderList();
}

/* ---------- Shapes ---------- */
const sgroup = L.layerGroup().addTo(map); const slayers = {};
const fmtLen = m => m >= 1000 ? (m / 1000).toFixed(2) + ' كم' : m.toFixed(1) + ' م';
const fmtArea = a => a >= 10000 ? (a / 10000).toFixed(2) + ' هكتار (' + Math.round(a).toLocaleString('en') + ' م²)' : a.toFixed(1) + ' م²';
function statsHtml(kind, c) {
  if (kind === 'poly') return 'المحيط: <b>' + fmtLen(Geo.length(c, true)) + '</b><br>المساحة: <b>' + fmtArea(Geo.area(c)) + '</b><br>عدد الرؤوس: ' + c.length;
  return 'الطول: <b>' + fmtLen(Geo.length(c, false)) + '</b><br>عدد الرؤوس: ' + c.length;
}
function shapePopup(s) {
  return '<div class="pop"><b>' + esc(s.name || (s.kind === 'poly' ? 'مضلع' : 'خط')) + '</b><div>' + esc((SCAT[s.cat] || SCAT.other)[0]) + '</div><div>' + statsHtml(s.kind, s.coords) + '</div>' +
    (s.notes ? '<div>' + esc(s.notes) + '</div>' : '') + '<div class="a"><button data-sact="edit" data-id="' + s.id + '">تعديل</button></div></div>';
}
function renderShapes() {
  sgroup.clearLayers(); Object.keys(slayers).forEach(k => delete slayers[k]);
  shapes.forEach(s => {
    const col = (SCAT[s.cat] || SCAT.other)[1];
    const l = s.kind === 'poly' ? L.polygon(s.coords, { color: col, weight: 3, fillOpacity: 0.2 }) : L.polyline(s.coords, { color: col, weight: 4 });
    l.bindPopup(shapePopup(s)).addTo(sgroup); slayers[s.id] = l;
  });
  $('#count').textContent = points.length + shapes.length;
}
map.on('popupopen', e => {
  const el = e.popup.getElement();
  el.querySelectorAll('[data-act="edit"]').forEach(b => {
    b.onclick = () => { map.closePopup(); openForm(points.find(p => p.id === b.dataset.id)); };
    pget(b.dataset.id).then(ph => { const box = el.querySelector('#pp-' + b.dataset.id); if (box && ph.length) { box.innerHTML = '<img class="ph" src="' + ph[0] + '"><div style="font-size:11px;color:#667">' + ph.length + ' صورة</div>'; box.onclick = () => showImg(ph[0]); } });
  });
  el.querySelectorAll('[data-sact="edit"]').forEach(b => b.onclick = () => { map.closePopup(); openShapeForm(shapes.find(s => s.id === b.dataset.id)); });
});

/* ---------- List ---------- */
function renderList() {
  const q = ($('#search').value || '').trim().toLowerCase();
  const box = $('#items'); box.innerHTML = '';
  const pl = points.filter(p => !q || (p.name || '').toLowerCase().includes(q)).slice().reverse();
  const sl = shapes.filter(s => !q || (s.name || '').toLowerCase().includes(q)).slice().reverse();
  if (!pl.length && !sl.length) { box.innerHTML = '<div class="it"><div class="t"><small>لا توجد عناصر. استخدم ＋ لإضافة نقطة، أو أدوات الرسم من "المزيد".</small></div></div>'; return; }
  pl.forEach(p => {
    const d = document.createElement('div'); d.className = 'it';
    d.innerHTML = '<div class="e">' + (TYPES[p.type] ? TYPES[p.type][1] : '📍') + '</div><div class="t"><b>' + esc(p.name || 'بدون اسم') + '</b><small>' + esc((TYPES[p.type] || ['أخرى'])[0]) + ' • ' + esc(STATUS[p.status] || '') + '</small></div>';
    d.onclick = () => { $('#sheetList').hidden = true; map.setView([p.lat, p.lng], Math.max(map.getZoom(), 17)); markers[p.id] && markers[p.id].openPopup(); };
    box.appendChild(d);
  });
  sl.forEach(s => {
    const d = document.createElement('div'); d.className = 'it';
    d.innerHTML = '<div class="e">' + (s.kind === 'poly' ? '⬠' : '📏') + '</div><div class="t"><b>' + esc(s.name || (s.kind === 'poly' ? 'مضلع' : 'خط')) + '</b><small>' + esc((SCAT[s.cat] || SCAT.other)[0]) + ' • ' + (s.kind === 'poly' ? fmtArea(Geo.area(s.coords)) : fmtLen(Geo.length(s.coords))) + '</small></div>';
    d.onclick = () => { $('#sheetList').hidden = true; map.fitBounds(L.latLngBounds(s.coords), { maxZoom: 18, padding: [30, 30] }); slayers[s.id] && slayers[s.id].openPopup(); };
    box.appendChild(d);
  });
}
$('#search').oninput = renderList;

/* ---------- Point form ---------- */
let editing = null, formId = null, formPhotos = [];
Object.keys(TYPES).forEach(k => $('#fType').insertAdjacentHTML('beforeend', '<option value="' + k + '">' + TYPES[k][1] + ' ' + TYPES[k][0] + '</option>'));
Object.keys(STATUS).forEach(k => $('#fStatus').insertAdjacentHTML('beforeend', '<option value="' + k + '">' + STATUS[k] + '</option>'));
function syncUTM() {
  const lat = num($('#fLat').value), lng = num($('#fLng').value);
  if (lat == null || lng == null || Math.abs(lat) > 84 || Math.abs(lng) > 180) return;
  const u = Geo.toUTM(lat, lng); $('#fZone').value = u.zone; $('#fHemi').value = u.hemi; $('#fE').value = u.e.toFixed(1); $('#fN').value = u.n.toFixed(1);
}
function syncLL() {
  const z = parseInt($('#fZone').value, 10), E = num($('#fE').value), N = num($('#fN').value);
  if (!(z >= 1 && z <= 60) || E == null || N == null) return;
  const r = Geo.fromUTM(z, $('#fHemi').value, E, N);
  if (isFinite(r.lat) && isFinite(r.lng)) { $('#fLat').value = r.lat.toFixed(6); $('#fLng').value = r.lng.toFixed(6); }
}
['fLat', 'fLng'].forEach(i => $('#' + i).addEventListener('input', syncUTM));
['fZone', 'fHemi', 'fE', 'fN'].forEach(i => $('#' + i).addEventListener('input', syncLL));
function renderThumbs() {
  const box = $('#thumbs'); box.innerHTML = '';
  formPhotos.forEach((src, i) => {
    const d = document.createElement('div'); d.className = 'th'; d.innerHTML = '<img src="' + src + '"><i>✕</i>';
    d.querySelector('img').onclick = () => showImg(src);
    d.querySelector('i').onclick = () => { formPhotos.splice(i, 1); renderThumbs(); };
    box.appendChild(d);
  });
}
function showImg(src) { $('#viewImg').src = src; $('#viewer').hidden = false; }
$('#viewClose').onclick = () => $('#viewer').hidden = true;
$('#phCam').onclick = async () => { const s = await takePhoto('CAMERA'); if (s) { formPhotos.push(s); renderThumbs(); } };
$('#phGal').onclick = async () => { const s = await takePhoto('PHOTOS'); if (s) { formPhotos.push(s); renderThumbs(); } };
async function openForm(p, lat, lng, acc) {
  editing = p || null; formId = p ? p.id : newId();
  $('#mTitle').textContent = p ? 'تعديل النقطة' : 'نقطة جديدة';
  $('#fName').value = p ? p.name : '';
  $('#fType').value = p ? p.type : load('fm_lastType', 'well');
  $('#fStatus').value = p ? p.status : 'unknown';
  $('#fLat').value = p ? p.lat : lat.toFixed(6);
  $('#fLng').value = p ? p.lng : lng.toFixed(6);
  syncUTM();
  const a = (p && p.a) || {}; ATTRS.forEach(x => $('#' + x[1]).value = a[x[0]] != null ? a[x[0]] : '');
  $('#fNotes').value = p ? p.notes : '';
  $('#fDel').hidden = !p;
  $('#modal').dataset.acc = p ? (p.acc || '') : (acc || '');
  formPhotos = p ? await pget(p.id) : []; renderThumbs();
  $('#modal').hidden = false;
}
$('#fCancel').onclick = () => $('#modal').hidden = true;
$('#fSave').onclick = async () => {
  const lat = num($('#fLat').value), lng = num($('#fLng').value);
  if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) { toast('الإحداثيات غير صحيحة'); return; }
  const a = {}; ATTRS.forEach(x => { const v = num($('#' + x[1]).value); if (v != null) a[x[0]] = v; });
  const data = { name: $('#fName').value.trim(), type: $('#fType').value, status: $('#fStatus').value, notes: $('#fNotes').value.trim(), lat, lng, a };
  store('fm_lastType', data.type);
  if (editing) Object.assign(editing, data);
  else points.push(Object.assign({ id: formId, acc: num($('#modal').dataset.acc), time: new Date().toISOString() }, data));
  await pset(formId, formPhotos);
  store('fm_points', points); render(); $('#modal').hidden = true; toast('تم الحفظ');
};
$('#fDel').onclick = async () => {
  if (!editing || !confirm('حذف هذه النقطة؟')) return;
  points = points.filter(p => p !== editing); await pset(editing.id, []); store('fm_points', points); render(); $('#modal').hidden = true;
};
$('#btnAdd').onclick = () => { const c = map.getCenter(); openForm(null, c.lat, c.lng); };

/* ---------- Shape form ---------- */
Object.keys(SCAT).forEach(k => $('#sCat').insertAdjacentHTML('beforeend', '<option value="' + k + '">' + SCAT[k][0] + '</option>'));
let editingShape = null, pendingShape = null;
function openShapeForm(s, pend) {
  editingShape = s || null; pendingShape = pend || null; const src = s || pend;
  $('#sTitle').textContent = (src.kind === 'poly' ? 'مضلع' : 'خط') + (s ? ' — تعديل' : ' جديد');
  $('#sName').value = s ? s.name : ''; $('#sCat').value = s ? s.cat : (src.kind === 'poly' ? 'bound' : 'pipe');
  $('#sNotes').value = s ? s.notes : ''; $('#sStats').innerHTML = statsHtml(src.kind, src.coords);
  $('#sDel').hidden = !s; $('#mShape').hidden = false;
}
$('#sCancel').onclick = () => $('#mShape').hidden = true;
$('#sSave').onclick = () => {
  const d = { name: $('#sName').value.trim(), cat: $('#sCat').value, notes: $('#sNotes').value.trim() };
  if (editingShape) Object.assign(editingShape, d); else shapes.push(Object.assign({ id: newId(), kind: pendingShape.kind, coords: pendingShape.coords, time: new Date().toISOString() }, d));
  store('fm_shapes', shapes); renderShapes(); renderList(); $('#mShape').hidden = true; toast('تم الحفظ');
};
$('#sDel').onclick = () => { if (!editingShape || !confirm('حذف هذا العنصر؟')) return; shapes = shapes.filter(s => s !== editingShape); store('fm_shapes', shapes); renderShapes(); renderList(); $('#mShape').hidden = true; };

/* ---------- Drawing ---------- */
let draw = null;
function startDraw(kind) {
  $('#sheetMore').hidden = true; $('#sheetList').hidden = true; map.closePopup();
  draw = { kind, coords: [], layer: (kind === 'poly' ? L.polygon([], { color: '#e11d48', weight: 3, fillOpacity: .15, dashArray: '6 4' }) : L.polyline([], { color: '#e11d48', weight: 4, dashArray: '6 4' })).addTo(map), dots: L.layerGroup().addTo(map) };
  $('#drawbar').hidden = false; $('#btnAdd').disabled = true; updateDraw();
  toast('اضغط على الخريطة لإضافة رأس، أو استخدم ＋ المركز / ＋ موقعي', 3500);
}
function updateDraw() {
  if (!draw) return;
  draw.layer.setLatLngs(draw.coords); draw.dots.clearLayers();
  draw.coords.forEach((c, i) => L.circleMarker(c, { radius: i === draw.coords.length - 1 ? 7 : 5, color: '#fff', weight: 2, fillColor: '#e11d48', fillOpacity: 1, interactive: false }).addTo(draw.dots));
  const n = draw.coords.length;
  $('#drawstat').innerHTML = n < 2 ? 'رؤوس: ' + n + ' — أضف رأسين على الأقل' : (draw.kind === 'poly' ? 'محيط ' + fmtLen(Geo.length(draw.coords, true)) + ' • مساحة ' + fmtArea(Geo.area(draw.coords)) : 'الطول ' + fmtLen(Geo.length(draw.coords)) + ' • رؤوس ' + n);
}
function endDraw() { if (!draw) return; map.removeLayer(draw.layer); map.removeLayer(draw.dots); draw = null; $('#drawbar').hidden = true; $('#btnAdd').disabled = false; }
map.on('click', e => { if (draw) { draw.coords.push([e.latlng.lat, e.latlng.lng]); updateDraw(); } });
$('#dUndo').onclick = () => { if (draw) { draw.coords.pop(); updateDraw(); } };
$('#dCenter').onclick = () => { if (draw) { const c = map.getCenter(); draw.coords.push([c.lat, c.lng]); updateDraw(); } };
$('#dGps').onclick = () => { if (!draw) return; if (!me) { toast('لا توجد إشارة GPS بعد'); startGPS(false); return; } draw.coords.push([me.lat, me.lng]); updateDraw(); };
$('#dCancel').onclick = () => { if (!draw || !draw.coords.length || confirm('إلغاء الرسم؟')) endDraw(); };
$('#dDone').onclick = () => {
  if (!draw) return; const min = draw.kind === 'poly' ? 3 : 2;
  if (draw.coords.length < min) { toast('تحتاج ' + min + ' رؤوس على الأقل'); return; }
  const pend = { kind: draw.kind, coords: draw.coords.slice() }; endDraw(); openShapeForm(null, pend);
};
$('#drLine').onclick = () => startDraw('line');
$('#drPoly').onclick = () => startDraw('poly');

/* ---------- GPS & permissions ---------- */
let me = null, meMarker = null, meCircle = null, watchId = null, centerOnFix = false;
async function ensureLocationPerm() {
  const G = PLG('Geolocation');
  if (!NATIVE || !G) return true;
  try {
    let s = await G.checkPermissions();
    if (s.location !== 'granted' && s.coarseLocation !== 'granted') s = await G.requestPermissions({ permissions: ['location'] });
    const ok = s.location === 'granted' || s.coarseLocation === 'granted';
    if (!ok) toast('إذن الموقع مرفوض — افتح إعدادات الجهاز ← التطبيقات ← خريطة الميدان ← الأذونات ← الموقع ← السماح', 6000);
    return ok;
  } catch (e) { return true; }
}
async function startGPS(center) {
  if (center) centerOnFix = true;
  if (watchId != null) { if (center && me) { map.setView([me.lat, me.lng], Math.max(map.getZoom(), 17)); centerOnFix = false; } return; }
  if (!navigator.geolocation) { toast('الجهاز لا يدعم تحديد الموقع'); return; }
  if (!(await ensureLocationPerm())) return;
  watchId = navigator.geolocation.watchPosition(onPos, err => {
    if (err.code === 1) { watchId = null; toast('إذن الموقع مرفوض — فعّله من إعدادات التطبيق', 5000); }
    else if (err.code === 2) toast('الموقع غير متاح — فعّل GPS من إعدادات الجهاز', 4000);
    else toast('لم تصل إشارة GPS بعد — اخرج لمكان مكشوف', 3500);
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
}
function onPos(pos) {
  const c = pos.coords; me = { lat: c.latitude, lng: c.longitude, acc: c.accuracy };
  if (!meMarker) {
    meMarker = L.marker([me.lat, me.lng], { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false, zIndexOffset: 1000 }).addTo(map);
    meCircle = L.circle([me.lat, me.lng], { radius: me.acc, weight: 1, color: '#2563eb', fillOpacity: .12, interactive: false }).addTo(map);
  } else { meMarker.setLatLng([me.lat, me.lng]); meCircle.setLatLng([me.lat, me.lng]).setRadius(me.acc); }
  $('#gpsinfo').textContent = 'GPS ±' + Math.round(me.acc) + ' م';
  if (centerOnFix) { centerOnFix = false; map.setView([me.lat, me.lng], Math.max(map.getZoom(), 17)); }
}
$('#btnLoc').onclick = () => { toast('جاري تحديد الموقع…', 1500); startGPS(true); };
$('#btnAddGps').onclick = () => {
  if (!me) { toast('جاري تحديد الموقع… اضغط مرة أخرى بعد ظهور النقطة الزرقاء'); startGPS(true); return; }
  openForm(null, me.lat, me.lng, me.acc);
};
$('#perm').onclick = async () => {
  const msg = [];
  const okLoc = await ensureLocationPerm(); msg.push('الموقع: ' + (okLoc ? 'مسموح ✓' : 'مرفوض ✗'));
  const C = PLG('Camera');
  if (NATIVE && C) { try { let s = await C.checkPermissions(); if (s.camera !== 'granted') s = await C.requestPermissions({ permissions: ['camera'] }); msg.push('الكاميرا: ' + (s.camera === 'granted' ? 'مسموح ✓' : 'مرفوض ✗')); } catch (e) { msg.push('الكاميرا: تعذر الفحص'); } }
  toast(msg.join(' | '), 5000);
  if (okLoc) startGPS(false);
};

/* ---------- Sheets ---------- */
$('#btnList').onclick = () => { $('#sheetMore').hidden = true; $('#sheetList').hidden = !$('#sheetList').hidden; renderList(); };
$('#btnMore').onclick = () => { $('#sheetList').hidden = true; $('#sheetMore').hidden = !$('#sheetMore').hidden; };
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => $('#' + b.dataset.close).hidden = true);

/* ---------- Export / Import ---------- */
async function saveFile(name, text, mime) {
  try {
    const F = PLG('Filesystem'), S = PLG('Share');
    if (NATIVE && F && S) {
      const r = await F.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
      await S.share({ title: name, url: r.uri, dialogTitle: 'حفظ أو مشاركة الملف' }); return;
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { toast('تعذر تصدير الملف: ' + ((e && e.message) || e), 4500); }
}
const stamp = () => new Date().toISOString().slice(0, 10);
function needData() { if (!points.length && !shapes.length) { toast('لا توجد بيانات للتصدير'); return false; } return true; }
function pointProps(p) { const a = p.a || {}, pr = { kind: 'point', id: p.id, name: p.name, type: p.type, status: p.status, notes: p.notes, accuracy_m: p.acc, time: p.time, utm: utmStr(p.lat, p.lng) }; ATTRS.forEach(x => pr[x[4]] = a[x[0]] != null ? a[x[0]] : null); return pr; }
$('#exGeo').onclick = () => {
  if (!needData()) return;
  const f = points.map(p => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: pointProps(p) }));
  shapes.forEach(s => {
    const ring = s.coords.map(c => [c[1], c[0]]);
    if (s.kind === 'poly') ring.push(ring[0]);
    f.push({ type: 'Feature', geometry: s.kind === 'poly' ? { type: 'Polygon', coordinates: [ring] } : { type: 'LineString', coordinates: ring },
      properties: { kind: s.kind, id: s.id, name: s.name, category: s.cat, notes: s.notes, time: s.time, length_m: Math.round(Geo.length(s.coords, s.kind === 'poly') * 10) / 10, area_m2: s.kind === 'poly' ? Math.round(Geo.area(s.coords)) : null } });
  });
  saveFile('survey-' + stamp() + '.geojson', JSON.stringify({ type: 'FeatureCollection', features: f }, null, 2), 'application/geo+json');
};
$('#exCsv').onclick = () => {
  if (!needData()) return;
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const head = ['kind', 'id', 'name', 'type', 'status', 'lat', 'lng', 'utm', 'accuracy_m', 'depth_m', 'yield_m3h', 'tds_mgl', 'swl_m', 'length_m', 'area_m2', 'wkt', 'notes', 'time'];
  const rows = [head.join(',')];
  points.forEach(p => { const a = p.a || {}; rows.push([ 'نقطة', p.id, p.name, (TYPES[p.type] || ['أخرى'])[0], STATUS[p.status], p.lat, p.lng, utmStr(p.lat, p.lng), p.acc, a.depth, a.yield, a.tds, a.swl, '', '', 'POINT(' + p.lng + ' ' + p.lat + ')', p.notes, p.time].map(q).join(',')); });
  shapes.forEach(s => {
    const pts = s.coords.map(c => c[1] + ' ' + c[0]); const wkt = s.kind === 'poly' ? 'POLYGON((' + pts.concat(pts[0]).join(', ') + '))' : 'LINESTRING(' + pts.join(', ') + ')';
    rows.push([s.kind === 'poly' ? 'مضلع' : 'خط', s.id, s.name, (SCAT[s.cat] || SCAT.other)[0], '', '', '', '', '', '', '', '', '', Math.round(Geo.length(s.coords, s.kind === 'poly') * 10) / 10, s.kind === 'poly' ? Math.round(Geo.area(s.coords)) : '', wkt, s.notes, s.time].map(q).join(','));
  });
  saveFile('survey-' + stamp() + '.csv', '\ufeff' + rows.join('\r\n'), 'text/csv');
};
$('#exKml').onclick = () => {
  if (!needData()) return;
  const x = esc;
  let k = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Survey</name>\n';
  points.forEach(p => { const d = [(TYPES[p.type] || ['أخرى'])[0], STATUS[p.status]].concat(attrLines(p)).concat(p.notes ? [p.notes] : []).join(' | '); k += '<Placemark><name>' + x(p.name) + '</name><description>' + x(d) + '</description><Point><coordinates>' + p.lng + ',' + p.lat + ',0</coordinates></Point></Placemark>\n'; });
  shapes.forEach(s => {
    const co = s.coords.map(c => c[1] + ',' + c[0] + ',0'); const d = (SCAT[s.cat] || SCAT.other)[0] + ' | ' + (s.kind === 'poly' ? fmtArea(Geo.area(s.coords)) : fmtLen(Geo.length(s.coords))) + (s.notes ? ' | ' + s.notes : '');
    k += '<Placemark><name>' + x(s.name) + '</name><description>' + x(d) + '</description>' + (s.kind === 'poly' ? '<Polygon><outerBoundaryIs><LinearRing><coordinates>' + co.concat(co[0]).join(' ') + '</coordinates></LinearRing></outerBoundaryIs></Polygon>' : '<LineString><coordinates>' + co.join(' ') + '</coordinates></LineString>') + '</Placemark>\n';
  });
  saveFile('survey-' + stamp() + '.kml', k + '</Document></kml>', 'application/vnd.google-earth.kml+xml');
};
$('#imp').onclick = () => $('#file').click();
$('#file').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const gj = JSON.parse(r.result); let n = 0;
      (gj.features || []).forEach(ft => {
        const g = ft.geometry, pr = ft.properties || {}; if (!g) return;
        if (g.type === 'Point') {
          const a = {}; ATTRS.forEach(x => { if (pr[x[4]] != null) a[x[0]] = pr[x[4]]; });
          points.push({ id: newId(), name: pr.name || '', type: TYPES[pr.type] ? pr.type : 'other', status: STATUS[pr.status] ? pr.status : 'unknown', notes: pr.notes || '', lat: g.coordinates[1], lng: g.coordinates[0], acc: pr.accuracy_m || null, time: pr.time || new Date().toISOString(), a }); n++;
        } else if (g.type === 'LineString' || g.type === 'Polygon') {
          let c = (g.type === 'Polygon' ? g.coordinates[0] : g.coordinates).map(v => [v[1], v[0]]);
          if (g.type === 'Polygon' && c.length > 1) c = c.slice(0, -1);
          shapes.push({ id: newId(), kind: g.type === 'Polygon' ? 'poly' : 'line', name: pr.name || '', cat: SCAT[pr.category] ? pr.category : 'other', notes: pr.notes || '', coords: c, time: pr.time || new Date().toISOString() }); n++;
        }
      });
      store('fm_points', points); store('fm_shapes', shapes); render(); renderShapes(); toast('تم استيراد ' + n + ' عنصر');
    } catch (err) { toast('ملف غير صالح'); }
    e.target.value = '';
  };
  r.readAsText(f);
};
$('#bkp').onclick = async () => {
  if (!needData()) return;
  saveFile('backup-' + stamp() + '.json', JSON.stringify({ fm_backup: 1, points, shapes, photos: await pall() }), 'application/json');
};
$('#rst').onclick = () => $('#fileBk').click();
$('#fileBk').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = async () => {
    try {
      const b = JSON.parse(r.result); if (!b.fm_backup) { toast('هذا ليس ملف نسخة احتياطية'); return; }
      const ids = new Set(points.map(p => p.id)), sids = new Set(shapes.map(s => s.id)); let n = 0;
      (b.points || []).forEach(p => { if (!ids.has(p.id)) { points.push(p); n++; } });
      (b.shapes || []).forEach(s => { if (!sids.has(s.id)) { shapes.push(s); n++; } });
      for (const id of Object.keys(b.photos || {})) await pset(id, b.photos[id]);
      store('fm_points', points); store('fm_shapes', shapes); render(); renderShapes(); toast('تمت استعادة ' + n + ' عنصر');
    } catch (err) { toast('ملف غير صالح'); }
    e.target.value = '';
  };
  r.readAsText(f);
};
$('#clearAll').onclick = async () => {
  if ((points.length || shapes.length) && confirm('حذف كل النقاط والخطوط والصور نهائياً؟ (خذ نسخة احتياطية أولاً)')) {
    for (const p of points) await pset(p.id, []);
    points = []; shapes = []; store('fm_points', points); store('fm_shapes', shapes); render(); renderShapes();
  }
};

/* ---------- Offline tiles ---------- */
const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * Math.pow(2, z));
const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z)); };
$('#offArea').onclick = async () => {
  if (!navigator.serviceWorker || !navigator.serviceWorker.controller) { toast('أعد فتح التطبيق مرة واحدة ثم حاول مجدداً'); return; }
  const L0 = LAYERS[currentKey], b = map.getBounds(), z0 = Math.round(map.getZoom()), maxZ = L0.opt.maxNativeZoom || L0.opt.maxZoom, urls = [];
  for (let z = z0; z <= Math.min(z0 + 2, maxZ); z++) {
    const x1 = lon2x(b.getWest(), z), x2 = lon2x(b.getEast(), z), y1 = lat2y(b.getNorth(), z), y2 = lat2y(b.getSouth(), z);
    for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) urls.push(L0.url.replace('{z}', z).replace('{x}', x).replace('{y}', y));
  }
  if (urls.length > 500) { toast('المنطقة كبيرة (' + urls.length + ' مربع). قرّب الخريطة على منطقة أصغر.', 4000); return; }
  if (!confirm('سيتم حفظ ' + urls.length + ' مربع خريطة من "' + L0.name + '" للعمل بدون إنترنت. متابعة؟')) return;
  $('#sheetMore').hidden = true; let done = 0, i = 0;
  const worker = async () => { while (i < urls.length) { const u = urls[i++]; try { await fetch(u, { mode: 'no-cors' }); } catch (e) {} done++; if (done % 10 === 0) toast('جاري الحفظ… ' + done + '/' + urls.length, 1500); } };
  await Promise.all([worker(), worker(), worker(), worker()]);
  toast('تم حفظ المنطقة (' + urls.length + ' مربع)', 3500);
};
$('#offClear').onclick = async () => { if (window.caches) { await caches.delete('tiles-v1'); toast('تم مسح الخرائط المحفوظة'); } };

/* ---------- Boot ---------- */
render(); renderShapes();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (NATIVE) setTimeout(() => { ensureLocationPerm().then(ok => { if (ok) startGPS(false); }); }, 700);
})();
