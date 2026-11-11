import { api } from "./api-client.js";
import { beginAttachment, formatBytes, markFailed, markReady, messageContentForSend, readyAttachmentIds, removeAttachment, sendBlockReason } from "./attachments.js";
import { clearSessionToken, getSessionToken, saveSessionToken } from "./auth.js";
import { ChatState } from "./chat-state.js";
import { renderMarkdown } from "./markdown.js";
import { beginSend, classifySendFailure, reconnectNotice } from "./send-guard.js";
import { speakableText, speechRecognitionConstructor, speechSynthesisAvailable, transcriptFromEvent, voiceErrorMessage } from "./voice.js";

const root = document.querySelector("#app");
const state = new ChatState();
let authMode = "login";
let mobileSidebarOpen = false;
let networkOnline = navigator.onLine !== false;
let connectionNotice = "";
let currentRequestId = 0;
let sendInFlight = false;
let replaceLocalId = "";
let voiceRecognition = null;
let voiceStopRequested = false;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
})[character]);

function draftKey(conversationId) {
  return `ash-chat-draft:${conversationId || "new"}`;
}

function draftFor(conversationId) {
  try { return sessionStorage.getItem(draftKey(conversationId)) || ""; } catch { return ""; }
}

function saveDraft(conversationId, value) {
  try {
    const key = draftKey(conversationId);
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {}
}

function attachmentKey(conversationId) {
  return `ash-chat-attachments:${conversationId || "new"}`;
}

function persistReadyAttachments() {
  try {
    const ready = state.pendingAttachments
      .filter((item) => item.status === "ready" && item.attachmentId)
      .map(({ localId, fileName, mimeType, size, lastModified, kind, attachmentId }) => ({
        localId, fileName, mimeType, size, lastModified, kind, attachmentId, status: "ready", progress: 100, error: "", previewUrl: "",
      }));
    const key = attachmentKey(state.activeConversationId);
    if (ready.length) sessionStorage.setItem(key, JSON.stringify(ready));
    else sessionStorage.removeItem(key);
  } catch {}
}

function restoreReadyAttachments(conversationId) {
  try {
    const raw = sessionStorage.getItem(attachmentKey(conversationId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => item && item.attachmentId && item.status === "ready") : [];
  } catch {
    return [];
  }
}

function releaseAttachmentPreviews(items) {
  for (const item of items) {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  }
}

function renderAttachmentCards() {
  return state.pendingAttachments.map((item) => {
    const status = item.status === "uploading"
      ? `Uploading ${item.progress || 0}%`
      : item.status === "error"
        ? item.error || "Upload failed."
        : `${item.kind === "pdf" ? "PDF" : "Image"} · ${formatBytes(item.size)} · Uploaded. Not analysed yet.`;
    const preview = item.previewUrl
      ? `<img src="${escapeHtml(item.previewUrl)}" alt="">`
      : `<span class="attachment-file-mark">${item.kind === "pdf" ? "PDF" : "IMG"}</span>`;
    return `<article class="attachment-card" data-local-id="${escapeHtml(item.localId)}">
      ${preview}
      <div class="attachment-meta">
        <strong>${escapeHtml(item.fileName || "attachment")}</strong>
        <span class="attachment-status">${escapeHtml(status)}</span>
        ${item.status === "uploading" ? `<div class="attachment-progress" aria-hidden="true"><span style="width:${Number(item.progress) || 0}%"></span></div>` : ""}
        <div class="attachment-actions">
          ${item.status === "error" ? `<button data-action="retry-attachment" data-id="${escapeHtml(item.localId)}" type="button">Retry</button>` : ""}
          <button data-action="replace-attachment" data-id="${escapeHtml(item.localId)}" type="button">Replace</button>
          <button data-action="remove-attachment" data-id="${escapeHtml(item.localId)}" type="button">Remove</button>
        </div>
      </div>
    </article>`;
  }).join("");
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.style.colorScheme = state.theme;
  try { localStorage.setItem("ash-chat-theme", state.theme); } catch {}
}

function capabilities(model) {
  const items = [];
  if (model.capabilities?.textInput && model.capabilities?.textOutput) items.push("Text");
  if (model.capabilities?.streaming) items.push("Streaming");
  if (model.capabilities?.imageInput) items.push("Image");
  if (model.capabilities?.pdfDirectInput) items.push("PDF");
  if (model.capabilities?.pdfTextPreprocessing) items.push("PDF text");
  if (model.capabilities?.toolCalling) items.push("Tools");
  if (model.capabilities?.embeddings) items.push("Embeddings");
  return items.length ? items : ["No supported chat capabilities"];
}

function modelDetails(model) {
  if (!model) return "No available models";
  const supported = capabilities(model).join(" · ");
  const native = [];
  if (model.nativeCapabilities?.imageInput && !model.capabilities?.imageInput) native.push("Vision is not enabled");
  if (model.nativeCapabilities?.toolCalling && !model.capabilities?.toolCalling) native.push("Tools are not enabled");
  return [supported, ...native].join(" · ");
}

function renderLogin() {
  applyTheme();
  root.innerHTML = `
    <main class="auth-shell">
      <section class="auth-card" aria-labelledby="auth-title">
        <div class="brand-lockup"><span class="brand-mark">A</span><span>ASH <b>CHAT</b></span></div>
        <p class="eyebrow">ASH AI</p>
        <h1 id="auth-title">${authMode === "login" ? "Welcome back." : "Create your account."}</h1>
        <p class="auth-copy">${authMode === "login"
          ? "Sign in with the same email on this computer and your phone. Each account sees only its own chats, files, and memory."
          : "Create an account with your own email and a password of at least 12 characters. Voice input needs microphone permission and a connection. The + button attaches a JPEG, PNG, WebP, or PDF from the camera, gallery, or files. Uploading a file does not by itself mean it was analysed. Cloud AI does not run in airplane mode."}</p>
        <form id="auth-form" class="auth-form">
          <label for="email">Email</label>
          <input id="email" name="email" type="email" autocomplete="username" maxlength="254" required>
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="${authMode === "login" ? "current-password" : "new-password"}" minlength="12" maxlength="1024" required>
          ${authMode === "register" ? `<label for="invite-code">Invite code</label>
          <input id="invite-code" name="inviteCode" type="password" autocomplete="off" maxlength="256" required>` : ""}
          <button class="primary-button auth-submit" type="submit">${authMode === "login" ? "Sign in" : "Create account"} <span>→</span></button>
          <p class="form-error" id="auth-error" role="alert" hidden></p>
        </form>
        <button class="text-button auth-switch" id="auth-switch" type="button">${authMode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}</button>
        <div class="privacy-note"><span class="status-dot online"></span> Provider keys stay on the server</div>
      </section>
    </main>`;
  root.querySelector("#auth-switch").addEventListener("click", () => {
    authMode = authMode === "login" ? "register" : "login";
    renderLogin();
  });
  root.querySelector("#auth-form").addEventListener("submit", (event) => {
    void submitAuth(event);
  });
}

async function submitAuth(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const button = form.querySelector(".auth-submit");
  const errorNode = form.querySelector("#auth-error");
  button.disabled = true;
  button.textContent = authMode === "login" ? "Signing in…" : "Creating account…";
  errorNode.hidden = true;
  try {
    const result = authMode === "login"
      ? await api.login(String(data.get("email")), String(data.get("password")))
      : await api.register(String(data.get("email")), String(data.get("password")), String(data.get("inviteCode") || ""));
    saveSessionToken(result.accessToken, result.csrfToken);
    state.user = result.user;
    state.error = "";
    await loadApplication();
  } catch (error) {
    errorNode.textContent = error.message || "Authentication failed.";
    errorNode.hidden = false;
    button.disabled = false;
    button.textContent = authMode === "login" ? "Sign in →" : "Create account →";
  }
}

function renderModelOptions() {
  const routingModes = [
    ["auto", "AUTO — FREE FIRST"],
    ["local_only", "LOCAL ONLY"],
    ["free_cloud", "FREE CLOUD"],
  ].map(([mode, label]) =>
    `<option value="${mode}" ${state.selectedMode === mode ? "selected" : ""}>${label}</option>`,
  ).join("");
  const models = state.models.filter((model) => model.capabilities?.textOutput).map((model) => {
    const value = encodeURIComponent(JSON.stringify([model.providerId, model.id]));
    const selected = state.selectedMode === "manual" &&
      state.selectedProviderId === model.providerId && state.selectedModelId === model.id;
    const price = model.pricing === "free" ? "Free" : model.pricing === "limited_free" ? "Limited free" : model.pricing === "paid" ? "Paid" : "Pricing unknown";
    return `<option value="${value}" ${selected ? "selected" : ""}>${escapeHtml(model.displayName)} · ${price}</option>`;
  }).join("");
  return routingModes + models;
}

function activeModel() {
  if (state.selectedMode === "auto") return state.actualModel;
  return state.models.find((model) =>
    model.providerId === state.selectedProviderId && model.id === state.selectedModelId,
  ) || null;
}

function providerStatus() {
  const providers = state.health?.providers || {};
  const parts = Object.entries(providers).map(([name, info]) => {
    if (!info) return "";
    if (info.available) return `${name} online`;
    if (info.configured) return `${name} unavailable`;
    return `${name} not configured`;
  }).filter(Boolean);
  return parts.join(" · ") || "Waiting for providers";
}

function renderConversationList() {
  if (state.loading) return `<div class="history-loading"><span class="spinner"></span> Loading conversations</div>`;
  if (!state.conversations.length) return `<div class="history-empty">Your conversations will appear here.</div>`;
  return state.conversations.map((conversation) => `
    <div class="history-row ${conversation.id === state.activeConversationId ? "selected" : ""}">
      <button class="history-open" data-action="open-conversation" data-id="${escapeHtml(conversation.id)}" type="button">
        <span class="history-glyph">◷</span>
        <span class="history-copy"><span class="history-title">${escapeHtml(conversation.title)}</span><span class="history-meta">${conversation.messageCount ?? 0} messages</span></span>
      </button>
      <button class="icon-button history-delete" data-action="rename-conversation" data-id="${escapeHtml(conversation.id)}" type="button" aria-label="Rename" title="Rename">✎</button>
      <button class="icon-button history-delete" data-action="delete-conversation" data-id="${escapeHtml(conversation.id)}" type="button" aria-label="Delete ${escapeHtml(conversation.title)}" title="Delete conversation">×</button>
    </div>`).join("");
}

function renderProjects() {
  return state.projects.map((project) => `
    <button class="history-open ${project.id === state.activeProjectId ? "selected" : ""}" data-action="select-project" data-id="${escapeHtml(project.id)}" type="button">
      <span class="history-copy"><span class="history-title">${escapeHtml(project.name)}</span><span class="history-meta">${project.localOnly ? "Local only" : "Mixed routing"}</span></span>
    </button>`).join("") + `<button class="text-button" data-action="new-project" type="button">＋ New project</button>`;
}

function renderMemories() {
  if (!state.memories.length) return `<div class="history-empty">Approved memories appear here after you save them.</div>`;
  return state.memories.map((memory) => `
    <div class="history-row">
      <span class="history-copy"><span class="history-title">${escapeHtml(memory.content)}</span><span class="history-meta">${memory.scope} · ${memory.status}</span></span>
      ${memory.status === "pending" ? `<button class="icon-button" data-action="approve-memory" data-id="${escapeHtml(memory.id)}" type="button">✓</button>` : ""}
      <button class="icon-button history-delete" data-action="delete-memory" data-id="${escapeHtml(memory.id)}" type="button">×</button>
    </div>`).join("");
}

function renderMessages() {
  if (!state.activeConversationId) {
    return `<section class="welcome-state">
      <div class="welcome-icon">✳</div>
      <p class="eyebrow">YOUR PRIVATE AI SPACE</p>
      <h1>What would you<br><em>like to explore?</em></h1>
      <p>AUTO chooses a free local or free-cloud model for the task. Attach images or PDFs when you need them.</p>
    </section>`;
  }
  if (!state.messages.length && !state.sending) {
    return `<section class="welcome-state compact-welcome">
      <div class="welcome-icon">✳</div><h1>New conversation</h1>
      <p>Write a message below to begin.</p>
    </section>`;
  }
  const messages = state.messages.map((message) => renderMessage(message)).join("");
  const streaming = state.sending
    ? `<article class="message assistant"><div class="message-avatar">A</div><div class="message-body"><div class="message-heading">ASH <span>AI</span></div>${state.actualModel ? `<div class="message-model">${escapeHtml(modelLabel(state.actualModel))}</div>` : ""}${state.streamingText
      ? `<div class="markdown">${renderMarkdown(state.streamingText)}</div>`
      : `<div class="thinking"><i></i><i></i><i></i><span>Thinking</span></div>`}${state.latestResearch?.length ? `<div class="source-list">${state.latestResearch.map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title || source.url)}</a>`).join("")}</div>` : ""}</div></article>`
    : "";
  return `<div class="message-list" id="message-list">${messages}${streaming}<div id="messages-end"></div></div>`;
}

function messageMeta(message) {
  try { return JSON.parse(message.metadata || "{}"); } catch { return {}; }
}

function modelLabel(modelLike) {
  if (!modelLike) return "";
  const name = modelLike.displayName || modelLike.modelId || modelLike.id || "";
  const provider = modelLike.providerId || "";
  const pricing = modelLike.pricing === "limited_free" ? "limited free" : modelLike.pricing || "";
  return [name, provider, pricing].filter(Boolean).join(" · ");
}

function renderMessage(message) {
  const assistant = message.role === "assistant";
  const meta = messageMeta(message);
  const usedModel = assistant ? modelLabel({
    displayName: meta.displayName,
    modelId: meta.modelId,
    providerId: meta.providerId,
    pricing: meta.pricing,
  }) : "";
  return `<article class="message ${assistant ? "assistant" : "user"}">
    <div class="message-avatar">${assistant ? "A" : "Y"}</div>
    <div class="message-body">
      <div class="message-heading">${assistant ? "ASH <span>AI</span>" : "You"}<time>${formatTime(message.createdAt)}</time>
      ${assistant && message.content ? `<button class="copy-button" data-action="copy" data-id="${escapeHtml(message.id)}" type="button">Copy</button>` : ""}
      ${assistant && message.content && speechSynthesisAvailable() ? `<button class="copy-button" data-action="speak" data-id="${escapeHtml(message.id)}" type="button">Speak</button>` : ""}
      ${assistant ? `<button class="copy-button" data-action="regenerate" data-id="${escapeHtml(message.id)}" type="button">Regenerate</button>` : `<button class="copy-button" data-action="edit-resend" data-id="${escapeHtml(message.id)}" type="button">Edit</button>`}
      ${assistant && meta.truncated && !meta.filtered ? `<button class="copy-button" data-action="continue" data-id="${escapeHtml(message.id)}" type="button">Continue</button>` : ""}</div>
      ${usedModel ? `<div class="message-model">${escapeHtml(usedModel)}</div>` : ""}
      ${assistant && meta.filtered ? `<div class="incomplete-note">This reply was stopped by the model's safety filter. It is not continued automatically.</div>` : ""}
      ${assistant && meta.truncated && !meta.filtered ? `<div class="incomplete-note">This reply stopped before it finished. Use Continue to complete it without repeating earlier sections.</div>` : ""}
      ${assistant && Array.isArray(meta.research) && meta.research.length ? `<div class="source-list">${meta.research.map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title || source.url)}</a>`).join("")}</div>` : ""}
      <div class="markdown">${renderMarkdown(message.content)}</div>
    </div>
  </article>`;
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(timestamp);
}

