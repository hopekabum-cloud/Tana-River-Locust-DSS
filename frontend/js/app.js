"use strict";
// Tana River Desert Locust Risk DSS - front end. All numbers come from the Flask API.

const S = { meta: null, stats: null, env: null, model: null, importance: null, year: null,
            maps: {}, layers: {}, charts: {}, riskLayer: "classes", riskOn: true, opacity: 0.8, envKey: null };

// ------------------------------------------------------------------ helpers
async function api(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} returned ${r.status}`);
  return r.json();
}
const $ = (id) => document.getElementById(id);
const fmt = (x, d = 1) => (x === null || x === undefined || Number.isNaN(x) ? "–" : Number(x).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }));
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === "style") Object.assign(e.style, v); else e[k] = v; }
  kids.flat().forEach((k) => e.append(k instanceof Node ? k : document.createTextNode(String(k))));
  return e;
}
const yearStats = () => S.stats.by_year[String(S.year)];
const bounds = () => [[S.meta.bounds.south, S.meta.bounds.west], [S.meta.bounds.north, S.meta.bounds.east]];

// ------------------------------------------------------------------ maps
function baseLayers() {
  return {
    "Light": L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { maxZoom: 18, attribution: "&copy; OpenStreetMap &copy; CARTO" }),
    "OpenStreetMap": L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "&copy; OpenStreetMap contributors" }),
    "Satellite": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 18, attribution: "Imagery &copy; Esri" }),
  };
}

function makeMap(id, opts = {}) {
  const map = L.map(id, { zoomControl: true });
  const bases = baseLayers();
  bases.Light.addTo(map);
  const boundary = L.geoJSON(S.boundary, { style: { color: "#111", weight: 2.5, fill: false }, interactive: false });
  const overlay = L.imageOverlay("", bounds(), { opacity: S.opacity, interactive: false });
  map.createPane("boundaryPane").style.zIndex = 450;
  boundary.options.pane = "boundaryPane";
  boundary.addTo(map);
  overlay.addTo(map);
  const overlays = { "Basin boundary": boundary };
  if (opts.riskToggle) overlays["Risk layer"] = overlay;
  L.control.layers(bases, overlays, { position: "topright" }).addTo(map);
  L.control.scale({ imperial: false }).addTo(map);
  map.fitBounds(boundary.getBounds(), { padding: [12, 12] });
  if (opts.title) {
    const t = L.control({ position: "topleft" });
    t.onAdd = () => { const d = L.DomUtil.create("div", "map-title"); d.id = `${id}-title`; return d; };
    t.addTo(map);
  }
  const legend = L.control({ position: "bottomright" });
  legend.onAdd = () => { const d = L.DomUtil.create("div", "legend"); d.id = `${id}-legend`; return d; };
  legend.addTo(map);
  if (opts.click) map.on("click", (e) => pointPopup(map, e.latlng));
  S.maps[id] = map;
  S.layers[id] = { overlay, boundary };
  return map;
}

function riskLegend(target, onlyHigh = false) {
  const box = $(target);
  if (!box) return;
  box.innerHTML = "";
  if (S.riskLayer === "score" && !onlyHigh) {
    box.append(el("b", {}, "Ensemble suitability score"),
      el("div", { className: "gradient", style: { background: "linear-gradient(to right,#1a9641,#a6d96a,#ffffbf,#fdae61,#d7191c)" } }),
      el("div", { className: "grad-labels" }, el("span", {}, "0 (low)"), el("span", {}, `${fmt(S.meta.score_max, 2)}+ (high)`)));
    return;
  }
  box.append(el("b", {}, "Relative risk class"));
  [...S.meta.classes].reverse().forEach((c) => {
    if (onlyHigh && c.code < 4) return;
    box.append(el("div", {}, el("span", { className: "sw", style: { background: c.colour } }), c.name));
  });
  box.append(el("div", {}, el("span", { className: "sw", style: { background: "transparent", borderColor: "#111", borderWidth: "2px" } }), "Basin boundary"));
  box.append(el("div", { className: "small" }, "Relative suitability, not a forecast."));
}

function updateRiskOverlay(id, layer) {
  const L_ = S.layers[id];
  if (!L_) return;
  L_.overlay.setUrl(`/api/risk/${S.year}/${layer}.png`);
  L_.overlay.setOpacity(id === "main-map" && !S.riskOn ? 0 : S.opacity);
  const t = $(`${id}-title`);
  if (t) t.textContent = layer === "score" ? `Suitability score, ${S.year}` : `Relative desert locust risk, ${S.year}`;
}

async function pointPopup(map, latlng) {
  const popup = L.popup({ maxWidth: 320 }).setLatLng(latlng).setContent("Reading…").openOn(map);
  try {
    const d = await api(`/api/point?year=${S.year}&lat=${latlng.lat}&lng=${latlng.lng}`);
    const box = el("div");
    if (!d.inside) { box.append(d.message); popup.setContent(box); return; }
    box.append(el("div", { style: { fontWeight: "700", marginBottom: "4px" } }, el("span", { className: "sw", style: { background: d.colour } }), `${d.year}: ${d.class_name}`),
      el("div", {}, `Ensemble score: ${d.score ?? "–"}`),
      el("div", { className: "small" }, d.guidance));
    const rows = Object.entries(d.environment || {}).map(([k, v]) => {
      const meta = S.env.variables.find((x) => x.key === k);
      return el("tr", {}, el("td", {}, meta ? meta.label : k), el("td", { className: "num" }, typeof v === "number" ? `${fmt(v, 3)} ${meta && meta.unit !== "class" ? meta.unit : ""}` : v));
    });
    if (rows.length) box.append(el("table", { style: { marginTop: "6px", fontSize: "12px" } }, el("tbody", {}, rows)));
    box.append(el("div", { className: "small" }, "Relative suitability, not confirmed locust presence."));
    popup.setContent(box);
  } catch (e) { popup.setContent("Could not read this location."); }
}

// ------------------------------------------------------------------ dashboard
function renderDashboard() {
  const st = yearStats();
  const top = [...st.classes].sort((a, b) => b.percent - a.percent)[0];
  $("situation-title").textContent = `Risk situation, ${S.year}`;
  $("situation-text").textContent =
    `In ${S.year}, ${fmt(st.high_very_high_pct)}% of the mapped basin (${fmt(st.classes.filter((c) => c.code >= 4).reduce((a, c) => a + c.area_km2, 0), 0)} km²) falls in the High or Very High classes. ` +
    `The largest class is ${top.name} (${fmt(top.percent)}%).`;
  $("fact-area").textContent = `${fmt(st.mapped_area_km2, 0)} km² (${fmt(Math.min(st.basin_coverage_pct, 100))}% of basin)`;
  $("fact-hv").textContent = `${fmt(st.high_very_high_pct)}%`;
  $("fact-years").textContent = `${S.meta.years[0]}–${S.meta.years[S.meta.years.length - 1]} (${S.meta.years.length})`;
  const cards = $("risk-cards");
  cards.innerHTML = "";
  st.classes.forEach((c) => cards.append(el("div", { className: "risk-card", style: { borderTopColor: c.colour } },
    el("p", { className: "name" }, c.name), el("p", { className: "pct" }, `${fmt(c.percent)}%`),
    el("p", { className: "km" }, `${fmt(c.area_km2, 0)} km² · ${c.pixels.toLocaleString()} cells`))));
  $("dash-map-title").textContent = `Relative desert locust risk, ${S.year}`;
  if (!S.maps["dash-map"]) makeMap("dash-map", { click: true });
  updateRiskOverlay("dash-map", "classes");
  riskLegend("dash-map-legend");

  const labels = st.classes.map((c) => c.name);
  chart("dash-chart", { type: "bar", data: { labels, datasets: [{ data: st.classes.map((c) => c.percent), backgroundColor: st.classes.map((c) => c.colour), borderColor: "#555", borderWidth: 0.5 }] },
    options: { indexAxis: "y", plugins: { legend: { display: false }, tooltip: { callbacks: { label: (x) => `${fmt(x.parsed.x)}% · ${fmt(st.classes[x.dataIndex].area_km2, 0)} km²` } } },
      scales: { x: { min: 0, max: 100, title: { display: true, text: "% of mapped area" } }, y: { grid: { display: false } } } } });
  const years = S.meta.years;
  chart("years-chart", { type: "bar", data: { labels: years.map(String), datasets: S.meta.classes.map((c) => ({ label: c.name,
      data: years.map((y) => S.stats.by_year[String(y)].classes.find((k) => k.code === c.code).percent),
      backgroundColor: years.map((y) => (y === S.year ? c.colour : c.colour + "99")), borderColor: "#fff", borderWidth: 1 })) },
    options: { onClick: (_e, els) => { if (els.length) setYear(years[els[0].index]); },
      plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${fmt(x.parsed.y)}%` } } },
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, max: 100, title: { display: true, text: "% of mapped area" } } } } });
}

