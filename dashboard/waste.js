(function () {
  "use strict";
  const calendar = window.WasteCalendar;
  const container = document.getElementById("waste-bins");
  const specialList = document.getElementById("waste-specials");
  const status = document.getElementById("waste-status");
  if (!container || !calendar) return;
  const dateFormat = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin", weekday: "short", day: "2-digit", month: "2-digit"
  });
  const coverageFormat = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric"
  });
  let latest = null;
  let loading = false;
  let lastLoad = 0;
  let failed = false;
  const dataUrl = new URL("waste-data.json", document.currentScript.src);

  function text(parent, tag, value, className) {
    const node = document.createElement(tag);
    node.textContent = value;
    if (className) node.className = className;
    parent.append(node);
    return node;
  }
  function binIcon(color) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 40 48");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("waste-icon");
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", "M10 12h24l-3 29H13z M8 7h28v5H8z M17 3h11v4H17z M11 8H5v10 M19 18v17 M26 18v17");
    path.setAttribute("fill", color);
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.7");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
    [16, 29].forEach(x => {
      const wheel = document.createElementNS(svg.namespaceURI, "circle");
      wheel.setAttribute("cx", String(x));
      wheel.setAttribute("cy", "43");
      wheel.setAttribute("r", "2.5");
      wheel.setAttribute("fill", "currentColor");
      svg.append(wheel);
    });
    return svg;
  }
  function dateLabel(date) {
    return dateFormat.format(new Date(date + "T12:00:00Z"));
  }
  function relative(date, today) {
    const days = calendar.dayNumber(date) - calendar.dayNumber(today);
    return days === 0 ? "Heute" : days === 1 ? "Morgen" : "In " + days + " Tagen";
  }
  function render() {
    const selected = latest ? calendar.select(latest) : null;
    container.replaceChildren();
    for (const bin of selected?.bins || calendar.bins) {
      const tile = document.createElement("article");
      tile.className = "waste-bin";
      if (bin.event && bin.event.date === selected.nearest) tile.classList.add("is-next");
      tile.append(binIcon(bin.color));
      const details = document.createElement("div");
      tile.append(details);
      text(details, "h4", bin.label);
      const time = text(details, "time", bin.event ? dateLabel(bin.event.date) : "Termin folgt");
      if (bin.event) time.dateTime = bin.event.date;
      text(details, "small", bin.event ? relative(bin.event.date, selected.today) : bin.material);
      container.append(tile);
    }
    specialList.replaceChildren();
    for (const event of selected?.specials || []) {
      const row = document.createElement("li");
      const label = text(row, "span", event.label || "Sonderabfuhr");
      if (event.registrationRequired) text(label, "small", "Anmeldung erforderlich");
      else if (event.collection === false) text(label, "small", "Bringsystem");
      const time = text(row, "time", dateLabel(event.date));
      time.dateTime = event.date;
      specialList.append(row);
    }
    specialList.hidden = !specialList.children.length;
    if (latest) document.getElementById("waste-place").textContent = latest.location;
    if (!latest) status.textContent = failed ? "Abfuhrtermine momentan nicht verfügbar." : "Abfuhrtermine werden geladen …";
    else if (!selected.covered || selected.bins.some(bin => !bin.event)) {
      status.textContent = "Weitere Abfuhrtermine müssen ergänzt werden · Stand bis " +
        coverageFormat.format(new Date(latest.validThrough + "T12:00:00Z"));
    } else status.textContent = failed ? "Gespeicherte Termine · Aktualisierung momentan nicht möglich" : "";
    status.hidden = !status.textContent;
  }
  async function load() {
    if (loading || document.hidden) return;
    loading = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(dataUrl.href, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Abfuhrdaten nicht erreichbar");
      const data = await response.json();
      calendar.select(data);
      latest = data;
      failed = false;
      lastLoad = Date.now();
    } catch {
      failed = true;
    } finally {
      clearTimeout(timeout);
      loading = false;
      render();
    }
  }
  render();
  load();
  setInterval(() => {
    if (document.hidden) return;
    render();
    if (Date.now() - lastLoad >= 5 * 60 * 1000) load();
  }, 60000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { render(); load(); }
  });
})();
