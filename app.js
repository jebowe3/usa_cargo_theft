// Cargo Theft Dashboard
const CSV_URL = "cargo-theft-dashboard.csv";
const GEOJSON_URL = "us-counties.geojson";

const START_DATE = new Date(2015, 0, 1);
const END_DATE = new Date(2025, 11, 31);

const offenseFields = ["offenses"];
const offenseLocationFields = ["locations"];
const victimFields = ["victims"];
const propertyFields = ["properties"];

const filterConfigs = [
  { id: "state", label: "State", mode: "single", field: "State" },
  { id: "agency", label: "Reporting Agency", mode: "single", field: "Agency_Cleaned" },
  { id: "offense", label: "Offense Type", mode: "multi", fields: offenseFields },
  { id: "location", label: "Offense Location", mode: "multi", fields: offenseLocationFields },
  { id: "victim", label: "Victim Category", mode: "multi", fields: victimFields },
  { id: "property", label: "Property Description", mode: "multi", fields: propertyFields }
];

let rows = [];
let countiesGeojson = null;
let incidentMap = null;
let valueMap = null;
let selectedFilters = {};
let tooltip = null;
let dateRangeSlider = null;

function syncMapCamera(fromMap, toMap) {
  toMap.jumpTo({
    center: fromMap.getCenter(),
    zoom: fromMap.getZoom(),
    bearing: fromMap.getBearing(),
    pitch: fromMap.getPitch()
  });
}

function syncSelectedFiltersFromDom() {
  for (const config of filterConfigs) {
    selectedFilters[config.id] = new Set();

    const section = [...document.querySelectorAll(".filter-section")]
      .find(sec => sec.querySelector("label")?.textContent === config.label);

    if (!section) continue;

    section.querySelectorAll("input[type='checkbox']:checked").forEach(cb => {
      selectedFilters[config.id].add(cb.value);
    });
  }
}

function getFilteredRows() {
  const { startDate, endDate } = getSelectedDateRange();

  return rows.filter(row => rowPassesFilters(row, startDate, endDate));
}

function exportFilteredCsv() {
  syncSelectedFiltersFromDom();

  const filteredRows = getFilteredRows();

  if (filteredRows.length === 0) {
    alert("No records match the current filters.");
    return;
  }

  const exportRows = filteredRows.map(row => {
    const cleanRow = { ...row };
    delete cleanRow.__IncidentDate;
    return cleanRow;
  });

  const csv = Papa.unparse(exportRows);

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = "cargo-theft-filtered-data.csv";
  link.click();

  URL.revokeObjectURL(url);
}

function getCurrentTargetBounds() {
  if (anyFiltersSelected()) {
    const agg = aggregateByCounty();
    return enhanceCountyGeojson(agg);
  }
  return null;
}

function resetVisibleMapView() {
  const visibleIsIncident = document.getElementById("incidentPanel").classList.contains("active-map");
  const activeMap = visibleIsIncident ? incidentMap : valueMap;

  activeMap.resize();

  setTimeout(() => {
    if (anyFiltersSelected()) {
      const enhanced = getCurrentTargetBounds();
      zoomToFilteredPolygons(enhanced);
    } else {
      zoomToLower48();
    }
  }, 100);
}

function getVisibleMapInfo() {
  const isIncident = document.getElementById("incidentPanel").classList.contains("active-map");

  return {
    map: isIncident ? incidentMap : valueMap,
    panel: isIncident ? document.getElementById("incidentPanel") : document.getElementById("valuePanel"),
    title: isIncident ? "Total Incidents by County" : "Total Value Stolen by County",
    legend: isIncident ? document.getElementById("incidentLegend") : document.getElementById("valueLegend")
  };
}

