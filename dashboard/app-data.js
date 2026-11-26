import { createAppCalculations } from "./app-calculations.js?v=2";

import { connectDashboard, dashboardHouseholdKey, householdId, householdKey, readLocalSnapshot, snapshotKey } from "./source.js?v=2";
import { carMonthTotals, carRunningCosts, nextInspection, previousCarMonth } from "./car-month.js?v=2";
import { activeCars, carVisibilityKey, hiddenCarIds } from "./vehicle-preferences.js?v=2";

const status = document.getElementById("app-data-status");
const selectedHousehold = householdId();
document.getElementById("household-name").textContent = selectedHousehold;
function syncState(state, message) {
  status.dataset.state = state;
  status.title = message;
  status.setAttribute("aria-label", message);
}
window.addEventListener("offline", () => syncState("error", "Offline · letzter Datenstand"));
window.addEventListener("online", () => syncState("pending", "Verbindung wird geprüft"));
const collections = ["readings", "resets", "pricePeriods", "purchases", "refills",
  "cars", "fuelEntries", "chargeEntries", "maintenanceEntries"];
const number = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
const dailyNumber = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 1 });
const money = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const shortDate = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeZone: "Europe/Berlin" });
const updateTime = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
const units = { strom: "kWh", wasser: "m³", pellets: "kg" };

function quantity(value, unit) {
  return value != null && Number.isFinite(Number(value)) ? number.format(value) + " " + unit : "–";
}

function displayDate(value) {
  const date = new Date(value || "");
  return Number.isFinite(date.getTime()) ? shortDate.format(date) : "–";
}

function appendText(parent, tag, value) {
  const element = document.createElement(tag);
  element.textContent = value;
  parent.append(element);
  return element;
}

function renderCars(data, now) {
  const period = previousCarMonth(now);
  document.getElementById("car-month").textContent = "· " + period.label;
  const active = activeCars(data.cars);
  const hidden = hiddenCarIds();
  const cars = active.filter(car => !hidden.has(car.id));
  const container = document.getElementById("app-cars");
  const reminders = document.getElementById("car-reminders");
  container.replaceChildren();
  if (!cars.length) appendText(container, "p", active.length
    ? "Keine Fahrzeuge zur Anzeige ausgewählt." : "Keine aktiven Fahrzeuge vorhanden.");

  const pending = [];
  for (const car of cars) {
    const tile = document.createElement("article");
    tile.className = "car";
    const name = car.name || "Fahrzeug";
    const header = document.createElement("header");
    header.className = "car-summary";
    tile.append(header);
    const identity = document.createElement("div");
    header.append(identity);
    appendText(identity, "h3", name);
    const fuelNames = {
      diesel: "Diesel", gasoline: "Benzin", petrol: "Benzin", electric: "Elektro",
      plug_in_hybrid: "Plug-in-Hybrid", hybrid: "Hybrid", lpg: "Autogas", cng: "Erdgas"
    };
    if (fuelNames[car.fuelType]) appendText(identity, "small", fuelNames[car.fuelType]);
    const model = name.toLowerCase();
    const photo = model.includes("tarraco") ? ["seat-tarraco", "Seat Tarraco"]
      : model.includes("tiguan") ? ["vw-tiguan", "VW Tiguan"] : null;
    if (photo) {
      const img = document.createElement("img");
      img.src = "./dashboard/" + photo[0] + ".webp";
      img.alt = photo[1] + " in Schwarz (Modellillustration)";
      header.append(img);
    }

    const electric = car.fuelType === "electric";
    const takesCharge = electric || car.fuelType === "plug_in_hybrid";
    const fuel = electric ? [] : data.fuelEntries.filter(entry => entry.carId === car.id);
    const charges = takesCharge ? data.chargeEntries.filter(entry => entry.carId === car.id) : [];
    const service = data.maintenanceEntries.filter(entry => entry.carId === car.id);
    const totals = carMonthTotals([...fuel, ...charges, ...service], period, now);
    const running = carRunningCosts(electric ? charges : fuel, electric, period, now);
    const projected = totals.distance !== null && running.costPer100km !== null
      ? totals.distance * running.costPer100km / 100 : null;
    const costLabel = electric ? "Ladekosten" : "Tankkosten";
    const distanceLabel = totals.partial ? "Kilometer · Teilzeitraum" : "Kilometer im Monat";
    const distance = totals.distance === null ? "–"
      : (totals.isEstimate ? "ca. " : "") + quantity(Math.round(totals.distance), "km");
    const metrics = document.createElement("dl");
    metrics.className = "car-metrics";
    const metricRows = [
      ["Letzter Kilometerstand", quantity(totals.mileage, "km")],
      [distanceLabel, distance],
      ["Nächste HU", displayDate(nextInspection(service, now))],
      [takesCharge && !electric ? "Spritverbrauch" : "Verbrauch",
        quantity(running.consumption, electric ? "kWh/100 km" : "l/100 km")],
      [costLabel + " pro 100 km", running.costPer100km === null ? "–" : money.format(running.costPer100km)],
      [costLabel + " geschätzt", projected === null ? "–" : "ca. " + money.format(projected)]
    ];
    for (const [label, value] of metricRows) {
      const metric = document.createElement("div");
      appendText(metric, "dt", label);
      appendText(metric, "dd", value);
      metrics.append(metric);
    }
    tile.append(metrics);
    const lastLabel = electric ? "Letzte Ladung" : "Zuletzt getankt";
    const last = running.last;
    const booking = last ? [
      displayDate(last.time),
      last.amount !== null ? quantity(last.amount, electric ? "kWh" : "l") : null,
      last.cost !== null ? money.format(last.cost) : null
    ].filter(Boolean).join(" · ") : "–";
    appendText(tile, "p", lastLabel + " · " + booking).className = "car-last";
    const notes = [];
    if (totals.partial) notes.push(totals.coverage + " % des Monats abgedeckt");
    else if (totals.distance === null) notes.push("Zu wenige Kilometerstände für den Monat");
    if (running.basedOnRecentIntervals) notes.push("Verbrauch aus letzten erfassten Strecken");
    if (notes.length) appendText(tile, "p", notes.join(" · ")).className = "car-last";
    container.append(tile);

    for (const entry of service) {
      if (!entry.remind || (!entry.nextDate && entry.nextMileage == null)) continue;
      if (service.some(other => other.category === entry.category && String(other.date) > String(entry.date))) continue;
      const due = [entry.nextDate ? displayDate(entry.nextDate) : null,
        entry.nextMileage != null ? quantity(entry.nextMileage, "km") : null].filter(Boolean).join(" / ");
      pending.push({ date: Date.parse(entry.nextDate) || Infinity, text: name + " · " + (entry.title || "Wartung") + " · " + due });
    }
  }
  pending.sort((a, b) => a.date - b.date);
  reminders.hidden = pending.length === 0;
  reminders.textContent = pending.length ? "Als Nächstes: " + pending[0].text : "";
}

