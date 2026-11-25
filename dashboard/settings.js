import { connectDashboard, dashboardHouseholdKey, householdId, householdKey, readLocalSnapshot, snapshotKey } from "./source.js?v=2";
import { activeCars, carVisibilityKey, hiddenCarIds, setCarVisible } from "./vehicle-preferences.js?v=2";

const householdForm = document.getElementById("dashboard-household-form");
const householdInput = document.getElementById("dashboard-household");
const householdStatus = document.getElementById("dashboard-household-status");
householdInput.value = householdId();

householdForm.addEventListener("submit", event => {
  event.preventDefault();
  const id = householdInput.value.trim();
  if (!id || id.includes("/") || id === "." || id === "..") {
    householdStatus.textContent = "Bitte gib die Haushalts-ID aus der App ein.";
    return;
  }
  try {
    localStorage.setItem(dashboardHouseholdKey, id);
  } catch {
    householdStatus.textContent = "Dieser Browser konnte den Haushalt nicht speichern.";
    return;
  }
  window.location.replace("dashboard.html?tv=20");
});

const list = document.getElementById("vehicle-settings");
const status = document.getElementById("settings-status");
let cars = readLocalSnapshot()?.cars;
let live = false;

function render() {
  const selected = hiddenCarIds();
  const focusedId = document.activeElement?.dataset.carId;
  const rows = activeCars(cars).map(car => {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !selected.has(car.id);
    checkbox.dataset.carId = car.id;
    label.append(checkbox, document.createTextNode(car.name || "Fahrzeug"));
    return label;
  });
  list.replaceChildren(...rows);
  if (focusedId) rows.find(row => row.firstChild.dataset.carId === focusedId)?.firstChild.focus();
  if (rows.length) status.textContent = live ? "" : "Fahrzeuge aus dem lokalen App-Stand.";
  else status.textContent = Array.isArray(cars) ? "Keine aktiven Fahrzeuge vorhanden." : "Fahrzeuge werden geladen …";
}

list.addEventListener("change", event => {
  const checkbox = event.target;
  if (!checkbox.dataset.carId) return;
  try {
    setCarVisible(checkbox.dataset.carId, checkbox.checked);
    status.textContent = "Auswahl gespeichert.";
  } catch {
    checkbox.checked = !checkbox.checked;
    status.textContent = "Dieser Browser konnte die Auswahl nicht speichern.";
  }
});

window.addEventListener("storage", event => {
  if (event.key === householdKey || event.key === dashboardHouseholdKey || event.key === null) window.location.reload();
  if (event.key === snapshotKey && !live) {
    cars = readLocalSnapshot()?.cars;
    render();
  }
  if (event.key === carVisibilityKey()) render();
});

render();
const unavailable = () => {
  status.textContent = Array.isArray(cars) ? "Live-Verbindung nicht verfügbar. Der letzte Fahrzeugstand wird angezeigt."
    : "Fahrzeuge konnten nicht geladen werden.";
};
const timeout = setTimeout(unavailable, 12000);

try {
  const { firestore, db, base } = await connectDashboard();
  firestore.onSnapshot(firestore.collection(db, base + "/cars"), { includeMetadataChanges: true }, snapshot => {
    if (snapshot.metadata.fromCache) return;
    clearTimeout(timeout);
    cars = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
    live = true;
    render();
  }, () => {
    clearTimeout(timeout);
    unavailable();
  });
} catch {
  clearTimeout(timeout);
  unavailable();
}