function renderApp() {
  applyTheme();
  const selectedModel = activeModel();
  const ollamaOnline = Boolean(state.health?.providers?.ollama?.available);
  root.innerHTML = `
    <main class="app-shell">
      <div class="mobile-backdrop ${mobileSidebarOpen ? "visible" : ""}" data-action="close-sidebar"></div>
      <aside class="sidebar ${mobileSidebarOpen ? "sidebar-open" : ""}">
        <div class="sidebar-top">
          <a class="brand-lockup" href="/" aria-label="ASH Chat home"><span class="brand-mark">A</span><span>ASH <b>CHAT</b></span></a>
          <button class="icon-button mobile-close" data-action="close-sidebar" type="button" aria-label="Close conversation sidebar">×</button>
        </div>
        <button class="new-chat-button" data-action="new-chat" type="button"><span>＋</span> New chat <kbd>⌘ K</kbd></button>
        <input class="search-box" data-role="search" placeholder="Search conversations" value="${escapeHtml(state.search)}">
        <div class="section-label"><button data-action="panel-chats" type="button">CHATS</button><button data-action="panel-projects" type="button">PROJECTS</button><button data-action="panel-memory" type="button">MEMORY</button></div>
        <nav class="history-list" aria-label="Sidebar">${state.panel === "projects" ? renderProjects() : state.panel === "memory" ? renderMemories() : renderConversationList()}</nav>
        <div class="sidebar-bottom">
          <div class="user-card"><div class="user-avatar">${escapeHtml((state.user?.email || "?").slice(0, 1).toUpperCase())}</div><div class="user-info"><strong>${escapeHtml(state.user?.email || "Local account")}</strong><span>Private workspace</span></div>
            <button class="icon-button" data-action="toggle-theme" type="button" aria-label="Toggle theme">${state.theme === "dark" ? "☀" : "☾"}</button>
            <button class="icon-button" data-action="logout" type="button" aria-label="Log out" title="Log out">↪</button></div>
          <div class="privacy-note"><span class="status-dot ${ollamaOnline ? "online" : ""}"></span>${escapeHtml(providerStatus())}</div>
          <div class="account-actions"><a class="text-button" href="/download.html">Android download</a><button class="text-button" data-action="export-account" type="button">Export data</button><button class="text-button" data-action="delete-account" type="button">Delete account</button></div>
        </div>
      </aside>
      <section class="chat-pane">
        <header class="topbar">
          <div class="topbar-left"><button class="icon-button mobile-menu" data-action="open-sidebar" type="button" aria-label="Open conversation list">☰</button><div class="topbar-title"><span class="mobile-brand">ASH <b>CHAT</b></span><span class="desktop-title">${state.activeConversationId ? escapeHtml(state.conversations.find((item) => item.id === state.activeConversationId)?.title || "Conversation") : "New conversation"}</span></div></div>
          <div class="topbar-right">
            <div class="model-picker"><label class="sr-only" for="model-select">Choose routing mode or model</label><select id="model-select">${renderModelOptions()}</select><span class="picker-chevron">⌄</span></div>
            <span class="runtime-pill"><i class="status-dot ${ollamaOnline ? "online" : ""}"></i>${ollamaOnline ? "Local runtime online" : "Local runtime offline"}</span>
          </div>
        </header>
        <div class="model-detail">${selectedModel ? `<span class="local-badge">${selectedModel.locality === "local" ? "LOCAL" : "CLOUD"}</span>${state.selectedMode === "manual" ? "" : `${state.selectedMode.replace("_", " ").toUpperCase()} · `}${escapeHtml(selectedModel.providerId)} · ${escapeHtml(selectedModel.displayName)} <span class="detail-separator">·</span> ${escapeHtml(modelDetails(selectedModel))}` : state.selectedMode === "auto" ? "AUTO — FREE FIRST · paid models are excluded" : state.selectedMode === "free_cloud" ? "FREE CLOUD · uses verified free cloud models only" : state.selectedMode === "local_only" ? "LOCAL ONLY · prompts stay on this computer" : escapeHtml(state.health?.providers?.ollama?.message || "Waiting for a model")}</div>
        ${networkOnline ? "" : `<div class="offline-banner" role="status">You are offline. Cloud AI needs a connection to the hosted ASH backend. Your unsent message and selected files stay here. Send again when you are back online.</div>`}
        ${networkOnline && connectionNotice ? `<div class="reconnect-banner" role="status">${escapeHtml(connectionNotice)}</div>` : ""}
        ${state.error ? `<div class="error-banner" role="alert"><span>!</span>${escapeHtml(state.error)}<button data-action="dismiss-error" type="button" aria-label="Dismiss error">×</button></div>` : ""}
        ${state.memorySuggestions.length ? `<div class="memory-banner">Suggested memory: ${state.memorySuggestions.map((item) => `<button data-action="save-suggestion" data-text="${escapeHtml(item)}" type="button">${escapeHtml(item)}</button>`).join("")}</div>` : ""}
        <section class="conversation-area" aria-live="polite">${renderMessages()}</section>
        <footer class="composer-area">
          <div class="attachment-row">${renderAttachmentCards()}</div>
          <form id="composer" class="composer">
            <label class="attach-button" aria-label="Attach a photo or PDF">＋<input id="file-input" type="file" accept="image/*,application/pdf,.pdf" hidden></label>
            <button class="attach-button ${voiceRecognition ? "listening" : ""}" data-action="voice" type="button" aria-pressed="${voiceRecognition ? "true" : "false"}" aria-label="${voiceRecognition ? "Stop voice input" : "Voice input"}">🎙</button>
            <textarea name="message" rows="1" maxlength="8000" placeholder="Message ASH Chat…" aria-label="Message" ${state.sending ? "disabled" : ""}>${escapeHtml(draftFor(state.activeConversationId))}</textarea>
            ${state.sending
              ? `<button class="stop-button" data-action="stop" type="button" aria-label="Stop generation"><span>■</span></button>`
              : `<button class="send-button" type="submit" aria-label="Send message"><span>↑</span></button>`}
          </form>
          <div class="composer-tools">
            <label>Mode <select id="working-mode">
              <option value="auto" ${state.workingMode === "auto" ? "selected" : ""}>Auto</option>
              <option value="research" ${state.workingMode === "research" ? "selected" : ""}>Research</option>
              <option value="deep_analysis" ${state.workingMode === "deep_analysis" ? "selected" : ""}>Deep analysis</option>
              <option value="coding" ${state.workingMode === "coding" ? "selected" : ""}>Coding</option>
            </select></label>
            <label>Length <select id="response-style">
              <option value="short" ${state.responseStyle === "short" ? "selected" : ""}>Short</option>
              <option value="normal" ${state.responseStyle === "normal" ? "selected" : ""}>Normal</option>
              <option value="detailed" ${state.responseStyle === "detailed" ? "selected" : ""}>Detailed</option>
              <option value="deep_analysis" ${state.responseStyle === "deep_analysis" ? "selected" : ""}>Deep analysis</option>
            </select></label>
            <label><input id="deep-reasoning" type="checkbox" ${state.deepReasoning ? "checked" : ""}> Deep reasoning</label>
            <label><input id="web-search" type="checkbox"> Force sources</label>
          </div>
          <div class="composer-hint"><span>Enter to send <kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line</span><span>Auto picks approach. Research uses Wikipedia and Instant Answer sources, not a paid web crawl.</span></div>
          ${voiceRecognition ? `<p class="voice-status" role="status">Listening… speak now. Tap the microphone again to stop. You can edit the text before sending. Voice transcription uses the browser’s online speech service.</p>` : ""}
        </footer>
      </section>
    </main>`;
  bindAppEvents();
  if (state.sending) scrollToBottom();
}