function hasReadingInterval(reading) {
  return Boolean(reading && Number.isFinite(reading.delta) &&
    Date.parse(reading.previousDate) < Date.parse(reading.date) &&
    (reading.resetApplied || Number(reading.value) >= Number(reading.previousValue)));
}

function renderReadingTrend(element, current, previous, unit) {
  element.classList.remove("up", "down");
  if (!hasReadingInterval(current) || !hasReadingInterval(previous) ||
      !Number.isFinite(current.dailyDelta) || !Number.isFinite(previous.dailyDelta)) {
    element.textContent = "Kein Tagesvergleich";
    return;
  }

  const difference = current.dailyDelta - previous.dailyDelta;
  const arrow = difference > 0 ? "↗" : difference < 0 ? "↘" : "→";
  if (difference) element.classList.add(difference > 0 ? "up" : "down");
  const sign = difference > 0 ? "+" : difference < 0 ? "−" : "";
  const amount = Math.abs(difference);
  const relative = previous.dailyDelta > 0 ? " (" + sign + percent.format(amount / previous.dailyDelta) + ")" : "";
  element.textContent = "Ø " + arrow + " " + sign + dailyNumber.format(amount) + " " + unit + "/Tag" + relative;
}

function renderAppData(raw) {
  const data = { settings: raw.settings };
  for (const key of collections) data[key] = Array.isArray(raw[key]) ? raw[key] : [];

  const now = new Date();
  data.readings = data.readings.filter(reading => {
    const time = Date.parse(reading?.date);
    return Number.isFinite(time) && time <= now.getTime() &&
      reading.value != null && reading.value !== "" && Number.isFinite(Number(reading.value));
  });
  const calculations = createAppCalculations(data);
  const readings = calculations.buildComputedReadings();
  document.querySelectorAll("#reading-values [data-meter-type]").forEach(row => {
    const type = row.dataset.meterType;
    const reading = readings.find(item => item.type === type);
    const unit = units[type];
    const validInterval = hasReadingInterval(reading);
    const previous = validInterval
      ? readings.find(item => item.type === type && item.date === reading.previousDate)
      : null;
    row.querySelector(".meter-reading").textContent = reading
      ? "Zähler " + quantity(reading.value, unit) + (type === "strom" ? "" : " · " + displayDate(reading.date)) : "";
    row.querySelector("dd strong").textContent = validInterval ? dailyNumber.format(reading.delta) + " " + unit : "–";
    row.querySelector(".reading-interval").textContent = validInterval
      ? displayDate(reading.previousDate) + " – " + displayDate(reading.date)
      : reading ? "Kein ablesbarer Zeitraum" : "Kein Zählerstand";
    renderReadingTrend(row.querySelector(".reading-trend"), reading, previous, unit);
  });

  const balance = calculations.pelletBalanceModel();
  const split = calculations.pelletStockSplit(balance);
  document.getElementById("stock-total").textContent = quantity(balance.stock, "kg");
  const bunker = split ? Math.max(0, split.bunker) : null;
  const bags = split ? Math.max(0, split.bags) : null;
  document.getElementById("stock-bunker").textContent = quantity(bunker, "kg");
  document.getElementById("stock-bags").textContent = quantity(bags, "kg");

  // Purchases enter the sack store. Refills only move pellets into the bunker.
  const lastDelivery = data.purchases.reduce((latest, entry) => {
    const date = Date.parse(entry?.date);
    return Number.isFinite(date) && date <= now.getTime() && Number(entry.totalKg) > 0 &&
      (!latest || date > Date.parse(latest.date)) ? entry : latest;
  }, null);
  const kgPerBag = Number(lastDelivery?.kgPerBag) ||
    Number(lastDelivery?.totalKg) / Number(lastDelivery?.bags);
  const bagCount = document.getElementById("stock-bag-count");
  const count = bags !== null && Number.isFinite(kgPerBag) && kgPerBag > 0 ? bags / kgPerBag : null;
  bagCount.hidden = !Number.isFinite(count);
  bagCount.textContent = bagCount.hidden ? "" :
    (Math.abs(count - Math.round(count)) > 0.001 ? "ca. " : "") +
    number.format(count) + (count === 1 ? " Sack à " : " Säcke à ") + quantity(kgPerBag, "kg");
  renderCars(data, now);
  return readings.length > 0;
}

