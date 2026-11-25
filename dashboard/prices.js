const priceDefinitions = {
  fuel: [
    ["super", "Super E5", "€/l", "⛽"],
    ["e10", "Super E10", "€/l", "⛽"],
    ["diesel", "Diesel", "€/l", "⛽"]
  ],
  energy: [
    ["heating_oil", "Heizöl", "€/100 l", "🔥"],
    ["pellets_loose", "Pellets lose", "€/1.000 kg", "🪵"],
    ["pellets_bag", "Pellets Sackware", "€/1.000 kg", "📦"]
  ]
};
const priceDate = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium", timeZone: "Europe/Berlin"
});

function displayDate(value) {
  const date = new Date(value ?? "");
  return Number.isFinite(date.getTime()) ? priceDate.format(date) : "Datum unbekannt";
}

function validPrice(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

async function readPriceFile(path) {
  try {
    const response = await fetch(path);
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

function readManualEnergyPrices() {
  try {
    const records = JSON.parse(localStorage.getItem("verbrauch-manual-market-v1") || "[]");
    return records.filter(record => /^\d{4}-\d{2}-\d{2}$/.test(record?.date))
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    return [];
  }
}

function renderPrices(id, definitions, digits, selectPrice) {
  const format = new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: digits, maximumFractionDigits: digits
  });
  const rows = definitions.map(([key, label, unit, icon]) => {
    const { value, date, source } = selectPrice(key);
    const row = document.createElement("div");
    row.className = "price-metric";
    row.dataset.priceType = key;
    const name = document.createElement("dt");
    const symbol = document.createElement("span");
    symbol.className = "price-symbol";
    symbol.setAttribute("aria-hidden", "true");
    symbol.textContent = icon;
    const labelNode = document.createElement("span");
    labelNode.textContent = label;
    name.append(symbol, labelNode);
    const price = document.createElement("dd");
    const amount = document.createElement("strong");
    amount.textContent = validPrice(value) ? format.format(value) : "–";
    const unitNode = document.createElement("span");
    unitNode.className = "price-unit";
    unitNode.textContent = validPrice(value) ? unit : "";
    price.append(amount, unitNode);
    if (validPrice(value) && source) {
      const meta = document.createElement("small");
      meta.className = "price-meta";
      meta.textContent = (source === "Historischer Ausgangswert" ? "Archiv · " : "") + displayDate(date);
      meta.title = source;
      price.append(meta);
    }
    row.append(name, price);
    return row;
  });
  document.getElementById(id).replaceChildren(...rows);
}

let lastFuelRecord;
let fuelFallback;
const fuelStatus = document.getElementById("fuel-status");

refreshDashboardData(async () => {
  let source = "App-Datenstand";
  try {
    const data = await readDashboardJson(dashboardDataUrl + "/fuel-national/latest");
    if (!priceDefinitions.fuel.some(([key]) => validPrice(data?.prices?.[key]))) {
      throw new Error("Keine gültigen Spritpreise");
    }
    lastFuelRecord = data;
  } catch {
    if (!lastFuelRecord) fuelFallback ||= readPriceFile("./fuel-prices.json");
    source = lastFuelRecord ? "Letzter verfügbarer Stand" : "Archivstand";
  }
  const data = lastFuelRecord || await fuelFallback;
  const date = data?.source_date || data?.fetched_at;
  const old = Date.now() - Date.parse(date) > 12 * 60 * 60 * 1000;
  const qualifier = !date ? "Nicht verfügbar" : old && source === "App-Datenstand" ? "Älterer App-Stand" : source;
  fuelStatus.textContent = "Deutschland-Durchschnitt · " + qualifier +
    (Number.isFinite(Date.parse(date)) ? " · " + dashboardBerlinTime.format(new Date(date)) : "");
  renderPrices("fuel-prices", priceDefinitions.fuel, 3, key => ({ value: data?.prices?.[key] }));
});

const dashboardMarketFile = readPriceFile("./market-prices.json");

async function renderDashboardEnergyPrices(records = readManualEnergyPrices()) {
  const data = await dashboardMarketFile;
  const manual = records.filter(record => /^\d{4}-\d{2}-\d{2}$/.test(record?.date))
    .sort((a, b) => b.date.localeCompare(a.date));
  renderPrices("energy-prices", priceDefinitions.energy, 2, key => {
    const record = manual.find(item => validPrice(item.prices?.[key]));
    if (record) return { value: record.prices[key], date: record.date, source: "Manuell erfasst" };
    const item = data?.prices?.[key];
    return { value: item?.price, date: item?.checked_at, source: "Historischer Ausgangswert" };
  });
}

void renderDashboardEnergyPrices();
let liveEnergyPrices = false;
const renderManualEnergyPrices = window.renderDashboardEnergyPrices;
window.renderDashboardEnergyPrices = records => {
  liveEnergyPrices = true;
  return renderManualEnergyPrices(records);
};
window.addEventListener("storage", event => {
  if (event.key === "verbrauch-manual-market-v1" && !liveEnergyPrices) {
    void renderManualEnergyPrices();
  }
});
