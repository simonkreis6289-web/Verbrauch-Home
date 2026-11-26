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
  const phases = [
    ["🌑", "Neumond"], ["🌒", "Zunehmende Sichel"], ["🌓", "Erstes Viertel"],
    ["🌔", "Zunehmender Mond"], ["🌕", "Vollmond"], ["🌖", "Abnehmender Mond"],
    ["🌗", "Letztes Viertel"], ["🌘", "Abnehmende Sichel"]
  ];
  const weatherCodes = [
    [0, "☀️", "Sonnig"], [2, "🌤️", "Teilweise bewölkt"], [3, "☁️", "Bewölkt"],
    [48, "🌫️", "Nebel"], [57, "🌦️", "Nieselregen"], [67, "🌧️", "Regen"],
    [77, "🌨️", "Schnee"], [82, "🌦️", "Regenschauer"], [86, "❄️", "Schneeschauer"],
    [99, "⛈️", "Gewitter"]
  ];
  let latest;
  const skyDays = new Map();
  try { for (const [key, value] of JSON.parse(localStorage.getItem("dashboard-sky-days") || "[]")) skyDays.set(key, value); } catch {}
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
  const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const timeLabel = value => {
    const rounded = Math.round(value);
    return String(Math.floor(((rounded % 1440 + 1440) % 1440) / 60)).padStart(2, "0") + ":" + String((rounded % 60 + 60) % 60).padStart(2, "0") + " Uhr";
  };

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

  function renderSky(daily, index, now) {
    const clockTime = clock.format(now);
    if (daily?.time) {
      daily.time.forEach((date, i) => {
        const rise = daily.sunrise?.[i]?.slice(11, 16), set = daily.sunset?.[i]?.slice(11, 16);
        if (rise && set) skyDays.set(date, {rise, set});
      });
      try { localStorage.setItem("dashboard-sky-days", JSON.stringify([...skyDays].sort().slice(-14))); } catch {}
    }
    const adjacent = offset => { const d = new Date(dayKey.format(now) + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + offset); return skyDays.get(dayKey.format(d)); };
    const rise = adjacent(0)?.rise;
    const set = adjacent(0)?.set;
    const daylight = /^\d\d:\d\d$/;
    const available = daylight.test(rise || "") && daylight.test(set || "") && minutes(set) > minutes(rise);
    const sun = byId("sun-marker");
    sun.hidden = !available;
    if (available) {
      const start = minutes(rise), end = minutes(set), current = minutes(clockTime);
      const night = current < start || current >= end;
      const nextRise = adjacent(1)?.rise;
      const prevSet = adjacent(-1)?.set;
      const nightStart = current < start ? (daylight.test(prevSet || "") ? minutes(prevSet) : end) - 1440 : end;
      const nightEnd = current < start ? start : 1440 + (daylight.test(nextRise || "") ? minutes(nextRise) : start);
      const fraction = Math.max(0, Math.min(1, night ? (current - nightStart) / (nightEnd - nightStart) : (current - start) / (end - start)));
      sun.textContent = night ? "🌙" : "☀️";
      sun.parentElement.classList.toggle("night-track", night);
      byId("sky-title").textContent = night ? "Nachtverlauf · schematisch" : "Sonnenverlauf · heute";
      sun.style.left = (50 - 50 * Math.cos(Math.PI * fraction)) + "%";
      sun.style.top = (100 - 100 * Math.sin(Math.PI * fraction)) + "%";
      byId("sky-rise-label").textContent = night ? "Mondaufgang" : "Sonnenaufgang";
      byId("sky-set-label").textContent = night ? "Monduntergang" : "Sonnenuntergang";
      byId("sky-middle-label").textContent = night ? "Nachtmitte ca." : "Höchststand ca.";
      const approximate = night && !(current < start ? daylight.test(prevSet || "") : daylight.test(nextRise || ""));
      byId("sun-rise").textContent = (approximate && current < start ? "ca. " : "") + timeLabel(night ? nightStart : start);
      byId("sun-noon").textContent = timeLabel(night ? (nightStart + nightEnd) / 2 : (start + end) / 2);
      byId("sun-set").textContent = (approximate && current >= start ? "ca. " : "") + timeLabel(night ? nightEnd : end);
      byId("sun-state").textContent = night ? "Nacht · Mondposition symbolisch" : "Jetzt · " + clockTime + " Uhr · Sonnenhöhe schematisch";
    } else {
      for (const id of ["sun-rise", "sun-noon", "sun-set"]) byId(id).textContent = "–";
      byId("sun-state").textContent = "Auf- und Untergang für heute nicht verfügbar.";
    }
    // The same mean synodic cycle used in the app's moon display.
    const cycle = (((now.getTime() / 86400000 + 2440587.5 - 2451550.1) / 29.530588853) % 1 + 1) % 1;
    const [symbol, name] = phases[Math.round(cycle * 8) % 8];
    const moon = byId("moon-marker");
    moon.textContent = symbol;
    byId("moon-phase-icon").textContent = symbol;
    moon.style.left = (50 + 50 * Math.cos(cycle * 2 * Math.PI)) + "%";
    moon.style.top = (50 - 50 * Math.sin(cycle * 2 * Math.PI)) + "%";
    byId("moon-phase").textContent = name;
    byId("moon-light").textContent = "Ca. " + Math.round((1 - Math.cos(2 * Math.PI * cycle)) * 50) + " % beleuchtet";
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
    renderSky(daily, daily.time.indexOf(today), now);
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

  renderSky(null, -1, new Date());
  setInterval(() => {
    const now = new Date();
    const daily = latest?.data.daily;
    renderSky(daily, daily?.time.indexOf(dayKey.format(now)) ?? -1, now);
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
