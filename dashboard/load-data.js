// Report startup failures even if a module could not be fetched or executed.
(() => {
  const script = document.currentScript;
  const entry = new URL(script.dataset.module, script.src);
  import(entry.href).catch(error => {
    console.error("Dashboard-Daten konnten nicht gestartet werden:", error);
    document.getElementById(script.dataset.status).textContent =
      "Das Datenmodul konnte nicht gestartet werden.";
    const cars = document.querySelector("#app-cars p");
    if (cars) cars.textContent = "Fahrzeugdaten nicht verfügbar.";
  });
})();