// ------------------------------------------------------------------ risk map view
function renderMapView() {
  if (!S.maps["main-map"]) makeMap("main-map", { riskToggle: true, title: true, click: true });
  updateRiskOverlay("main-map", S.riskLayer);
  riskLegend("main-map-legend", S.riskLayer === "high_very_high");
  $("map-year").textContent = S.year;
  const st = yearStats();
  const body = $("stats-table").querySelector("tbody");
  body.innerHTML = "";
  st.classes.forEach((c) => body.append(el("tr", {}, el("td", {}, el("span", { className: "sw", style: { background: c.colour } }), c.name),
    el("td", { className: "num" }, c.pixels.toLocaleString()), el("td", { className: "num" }, fmt(c.area_km2, 0)), el("td", { className: "num" }, fmt(c.percent)))));
  body.append(el("tr", {}, el("td", { style: { fontWeight: "700" } }, "Total mapped"), el("td", { className: "num" }, st.mapped_pixels.toLocaleString()),
    el("td", { className: "num" }, fmt(st.mapped_area_km2, 0)), el("td", { className: "num" }, "100.0")));
  $("stats-note").textContent = `Areas use each cell's true size (cells are ~500 m and shrink slightly away from the equator). Basin area ${fmt(st.basin_area_km2, 0)} km²; mapped ${fmt(st.basin_coverage_pct)}%.`;
  $("dl-classes").href = `/api/download/${S.year}/classes`;
  $("dl-score").href = `/api/download/${S.year}/score`;
}

