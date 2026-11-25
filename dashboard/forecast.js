(() => {
  const byId = id => document.getElementById(id);
  const status = byId("forecast-status");
  const detailsStatus = byId("weather-view-status");
  const dialog = byId("weather-view");
  const close = byId("weather-close");
  const dayFormat = new Intl.DateTimeFormat("de-DE", {
    weekday: "short", day: "2-digit", month: "2-digit", timeZone: "Europe/Berlin"
  });
  const dayKey = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" });
  const clock = new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Berlin"
  });
  const weatherCodes = [
    [0, "☀️", "Sonnig"], [2, "🌤️", "Teilweise bewölkt"], [3, "☁️", "Bewölkt"],
    [48, "🌫️", "Nebel"], [57, "🌦️", "Nieselregen"], [67, "🌧️", "Regen"],
    [77, "🌨️", "Schnee"], [82, "🌦️", "Regenschauer"], [86, "❄️", "Schneeschauer"],
    [99, "⛈️", "Gewitter"]
  ];
  let latest;
  let opener;

  function el(tag, text, className) {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function formatValue(value, unit, decimals = 0) {
    return Number.isFinite(value) ? value.toLocaleString("de-DE", { maximumFractionDigits: decimals }) + " " + unit : "–";
  }

  function iconFor(code) {
    const entry = Number.isFinite(code) && weatherCodes.find(([max]) => code <= max);
    const icon = el("span", entry ? entry[1] : "🌡️", "forecast-icon");
    icon.setAttribute("role", "img");
    icon.setAttribute("aria-label", entry ? entry[2] : "Wetterlage unbekannt");
    icon.title = icon.getAttribute("aria-label");
    return icon;
  }

  function rainText(probability, amount) {
    return "☔ " + formatValue(probability, "%") + " · " + formatValue(amount, "mm", 1);
  }

  const formatDay = date => dayFormat.format(new Date(date + "T12:00:00Z"));

  function dayCard(daily, index, today) {
    const date = daily.time[index];
    const card = el("article", "", "forecast-day-card");
    card.append(
      el("h3", date === today ? "Heute" : formatDay(date)),
      iconFor(daily.weather_code?.[index]),
      el("strong", formatValue(daily.temperature_2m_max?.[index], "°C") + " / " + formatValue(daily.temperature_2m_min?.[index], "°C")),
      el("small", rainText(daily.precipitation_probability_max?.[index], daily.precipitation_sum?.[index])),
      el("small", "💨 " + formatValue(daily.wind_speed_10m_max?.[index], "km/h"))
    );
    return card;
  }

  function renderHours(hourly, nowKey) {
    const panel = byId("forecast-hours");
    const start = hourly?.time?.findIndex(time => time.slice(0, 13) >= nowKey.slice(0, 13)) ?? -1;
    if (start < 0) {
      panel.textContent = "Keine kommenden Stundenwerte verfügbar.";
      return;
    }
    const groups = new Map();
    for (let index = start; index < Math.min(start + 48, hourly.time.length); index += 2) {
      const time = hourly.time[index];
      const date = time.slice(0, 10);
      if (!groups.has(date)) groups.set(date, el("div", "", "forecast-hour-grid"));
      const card = el("div", "", "forecast-hour-card");
      card.append(el("strong", time.slice(11, 16) + " Uhr"), iconFor(hourly.weather_code?.[index]),
        el("span", formatValue(hourly.temperature_2m?.[index], "°C")),
        el("small", rainText(hourly.precipitation_probability?.[index], hourly.precipitation?.[index])),
        el("small", "💨 " + formatValue(hourly.wind_speed_10m?.[index], "km/h")));
      groups.get(date).append(card);
    }
    panel.replaceChildren(...Array.from(groups, ([date, grid]) => {
      const group = el("section");
      group.append(el("h4", formatDay(date)), grid);
      return group;
    }));
  }

  function renderSky(now) {
    const latitude = Number.isFinite(latest?.latitude) ? latest.latitude : 51.042840;
    const longitude = Number.isFinite(latest?.longitude) ? latest.longitude : 7.819017;
    const sky = window.DashboardSky.calculate(now, latitude, longitude);
    const night = sky.mode === "moon";
    const title = night ? "Mondverlauf · diese Nacht" : "Sonnenverlauf · heute";
    const marker = byId("sun-marker");
    const track = marker.closest(".sky-card");
    track.classList.toggle("is-night", night);
    byId("sky-title").textContent = title;
    marker.hidden = !sky.visible;
    marker.textContent = night ? sky.moon.symbol : "☀️";
    marker.setAttribute("aria-label", night ? "Mond" : "Sonne");
    marker.style.left = (50 - 50 * Math.cos(Math.PI * sky.fraction)) + "%";
    marker.style.top = (100 - 100 * Math.sin(Math.PI * sky.fraction)) + "%";
    const day = dayKey.format(now);
    function eventTime(date) {
      if (!date || !Number.isFinite(date.getTime())) return "–";
      return clock.format(date) + (dayKey.format(date) !== day ? " · " + dayFormat.format(date) : " Uhr");
    }
    byId("sun-rise").textContent = eventTime(sky.rise);
    byId("sun-noon").textContent = eventTime(sky.peak);
    byId("sun-set").textContent = eventTime(sky.set);
    byId("sun-state").textContent = night && !sky.visible
      ? "Mond unter dem Horizont · nächster Mondaufgang siehe oben"
      : "Jetzt · " + clock.format(now) + " Uhr · Verlauf schematisch";
    byId("moon-phase").textContent = sky.moon.name;
    byId("moon-light").textContent = Math.round(sky.moon.fraction * 100) + " % beleuchtet";
    byId("moon-lit-path").setAttribute("d", sky.moon.path);
    byId("moon-phase-symbol").setAttribute("aria-label", sky.moon.name + " · " + Math.round(sky.moon.fraction * 100) + " Prozent beleuchtet");
  }

  function render(record, offline) {
    const now = new Date();
    const today = dayKey.format(now);
    const { daily, current: outside } = record.data;
    const days = daily.time.map((date, i) => ({ date, i })).filter(day => day.date >= today).slice(0, 3);
    const updated = new Date(record.updatedAt);
    const old = now - updated > 24 * 60 * 60 * 1000;
    const message = (offline || old ? "Letzter verfügbarer Stand · " : "Stand · ") + dashboardBerlinTime.format(updated);
    status.textContent = message;
    detailsStatus.textContent = message;
    for (const id of ["forecast-days", "forecast-overview"]) {
      byId(id).replaceChildren(...days.map(({ i }) => dayCard(daily, i, today)));
    }
    const label = byId("forecast-current");
    label.hidden = offline || old || !Number.isFinite(outside?.temperature_2m);
    label.replaceChildren(iconFor(outside?.weather_code), el("span", "Außen laut Vorhersage · " +
      formatValue(outside?.temperature_2m, "°C") + " · " + formatValue(outside?.relative_humidity_2m, "% Luftfeuchte")));
    renderSky(now);
    renderHours(record.data.hourly, today + "T" + clock.format(now));
  }

  function restoreFocus() { opener?.focus(); }
  close.addEventListener("click", () => {
    if (typeof dialog.close === "function" && dialog.open && !dialog.classList.contains("weather-dialog-fallback")) dialog.close();
    else {
      dialog.removeAttribute("open");
      dialog.classList.remove("weather-dialog-fallback");
      restoreFocus();
    }
  });
  dialog.addEventListener("close", restoreFocus);
  document.querySelectorAll("[data-open-weather]").forEach(trigger => trigger.addEventListener("click", event => {
    event.preventDefault();
    opener = trigger;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else {
      dialog.setAttribute("open", "");
      dialog.classList.add("weather-dialog-fallback");
    }
    close.focus();
  }));

  renderSky(new Date());
  setInterval(() => {
    const now = new Date();
    renderSky(now);
  }, 60000);
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
      else status.textContent = detailsStatus.textContent = "Vorhersage momentan nicht verfügbar.";
    }
  });
})();
