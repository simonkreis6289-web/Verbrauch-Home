const STORAGE_KEY = "verbrauch-zuhause-v1";

let entries = [];
let currentRange = 30;
let deferredPrompt = null;

const entryForm = document.getElementById("entryForm");
const typeInput = document.getElementById("type");
const datetimeInput = document.getElementById("datetime");
const valueInput = document.getElementById("value");
const valueLabel = document.getElementById("valueLabel");
const valueHint = document.getElementById("valueHint");
const pelletsFields = document.getElementById("pelletsFields");
const bagsInput = document.getElementById("bags");
const kgPerBagInput = document.getElementById("kgPerBag");
const pelletsTotal = document.getElementById("pelletsTotal");
const noteInput = document.getElementById("note");

const filterForm = document.getElementById("filterForm");
const filterType = document.getElementById("filterType");
const fromDate = document.getElementById("fromDate");
const toDate = document.getElementById("toDate");
const minValue = document.getElementById("minValue");
const maxValue = document.getElementById("maxValue");
const resetFilterBtn = document.getElementById("resetFilterBtn");

const entriesContainer = document.getElementById("entriesContainer");
const resultCount = document.getElementById("resultCount");
const stats = document.getElementById("stats");
const exportBtn = document.getElementById("exportBtn");
const installBtn = document.getElementById("installBtn");

const editDialog = document.getElementById("editDialog");
const editForm = document.getElementById("editForm");
const editId = document.getElementById("editId");
const editType = document.getElementById("editType");
const editDatetime = document.getElementById("editDatetime");
const editValue = document.getElementById("editValue");
const editNote = document.getElementById("editNote");
const editPelletsFields = document.getElementById("editPelletsFields");
const editBags = document.getElementById("editBags");
const editKgPerBag = document.getElementById("editKgPerBag");
const editPelletsTotal = document.getElementById("editPelletsTotal");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const chartTabs = document.getElementById("chartTabs");

document.addEventListener("DOMContentLoaded", init);

function init() {
  setDefaultDatetime();
  loadEntries();
  updateTypeUI(typeInput.value);
  bindEvents();
  render();
  registerServiceWorker();
}

function bindEvents() {
  typeInput.addEventListener("change", () => updateTypeUI(typeInput.value));
  bagsInput.addEventListener("input", syncPelletsTotal);
  kgPerBagInput.addEventListener("input", syncPelletsTotal);
  entryForm.addEventListener("submit", handleCreateEntry);

  filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    render();
  });

  resetFilterBtn.addEventListener("click", () => {
    filterForm.reset();
    render();
  });

  exportBtn.addEventListener("click", exportData);
  installBtn.addEventListener("click", installApp);

  chartTabs.addEventListener("click", (event) => {
    const tab = event.target.closest(".tab");
    if (!tab) return;
    currentRange = Number(tab.dataset.range);
    document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    renderCharts(getFilteredEntries());
  });

  editType.addEventListener("change", () => updateEditTypeUI(editType.value));
  editBags.addEventListener("input", syncEditPelletsTotal);
  editKgPerBag.addEventListener("input", syncEditPelletsTotal);

  editForm.addEventListener("submit", handleEditEntry);
  cancelEditBtn.addEventListener("click", () => editDialog.close());

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    installBtn.classList.remove("hidden");
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installBtn.classList.add("hidden");
  });
}

function setDefaultDatetime() {
  const now = new Date();
  datetimeInput.value = toDatetimeLocal(now);
}

function loadEntries() {
  try {
    entries = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    entries = [];
  }
  entries.sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
}

function saveEntries() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function updateTypeUI(type) {
  const hints = {
    strom: { label: "Wert", hint: "z. B. 4.8 kWh" },
    wasser: { label: "Wert", hint: "z. B. 120 Liter oder 1.3 m³" },
    pellets: { label: "Gesamtgewicht", hint: "wird automatisch aus Säcken berechnet" }
  };

  valueLabel.firstChild.textContent = hints[type].label;
  valueHint.textContent = hints[type].hint;

  const pelletsMode = type === "pellets";
  pelletsFields.classList.toggle("hidden", !pelletsMode);
  valueInput.readOnly = pelletsMode;
  valueInput.required = true;

  if (pelletsMode) {
    valueInput.value = calculatePelletsTotal(bagsInput.value, kgPerBagInput.value);
    syncPelletsTotal();
  } else {
    bagsInput.value = "";
    kgPerBagInput.value = "";
    pelletsTotal.textContent = "0 kg";
  }
}

function updateEditTypeUI(type) {
  const pelletsMode = type === "pellets";
  editPelletsFields.classList.toggle("hidden", !pelletsMode);
  editValue.readOnly = pelletsMode;
  if (pelletsMode) {
    syncEditPelletsTotal();
  }
}