// ------------------------------------------------------------------ environment view
function renderEnvironment() {
  const vars = S.env.variables;
  if (!vars.length) { $("env-note").textContent = "No environmental layers were found when the data were built."; return; }
  if (!S.envKey) S.envKey = vars[0].key;
  if (!S.maps["env-map"]) makeMap("env-map", { title: true, click: true });
  const v = vars.find((x) => x.key === S.envKey);
  const L_ = S.layers["env-map"];
  L_.overlay.setUrl(`/api/environment/${v.key}/${S.year}.png`);
  L_.overlay.setOpacity(0.85);
  $("env-map-title").textContent = `${v.label}${v.static ? "" : `, ${S.year}`}`;
  const lg = $("env-map-legend");
  lg.innerHTML = "";
  lg.append(el("b", {}, `${v.label}${v.unit && v.unit !== "class" ? ` (${v.unit})` : ""}`));
  if (v.kind === "categorical") v.categories.forEach((c) => lg.append(el("div", {}, el("span", { className: "sw", style: { background: c.colour } }), c.name)));
  else lg.append(el("div", { className: "gradient", style: { background: `linear-gradient(to right,${v.gradient.join(",")})` } }),
    el("div", { className: "grad-labels" }, el("span", {}, fmt(v.vmin, 2)), el("span", {}, fmt(v.vmax, 2))));
  $("env-source").textContent = v.source ? `Source: ${v.source}` : "";
  $("env-legend").innerHTML = "";
  const means = S.env.means[v.key] || {};
  const ys = Object.keys(means);
  if (ys.length > 1) {
    chart("env-chart", { type: "line", data: { labels: ys, datasets: [{ data: ys.map((y) => means[y]), borderColor: "#1f3d2b", backgroundColor: "#1f3d2b", tension: 0,
        pointRadius: ys.map((y) => (Number(y) === S.year ? 6 : 3)) }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { title: { display: true, text: v.unit } } } } });
  } else if (S.charts["env-chart"]) { S.charts["env-chart"].destroy(); delete S.charts["env-chart"]; }
  $("env-note").textContent = (v.static ? "Static layer: the same for every year. " : "") +
    (v.kind === "categorical" ? "Class layer: no average is shown. " : "Area-weighted basin average. ") +
    (v.basin_coverage_pct < 97 ? `This layer covers ${fmt(v.basin_coverage_pct)}% of the basin; blank areas have no data.` : "");
}

