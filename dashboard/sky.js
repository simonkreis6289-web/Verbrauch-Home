// Local astronomical calculations, independent of forecast/API availability.
(function (root) {
  "use strict";
  const astro = typeof module !== "undefined" && module.exports
    ? require("./vendor/suncalc-1.9.0.js") : root.SunCalc;
  const dayMs = 86400000;
  const berlinDay = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" });
  const phaseNames = ["Neumond", "Zunehmende Sichel", "Erstes Viertel", "Zunehmender Mond",
    "Vollmond", "Abnehmender Mond", "Letztes Viertel", "Abnehmende Sichel"];
  const phaseSymbols = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"];
  function highest(rise, set, lat, lon) {
    if (!rise || !set) return null;
    let left = rise.getTime(), right = set.getTime();
    for (let i = 0; i < 28; i++) {
      const a = left + (right - left) / 3;
      const b = right - (right - left) / 3;
      if (astro.getMoonPosition(new Date(a), lat, lon).altitude < astro.getMoonPosition(new Date(b), lat, lon).altitude) left = a;
      else right = b;
    }
    return new Date((left + right) / 2);
  }
  function illuminatedPath(fraction, waxing) {
    const light = Math.max(0, Math.min(1, fraction));
    if (light < .00001) return "";
    const terminator = 1 - 2 * light;
    const radius = Math.max(.0001, Math.abs(terminator) * 44);
    const outer = waxing ? 1 : 0;
    const inner = waxing ? (terminator >= 0 ? 0 : 1) : (terminator >= 0 ? 1 : 0);
    return "M50 6 A44 44 0 0 " + outer + " 50 94 A" + radius + " 44 0 0 " + inner + " 50 6 Z";
  }
  function calculate(now = new Date(), lat = 51.042840, lon = 7.819017) {
    const localNoon = new Date(berlinDay.format(now) + "T12:00:00Z");
    const sun = astro.getTimes(localNoon, lat, lon);
    const illumination = astro.getMoonIllumination(now);
    const phaseIndex = Math.round(illumination.phase * 8) % 8;
    const moon = { ...illumination, name: phaseNames[phaseIndex], symbol: phaseSymbols[phaseIndex],
      path: illuminatedPath(illumination.fraction, illumination.phase < .5) };
    if (now >= sun.sunrise && now < sun.sunset) {
      return { mode: "sun", visible: true, rise: sun.sunrise, set: sun.sunset, peak: sun.solarNoon, moon,
        fraction: (now - sun.sunrise) / (sun.sunset - sun.sunrise) };
    }
    // Collect UTC-day events around now so TV timezone settings and midnight
    // never split a moonrise from the following moonset.
    const events = [];
    for (let offset = -2; offset <= 2; offset++) {
      const times = astro.getMoonTimes(new Date(localNoon.getTime() + offset * dayMs), lat, lon, true);
      for (const type of ["rise", "set"]) if (times[type]) events.push({ type, date: times[type] });
    }
    events.sort((a, b) => a.date - b.date);
    const prior = events.filter(event => event.date <= now).pop();
    const visible = prior?.type === "rise";
    const rise = visible ? prior.date : events.find(event => event.type === "rise" && event.date > now)?.date;
    const set = rise && events.find(event => event.type === "set" && event.date > rise)?.date;
    return { mode: "moon", visible: Boolean(visible && rise && set), rise: rise || null, set: set || null,
      peak: highest(rise, set, lat, lon), moon,
      fraction: rise && set ? Math.max(0, Math.min(1, (now - rise) / (set - rise))) : 0 };
  }
  const api = { calculate, illuminatedPath };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DashboardSky = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
