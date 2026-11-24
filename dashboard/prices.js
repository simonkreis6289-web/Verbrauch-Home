const priceDefinitions = {
  fuel: [
    ["super", "Super E5", "€/l"],
    ["e10", "Super E10", "€/l"],
    ["diesel", "Diesel", "€/l"]
  ],
  energy: [
    ["heating_oil", "Heizöl", "€/100 l"],
    ["pellets_loose", "Pellets · lose Ware", "€/1.000 kg"],
    ["pellets_bag", "Pellets · Sackware", "€/1.000 kg"]
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
  const rows = definitions.map(([key, label, unit]) => {
    const { value, date, source } = selectPrice(key);
    const row = document.createElement("div");
    const name = document.createElement("dt");
    const price = document.createElement("dd");
    const meta = document.createElement("small");
    name.textContent = label;
    price.textContent = validPrice(value) ? format.format(value) + " " + unit : "Nicht verfügbar";
    if (validPrice(value)) {
      meta.textContent = source + " · " + displayDate(date);
      price.append(meta);
    }
    row.append(name, price);
    return row;
  });
  document.getElementById(id).replaceChildren(...rows);
}

// Read the repository snapshots only. Opening the dashboard never calls a market-price provider.
readPriceFile("./fuel-prices.json").then(data => {
  renderPrices("fuel-prices", priceDefinitions.fuel, 3, key => ({
    value: data?.prices?.[key],
    date: data?.source_date || data?.fetched_at,
    source: "Gespeicherter Stand"
  }));
});

readPriceFile("./market-prices.json").then(data => {
  const manual = readManualEnergyPrices();
  renderPrices("energy-prices", priceDefinitions.energy, 2, key => {
    const record = manual.find(item => validPrice(item.prices?.[key]));
    if (record) return { value: record.prices[key], date: record.date, source: "Manuell erfasst" };
    const item = data?.prices?.[key];
    return { value: item?.price, date: item?.checked_at, source: "Historischer Ausgangswert" };
  });
});