// ------------------------------------------------------------------ early warning view
function renderWarning() {
  const st = yearStats();
  const hv = st.classes.filter((c) => c.code >= 4);
  const hvKm = hv.reduce((a, c) => a + c.area_km2, 0);
  $("warn-title").textContent = `Early warning summary, ${S.year}`;
  $("warn-text").textContent = hvKm > 0
    ? `${fmt(st.high_very_high_pct)}% of the mapped basin (${fmt(hvKm, 0)} km²) is in the High or Very High class in ${S.year}. These areas are where field surveillance and preparedness should be prioritised.`
    : `No part of the basin is mapped as High or Very High in ${S.year}. Routine monitoring and surveillance apply.`;
  const bar = $("warn-bar");
  bar.innerHTML = "";
  st.classes.forEach((c) => { if (c.percent > 0) bar.append(el("div", { title: `${c.name} ${fmt(c.percent)}%`, style: { width: `${c.percent}%`, background: c.colour } })); });
  const body = $("warn-table").querySelector("tbody");
  body.innerHTML = "";
  [...st.classes].reverse().forEach((c) => {
    const g = S.meta.classes.find((k) => k.code === c.code).guidance;
    body.append(el("tr", {}, el("td", { style: { fontWeight: "600" } }, el("span", { className: "sw", style: { background: c.colour } }), c.name),
      el("td", { className: "num" }, fmt(c.area_km2, 0)), el("td", { className: "num" }, `${fmt(c.percent)}%`), el("td", {}, g)));
  });
  if (!S.maps["warn-map"]) makeMap("warn-map", { click: true });
  updateRiskOverlay("warn-map", "high_very_high");
  riskLegend("warn-map-legend", true);
}

// ------------------------------------------------------------------ climate projections view (two tabs)
S.climTab = "proj";
function renderClimate() {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === S.climTab));
  $("tab-proj").hidden = S.climTab !== "proj";
  $("tab-clim").hidden = S.climTab !== "clim";
  if (S.climTab === "proj") renderProjections(); else renderClimateOutlook();
  Object.values(S.maps).forEach((m) => setTimeout(() => m.invalidateSize(), 50));
}

function classBar(target, pct, classes) {
  const bar = $(target);
  bar.innerHTML = "";
  pct.forEach((p, i) => { if (p > 0) bar.append(el("div", { title: `${classes[i].name} ${fmt(p)}%`, style: { width: `${p}%`, background: classes[i].colour } })); });
}

const PRED_LABEL = { Rain_OND: "Short-rains rainfall (Oct–Dec)", Rain_MAM: "Long-rains rainfall (Mar–May)", Rain_annual: "Annual rainfall",
  PCI_clim: "Rainfall concentration (PCI)", Spec_hum: "Specific humidity", Temp_range: "Daily temperature range", Sand_pct: "Soil sand content",
  Slope: "Slope", Elevation: "Elevation", Wet_days: "Wet days", Hot_days: "Hot days" };
const plabel = (k) => PRED_LABEL[k] || k;