function scrollToBottom() {
  document.querySelector("#messages-end")?.scrollIntoView({ block: "end", behavior: "smooth" });
}

function bindAppEvents() {
  root.querySelectorAll("[data-action]").forEach((element) => {
    element.addEventListener("click", () => {
      const { action, id, index, text } = element.dataset;
      if (action === "new-chat") {
        currentRequestId += 1;
        state.stop();
        releaseAttachmentPreviews(state.pendingAttachments);
        try { sessionStorage.removeItem(attachmentKey("")); } catch {}
        state.update({ activeConversationId: "", messages: [], error: "", sending: false, streamingText: "", pendingAttachments: restoreReadyAttachments(""), memorySuggestions: [] });
        mobileSidebarOpen = false;
        return;
      }
      if (action === "open-conversation") void openConversation(id);
      if (action === "delete-conversation") void deleteConversation(id);
      if (action === "rename-conversation") void renameConversation(id);
      if (action === "logout") void logout();
      if (action === "stop") state.stop();
      if (action === "dismiss-error") state.update({ error: "" });
      if (action === "open-sidebar") { mobileSidebarOpen = true; renderApp(); }
      if (action === "close-sidebar") { mobileSidebarOpen = false; renderApp(); }
      if (action === "copy") void copyMessage(id, element);
      if (action === "speak") speakMessage(id);
      if (action === "regenerate") {
        const lastUser = [...state.messages].reverse().find((message) => message.role === "user");
        void sendMessage(null, { regenerateFromMessageId: id, content: lastUser?.content || ".", skipUserBubble: true });
      }
      if (action === "continue") {
        void sendMessage(null, { continueFromMessageId: id, content: "Continue.", skipUserBubble: true });
      }
      if (action === "edit-resend") void editResend(id);
      if (action === "toggle-theme") state.update({ theme: state.theme === "dark" ? "light" : "dark" });
      if (action === "panel-chats") state.update({ panel: "chats" });
      if (action === "panel-projects") state.update({ panel: "projects" });
      if (action === "panel-memory") { void loadMemories(); state.update({ panel: "memory" }); }
      if (action === "select-project") { state.activeProjectId = id; void loadApplication(); }
      if (action === "new-project") void createProject();
      if (action === "approve-memory") void api.updateMemory(id, { status: "approved" }).then(loadMemories);
      if (action === "delete-memory") void api.deleteMemory(id).then(loadMemories);
      if (action === "save-suggestion") void saveSuggestion(text);
      if (action === "remove-attachment") {
        const removed = state.pendingAttachments.find((item) => item.localId === id);
        if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
        state.pendingAttachments = removeAttachment(state.pendingAttachments, id);
        persistReadyAttachments();
        state.update({});
      }
      if (action === "retry-attachment") {
        const item = state.pendingAttachments.find((entry) => entry.localId === id);
        if (item?.file) void uploadLocalFile(item.file, id);
      }
      if (action === "replace-attachment") {
        replaceLocalId = id;
        root.querySelector("#file-input")?.click();
      }
      if (action === "export-account") void exportAccount();
      if (action === "delete-account") void deleteAccount();
      if (action === "voice") startVoice();
    });
  });
  root.querySelector("#model-select")?.addEventListener("change", (event) => {
    const selected = event.currentTarget.value;
    state.actualModel = null;
    if (selected === "auto" || selected === "local_only" || selected === "free_cloud") state.selectedMode = selected;
    else {
      try {
        [state.selectedProviderId, state.selectedModelId] = JSON.parse(decodeURIComponent(selected));
      } catch {
        state.update({ error: "The selected model option is invalid." });
        return;
      }
      state.selectedMode = "manual";
    }
    renderApp();
  });
  root.querySelector("[data-role=search]")?.addEventListener("change", (event) => {
    state.search = event.currentTarget.value;
    void loadApplication();
  });
  root.querySelector("#file-input")?.addEventListener("change", (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    const replacing = replaceLocalId;
    replaceLocalId = "";
    if (file) void uploadLocalFile(file, replacing);
  });
  root.querySelector("#working-mode")?.addEventListener("change", (event) => {
    const value = event.currentTarget.value;
    state.workingMode = value === "research" || value === "deep_analysis" || value === "coding" ? value : "auto";
    try { localStorage.setItem("ash-chat-working-mode", state.workingMode); } catch {}
  });
  root.querySelector("#response-style")?.addEventListener("change", (event) => {
    const value = event.currentTarget.value;
    state.responseStyle = value === "short" || value === "detailed" || value === "deep_analysis" ? value : "normal";
    try { localStorage.setItem("ash-chat-response-style", state.responseStyle); } catch {}
  });
  root.querySelector("#deep-reasoning")?.addEventListener("change", (event) => {
    state.deepReasoning = event.currentTarget.checked;
    try { localStorage.setItem("ash-chat-deep-reasoning", state.deepReasoning ? "1" : "0"); } catch {}
  });
  root.querySelector("#composer")?.addEventListener("submit", (event) => { void sendMessage(event); });
  const textarea = root.querySelector("#composer textarea");
  textarea?.addEventListener("input", () => {
    saveDraft(state.activeConversationId, textarea.value);
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  });
  textarea?.addEventListener("focus", () => {
    setTimeout(() => textarea.scrollIntoView({ block: "nearest" }), 250);
  });
  textarea?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      root.querySelector("#composer")?.requestSubmit();
    }
  });
}

