(function () {
  "use strict";
  const mode = window.matchMedia("(min-width: 900px) and (min-height: 500px)");
  const panels = [...document.querySelectorAll(".tv-grid .panel:not(.weather)")];
  const entries = panels.map(panel => {
    const content = document.createElement("div");
    content.className = "panel-fit-content";
    while (panel.firstChild) content.append(panel.firstChild);
    panel.append(content);
    return { panel, content };
  });
  let queued = false;
  function fit() {
    queued = false;
    for (const { panel, content } of entries) {
      content.style.transform = "none";
      content.style.width = "auto";
      if (!mode.matches) continue;
      const style = getComputedStyle(panel);
      const width = panel.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const height = panel.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      if (width <= 0 || height <= 0) continue;
      // Expanding the unscaled width preserves the full visible panel width
      // and lets long labels reflow as the content is made smaller.
      function fits(scale) {
        content.style.width = (width / scale) + "px";
        return content.scrollHeight * scale <= height - 1 && content.scrollWidth * scale <= width + .5;
      }
      let scale = 1;
      if (!fits(1)) {
        let low = .02;
        let high = 1;
        for (let i = 0; i < 12; i++) {
          const middle = (low + high) / 2;
          if (fits(middle)) low = middle;
          else high = middle;
        }
        scale = low;
      }
      content.style.width = (width / scale) + "px";
      content.style.transform = "scale(" + scale + ")";
    }
  }
  function schedule() {
    if (!queued) { queued = true; requestAnimationFrame(fit); }
  }
  if ("ResizeObserver" in window) {
    const resize = new ResizeObserver(schedule);
    panels.forEach(panel => resize.observe(panel));
  }
  const mutations = new MutationObserver(schedule);
  panels.forEach(panel => mutations.observe(panel, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ["hidden", "class"]
  }));
  window.addEventListener("resize", schedule);
  document.addEventListener("fullscreenchange", schedule);
  document.addEventListener("visibilitychange", schedule);
  document.addEventListener("load", schedule, true);
  if (document.fonts?.ready) document.fonts.ready.then(schedule);
  fit();
})();