function renderProjections() {
  const P = S.proj;
  $("proj-missing").hidden = !!P;
  $("proj-content").hidden = !P;
  if (!P) return;
  const period = $("proj-period").value, isBase = period === "baseline";
  $("proj-scen").disabled = isBase;
  document.querySelectorAll("input[name=proj-view]").forEach((r) => { r.disabled = isBase && r.value !== "risk"; });
  let view = document.querySelector("input[name=proj-view]:checked").value;
  if (isBase) view = "risk";
  const sc = $("proj-scen").value, key = `${sc}_${period}`, r = isBase ? null : P.projections[key];
  if (!S.maps["proj-map"]) makeMap("proj-map", { title: true });
  const L_ = S.layers["proj-map"];
  const file = isBase ? P.baseline.map : { risk: r.map, change: r.change_map, agreement: r.agreement_map }[view];
  L_.overlay.setUrl(`/api/projections/map/${file}`);
  L_.overlay.setOpacity(0.9);
  const scenName = P.scenarios[sc].split(" (")[0];
  $("proj-map-title").textContent = isBase ? `Climatic suitability, baseline ${P.baseline_period}`
    : `${{ risk: "Projected climatic suitability", change: "Change in suitability score", agreement: "Model agreement on direction of change" }[view]}: ${scenName}, ${P.periods[period]}`;
  const lg = $("proj-map-legend");
  lg.innerHTML = "";
  if (view === "risk") {
    lg.append(el("b", {}, "Climatic suitability class"));
    [...P.classes].reverse().forEach((c) => lg.append(el("div", {}, el("span", { className: "sw", style: { background: c.colour } }), c.name)));
    lg.append(el("div", { className: "small" }, "Faded: climate outside the model's training range."),
      el("div", { className: "small" }, "Projection, not a forecast."));
  } else if (view === "change") {
    const s = P.change_scale;
    lg.append(el("b", {}, "Change in score vs 1995–2014"),
      el("div", { className: "gradient", style: { background: `linear-gradient(to right,${s.gradient.join(",")})` } }),
      el("div", { className: "grad-labels" }, el("span", {}, `${fmt(s.vmin, 3)} less suitable`), el("span", {}, `+${fmt(s.vmax, 3)} more`)),
      el("div", { className: "small" }, "Median of the climate models."));
  } else {
    const s = P.agreement_scale;
    lg.append(el("b", {}, "Share of models agreeing on direction"),
      el("div", { className: "gradient", style: { background: `linear-gradient(to right,${s.gradient.join(",")})` } }),
      el("div", { className: "grad-labels" }, el("span", {}, "50%"), el("span", {}, "100%")),
      el("div", { className: "small" }, "Faded: almost no change, so agreement is not meaningful."));
  }
  const b = P.baseline;
  if (isBase) {
    $("proj-text").textContent = `Under the ${P.baseline_period} climate, ${fmt(b.high_very_high_pct)}% of the basin falls in the High or Very High suitability classes. ` +
      `This is the reference against which every projection is compared.`;
  } else {
    const hv = r.high_very_high_models_median ?? r.high_very_high_pct;
    $("proj-text").textContent = `${scenName}, ${P.periods[period]}: ${fmt(hv)}% of the basin is High or Very High ` +
      `(median of ${r.n_models} climate models; range ${fmt(r.high_very_high_models_p10_p90[0])}–${fmt(r.high_very_high_models_p10_p90[1])}%), ` +
      `compared with ${fmt(b.high_very_high_pct)}% in ${P.baseline_period}. The suitability score rises in ${fmt(r.area_increase_pct, 0)}% of the basin; ` +
      `at least two-thirds of models agree on the direction over ${fmt(r.area_agree_two_thirds_pct, 0)}% of it. ` +
      `${fmt(r.outside_training_pct)}% of the basin has climate outside the training range.`;
  }
  classBar("proj-bar-base", b.class_pct, P.classes);
  $("proj-bar-label").textContent = isBase ? "Selected: baseline" : `Selected: ${scenName}, ${P.periods[period]} (median map)`;
  classBar("proj-bar-sel", isBase ? b.class_pct : r.class_pct, P.classes);

  const keys = Object.keys(P.projections);
  const labels = keys.map((k) => `${P.projections[k].scenario === "ssp245" ? "SSP2-4.5" : "SSP5-8.5"} ${P.periods[P.projections[k].period].split(" (")[0]}`);
  chart("proj-chart", { type: "bar", data: { labels, datasets: [
      { type: "bar", label: "Range of climate models (10th–90th percentile)", data: keys.map((k) => P.projections[k].high_very_high_models_p10_p90),
        backgroundColor: keys.map((k) => (k === key ? "#c99a3b" : "#c99a3b66")), borderRadius: 4, barPercentage: 0.5 },
      { type: "scatter", label: "Median of climate models", data: keys.map((k, i) => ({ x: labels[i], y: P.projections[k].high_very_high_models_median ?? P.projections[k].high_very_high_pct })),
        backgroundColor: "#1f3d2b", pointRadius: 6 },
      { type: "line", label: `Baseline ${P.baseline_period}`, data: keys.map(() => b.high_very_high_pct), borderColor: "#5a6259", borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5 }] },
    options: { plugins: { legend: { position: "bottom" } }, scales: { y: { beginAtZero: true, title: { display: true, text: "% of basin High + Very High" } }, x: { grid: { display: false } } } } });

  const m = P.model;
  const f = $("proj-facts");
  f.innerHTML = "";
  const ens = (m.metrics || []).find((x) => x.model.startsWith("Ensemble"));
  [["Predictors", m.predictors.map(plabel).join(", ")],
   ["Test ROC-AUC", (m.metrics || []).map((x) => `${x.model.replace(" (geometric mean)", "")} ${fmt(x.roc_auc, 2)}`).join(" · ")],
   ["Climate models", `${P.n_models} CMIP6 (NEX-GDDP)`],
   ["Baseline", `${P.baseline_period} (CHIRPS, ERA5-Land)`],
   ["Class limits", P.thresholds.map((t) => fmt(t, 3)).join(" · ")]]
    .forEach(([k, v]) => f.append(el("dt", {}, k), el("dd", { style: { fontFamily: "inherit" } }, v)));
  const excl = Object.keys(m.excluded || {});
  $("proj-method").textContent = `A separate climate-only model, trained on ${P.baseline_period} average climate at the same locust records, is applied to each climate model's ` +
    `projection (baseline + projected change). Class limits are fixed for all maps: the 10th, 25th, 50th and 75th percentiles of cross-validated scores at known locust records. ` +
    (excl.length ? `${excl.map(plabel).join(" and ")} were left out because the basin's climate falls outside their training range. ` : "") +
    "Compare projections only with this model's baseline, not with the annual risk maps. 2025–2026 are already past; that period is labelled 'begins near present'.";
}