async function loadMemories() {
  const result = await api.memories();
  state.memories = result.memories || [];
  renderApp();
}

function recoverExpiredSession(message = "Your session expired. Please sign in again.") {
  try { clearSessionToken(); } catch {}
  state.user = null;
  state.sending = false;
  state.controller = null;
  authMode = "login";
  renderLogin();
  const errorNode = root.querySelector("#auth-error");
  if (errorNode) { errorNode.textContent = message; errorNode.hidden = false; }
}

async function loadApplication() {
  state.update({ loading: true, error: "" });
  try {
    const [healthResult, modelResult, conversationsResult, projectsResult] = await Promise.allSettled([
      api.health(),
      api.models(),
      api.conversations(state.search, state.activeProjectId || undefined),
      api.projects(),
    ]);
    if (modelResult.status === "rejected" && modelResult.reason.status === 401) throw modelResult.reason;
    if (conversationsResult.status === "rejected" && conversationsResult.reason.status === 401) throw conversationsResult.reason;
    state.health = healthResult.status === "fulfilled" ? healthResult.value : null;
    state.models = modelResult.status === "fulfilled" ? modelResult.value.models || [] : [];
    state.conversations = conversationsResult.status === "fulfilled" ? conversationsResult.value.conversations || [] : [];
    state.projects = projectsResult.status === "fulfilled" ? projectsResult.value.projects || [] : [];
    const loadErrors = [modelResult, conversationsResult].filter((result) => result.status === "rejected").map((result) => result.reason.message);
    if (healthResult.status === "rejected") {
      state.health = { providers: { ollama: { available: false, message: "Health status could not be loaded." } } };
    }
    if (loadErrors.length) state.error = loadErrors.join(" ");
    if (!state.pendingAttachments.length) state.pendingAttachments = restoreReadyAttachments(state.activeConversationId);
    if (state.selectedMode === "manual" && !state.models.some((model) => model.providerId === state.selectedProviderId && model.id === state.selectedModelId)) {
      state.selectedMode = "auto";
      state.selectedProviderId = "";
      state.selectedModelId = "";
    }
    state.update({ loading: false, error: state.error });
    renderApp();
  } catch (error) {
    if (error.status === 401) {
      recoverExpiredSession();
      return;
    }
    state.update({ loading: false, error: error.message || "The platform could not load your account." });
    renderApp();
  }
}