function calculatePelletsTotal(bags, kgPerBag) {
  const total = (Number(bags) || 0) * (Number(kgPerBag) || 0);
  return total ? Number(total.toFixed(2)) : 0;
}

function syncPelletsTotal() {
  const total = calculatePelletsTotal(bagsInput.value, kgPerBagInput.value);
  valueInput.value = total;
  pelletsTotal.textContent = `${formatNumber(total)} kg`;
}

function syncEditPelletsTotal() {
  const total = calculatePelletsTotal(editBags.value, editKgPerBag.value);
  editValue.value = total;
  editPelletsTotal.textContent = `${formatNumber(total)} kg`;
}

function handleCreateEntry(event) {
  event.preventDefault();

  const type = typeInput.value;
  const entry = {
    id: crypto.randomUUID(),
    type,
    datetime: datetimeInput.value,
    value: Number(valueInput.value),
    unit: inferUnit(type, Number(valueInput.value)),
    note: noteInput.value.trim(),
    bags: type === "pellets" ? Number(bagsInput.value || 0) : null,
    kgPerBag: type === "pellets" ? Number(kgPerBagInput.value || 0) : null,
    createdAt: new Date().toISOString()
  };

  if (!isValidEntry(entry)) {
    alert("Bitte alle Pflichtfelder korrekt ausfüllen.");
    return;
  }

  entries.unshift(entry);
  entries.sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
  saveEntries();
  entryForm.reset();
  setDefaultDatetime();
  updateTypeUI("strom");
  render();
}

function handleEditEntry(event) {
  event.preventDefault();
  const id = editId.value;
  const index = entries.findIndex((item) => item.id === id);
  if (index === -1) return;

  const type = editType.value;
  const updated = {
    ...entries[index],
    type,
    datetime: editDatetime.value,
    value: Number(editValue.value),
    unit: inferUnit(type, Number(editValue.value)),
    note: editNote.value.trim(),
    bags: type === "pellets" ? Number(editBags.value || 0) : null,
    kgPerBag: type === "pellets" ? Number(editKgPerBag.value || 0) : null
  };

  if (!isValidEntry(updated)) {
    alert("Bitte alle Felder korrekt prüfen.");
    return;
  }

  entries[index] = updated;
  entries.sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
  saveEntries();
  editDialog.close();
  render();
}

function isValidEntry(entry) {
  if (!entry.type || !entry.datetime || !(entry.value >= 0)) return false;
  if (entry.type === "pellets" && (!(entry.bags > 0) || !(entry.kgPerBag > 0))) return false;
  return true;
}

function inferUnit(type, value) {
  if (type === "strom") return "kWh";
  if (type === "pellets") return "kg";
  return value >= 10 ? "Liter" : "m³";
}

function getFilteredEntries() {
  return entries.filter((entry) => {
    const typeOk = filterType.value === "alle" || entry.type === filterType.value;
    const entryDate = new Date(entry.datetime).getTime();
    const fromOk = !fromDate.value || entryDate >= new Date(fromDate.value).getTime();
    const toOk = !toDate.value || entryDate <= new Date(toDate.value).getTime();
    const minOk = !minValue.value || entry.value >= Number(minValue.value);
    const maxOk = !maxValue.value || entry.value <= Number(maxValue.value);
    return typeOk && fromOk && toOk && minOk && maxOk;
  });
}

function render() {
  const filtered = getFilteredEntries();
  renderStats(filtered);
  renderEntries(filtered);
  renderCharts(filtered);
}

function renderStats(filtered) {
  const byType = ["strom", "wasser", "pellets"].map((type) => {
    const total = filtered
      .filter((entry) => entry.type === type)
      .reduce((sum, entry) => sum + Number(entry.value || 0), 0);

    const labelMap = {
      strom: "Strom gesamt",
      wasser: "Wasser gesamt",
      pellets: "Pellets gesamt"
    };

    const unitMap = {
      strom: "kWh",
      wasser: "Einheiten",
      pellets: "kg"
    };

    return `
      <div class="stat">
        <div class="stat-label">${labelMap[type]}</div>
        <div class="stat-value">${formatNumber(total)} ${unitMap[type]}</div>
      </div>
    `;
  }).join("");

  stats.innerHTML = byType;
}

