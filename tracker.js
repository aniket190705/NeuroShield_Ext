(() => {
  let keystrokes = 0;
  let mouseDistance = 0;
  let lastMousePos = null;

  const sendTelemetry = (payload) => {
    chrome.runtime.sendMessage({ type: "SEND_TELEMETRY", payload }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Telemetry send failed:", chrome.runtime.lastError.message);
        return;
      }

      if (!response?.ok) {
        console.error("Telemetry send failed:", response?.error || "Unknown error");
      }
    });
  };

  document.addEventListener(
    "keydown",
    () => {
        keystrokes += 1;
    },
    { passive: true }
  );

  document.addEventListener(
    "mousemove",
    (event) => {
      const currentMousePos = { x: event.clientX, y: event.clientY };

      if (lastMousePos) {
        const deltaX = currentMousePos.x - lastMousePos.x;
        const deltaY = currentMousePos.y - lastMousePos.y;
        mouseDistance += Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      }

      lastMousePos = currentMousePos;
    },
    { passive: true }
  );

  const isPageActive = () =>
    document.visibilityState === "visible" && document.hasFocus();

  setInterval(() => {
    if (!isPageActive()) {
      return;
    }

    const payload = {
      timestamp: new Date().toISOString(),
      metrics: {
        keys_pressed: keystrokes,
        mouse_travel_pixels: Math.round(mouseDistance),
        tab_switches: 0
      }
    };

    keystrokes = 0;
    mouseDistance = 0;

    sendTelemetry(payload);
  }, 5000);
})();
