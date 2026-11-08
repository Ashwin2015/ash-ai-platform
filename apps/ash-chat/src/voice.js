/** Browser speech-to-text helpers. Chrome on Android uses an online recognizer. */

export function speechRecognitionConstructor(root = globalThis) {
  return root.SpeechRecognition || root.webkitSpeechRecognition || null;
}

export function voiceErrorMessage(code, { captured = false, offline = false } = {}) {
  if (captured && code !== "not-allowed" && code !== "service-not-allowed") return "";
  if (offline || code === "network") {
    return "Voice transcription needs an internet connection. You can type instead.";
  }
  if (code === "not-allowed" || code === "service-not-allowed") {
    return "Microphone permission was denied. Allow the microphone for this site, or type your message.";
  }
  if (code === "audio-capture") return "No microphone was found. You can type instead.";
  if (code === "no-speech") return "No speech was heard. Tap the microphone and try again, or type.";
  if (code === "aborted") return "";
  if (code === "language-not-supported") return "This browser cannot transcribe that language. You can type instead.";
  return "Voice input could not be completed. You can type instead.";
}

export function mergeTranscript(current, next) {
  const spoken = String(next || "").replace(/\s+/g, " ").trim();
  const base = String(current || "").replace(/\s+$/g, "");
  if (!spoken) return base;
  if (base === spoken || base.endsWith(` ${spoken}`)) return base;
  return base ? `${base} ${spoken}` : spoken;
}

export function transcriptFromEvent(baseText, committedFinals, event) {
  const results = event?.results || [];
  const start = Number.isInteger(event?.resultIndex) ? event.resultIndex : 0;
  let finals = committedFinals || "";
  let interim = "";
  for (let index = start; index < results.length; index += 1) {
    const result = results[index];
    const piece = result?.[0]?.transcript || "";
    if (result?.isFinal) finals = mergeTranscript(finals, piece);
    else interim = String(piece).replace(/\s+/g, " ").trim();
  }
  return {
    finals,
    interim,
    captured: mergeTranscript(baseText, [finals, interim].filter(Boolean).join(" ")),
  };
}
