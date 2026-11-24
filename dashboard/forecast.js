(() => {
  const status = document.getElementById("forecast-status");
  const list = document.getElementById("forecast-days");
  const current = document.getElementById("forecast-current");
  const dayFormat = new Intl.DateTimeFormat("de-DE", { weekday: "short", timeZone: "Europe/Berlin" });
  const dayKey = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" });
  let latest;

  function formatValue(value, unit) {
    return Number.isFinite(value) ? Math.round(value) + " " + unit : "–";
  }

  function render(record, offline) {
    const updated = new Date(record.updatedAt);
    const { daily, current: outside } = record.data;
    const today = dayKey.format(new Date());
    const indices = daily.time.map((date, index) => ({ date, index }))
      .filter(day => day.date >= today).slice(0, 3);
    const old = Date.now() - updated.getTime() > 24 * 60 * 60 * 1000;
    status.textContent = (offline || old ? "Letzter verfügbarer Stand · " : "Stand · ") + dashboardBerlinTime.format(updated);
    list.replaceChildren(...indices.map(({ date, index }) => {
      const row = document.createElement("div");
      const label = document.createElement("dt");
      const values = document.createElement("dd");
      const temperature = document.createElement("strong");
      const rain = document.createElement("small");
      label.textContent = date === today ? "Heute" : dayFormat.format(new Date(date + "T12:00:00Z"));
      temperature.textContent = formatValue(daily.temperature_2m_min?.[index], "°C") + " / " +
        formatValue(daily.temperature_2m_max?.[index], "°C");
      const probability = daily.precipitation_probability_max?.[index];
      if (Number.isFinite(probability)) rain.textContent = "Regen " + formatValue(probability, "%");
      values.append(temperature, rain);
      row.append(label, values);
      return row;
    }));
    current.hidden = offline || old || !Number.isFinite(outside?.temperature_2m);
    current.textContent = "Außen laut Vorhersage · " + formatValue(outside?.temperature_2m, "°C");
  }

  refreshDashboardData(async () => {
    try {
      const data = await readDashboardJson(dashboardDataUrl + "/forecast");
      if (!Array.isArray(data?.data?.daily?.time) || !Number.isFinite(Date.parse(data.updatedAt))) {
        throw new Error("Vorhersage unvollständig");
      }
      latest = data;
      render(latest, false);
    } catch {
      if (latest) render(latest, true);
      else status.textContent = "Vorhersage momentan nicht verfügbar.";
    }
  });
})();
