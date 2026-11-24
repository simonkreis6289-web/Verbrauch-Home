export const cameraServerKey = "verbrauch-dashboard-camera-server-v1";

export function cameraServerAddress(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Ungültige HTTPS-Adresse");
  }
  return url.href.replace(/\/+$/, "");
}

export function readCameraServer() {
  try {
    return cameraServerAddress(localStorage.getItem(cameraServerKey) || "");
  } catch {
    return "";
  }
}

const form = document.getElementById("camera-settings-form");
if (form) {
  const field = document.getElementById("camera-server");
  const status = document.getElementById("camera-settings-status");
  field.value = readCameraServer();
  form.addEventListener("submit", event => {
    event.preventDefault();
    try {
      const value = field.value.trim();
      if (value) localStorage.setItem(cameraServerKey, cameraServerAddress(value));
      else localStorage.removeItem(cameraServerKey);
      status.textContent = "Gespeichert. Öffne das Dashboard, um die Kameraverbindung zu testen.";
    } catch {
      status.textContent = "Bitte eine HTTPS-Adresse ohne Zugangsdaten eingeben und Browserspeicher erlauben.";
    }
  });
}
