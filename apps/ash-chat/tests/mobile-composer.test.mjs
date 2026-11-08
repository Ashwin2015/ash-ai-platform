import assert from "node:assert/strict";
import test from "node:test";
import { beginAttachment, classifyLocalFile, markFailed, markReady, messageContentForSend, readyAttachmentIds, removeAttachment, sendBlockReason } from "../src/attachments.js";
import { beginSend, classifySendFailure, reconnectNotice } from "../src/send-guard.js";
import { speechRecognitionConstructor, transcriptFromEvent, voiceErrorMessage } from "../src/voice.js";

test("voice errors distinguish permission, unsupported browsers, and a successful transcript", () => {
  assert.equal(speechRecognitionConstructor({}), null);
  assert.match(voiceErrorMessage("not-allowed"), /Microphone permission was denied/);
  assert.match(voiceErrorMessage("service-not-allowed"), /Microphone permission was denied/);
  assert.match(voiceErrorMessage("network"), /internet connection/);
  assert.match(voiceErrorMessage("no-speech"), /No speech was heard/);
  assert.equal(voiceErrorMessage("aborted"), "");
  assert.equal(voiceErrorMessage("network", { captured: true }), "");
  assert.match(voiceErrorMessage("not-allowed", { captured: true }), /Microphone permission was denied/);
  const Speech = function Speech() {};
  assert.equal(speechRecognitionConstructor({ SpeechRecognition: Speech }), Speech);
  assert.equal(speechRecognitionConstructor({ webkitSpeechRecognition: Speech }), Speech);

  const first = transcriptFromEvent("Hello", "", {
    resultIndex: 0,
    results: [{ 0: { transcript: "there" }, isFinal: false }],
  });
  assert.equal(first.captured, "Hello there");
  const confirmed = transcriptFromEvent("Hello", first.finals, {
    resultIndex: 0,
    results: [{ 0: { transcript: "there friend" }, isFinal: true }],
  });
  assert.equal(confirmed.captured, "Hello there friend");
  const repeated = transcriptFromEvent("Hello", confirmed.finals, {
    resultIndex: 0,
    results: [{ 0: { transcript: "there friend" }, isFinal: true }],
  });
  assert.equal(repeated.captured, "Hello there friend");
});

test("image selection creates one preview row and blocks a duplicate file", () => {
  const file = { name: "photo.jpg", type: "image/jpeg", size: 2048, lastModified: 10 };
  const first = beginAttachment([], file, "local-1");
  assert.equal(first.error, "");
  assert.equal(first.item.kind, "image");
  assert.equal(first.item.status, "uploading");
  assert.match(classifyLocalFile({ name: "notes.txt", type: "text/plain", size: 10 }).error, /JPEG, PNG, WebP, and PDF/);
  assert.match(classifyLocalFile({ name: "huge.png", type: "image/png", size: 13 * 1024 * 1024 }).error, /12 MB/);
  const duplicate = beginAttachment(first.list, file, "local-2");
  assert.match(duplicate.error, /already attached/);
  assert.equal(duplicate.list.length, 1);
  const pdf = beginAttachment(first.list, { name: "paper.pdf", type: "application/pdf", size: 5000, lastModified: 11 }, "local-pdf");
  assert.equal(pdf.item.kind, "pdf");
  assert.equal(pdf.list.length, 2);
});

test("upload success, failure, and retry keep the attachment associated with the message", () => {
  const file = { name: "scan.png", type: "image/png", size: 1200, lastModified: 4 };
  let list = beginAttachment([], file, "local-1").list.map((item) => ({ ...item, file }));
  assert.equal(sendBlockReason(list), "Wait for the attachment to finish uploading, or remove it before sending.");
  assert.deepEqual(readyAttachmentIds(list), []);
  list = markFailed(list, "local-1", "Upload failed.");
  assert.match(sendBlockReason(list), /Retry it or remove it/);
  assert.equal(list[0].file, file);
  list = beginAttachment(removeAttachment(list, "local-1"), file, "local-1").list;
  list = markReady(list, "local-1", { id: "att-1", fileName: "scan.png", kind: "image", mimeType: "image/png" });
  assert.equal(sendBlockReason(list), "");
  assert.deepEqual(readyAttachmentIds(list), ["att-1"]);
  assert.equal(messageContentForSend("", list), "(See attached file.)");
  assert.equal(messageContentForSend("Look at this", list), "Look at this");
  assert.equal(list[0].status, "ready");
  assert.equal(list[0].file, undefined);
});

test("offline send keeps the draft and a retry does not start a second request", () => {
  const offline = classifySendFailure(new Error("Failed to fetch"), false);
  assert.equal(offline.kind, "offline");
  assert.match(offline.message, /still here/);
  assert.match(reconnectNotice(), /Tap send/);
  const provider = classifySendFailure(Object.assign(new Error("Groq is busy"), { status: 503, code: "provider_unavailable" }), true);
  assert.equal(provider.kind, "provider");
  const server = classifySendFailure(Object.assign(new Error("Database unavailable"), { status: 500 }), true);
  assert.equal(server.kind, "server");
  assert.equal(classifySendFailure(Object.assign(new Error("stopped"), { name: "AbortError" }), true).kind, "aborted");
  assert.equal(beginSend(false).ok, true);
  assert.equal(beginSend(true).ok, false);
});
