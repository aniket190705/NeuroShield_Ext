const TELEMETRY_ENDPOINTS = [
  "http://localhost:3000/api/telemetry",
  "http://127.0.0.1:3000/api/telemetry",
  "http://[::1]:3000/api/telemetry"
];
const ACTIVATION_DEDUPE_MS = 500;

let globalTaskSwitches = 0;
let browserIsFocused = true;
let activeContext = {
  windowId: null,
  tabId: null
};
let lastFocusDrivenActivation = null;
let pendingWindowFocus = null;

const sameContext = (left, right) =>
  Boolean(left) &&
  Boolean(right) &&
  left.windowId === right.windowId &&
  left.tabId === right.tabId;

const getActiveContextForWindow = async (windowId) => {
  const tabs = await chrome.tabs.query({ active: true, windowId });
  const [tab] = tabs;

  if (!tab?.id) {
    return null;
  }

  return {
    windowId,
    tabId: tab.id
  };
};

const markTabSwitch = () => {
  globalTaskSwitches += 1;
};

const rememberFocusDrivenActivation = (context) => {
  lastFocusDrivenActivation = {
    ...context,
    timestamp: Date.now()
  };
};

const shouldIgnoreActivatedEvent = (context) => {
  if (!sameContext(lastFocusDrivenActivation, context)) {
    if (
      !pendingWindowFocus ||
      pendingWindowFocus.windowId !== context.windowId ||
      Date.now() - pendingWindowFocus.timestamp >= ACTIVATION_DEDUPE_MS
    ) {
      return false;
    }
  }

  if (
    sameContext(lastFocusDrivenActivation, context) &&
    Date.now() - lastFocusDrivenActivation.timestamp < ACTIVATION_DEDUPE_MS
  ) {
    return true;
  }

  return true;
};

const initializeActiveContext = async () => {
  try {
    const tabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true
    });
    const [tab] = tabs;

    if (tab?.id) {
      activeContext = {
        windowId: tab.windowId,
        tabId: tab.id
      };
    }
  } catch (error) {
    console.error("Failed to initialize active tab context:", error);
  }
};

const postTelemetry = async (payload) => {
  let lastError = null;
  const telemetryPayload = {
    ...payload,
    metrics: {
      ...payload.metrics,
      tab_switches: globalTaskSwitches
    }
  };

  for (const endpoint of TELEMETRY_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(telemetryPayload),
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${endpoint}`);
      }

      globalTaskSwitches = 0;
      return { ok: true, endpoint };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  return { ok: false, error: lastError || "All loopback endpoints failed" };
};

chrome.runtime.onInstalled.addListener(() => {
  initializeActiveContext();
});

chrome.runtime.onStartup.addListener(() => {
  initializeActiveContext();
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  const nextContext = {
    windowId: activeInfo.windowId,
    tabId: activeInfo.tabId
  };

  if (shouldIgnoreActivatedEvent(nextContext)) {
    activeContext = nextContext;
    lastFocusDrivenActivation = null;
    pendingWindowFocus = null;
    return;
  }

  if (
    browserIsFocused &&
    activeContext.tabId !== null &&
    !sameContext(activeContext, nextContext)
  ) {
    markTabSwitch();
  }

  activeContext = nextContext;
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    if (browserIsFocused) {
      markTabSwitch();
    }

    browserIsFocused = false;
    pendingWindowFocus = null;
    return;
  }

  browserIsFocused = true;
  pendingWindowFocus = {
    windowId,
    timestamp: Date.now()
  };

  try {
    const nextContext = await getActiveContextForWindow(windowId);

    if (!nextContext) {
      return;
    }

    if (activeContext.tabId !== null && !sameContext(activeContext, nextContext)) {
      markTabSwitch();
    }

    activeContext = nextContext;
    rememberFocusDrivenActivation(nextContext);
  } catch (error) {
    console.error("Failed to update focused window context:", error);
  }
});

initializeActiveContext();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "SEND_TELEMETRY") {
    return false;
  }

  postTelemetry(message.payload)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });

  return true;
});
