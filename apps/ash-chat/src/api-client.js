import { getCsrfToken, getSessionToken } from "./auth.js";

const API_PREFIX = "/api/v1";

function apiOrigin() {
  try {
    const value = globalThis.ASH_CHAT_API_ORIGIN;
    return typeof value === "string" ? value.replace(/\/$/, "") : "";
  } catch {
    return "";
  }
}

function apiUrl(path) {
  return `${apiOrigin()}${API_PREFIX}${path}`;
}

async function request(path, { method = "GET", body, signal, headers: extraHeaders } = {}) {
  const headers = { Accept: "application/json", ...(extraHeaders || {}) };
  const token = getSessionToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const csrf = getCsrfToken();
  if (csrf) headers["X-CSRF-Token"] = csrf;
  if (body !== undefined && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
  const crossOrigin = Boolean(apiOrigin());

  let response;
  try {
    response = await fetch(apiUrl(path), {
      method,
      headers,
      ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
      cache: "no-store",
      credentials: crossOrigin ? "omit" : "same-origin",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("Cannot reach ASH AI PLATFORM. Check that the backend is running locally.");
  }

  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json") ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    const message = data?.error?.message || `Request failed (${response.status}).`;
    const error = new Error(message);
    error.status = response.status;
    error.code = data?.error?.code || "request_failed";
    throw error;
  }
  return data;
}

export const api = {
  health: () => request("/health"),
  register: async (email, password) => {
    const result = await request("/auth/register", { method: "POST", body: { email, password } });
    const accessToken = typeof result?.accessToken === "string"
      ? result.accessToken
      : typeof result?.token === "string"
        ? result.token
        : "";
    if (!accessToken) throw new Error("The platform did not return a valid session token.");
    return { ...result, accessToken };
  },
  login: async (email, password) => {
    const result = await request("/auth/login", { method: "POST", body: { email, password } });
    const accessToken = typeof result?.accessToken === "string"
      ? result.accessToken
      : typeof result?.token === "string"
        ? result.token
        : "";
    if (!accessToken) throw new Error("The platform did not return a valid session token.");
    return { ...result, accessToken };
  },
  logout: () => request("/auth/logout", { method: "POST", body: {} }),
  me: () => request("/auth/me"),
  models: () => request("/models"),
  conversations: (query = "", projectId) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (projectId !== undefined) params.set("projectId", projectId || "");
    const suffix = params.toString() ? `?${params}` : "";
    return request(`/chat/conversations${suffix}`);
  },
  createConversation: (title, projectId) =>
    request("/chat/conversations", { method: "POST", body: { title, ...(projectId ? { projectId } : {}) } }),
  renameConversation: (conversationId, title) =>
    request(`/chat/conversations/${encodeURIComponent(conversationId)}`, { method: "PATCH", body: { title } }),
  messages: (conversationId) =>
    request(`/chat/conversations/${encodeURIComponent(conversationId)}/messages`),
  deleteConversation: (conversationId) =>
    request(`/chat/conversations/${encodeURIComponent(conversationId)}`, { method: "DELETE" }),
  projects: () => request("/projects"),
  createProject: (body) => request("/projects", { method: "POST", body }),
  updateProject: (id, body) => request(`/projects/${encodeURIComponent(id)}`, { method: "PATCH", body }),
  deleteProject: (id) => request(`/projects/${encodeURIComponent(id)}`, { method: "DELETE" }),
  memories: (params = "") => request(`/memories${params}`),
  createMemory: (body) => request("/memories", { method: "POST", body }),
  updateMemory: (id, body) => request(`/memories/${encodeURIComponent(id)}`, { method: "PATCH", body }),
  deleteMemory: (id) => request(`/memories/${encodeURIComponent(id)}`, { method: "DELETE" }),
  exportAccount: () => request("/account/export"),
  deleteAccount: () => request("/account", { method: "DELETE" }),
  upload(file, extra = {}) {
    const data = new FormData();
    data.append("file", file, file.name);
    if (extra.projectId) data.append("projectId", extra.projectId);
    if (extra.conversationId) data.append("conversationId", extra.conversationId);
    return request("/uploads", { method: "POST", body: data });
  },
  streamMessage(conversationId, payload, { signal, onToken, onEvent }) {
    return streamMessage(conversationId, payload, { signal, onToken, onEvent });
  },
};

async function streamMessage(conversationId, payload, { signal, onToken, onEvent }) {
  const headers = {
    Accept: "text/event-stream",
    "Content-Type": "application/json",
  };
  const token = getSessionToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const csrf = getCsrfToken();
  if (csrf) headers["X-CSRF-Token"] = csrf;

  let response;
  try {
    response = await fetch(
      apiUrl(`/chat/conversations/${encodeURIComponent(conversationId)}/messages`),
      {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal,
        cache: "no-store",
        credentials: apiOrigin() ? "omit" : "same-origin",
      },
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("The chat request could not reach the platform.");
  }

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const error = new Error(data?.error?.message || `Request failed (${response.status}).`);
    error.status = response.status;
    error.code = data?.error?.code || "request_failed";
    throw error;
  }
  if (!response.body) throw new Error("The platform did not return a response stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";
      for (const rawEvent of events) {
        const event = parseEvent(rawEvent);
        if (!event) continue;
        if (event.type === "token") onToken(event.data.text || "");
        else if (event.type === "done") {
          complete = true;
          onEvent?.("done", event.data);
        } else if (event.type === "error") {
          if (complete) {
            onEvent?.("error", event.data);
            continue;
          }
          const error = new Error(event.data.message || "The model could not finish this response.");
          error.code = event.data.code || "provider_unavailable";
          throw error;
        } else {
          onEvent?.(event.type, event.data);
        }
      }
      if (done) break;
    }
    if (buffer.trim()) {
      const event = parseEvent(buffer);
      if (event?.type === "error") throw new Error(event.data.message || "The model could not finish this response.");
      if (event?.type === "done") complete = true;
    }
    if (!complete) throw new Error("The response stream ended before the model finished.");
  } finally {
    reader.releaseLock();
  }
}

function parseEvent(raw) {
  let type = "message";
  const data = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("event:")) type = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  try {
    return { type, data: JSON.parse(data.join("\n")) };
  } catch {
    throw new Error("The platform returned an invalid streaming event.");
  }
}