function renderLocalFallback() {
  const local = readLocalSnapshot();
  renderAppData(local || {});
  syncState("pending", local ? "Lokaler App-Stand · Verbindung wird geprüft" : "App-Daten werden geladen");
  return Boolean(local);
}

function normalize(value) {
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  }
  return value;
}

let remoteSnapshot;
let remoteStarted = false;
const hasLocalData = renderLocalFallback();
const noSync = () => {
  syncState("error", remoteStarted ? "Live-Sync unterbrochen · letzter geladener App-Stand"
    : hasLocalData ? "Lokaler App-Stand · Live-Sync nicht verfügbar"
      : "App-Daten konnten nicht geladen werden.");
};
const initialWait = setTimeout(noSync, 12000);

try {
  const { firestore, db, base } = await connectDashboard();
  const pending = new Set([...collections, "settings"]);
  const data = {};
  const cached = new Set();
  const update = (key, value, fromCache) => {
    data[key] = value;
    pending.delete(key);
    if (fromCache) cached.add(key);
    else cached.delete(key);
    if (pending.size || cached.size) {
      if (remoteStarted) noSync();
      return;
    }
    clearTimeout(initialWait);
    const hasReadings = renderAppData(data);
    remoteStarted = true;
    remoteSnapshot = data;
    syncState(navigator.onLine && hasReadings ? "ok" : "error", hasReadings ? "Serverstand bestätigt · " + updateTime.format(new Date()) + " Uhr" : "Keine Zählerstände · Haushalt prüfen");
  };
  const options = { includeMetadataChanges: true };
  firestore.onSnapshot(firestore.doc(db, base + "/heating/latest"), s => window.HeatingUI?.update(s.data()), () => window.HeatingUI?.update(null));
  for (const key of collections) {
    firestore.onSnapshot(firestore.collection(db, base + "/" + key), options,
      snapshot => update(key, snapshot.docs.map(doc => ({ id: doc.id, ...normalize(doc.data()) })), snapshot.metadata.fromCache),
      noSync);
  }
  firestore.onSnapshot(firestore.doc(db, base + "/settings/main"), options,
    snapshot => update("settings", normalize(snapshot.data()), snapshot.metadata.fromCache),
    noSync);
  firestore.onSnapshot(firestore.collection(db, base + "/marketQuotes"), options,
    snapshot => {
      if (!snapshot.metadata.fromCache) void window.renderDashboardEnergyPrices(snapshot.docs.map(doc => normalize(doc.data())));
    }, () => {});
} catch {
  clearTimeout(initialWait);
  noSync();
}

// Refresh month-dependent figures on a TV left running across midnight.
let lastDay = new Date().toDateString();
setInterval(() => {
  const day = new Date().toDateString();
  if (day === lastDay) return;
  lastDay = day;
  renderAppData(remoteSnapshot || readLocalSnapshot() || {});
}, 60000);

window.addEventListener("storage", event => {
  if (event.key === householdKey || event.key === dashboardHouseholdKey || event.key === null) window.location.reload();
  if (event.key === carVisibilityKey()) renderAppData(remoteSnapshot || readLocalSnapshot() || {});
  if (event.key === snapshotKey && !remoteStarted) renderAppData(readLocalSnapshot() || {});
});

window.addEventListener("pageshow", event => {
  if (!event.persisted) return;
  if (householdId() !== selectedHousehold) {
    window.location.reload();
    return;
  }
  renderAppData(remoteSnapshot || readLocalSnapshot() || {});
});