async function exportVisibleMapPng() {
  const { map, title, legend } = getVisibleMapInfo();

  map.triggerRepaint();

  await new Promise(resolve => setTimeout(resolve, 300));

  const mapCanvas = map.getCanvas();

  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = mapCanvas.width;
  exportCanvas.height = mapCanvas.height + 50;

  const ctx = exportCanvas.getContext("2d");

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

  ctx.fillStyle = "black";
  ctx.font = "bold 24px Arial";
  ctx.fillText(title, 20, 32);

  ctx.drawImage(mapCanvas, 0, 50);

  const legendCanvas = await html2canvas(legend, {
    backgroundColor: null,
    scale: 2,
    useCORS: true
  });

  ctx.drawImage(
    legendCanvas,
    20,
    exportCanvas.height - legendCanvas.height / 2 - 20,
    legendCanvas.width / 2,
    legendCanvas.height / 2
  );

  const link = document.createElement("a");
  link.href = exportCanvas.toDataURL("image/png");
  link.download = "cargo-theft-map.png";
  link.click();
}

function anyFiltersSelected() {
  return Object.values(selectedFilters).some(set => set.size > 0);
}

function zoomToLower48() {
  const lower48Bounds = [
    [-125.0, 24.0],
    [-66.5, 49.5]
  ];

  incidentMap.fitBounds(lower48Bounds, {
    padding: 30,
    duration: 700
  });

  valueMap.fitBounds(lower48Bounds, {
    padding: 30,
    duration: 700
  });
}

function zoomToFilteredPolygons(enhancedGeojson) {
  const matchingFeatures = enhancedGeojson.features.filter(f =>
    Number(f.properties.incidents || 0) > 0 ||
    Number(f.properties.stolenValue || 0) > 0
  );

  if (matchingFeatures.length === 0) return;

  const bounds = new maplibregl.LngLatBounds();

  function extendCoords(coords) {
    if (typeof coords[0] === "number") {
      bounds.extend(coords);
    } else {
      coords.forEach(extendCoords);
    }
  }

  matchingFeatures.forEach(feature => {
    extendCoords(feature.geometry.coordinates);
  });

  if (!bounds.isEmpty()) {
    incidentMap.fitBounds(bounds, {
      padding: 40,
      duration: 700,
      maxZoom: 8
    });

    valueMap.fitBounds(bounds, {
      padding: 40,
      duration: 700,
      maxZoom: 8
    });
  }
}

function dateToSliderValue(date) {
  return daysBetween(START_DATE, date);
}

function toInputDateValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function inputValueToDate(value) {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function syncDateInputsFromSlider() {
  const { startDate, endDate } = getSelectedDateRange();

  document.getElementById("startDateInput").value = toInputDateValue(startDate);
  document.getElementById("endDateInput").value = toInputDateValue(endDate);

  document.getElementById("dateRangeLabel").textContent =
    `${formatDate(startDate)} - ${formatDate(endDate)}`;
}

function getSelectedDateRange() {
  const values = dateRangeSlider.noUiSlider.get().map(Number);
  return {
    startDate: sliderValueToDate(values[0]),
    endDate: sliderValueToDate(values[1])
  };
}

function daysBetween(a, b) {
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

const maxDays = daysBetween(START_DATE, END_DATE);

function sliderValueToDate(value) {
  const d = new Date(START_DATE);
  d.setDate(d.getDate() + Number(value));
  return d;
}

function formatDate(d) {
  return d.toLocaleDateString("en-US");
}

function parseIncidentDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (s.length !== 8) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6)) - 1;
  const d = Number(s.slice(6, 8));
  return new Date(y, m, d);
}

