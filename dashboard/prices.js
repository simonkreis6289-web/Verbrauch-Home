const priceDefinitions = {
  fuel: [
    ["super", "Super E5", "€/l", "⛽"],
    ["e10", "Super E10", "€/l", "⛽"],
    ["diesel", "Diesel", "€/l", "⛽"]
  ],
  energy: [
    ["heating_oil", "Heizöl", "€/100 l", "🔥"],
    ["pellets_loose", "Pellets lose", "€/1.000 kg", "./dashboard/loose-pellets.svg"],
    ["pellets_bag", "Pellets Sackware", "€/1.000 kg", "📦"]
  ]
};
const priceDate = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium", timeZone: "Europe/Berlin"
});

const marketDayFormat = new Intl.DateTimeFormat("de-DE", {
  year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Berlin"
});

function marketDay(timestamp) {
  const date = new Date(timestamp ?? "");
  if (!Number.isFinite(date.getTime())) return "";
  const parts = Object.fromEntries(marketDayFormat.formatToParts(date).map(part => [part.type, part.value]));
  return parts.year + "-" + parts.month + "-" + parts.day;
}

function previousMarketDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  const date = new Date(day + "T12:00:00Z");
  if (!Number.isFinite(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

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

function renderPriceChange(change, format) {
  const trend = document.createElement("small");
  trend.className = "price-change";
  if (!change) {
    trend.textContent = "Kein Vortageswert";
    return trend;
  }
  const { amount, percent } = change;
  const variant = amount > 0 ? "up" : amount < 0 ? "down" : "flat";
  trend.classList.add(variant);
  const arrow = amount > 0 ? "↗" : amount < 0 ? "↘" : "→";
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  trend.textContent = arrow + " " + sign + format.format(Math.abs(amount)) + " € (" +
    sign + format.format(Math.abs(percent)) + " %)";
  return trend;
}

function renderPrices(id, definitions, digits, selectPrice) {
  const format = new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: digits, maximumFractionDigits: digits
  });
  const rows = definitions.map(([key, label, unit, icon]) => {
    const { value, date, source, change } = selectPrice(key);
    const row = document.createElement("div");
    row.className = "price-metric";
    row.dataset.priceType = key;
    const name = document.createElement("dt");
    const symbol = document.createElement("span");
    symbol.className = "price-symbol";
    symbol.setAttribute("aria-hidden", "true");
    if (icon.endsWith(".svg")) {
      const image = document.createElement("img");
      image.src = icon;
      image.alt = "";
      image.width = 24;
      image.height = 24;
      symbol.append(image);
    } else {
      symbol.textContent = icon;
    }
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
      if (change !== undefined) price.append(renderPriceChange(change, format));
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
const dashboardMarketHistory = readPriceFile("./market-price-history.json");

function energyPriceChange(history, key, day, current) {
  const previous = history.get(previousMarketDay(day))?.[key];
  if (!validPrice(current) || !validPrice(previous)) return null;
  const amount = current - previous;
  return { amount, percent: amount / previous * 100 };
}

async function renderDashboardEnergyPrices(records = readManualEnergyPrices()) {
  const [data, archive] = await Promise.all([dashboardMarketFile, dashboardMarketHistory]);
  const manual = records.filter(record => /^\d{4}-\d{2}-\d{2}$/.test(record?.date))
    .sort((a, b) => b.date.localeCompare(a.date));
  const history = new Map();
  const archivedRecords = Array.isArray(archive?.records) ? archive.records : [];
  for (const record of [...archivedRecords, ...manual]) {
    const day = record?.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    history.set(day, { ...history.get(day), ...record.prices });
  }

  renderPrices("energy-prices", priceDefinitions.energy, 2, key => {
    const record = manual.find(item => validPrice(item.prices?.[key]));
    const item = data?.prices?.[key];
    const value = record ? record.prices[key] : item?.price;
    const date = record?.date || item?.checked_at;
    const day = record?.date || marketDay(date);
    const source = record ? "Manuell erfasst" : "Historischer Ausgangswert";
    return { value, date, source, change: energyPriceChange(history, key, day, value) };
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
