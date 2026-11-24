const localCameraView = new URLSearchParams(location.search).get("kameras") === "live";
if (localCameraView) {
  document.querySelector(".brand").href = "https://simonkreis6289-web.github.io/Verbrauch-Home/";
  document.getElementById("camera-status").hidden = true;
  for (const tile of document.querySelectorAll("#camera-grid [data-stream]")) {
    const playerUrl = new URL("stream.html", location.href);
    playerUrl.searchParams.set("src", tile.dataset.stream);
    playerUrl.searchParams.set("mode", "webrtc");

    const player = document.createElement("iframe");
    player.title = "Livebild " + tile.textContent.trim();
    player.allow = "autoplay; fullscreen";
    player.allowFullscreen = true;
    player.src = playerUrl.href;
    tile.classList.add("camera-live");
    tile.append(player);
  }
}