function numberFromValue(value) {
  if (value === null || value === undefined) return 0;
  const cleaned = String(value).replace(/[$,]/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function cleanValue(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function uniqueNonBlank(values) {
  return [...new Set(values.map(cleanValue).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function getRowValues(row, fields) {
  if (fields.length === 1 && ["offenses", "locations", "victims", "properties"].includes(fields[0])) {
    return cleanValue(row[fields[0]])
      .split("|")
      .map(v => v.trim())
      .filter(Boolean);
  }

  return fields.map(f => cleanValue(row[f])).filter(Boolean);
}

function buildFilters() {
  const filtersDiv = document.getElementById("filters");
  filtersDiv.innerHTML = "";

  for (const config of filterConfigs) {
    const values = config.mode === "single"
      ? uniqueNonBlank(rows.map(r => r[config.field]))
      : uniqueNonBlank(rows.flatMap(r => getRowValues(r, config.fields)));

    selectedFilters[config.id] = new Set();

    const section = document.createElement("div");
    section.className = "filter-section";

    const label = document.createElement("label");
    label.textContent = config.label;

    const dropdown = document.createElement("div");
    dropdown.className = "dropdown";
    dropdown.textContent = "Select options";

    const content = document.createElement("div");
    content.className = "dropdown-content";

    const search = document.createElement("input");
    search.type = "text";
    search.placeholder = "Search...";
    search.style.width = "100%";
    search.style.marginBottom = "6px";
    content.appendChild(search);

    const optionsWrap = document.createElement("div");
    content.appendChild(optionsWrap);

    function renderOptions(filterText = "") {
      optionsWrap.innerHTML = "";
      const filtered = values.filter(v => v.toLowerCase().includes(filterText.toLowerCase()));

      for (const value of filtered) {
        const optionLabel = document.createElement("label");

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = value;

        checkbox.addEventListener("change", () => {
          if (checkbox.checked) selectedFilters[config.id].add(value);
          else selectedFilters[config.id].delete(value);

          refreshFilterOptions();
          updateMaps();
        });

        optionLabel.appendChild(checkbox);
        optionLabel.appendChild(document.createTextNode(" " + value));
        optionsWrap.appendChild(optionLabel);
      }
    }

    search.addEventListener("input", () => renderOptions(search.value));

    dropdown.addEventListener("click", () => {
      content.classList.toggle("open");
    });

    renderOptions();

    section.appendChild(label);
    section.appendChild(dropdown);
    section.appendChild(content);
    filtersDiv.appendChild(section);
  }
}

function getRowsForFilterOptions(excludeFilterId = null) {
  const { startDate, endDate } = getSelectedDateRange();

  return rows.filter(row => {
    const incidentDate = row.__IncidentDate;
    if (!incidentDate || incidentDate < startDate || incidentDate > endDate) return false;

    for (const config of filterConfigs) {
      if (config.id === excludeFilterId) continue;

      const selected = selectedFilters[config.id];
      if (!selected || selected.size === 0) continue;

      if (config.mode === "single") {
        if (!selected.has(cleanValue(row[config.field]))) return false;
      } else {
        const rowValues = getRowValues(row, config.fields);
        if (!rowValues.some(v => selected.has(v))) return false;
      }
    }

    return true;
  });
}

function refreshFilterOptions() {
  for (const config of filterConfigs) {
    const availableRows = getRowsForFilterOptions(config.id);

    const availableValues = config.mode === "single"
      ? new Set(uniqueNonBlank(availableRows.map(r => r[config.field])))
      : new Set(uniqueNonBlank(availableRows.flatMap(r => getRowValues(r, config.fields))));

    const section = [...document.querySelectorAll(".filter-section")]
      .find(sec => sec.querySelector("label")?.textContent === config.label);

    if (!section) continue;

    section.querySelectorAll("input[type='checkbox']").forEach(cb => {
      const isAvailable = availableValues.has(cb.value);
      const isSelected = selectedFilters[config.id].has(cb.value);

      const shouldShow = isAvailable || isSelected;

      cb.parentElement.style.display = shouldShow ? "block" : "none";
    });

    const dropdown = section.querySelector(".dropdown");
    const count = selectedFilters[config.id].size;
    dropdown.textContent = count ? `${count} selected` : "Select options";
  }
}

function updateDateLabel() {
  syncDateInputsFromSlider();
}

function syncSliderFromDateInputs() {
  const startInput = document.getElementById("startDateInput");
  const endInput = document.getElementById("endDateInput");

  let startDate = inputValueToDate(startInput.value);
  let endDate = inputValueToDate(endInput.value);

  if (!startDate || !endDate) return;

  if (startDate < START_DATE) startDate = START_DATE;
  if (endDate > END_DATE) endDate = END_DATE;

  if (startDate > endDate) {
    [startDate, endDate] = [endDate, startDate];
  }

  dateRangeSlider.noUiSlider.set([
    dateToSliderValue(startDate),
    dateToSliderValue(endDate)
  ]);

  refreshFilterOptions();
  updateMaps();
}

function rowPassesFilters(row, startDate, endDate) {
  const incidentDate = row.__IncidentDate;
  if (!incidentDate || incidentDate < startDate || incidentDate > endDate) return false;

  for (const config of filterConfigs) {
    const selected = selectedFilters[config.id];
    if (!selected || selected.size === 0) continue;

    if (config.mode === "single") {
      if (!selected.has(cleanValue(row[config.field]))) return false;
    } else {
      const rowValues = getRowValues(row, config.fields);
      if (!rowValues.some(v => selected.has(v))) return false;
    }
  }

  return true;
}

function aggregateByCounty() {
  const { startDate, endDate } = getSelectedDateRange();

  const agg = new Map();

  for (const row of rows) {
    if (!rowPassesFilters(row, startDate, endDate)) continue;

    const geoid = cleanValue(row.GEOID);
    if (!geoid) continue;

    if (!agg.has(geoid)) {
      agg.set(geoid, { incidents: 0, stolenValue: 0 });
    }

    const item = agg.get(geoid);
    item.incidents += 1;
    item.stolenValue += numberFromValue(row.Stolen_Value_Total);
  }

  return agg;
}

function getBreaks(values, steps = 5) {
  const clean = values.filter(v => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (clean.length === 0) return [0, 1, 2, 3, 4, 5];

  const breaks = [0];
  for (let i = 1; i <= steps; i++) {
    const idx = Math.floor((clean.length - 1) * (i / steps));
    breaks.push(clean[idx]);
  }
  return [...new Set(breaks)];
}

function colorExpression(propertyName, breaks) {
  // ColorBrewer-style Reds.
  return [
    "step",
    ["get", propertyName],
    "#f7fbff",
    breaks[1] || 1, "#deebf7",
    breaks[2] || 2, "#9ecae1",
    breaks[3] || 3, "#4292c6",
    breaks[4] || 4, "#08519c"
  ];
}

function enhanceCountyGeojson(agg) {
  const features = countiesGeojson.features.map(feature => {
    const geoid = cleanValue(feature.properties.GEOID);
    const values = agg.get(geoid) || { incidents: 0, stolenValue: 0 };

    return {
      ...feature,
      properties: {
        ...feature.properties,
        incidents: values.incidents,
        stolenValue: values.stolenValue
      }
    };
  });

  return { type: "FeatureCollection", features };
}

function updateMaps() {
  updateDateLabel();

  const agg = aggregateByCounty();
  const enhanced = enhanceCountyGeojson(agg);

  const showingIncident =
    document.getElementById("incidentPanel").classList.contains("active-map");

  if (showingIncident) {
    const incidentValues = enhanced.features.map(f => f.properties.incidents);
    const incidentBreaks = getBreaks(incidentValues);

    updateSingleMap(
      incidentMap,
      enhanced,
      "incidents",
      incidentBreaks,
      "incidentLegend",
      "Incidents"
    );
  } else {
    const stolenValues = enhanced.features.map(f => f.properties.stolenValue);
    const valueBreaks = getBreaks(stolenValues);

    updateSingleMap(
      valueMap,
      enhanced,
      "stolenValue",
      valueBreaks,
      "valueLegend",
      "Value Stolen"
    );
  }

  // Optional: comment this block out if filtering still feels slow.
  if (anyFiltersSelected()) {
    zoomToFilteredPolygons(enhanced);
  } else {
    zoomToLower48();
  }
}

function updateSingleMap(map, geojson, propertyName, breaks, legendId, legendTitle) {
  const source = map.getSource("counties");

  if (source) {
    source.setData(geojson);
  }

  if (map.getLayer("county-fill")) {
    map.setPaintProperty("county-fill", "fill-color", colorExpression(propertyName, breaks));
  }

  buildLegend(legendId, legendTitle, breaks, propertyName === "stolenValue");
}

function buildLegend(id, title, breaks, currency = false) {
  const legend = document.getElementById(id);
  const colors = ["#f7fbff", "#deebf7", "#9ecae1", "#4292c6", "#08519c"];

  function fmt(v) {
    if (currency) return "$" + Math.round(v).toLocaleString();
    return Math.round(v).toLocaleString();
  }

  let html = `<strong>${title}</strong><br>`;
  for (let i = 0; i < colors.length; i++) {
    const from = breaks[i] || 0;
    const to = breaks[i + 1];
    const label = to === undefined ? `${fmt(from)}+` : `${fmt(from)} - ${fmt(to)}`;
    html += `<span style="display:inline-block;width:14px;height:14px;background:${colors[i]};border:1px solid #888;margin-right:5px;"></span>${label}<br>`;
  }

  legend.innerHTML = html;
}

function createMap(containerId, propertyName) {
  const map = new maplibregl.Map({
    container: containerId,
    preserveDrawingBuffer: true,
    style: {
      version: 8,
      sources: {
        osm: {
          type: "raster",
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          attribution: "© OpenStreetMap contributors"
        }
      },
      layers: [
        {
          id: "osm",
          type: "raster",
          source: "osm"
        }
      ]
    },
    center: [-98.5, 39.8],
    zoom: 3
  });

  map.addControl(new maplibregl.NavigationControl(), "top-right");

  map.on("load", () => {
    map.addSource("counties", {
      type: "geojson",
      data: countiesGeojson
    });

    map.addLayer({
      id: "county-fill",
      type: "fill",
      source: "counties",
      paint: {
        "fill-color": colorExpression(propertyName, [0, 1, 2, 3, 4]),
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          0.90,
          0.70
        ]
      }
    });

    map.addLayer({
      id: "county-outline",
      type: "line",
      source: "counties",
      paint: {
        "line-color": "#555",
        "line-width": 0.3
      }
    });

    let hoveredId = null;

    map.on("mousemove", "county-fill", e => {
      map.getCanvas().style.cursor = "pointer";

      if (e.features.length > 0) {
        if (hoveredId !== null) {
          map.setFeatureState({ source: "counties", id: hoveredId }, { hover: false });
        }

        hoveredId = e.features[0].id ?? e.features[0].properties.GEOID;
        map.setFeatureState({ source: "counties", id: hoveredId }, { hover: true });

        const p = e.features[0].properties;
        const countyName = `${p.NAMELSAD || ""}, ${p.STATE_NAME || ""}`;
        const value = Number(p.stolenValue || 0);

        tooltip.innerHTML = `
          <strong>${countyName}</strong><br>
          Incidents: ${Number(p.incidents || 0).toLocaleString()}<br>
          Total Value Stolen: $${Math.round(value).toLocaleString()}
        `;
        tooltip.style.left = `${e.originalEvent.pageX + 12}px`;
        tooltip.style.top = `${e.originalEvent.pageY + 12}px`;
        tooltip.style.display = "block";
      }
    });

    map.on("mouseleave", "county-fill", () => {
      map.getCanvas().style.cursor = "";
      if (hoveredId !== null) {
        map.setFeatureState({ source: "counties", id: hoveredId }, { hover: false });
      }
      hoveredId = null;
      tooltip.style.display = "none";
    });

    updateMaps();
  });

  return map;
}

async function loadData() {
  tooltip = document.createElement("div");
  tooltip.className = "tooltip";
  tooltip.style.display = "none";
  document.body.appendChild(tooltip);

  dateRangeSlider = document.getElementById("dateRangeSlider");

  noUiSlider.create(dateRangeSlider, {
    start: [0, maxDays],
    connect: true,
    range: {
      min: 0,
      max: maxDays
    },
    step: 1
  });

  dateRangeSlider.noUiSlider.on("update", () => {
    if (dateRangeSlider?.noUiSlider) {
      syncDateInputsFromSlider();
    }
  });

  dateRangeSlider.noUiSlider.on("change", () => {
    if (incidentMap && valueMap) {
      refreshFilterOptions();
      updateMaps();
    }
  });

  document.getElementById("exportMapPng").addEventListener("click", exportVisibleMapPng);
  document.getElementById("exportCsv").addEventListener("click", exportFilteredCsv);

  document.getElementById("startDateInput").value = "2015-01-01";
  document.getElementById("endDateInput").value = "2025-12-31";

  document.getElementById("startDateInput").addEventListener("change", syncSliderFromDateInputs);
  document.getElementById("endDateInput").addEventListener("change", syncSliderFromDateInputs);  

  const geoRes = await fetch(GEOJSON_URL);
  countiesGeojson = await geoRes.json();

  // Ensure features have stable ids for feature-state hover.
  countiesGeojson.features = countiesGeojson.features.map(f => ({
    ...f,
    id: cleanValue(f.properties.GEOID)
  }));

  await new Promise((resolve, reject) => {
    Papa.parse(CSV_URL, {
      header: true,
      download: true,
      skipEmptyLines: true,
      worker: false,
      complete: result => {
        rows = result.data.map(row => ({
          ...row,
          GEOID: cleanValue(row.GEOID),
          __IncidentDate: parseIncidentDate(row.Incident_Date)
        }));
        resolve();
      },
      error: reject
    });
  });

  buildFilters();
  updateDateLabel();

  incidentMap = createMap("incidentMap", "incidents");
  valueMap = createMap("valueMap", "stolenValue");

  document.getElementById("clearFilters").addEventListener("click", () => {
    for (const key of Object.keys(selectedFilters)) selectedFilters[key].clear();

    document.querySelectorAll(".dropdown-content input[type='checkbox']").forEach(cb => cb.checked = false);
    document.querySelectorAll(".dropdown").forEach(dd => dd.textContent = "Select options");

    dateRangeSlider.noUiSlider.set([0, maxDays]);

    updateMaps();
  });

  document.getElementById("toggleSidebar").addEventListener("click", () => {
    const sidebar = document.getElementById("sidebar");
    sidebar.classList.toggle("collapsed");
    document.getElementById("toggleSidebar").textContent =
      sidebar.classList.contains("collapsed") ? "›" : "‹";

    setTimeout(() => {
      incidentMap.resize();
      valueMap.resize();
    }, 220);
  });

  document.getElementById("showIncidentMap").addEventListener("click", () => {
    document.getElementById("incidentPanel").classList.remove("hidden-map");
    document.getElementById("incidentPanel").classList.add("active-map");

    document.getElementById("valuePanel").classList.remove("active-map");
    document.getElementById("valuePanel").classList.add("hidden-map");

    document.getElementById("showIncidentMap").classList.add("active");
    document.getElementById("showValueMap").classList.remove("active");

    syncMapCamera(valueMap, incidentMap);

    incidentMap.resize();
    updateMaps();
  });

  document.getElementById("showValueMap").addEventListener("click", () => {
    document.getElementById("valuePanel").classList.remove("hidden-map");
    document.getElementById("valuePanel").classList.add("active-map");

    document.getElementById("incidentPanel").classList.remove("active-map");
    document.getElementById("incidentPanel").classList.add("hidden-map");

    document.getElementById("showValueMap").classList.add("active");
    document.getElementById("showIncidentMap").classList.remove("active");

    syncMapCamera(incidentMap, valueMap);

    valueMap.resize();
    updateMaps();
  });

}

loadData().catch(err => {
  console.error(err);
  alert("Dashboard failed to load. Check that the CSV and GeoJSON filenames match the app settings.");  
});