// ------------------------------------------------------------------ climate change outlook (second tab)
function renderClimateOutlook() {
  const C = S.climate;
  $("clim-missing").hidden = !!C;
  $("clim-content").hidden = !C;
  if (!C) return;
  const vk = $("clim-var").value, sc = $("clim-scen").value, pe = $("clim-period").value;
  const v = C.variables[vk];
  const key = `${sc}_${pe.replace("-", "_")}`;
  const r = v.results[key];
  if (!S.maps["clim-map"]) {
    makeMap("clim-map", { title: true });
    const b = C.bounds;
    S.layers["clim-map"].overlay.setBounds([[b.south, b.west], [b.north, b.east]]);
  }
  const L_ = S.layers["clim-map"];
  L_.overlay.setUrl(`/api/climate/map/${r.map}`);
  L_.overlay.setOpacity(0.9);
  $("clim-map-title").textContent = `${v.label}: ${C.scenarios[sc].split(" (")[0]}, ${pe} vs ${C.baseline}`;
  const lg = $("clim-map-legend");
  lg.innerHTML = "";
  lg.append(el("b", {}, `${v.label} (${v.unit})`),
    el("div", { className: "gradient", style: { background: `linear-gradient(to right,${v.gradient.join(",")})` } }),
    el("div", { className: "grad-labels" }, el("span", {}, fmt(v.vmin, 1)), el("span", {}, "0"), el("span", {}, `+${fmt(v.vmax, 1)}`)),
    el("div", { className: "small" }, "Faded cells: fewer than 2 in 3 models agree on the direction."));
  $("clim-text").textContent = `Under ${C.scenarios[sc]}, ${pe}: the models' median projects a basin-average ${v.label.toLowerCase()} change of ` +
    `${r.median >= 0 ? "+" : ""}${fmt(r.median, 1)} ${v.unit} (10th–90th percentile of models: ${fmt(r.p10, 1)} to ${fmt(r.p90, 1)}). ` +
    `${r.models_same_direction} of ${r.n_models} models agree on the direction.`;
  const keys = Object.keys(v.results);
  const labels = keys.map((k) => `${v.results[k].scenario === "ssp245" ? "SSP2-4.5" : "SSP5-8.5"} ${v.results[k].period}`);
  chart("clim-chart", { type: "bar", data: { labels, datasets: [
      { type: "bar", label: "Range of models (10th–90th percentile)", data: keys.map((k) => [v.results[k].p10, v.results[k].p90]),
        backgroundColor: keys.map((k) => (k === key ? "#c99a3b" : "#c99a3b66")), borderRadius: 4, barPercentage: 0.5 },
      { type: "scatter", label: "Median of models", data: keys.map((k, i) => ({ x: labels[i], y: v.results[k].median })),
        backgroundColor: "#1f3d2b", pointRadius: 6 }] },
    options: { plugins: { legend: { position: "bottom" } }, scales: { y: { title: { display: true, text: v.unit } }, x: { grid: { display: false } } } } });
  const base = C.baseline_values[vk];
  $("clim-note").textContent = `Baseline ${C.baseline} basin average: ${base !== undefined ? fmt(base, 1) : "–"}. ${C.models.length} CMIP6 models, ${C.resolution}. ` +
    "Rainfall amount and its seasonal concentration are among the conditions the risk model responds to; this page shows how they may change. It is not a future risk map.";
}