async function openConversation(id) {
  currentRequestId += 1;
  state.stop();
  releaseAttachmentPreviews(state.pendingAttachments);
  state.update({
    activeConversationId: id,
    messages: [],
    sending: false,
    streamingText: "",
    error: "",
    loading: true,
    pendingAttachments: restoreReadyAttachments(id),
  });
  mobileSidebarOpen = false;
  try {
    const result = await api.messages(id);
    if (state.activeConversationId !== id) return;
    state.update({ messages: result.messages || [], loading: false });
    renderApp();
  } catch (error) {
    state.update({ loading: false, error: error.message || "Could not open this conversation." });
    renderApp();
  }
}

async function deleteConversation(id) {
  const conversation = state.conversations.find((item) => item.id === id);
  if (!conversation || !window.confirm(`Delete “${conversation.title}”? This cannot be undone.`)) return;
  try {
    await api.deleteConversation(id);
    state.conversations = state.conversations.filter((item) => item.id !== id);
    if (state.activeConversationId === id) { state.activeConversationId = ""; state.messages = []; }
    renderApp();
  } catch (error) {
    state.update({ error: error.message || "Could not delete the conversation." });
    renderApp();
  }
}

async function renameConversation(id) {
  const conversation = state.conversations.find((item) => item.id === id);
  const title = window.prompt("Rename conversation", conversation?.title || "");
  if (!title) return;
  await api.renameConversation(id, title);
  await loadApplication();
}

