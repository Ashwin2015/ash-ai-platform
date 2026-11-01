const TOKEN_KEY = "ash-platform-session-v1";
const CSRF_KEY = "ash-platform-csrf-v1";

function storage() {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {}
  try {
    if (typeof sessionStorage !== "undefined") return sessionStorage;
  } catch {}
  const memory = new Map();
  return {
    getItem: (key) => memory.get(key) || null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: (key) => memory.delete(key),
  };
}

export function getSessionToken() {
  try {
    return storage().getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function getCsrfToken() {
  try {
    return storage().getItem(CSRF_KEY) || "";
  } catch {
    return "";
  }
}

export function saveSessionToken(token, csrfToken = "") {
  try {
    storage().setItem(TOKEN_KEY, token);
    if (csrfToken) storage().setItem(CSRF_KEY, csrfToken);
  } catch {
    throw new Error("This browser cannot keep a session. Check its storage settings.");
  }
}

export function clearSessionToken() {
  try {
    storage().removeItem(TOKEN_KEY);
    storage().removeItem(CSRF_KEY);
  } catch {
    throw new Error("The browser could not clear the session token.");
  }
}