function renderEntries(filtered) {
  resultCount.textContent = `${filtered.length} ${filtered.length === 1 ? "Eintrag" : "Einträge"}`;
  entriesContainer.innerHTML = "";

  if (!filtered.length) {
    entriesContainer.innerHTML = `<div class="empty-state">Noch nichts gefunden. Probiere einen anderen Zeitraum oder lege den ersten Eintrag an.</div>`;
    return;
  }

  const template = document.getElementById("entryTemplate");

  filtered.forEach((entry) => {
    const node = template.content.cloneNode(true);
    node.querySelector(".entry-type").textContent = prettyType(entry.type);
    node.querySelector(".entry-datetime").textContent = formatDateTime(entry.datetime);
    node.querySelector(".entry-value").textContent = formatEntryValue(entry);
    node.querySelector(".entry-note").textContent =
      (entry.note || entry.type === "pellets")
        ? buildEntryNote(entry)
        : "";

    node.querySelector(".edit-btn").addEventListener("click", () => openEditDialog(entry.id));
    node.querySelector(".delete-btn").addEventListener("click", () => deleteEntry(entry.id));
    entriesContainer.appendChild(node);
  });
}

function buildEntryNote(entry) {
  const parts = [];
  if (entry.type === "pellets" && entry.bags && entry.kgPerBag) {
    parts.push(`${entry.bags} Sack/Säcke × ${formatNumber(entry.kgPerBag)} kg`);
  }
  if (entry.note) parts.push(entry.note);
  return parts.join(" • ");
}

function openEditDialog(id) {
  const entry = entries.find((item) => item.id === id);
  if (!entry) return;

  editId.value = entry.id;
  editType.value = entry.type;
  editDatetime.value = entry.datetime;
  editValue.value = entry.value;
  editNote.value = entry.note || "";
  editBags.value = entry.bags ?? "";
  editKgPerBag.value = entry.kgPerBag ?? "";
  updateEditTypeUI(entry.type);
  syncEditPelletsTotal();
  editDialog.showModal();
}

function deleteEntry(id) {
  const entry = entries.find((item) => item.id === id);
  if (!entry) return;
  const ok = confirm(`Eintrag vom ${formatDateTime(entry.datetime)} wirklich löschen?`);
  if (!ok) return;
  entries = entries.filter((item) => item.id !== id);
  saveEntries();
  render();
}

function renderCharts(filteredEntries) {
  const chartTypes = ["strom", "wasser", "pellets"];

  chartTypes.forEach((type) => {
    const el = document.getElementById(`chart-${type}`);
    const scoped = applyRange(filteredEntries.filter((entry) => entry.type === type), currentRange);
    const grouped = groupEntries(scoped, currentRange === 365 ? "month" : "day");
    el.innerHTML = createBarsMarkup(grouped, type);
  });
}

function applyRange(items, rangeDays) {
  if (!rangeDays) return items;
  const now = new Date();
  const from = new Date(now);
  from.setDate(now.getDate() - rangeDays);
  return items.filter((entry) => new Date(entry.datetime) >= from);
}

function groupEntries(items, mode = "day") {
  const bucket = new Map();

  for (const entry of items) {
    const d = new Date(entry.datetime);
    const key = mode === "month"
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    bucket.set(key, (bucket.get(key) || 0) + Number(entry.value || 0));
  }

  return [...bucket.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-8)
    .map(([label, value]) => ({ label: shortenDateLabel(label, mode), value: Number(value.toFixed(2)) }));
}

function createBarsMarkup(data, type) {
  if (!data.length) {
    return `<div class="chart-empty">Noch keine Daten in diesem Zeitraum.</div>`;
  }

  const max = Math.max(...data.map((item) => item.value), 1);

  const bars = data.map((item) => {
    const height = Math.max(8, Math.round((item.value / max) * 180));
    return `
      <div class="bar-wrap">
        <div class="bar-value">${formatNumber(item.value)}</div>
        <div class="bar" style="height:${height}px" title="${prettyType(type)} ${item.label}: ${formatNumber(item.value)}"></div>
        <div class="bar-label">${item.label}</div>
      </div>
    `;
  }).join("");

  return `<div class="chart-bars">${bars}</div>`;
}

function exportData() {
  const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `verbrauch-export-${stamp}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function installApp() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.classList.add("hidden");
}

function prettyType(type) {
  return ({ strom: "Strom", wasser: "Wasser", pellets: "Pellets" })[type] || type;
}

function formatEntryValue(entry) {
  if (entry.type === "pellets") return `${formatNumber(entry.value)} kg`;
  if (entry.type === "strom") return `${formatNumber(entry.value)} kWh`;
  return `${formatNumber(entry.value)} ${entry.unit || "Einheiten"}`;
}

function formatDateTime(value) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function toDatetimeLocal(date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function formatNumber(value) {
  return new Intl.NumberFormat("de-DE", {
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function shortenDateLabel(label, mode) {
  if (mode === "month") {
    const [year, month] = label.split("-");
    return `${month}.${year.slice(-2)}`;
  }
  const [year, month, day] = label.split("-");
  return `${day}.${month}.`;
}

async function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch (error) {
      console.warn("Service Worker konnte nicht registriert werden", error);
    }
  }
}