async function createProject() {
  const name = window.prompt("Project name");
  if (!name) return;
  const instructions = window.prompt("Project instructions (optional)") || "";
  const created = await api.createProject({ name, instructions, localOnly: false });
  state.activeProjectId = created.project.id;
  await loadApplication();
}

async function uploadLocalFile(file, replacingId = "") {
  if (!networkOnline) {
    state.update({ error: "You are offline. The file was not uploaded. Reconnect, then choose it again." });
    return;
  }
  let list = state.pendingAttachments;
  if (replacingId) {
    const previous = list.find((item) => item.localId === replacingId);
    if (previous?.previewUrl) URL.revokeObjectURL(previous.previewUrl);
    list = removeAttachment(list, replacingId);
  }
  const localId = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const ownerConversation = state.activeConversationId;
  const begun = beginAttachment(list, file, localId);
  if (begun.error || !begun.item) {
    state.pendingAttachments = list;
    state.update({ error: begun.error || "That file could not be attached." });
    return;
  }
  const previewUrl = begun.item.kind === "image" && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : "";
  state.pendingAttachments = begun.list.map((item) => item.localId === localId ? { ...item, file, previewUrl } : item);
  state.update({ error: "" });
  try {
    const result = await api.upload(file, {
      projectId: state.activeProjectId || undefined,
      conversationId: state.activeConversationId || undefined,
    }, (progress) => {
      const card = root.querySelector(`[data-local-id="${localId}"] .attachment-progress > span`);
      const label = root.querySelector(`[data-local-id="${localId}"] .attachment-status`);
      if (card) card.style.width = `${progress}%`;
      if (label) label.textContent = `Uploading ${progress}%`;
    });
    if (!result?.attachment?.id) throw new Error("The server did not confirm this upload.");
    if (state.activeConversationId !== ownerConversation) return;
    state.pendingAttachments = markReady(state.pendingAttachments, localId, result.attachment);
    persistReadyAttachments();
    state.update({});
  } catch (error) {
    if (state.activeConversationId !== ownerConversation) return;
    const failure = classifySendFailure(error, networkOnline);
    state.pendingAttachments = markFailed(state.pendingAttachments, localId, failure.kind === "offline"
      ? "Upload failed because the connection dropped. Retry when you are back online."
      : (error.message || "Upload failed."));
    state.update({});
  }
}

async function saveSuggestion(text) {
  await api.createMemory({ scope: state.activeProjectId ? "project" : "personal", projectId: state.activeProjectId || undefined, content: text, status: "pending" });
  state.memorySuggestions = [];
  await loadMemories();
}

async function exportAccount() {
  const data = await api.exportAccount();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ash-ai-export.json";
  link.click();
  URL.revokeObjectURL(url);
}

async function deleteAccount() {
  if (!window.confirm("Delete this local account and all of its data? This cannot be undone.")) return;
  await api.deleteAccount();
  try { clearSessionToken(); } catch {}
  state.user = null;
  renderLogin();
}

