export function beginSend(inFlight) {
  if (inFlight) return { ok: false, inFlight: true };
  return { ok: true, inFlight: true };
}

export function classifySendFailure(error, online = true) {
  if (error?.name === "AbortError") return { kind: "aborted", message: "" };
  const status = Number(error?.status) || 0;
  const code = error?.code || "";
  const message = String(error?.message || "");
  if (!online || /cannot reach|could not reach|failed to fetch|networkerror|network request failed/i.test(message)) {
    return {
      kind: "offline",
      message: "You are offline. Cloud AI needs a connection. Your message and attachments are still here. Tap send when you are back online.",
    };
  }
  if (status === 401) return { kind: "auth", message };
  if (code === "rate_limited" || code === "provider_unavailable") {
    return {
      kind: "provider",
      message: message || "The AI provider could not finish this reply. Your draft was kept. Tap send to try again.",
    };
  }
  if (status >= 500) {
    return {
      kind: "server",
      message: message || "The server could not complete this message. Your draft was kept. Tap send to try again.",
    };
  }
  if (status >= 400) return { kind: "request", message: message || "The message was not accepted." };
  return {
    kind: "unknown",
    message: message || "The response could not be completed. Your draft was kept.",
  };
}

export function reconnectNotice() {
  return "Back online. Your draft is still in the composer. Tap send when you want to retry.";
}