// ------------------------------------------------------------------ model view
function renderModel() {
  const m = S.model;
  const metrics = m.metrics_shown || [];
  chart("perf-chart", { type: "bar", data: { labels: metrics.map((x) => x.model), datasets: [{ data: metrics.map((x) => x.value), backgroundColor: ["#1f3d2b", "#4f8a63", "#2f6f8f"] }] },
    options: { indexAxis: "y", plugins: { legend: { display: false }, tooltip: { callbacks: { label: (x) => `${metrics[x.dataIndex].metric} ${fmt(x.parsed.x, 2)}` } } },
      scales: { x: { min: 0, max: 1, title: { display: true, text: "ROC-AUC (0.5 = no skill, 1 = perfect)" } }, y: { grid: { display: false } } } } });
  $("perf-note").textContent = `All values are ROC-AUC (${metrics.map((x) => `${x.model} ${fmt(x.value, 2)}`).join("; ")}).`;
  const f = $("model-facts");
  f.innerHTML = "";
  [["Predictors", (m.features || []).join(", ")], ["Ensemble", (m.ensemble_method || "").replace(/_/g, " ")], ["Class limits", (m.thresholds || []).map((t) => fmt(t, 3)).join(" · ")], ["Training", m.training]]
    .forEach(([k, v]) => f.append(el("dt", {}, k), el("dd", { style: { fontFamily: "inherit" } }, v || "–")));
  const row = $("importance-row");
  row.innerHTML = "";
  Object.entries(S.importance || {}).forEach(([key, imp], i) => {
    if (!imp) return;
    const card = el("div", { className: "card importance" }, el("h2", {}, `Predictor importance: ${imp.title}`), el("canvas", { id: `imp-${key}`, height: 60 + 22 * Object.keys(imp.rf || imp.xgb).length }));
    row.append(card);
    const vars = Object.keys(imp.rf || imp.xgb).sort((a, b) => (imp.rf ? imp.rf[b] - imp.rf[a] : imp.xgb[b] - imp.xgb[a]));
    chart(`imp-${key}`, { type: "bar", data: { labels: vars, datasets: [
        imp.rf ? { label: "Random Forest", data: vars.map((v) => imp.rf[v]), backgroundColor: "#1f3d2b" } : null,
        imp.xgb ? { label: "XGBoost", data: vars.map((v) => imp.xgb[v]), backgroundColor: "#c99a3b" } : null].filter(Boolean) },
      options: { indexAxis: "y", plugins: { legend: { position: "bottom" } }, scales: { x: { title: { display: true, text: "Relative importance" } }, y: { grid: { display: false } } } } });
  });
  if (!row.children.length) row.append(el("div", { className: "card" }, "Predictor importance values were not found when the data were built."));
}

// ------------------------------------------------------------------ charts and views
function chart(id, cfg) {
  if (typeof Chart === "undefined") {           // chart library missing: keep the rest of the page working
    const c = $(id);
    if (c && !c.dataset.noted) { c.replaceWith(el("p", { className: "small", id }, "Chart could not be shown in this browser.")); }
    return;
  }
  if (!$(id) || $(id).tagName !== "CANVAS") return;
  if (S.charts[id]) S.charts[id].destroy();
  cfg.options = Object.assign({ responsive: true, animation: false }, cfg.options);
  S.charts[id] = new Chart($(id), cfg);
}

const RENDER = { dashboard: renderDashboard, map: renderMapView, environment: renderEnvironment, warning: renderWarning,
                 climate: renderClimate, model: renderModel, about: () => {} };
function currentView() { const v = location.hash.replace("#", ""); return RENDER[v] ? v : "dashboard"; }
function showView() {
  const v = currentView();
  document.querySelectorAll(".view").forEach((s) => { s.hidden = s.id !== `view-${v}`; });
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === v));
  document.querySelector(".year-box").style.visibility = v === "climate" || v === "about" ? "hidden" : "visible";
  RENDER[v]();
  Object.values(S.maps).forEach((m) => setTimeout(() => m.invalidateSize(), 50));
}
function setYear(y) {
  if (!S.meta.years.includes(y)) { alert(`No risk map is available for ${y}.`); return; }
  S.year = y;
  $("year").value = String(y);
  showView();
}