async function logout() {
  state.stop();
  let requestError = "";
  try { await api.logout(); } catch (error) { requestError = error.message; }
  try { clearSessionToken(); } catch (error) {
    state.update({ error: error.message });
    renderApp();
    return;
  }
  state.user = null;
  state.conversations = [];
  state.messages = [];
  state.models = [];
  state.activeConversationId = "";
  state.error = "";
  authMode = "login";
  renderLogin();
  if (requestError) {
    const errorNode = root.querySelector("#auth-error");
    errorNode.textContent = `Signed out in this browser. The server could not revoke the session: ${requestError}`;
    errorNode.hidden = false;
  }
}

async function editResend(id) {
  const message = state.messages.find((item) => item.id === id);
  if (!message) return;
  const next = window.prompt("Edit and resend", message.content);
  if (!next) return;
  await sendMessage(null, { content: next, editMessageId: id });
}

async function sendMessage(event, overrides = {}) {
  event?.preventDefault();
  const gate = beginSend(sendInFlight || state.sending);
  if (!gate.ok) return;
  const textarea = root.querySelector("#composer textarea");
  const typed = overrides.content || textarea?.value || "";
  const attachmentGate = overrides.skipUserBubble || overrides.regenerateFromMessageId || overrides.continueFromMessageId
    ? ""
    : sendBlockReason(state.pendingAttachments);
  if (attachmentGate) {
    sendInFlight = false;
    state.update({ error: attachmentGate });
    return;
  }
  const content = overrides.content || messageContentForSend(typed, state.pendingAttachments);
  const webSearch = Boolean(root.querySelector("#web-search")?.checked);
  state.latestResearch = [];
  const selected = activeModel();
  if (!content || (state.selectedMode === "manual" && !selected)) {
    sendInFlight = false;
    return;
  }
  if (!networkOnline) {
    if (!overrides.content) saveDraft(state.activeConversationId, textarea?.value ?? typed);
    sendInFlight = false;
    state.update({ error: classifySendFailure(new Error("failed to fetch"), false).message });
    return;
  }
  const requestId = ++currentRequestId;
  state.stop();
  state.error = "";
  connectionNotice = "";
  state.sending = true;
  sendInFlight = true;
  state.streamingText = "";
  state.actualModel = null;
  let conversationId = state.activeConversationId;
  let createdConversation = false;
  let temporaryUserMessage = null;
  const attachmentIds = readyAttachmentIds(state.pendingAttachments);
  state.update({});
  try {
    if (!conversationId) {
      const result = await api.createConversation(content.slice(0, 120), state.activeProjectId || undefined);
      if (requestId !== currentRequestId) return;
      conversationId = result.conversation.id;
      createdConversation = true;
      state.activeConversationId = conversationId;
      state.conversations = [result.conversation, ...state.conversations];
    }
    if (!overrides.skipUserBubble && !overrides.regenerateFromMessageId && !overrides.continueFromMessageId) {
      temporaryUserMessage = { id: `pending-${Date.now()}`, role: "user", content, createdAt: Date.now() };
      state.messages = [...state.messages, temporaryUserMessage];
    }
    renderApp();
    const controller = new AbortController();
    state.controller = controller;
    await api.streamMessage(conversationId, {
      content,
      providerId: selected?.providerId || "",
      modelId: selected?.id || "",
      mode: state.selectedMode,
      attachmentIds,
      regenerateFromMessageId: overrides.regenerateFromMessageId,
      continueFromMessageId: overrides.continueFromMessageId,
      editMessageId: overrides.editMessageId,
      webSearch,
      responseStyle: state.responseStyle,
      deepReasoning: state.deepReasoning,
      workingMode: state.workingMode,
    }, {
      signal: controller.signal,
      onToken: (token) => {
        if (requestId !== currentRequestId) return;
        state.setStreamingText(state.streamingText + token);
        const streamContainer = root.querySelector(".message.assistant:last-of-type .markdown");
        if (streamContainer) {
          streamContainer.innerHTML = renderMarkdown(state.streamingText);
          scrollToBottom();
        } else renderApp();
      },
      onEvent: (type, data) => {
        if (requestId !== currentRequestId) return;
        if (type === "model") {
          state.actualModel = state.models.find((model) => model.providerId === data.providerId && model.id === data.modelId) || data;
          state.update({});
        }
        if (type === "memory_suggestions") state.memorySuggestions = data.suggestions || [];
        if (type === "research") {
          state.latestResearch = data.sources || [];
          state.update({});
        }
      },
    });
    if (requestId !== currentRequestId) return;
    const result = await api.messages(conversationId);
    state.messages = result.messages || [];
    state.conversations = state.conversations.map((item) => item.id === conversationId
      ? { ...item, messageCount: state.messages.length, updatedAt: result.conversation.updatedAt }
      : item);
    if (!overrides.content) saveDraft(conversationId, "");
    releaseAttachmentPreviews(state.pendingAttachments);
    state.pendingAttachments = [];
    persistReadyAttachments();
    state.sending = false;
    state.controller = null;
    state.streamingText = "";
    state.update({});
  } catch (error) {
    if (requestId !== currentRequestId) return;
    const failure = classifySendFailure(error, navigator.onLine !== false);
    state.sending = false;
    state.controller = null;
    state.streamingText = "";
    if (!overrides.content) saveDraft(state.activeConversationId, textarea?.value ?? typed);
    if (conversationId && temporaryUserMessage) {
      try { state.messages = (await api.messages(conversationId)).messages || []; } catch {
        state.messages = state.messages.filter((message) => message !== temporaryUserMessage);
      }
    } else if (temporaryUserMessage) {
      state.messages = state.messages.filter((message) => message !== temporaryUserMessage);
    }
    if (failure.kind === "auth" || error.status === 401) {
      recoverExpiredSession();
      return;
    }
    if (failure.kind === "offline") networkOnline = false;
    if (failure.kind !== "aborted") {
      if (createdConversation && !temporaryUserMessage && conversationId) {
        state.conversations = state.conversations.filter((item) => item.id !== conversationId);
        state.activeConversationId = "";
      }
      state.error = error.code === "rate_limited"
        ? `${error.message || "A free-tier limit was reached."} ASH Chat will try another free model on the next send. Your draft was kept.`
        : failure.message;
    }
    state.update({});
  } finally {
    sendInFlight = false;
  }
}

