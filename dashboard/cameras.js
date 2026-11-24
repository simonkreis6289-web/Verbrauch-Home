import { readCameraServer } from "./camera-settings.js";

const localCameraView = new URLSearchParams(location.search).get("kameras") === "live";
const server = readCameraServer();
const tiles = document.querySelectorAll("#camera-grid [data-stream]");

if (localCameraView || server) {
  document.getElementById("camera-status").hidden = true;
  for (const tile of tiles) {
    tile.classList.add("camera-live");
    if (localCameraView) {
      document.querySelector(".brand").href = "https://simonkreis6289-web.github.io/Verbrauch-Home/";
      const playerUrl = new URL("stream.html", location.href);
      playerUrl.searchParams.set("src", tile.dataset.stream);
      playerUrl.searchParams.set("mode", "webrtc");
      const iframe = document.createElement("iframe");
      iframe.title = "Livebild " + tile.textContent.trim();
      iframe.allow = "autoplay; fullscreen";
      iframe.allowFullscreen = true;
      iframe.src = playerUrl.href;
      tile.append(iframe);
    } else {
      startCamera(tile, server);
    }
  }
}

function startCamera(tile, serverAddress) {
  const url = new URL(serverAddress + "/api/ws");
  url.protocol = "wss:";
  url.searchParams.set("src", tile.dataset.stream);

  const player = document.createElement("div");
  player.className = "camera-player";
  const video = document.createElement("video");
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute("aria-label", "Livebild " + tile.textContent.trim());
  const status = document.createElement("p");
  status.className = "camera-feedback";
  status.textContent = "Verbindung wird aufgebaut …";
  player.append(video, status);
  tile.append(player);

  let stop = () => {};
  let retry;
  let failed = false;

  function connect() {
    clearTimeout(retry);
    if (document.hidden) return;
    if (!window.RTCPeerConnection) {
      status.textContent = "WebRTC ist in diesem Browser nicht verfügbar.";
      return;
    }

    const peer = new RTCPeerConnection();
    const socket = new WebSocket(url.href);
    const connectionTimer = setTimeout(unavailable, 12000);
    const incoming = [];
    const outgoing = [];
    let active = true;
    let offerSent = false;
    let lastTime = -1;
    let lastProgress = Date.now();
    const monitor = setInterval(() => {
      if (video.currentTime !== lastTime) {
        lastTime = video.currentTime;
        lastProgress = Date.now();
      } else if (Date.now() - lastProgress > 12000) {
        unavailable();
      }
    }, 2000);

    stop = () => {
      active = false;
      clearTimeout(connectionTimer);
      clearInterval(monitor);
      socket.close();
      peer.close();
      video.srcObject = null;
      status.hidden = false;
    };

    function unavailable() {
      if (!active) return;
      stop();
      failed = true;
      status.textContent = "Kamera nicht erreichbar";
      retry = setTimeout(connect, 15000);
    }

    video.onplaying = () => {
      if (!active || !video.videoWidth) return;
      clearTimeout(connectionTimer);
      failed = false;
      status.hidden = true;
      lastProgress = Date.now();
    };
    peer.ontrack = event => {
      video.srcObject = event.streams[0] || new MediaStream([event.track]);
      video.play().catch(unavailable);
    };
    peer.addTransceiver("video", { direction: "recvonly" });
    const send = (type, value) => socket.send(JSON.stringify({ type, value }));
    peer.onicecandidate = ({ candidate }) => {
      const value = candidate?.candidate || "";
      if (offerSent && socket.readyState === WebSocket.OPEN) send("webrtc/candidate", value);
      else if (!offerSent) outgoing.push(value);
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed") unavailable();
    };
    socket.onopen = async () => {
      try {
        await peer.setLocalDescription(await peer.createOffer());
        if (!active) return;
        send("webrtc/offer", peer.localDescription.sdp);
        offerSent = true;
        for (const candidate of outgoing) send("webrtc/candidate", candidate);
      } catch {
        unavailable();
      }
    };
    let signaling = Promise.resolve();
    socket.onmessage = event => {
      signaling = signaling.then(async () => {
        if (!active) return;
        const message = JSON.parse(event.data);
        if (message.type === "webrtc/answer") {
          await peer.setRemoteDescription({ type: "answer", sdp: message.value });
          for (const candidate of incoming.splice(0)) await peer.addIceCandidate(candidate);
        } else if (message.type === "webrtc/candidate") {
          const candidate = { candidate: message.value, sdpMid: "0" };
          if (peer.remoteDescription) await peer.addIceCandidate(candidate);
          else incoming.push(candidate);
        } else if (message.type === "error") {
          unavailable();
        }
      }).catch(unavailable);
    };
    socket.onerror = unavailable;
    socket.onclose = () => {
      if (!status.hidden) unavailable();
    };
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stop();
      clearTimeout(retry);
    } else {
      if (!failed) status.textContent = "Verbindung wird aufgebaut …";
      connect();
    }
  });
  connect();
}