// ------------------------------------------------------------------ start
async function init() {
  try {
    const [meta, stats, env, model, importance, boundary] = await Promise.all([
      api("/api/meta"), api("/api/statistics"), api("/api/environment"), api("/api/model"), api("/api/importance"), api("/api/boundary")]);
    Object.assign(S, { meta, stats, env, model, importance, boundary, year: meta.years[meta.years.length - 1] });
    S.climate = null; S.proj = null;
    if (meta.has_projections) {
      try { S.proj = await api("/api/projections"); } catch (e) { S.proj = null; }
    }
    if (S.proj) {
      const P = S.proj;
      $("proj-period").append(el("option", { value: "baseline" }, `Baseline ${P.baseline_period}`));
      Object.entries(P.periods).forEach(([k, v]) => $("proj-period").append(el("option", { value: k }, v)));
      Object.entries(P.scenarios).forEach(([k, v]) => $("proj-scen").append(el("option", { value: k }, v)));
      $("proj-period").value = Object.keys(P.periods).includes("2025_2040") ? "2025_2040" : Object.keys(P.periods)[0];
      ["proj-period", "proj-scen"].forEach((id) => $(id).addEventListener("change", renderProjections));
      document.querySelectorAll("input[name=proj-view]").forEach((r) => r.addEventListener("change", renderProjections));
    }
    document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => { S.climTab = b.dataset.tab; renderClimate(); }));
    if (meta.has_climate) {
      try { S.climate = await api("/api/climate"); } catch (e) { S.climate = null; }
    }
    if (meta.system_name) { $("system-name").textContent = meta.system_name; document.title = `${meta.system_name} Decision Support System`; }
    if (S.climate) {
      const C = S.climate;
      Object.entries(C.variables).forEach(([k, v]) => $("clim-var").append(el("option", { value: k }, v.label)));
      Object.entries(C.scenarios).forEach(([k, v]) => $("clim-scen").append(el("option", { value: k }, v)));
      C.periods.forEach((p) => $("clim-period").append(el("option", { value: p }, p)));
      $("clim-period").value = C.periods[C.periods.length - 1];
      ["clim-var", "clim-scen", "clim-period"].forEach((id) => $(id).addEventListener("change", renderClimateOutlook));
    }
    $("study-name").textContent = meta.study_area;
    $("about-area").textContent = `${meta.study_area}. The study-area boundary covers ${fmt(meta.basin_area_km2, 0)} km²; risk maps use a ~500 m grid.`;
    $("built").textContent = `data built ${meta.built}`;
    const sel = $("year");
    meta.years.forEach((y) => sel.append(el("option", { value: String(y) }, y)));
    sel.value = String(S.year);
    sel.addEventListener("change", () => setYear(Number(sel.value)));
    $("prev-year").addEventListener("click", () => { const i = meta.years.indexOf(S.year); if (i > 0) setYear(meta.years[i - 1]); });
    $("next-year").addEventListener("click", () => { const i = meta.years.indexOf(S.year); if (i < meta.years.length - 1) setYear(meta.years[i + 1]); });
    document.querySelectorAll("input[name=risk-layer]").forEach((r) => r.addEventListener("change", () => { S.riskLayer = r.value; renderMapView(); }));
    $("risk-on").addEventListener("change", (e) => { S.riskOn = e.target.checked; renderMapView(); });
    $("opacity").addEventListener("input", (e) => { S.opacity = Number(e.target.value); renderMapView(); });
    const envSel = $("env-var");
    const groups = {};
    env.variables.forEach((v) => { (groups[v.group] = groups[v.group] || []).push(v); });
    Object.entries(groups).forEach(([g, vs]) => envSel.append(el("optgroup", { label: g }, vs.map((v) => el("option", { value: v.key }, v.label)))));
    envSel.addEventListener("change", () => { S.envKey = envSel.value; renderEnvironment(); });
    window.addEventListener("hashchange", showView);
    showView();
  } catch (e) {
    const box = $("load-error");
    box.hidden = false;
    box.textContent = `The DSS could not load its data (${e.message}). Check that the backend is running and that the Step 4 build finished.`;
  }
}
init();
