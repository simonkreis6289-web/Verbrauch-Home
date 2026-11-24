import { householdId } from "./source.mjs";

export function activeCars(cars) {
  return Array.isArray(cars) ? cars.filter(car => car?.active !== false && typeof car?.id === "string") : [];
}

export function carVisibilityKey() {
  return "verbrauch-dashboard-hidden-cars-v1:" + householdId();
}

export function hiddenCarIds() {
  try {
    const stored = JSON.parse(localStorage.getItem(carVisibilityKey()));
    return new Set(Array.isArray(stored) ? stored.filter(id => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function setCarVisible(id, visible) {
  const hidden = hiddenCarIds();
  if (visible) hidden.delete(id);
  else hidden.add(id);
  localStorage.setItem(carVisibilityKey(), JSON.stringify([...hidden]));
}