function speakMessage(id) {
  const message = state.messages.find((item) => item.id === id);
  const text = speakableText(message?.content || "");
  if (!text || !speechSynthesisAvailable()) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = navigator.language || "en";
  window.speechSynthesis.speak(utterance);
}

async function copyMessage(id, button) {
  const message = state.messages.find((item) => item.id === id);
  if (!message) return;
  try {
    await navigator.clipboard.writeText(message.content);
    button.textContent = "Copied";
    setTimeout(() => { if (button.isConnected) button.textContent = "Copy"; }, 1400);
  } catch {
    state.update({ error: "Clipboard access was denied by the browser." });
  }
}

state.addEventListener("change", () => { if (getSessionToken() && state.user) renderApp(); });
state.addEventListener("stream", () => {
  if (!state.sending) return;
  const streamContainer = root.querySelector(".message.assistant:last-of-type .markdown");
  if (streamContainer) streamContainer.innerHTML = renderMarkdown(state.streamingText);
});

async function boot() {
  applyTheme();
  const viewport = window.visualViewport;
  if (viewport) {
    const applyKeyboardInset = () => {
      const height = Math.max(0, Math.round(viewport.height));
      document.documentElement.style.setProperty("--app-height", `${height}px`);
    };
    viewport.addEventListener("resize", applyKeyboardInset);
    viewport.addEventListener("scroll", applyKeyboardInset);
    applyKeyboardInset();
  }
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("/sw.js"); } catch {}
  }
  const showNetwork = () => {
    const nowOnline = navigator.onLine !== false;
    const cameBack = nowOnline && !networkOnline;
    networkOnline = nowOnline;
    if (!nowOnline) connectionNotice = "";
    else if (cameBack) connectionNotice = reconnectNotice();
    if (getSessionToken() && state.user) renderApp();
  };
  window.addEventListener("online", showNetwork);
  window.addEventListener("offline", showNetwork);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") stopVoice(true);
  });
  if (!getSessionToken()) {
    renderLogin();
    try {
      const health = await api.health();
      const dot = root.querySelector(".privacy-note .status-dot");
      if (health.providers?.ollama?.available && dot) dot.classList.add("online");
    } catch {}
    return;
  }
  try {
    const me = await api.me();
    state.user = me.user || { email: "Signed-in account" };
  } catch (error) {
    recoverExpiredSession(error.status === 401
      ? "Your session expired. Please sign in again."
      : "The saved session could not be verified. Please sign in again.");
    return;
  }
  await loadApplication();
}

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    state.stop();
    state.update({ activeConversationId: "", messages: [], error: "", sending: false, streamingText: "" });
    root.querySelector("#composer textarea")?.focus();
  }
});

function stopVoice(silent = false) {
  voiceStopRequested = silent;
  const recognition = voiceRecognition;
  voiceRecognition = null;
  if (!recognition) return;
  try { recognition.stop(); } catch { try { recognition.abort(); } catch {} }
}

function startVoice() {
  if (voiceRecognition) {
    stopVoice(true);
    state.update({});
    return;
  }
  const Speech = speechRecognitionConstructor(window);
  const textarea = root.querySelector("#composer textarea");
  if (!Speech || !textarea) {
    state.update({ error: "This browser does not support voice input. You can type your message." });
    return;
  }
  if (navigator.onLine === false) {
    state.update({ error: voiceErrorMessage("network", { offline: true }) });
    return;
  }
  void beginVoice(Speech, textarea);
}

async function beginVoice(Speech, textarea) {
  if (navigator.mediaDevices?.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    } catch (error) {
      const denied = error?.name === "NotAllowedError" || error?.name === "SecurityError";
      state.update({ error: voiceErrorMessage(denied ? "not-allowed" : "audio-capture") });
      return;
    }
  }
  const liveBox = root.querySelector("#composer textarea") || textarea;
  const recognition = new Speech();
  recognition.lang = navigator.language || "en-GB";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;
  const baseText = liveBox.value;
  let finals = "";
  let voiceErrorShown = false;
  voiceStopRequested = false;
  voiceRecognition = recognition;
  state.update({});
  recognition.onresult = (event) => {
    const next = transcriptFromEvent(baseText, finals, event);
    finals = next.finals;
    const box = root.querySelector("#composer textarea");
    if (!box) return;
    box.value = next.captured;
    saveDraft(state.activeConversationId, next.captured);
    box.dispatchEvent(new Event("input"));
  };
  recognition.onerror = (event) => {
    const box = root.querySelector("#composer textarea");
    if (box) saveDraft(state.activeConversationId, box.value);
    const captured = Boolean(box && box.value.trim() && box.value.trim() !== baseText.trim());
    if (voiceStopRequested) return;
    const message = voiceErrorMessage(event?.error || "", { captured, offline: navigator.onLine === false });
    if (!message) return;
    voiceErrorShown = true;
    state.update({ error: message });
  };
  recognition.onend = () => {
    const box = root.querySelector("#composer textarea");
    const captured = Boolean(box && box.value.trim() && box.value.trim() !== baseText.trim());
    if (box) saveDraft(state.activeConversationId, box.value);
    voiceRecognition = null;
    if (!voiceStopRequested && !captured && !voiceErrorShown) {
      state.update({ error: "No speech was heard. Tap the microphone and try again, or type." });
      return;
    }
    state.update({});
  };
  try {
    recognition.start();
  } catch {
    voiceRecognition = null;
    state.update({ error: "Voice input could not be started. You can type instead." });
  }
}

void boot();
