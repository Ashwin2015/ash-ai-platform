export class ChatState extends EventTarget {
  constructor() {
    super();
    this.models = [];
    this.conversations = [];
    this.messages = [];
    this.projects = [];
    this.memories = [];
    this.activeConversationId = "";
    this.activeProjectId = "";
    this.selectedMode = "auto";
    this.selectedModelId = "";
    this.selectedProviderId = "";
    this.actualModel = null;
    this.loading = false;
    this.sending = false;
    this.streamingText = "";
    this.error = "";
    this.health = null;
    this.user = null;
    this.controller = null;
    this.search = "";
    this.pendingAttachments = [];
    this.theme = (() => {
      try { return localStorage.getItem("ash-chat-theme") || "dark"; } catch { return "dark"; }
    })();
    this.panel = "chats";
    this.memorySuggestions = [];
    this.responseStyle = (() => {
      try {
        const stored = localStorage.getItem("ash-chat-response-style");
        if (stored === "concise" || stored === "short") return "short";
        if (stored === "detailed") return "detailed";
        if (stored === "deep_analysis" || stored === "deep") return "deep_analysis";
        return "normal";
      } catch { return "normal"; }
    })();
    this.deepReasoning = (() => {
      try { return localStorage.getItem("ash-chat-deep-reasoning") === "1"; } catch { return false; }
    })();
  }

  update(patch) {
    Object.assign(this, patch);
    this.dispatchEvent(new Event("change"));
  }

  setStreamingText(text) {
    this.streamingText = text;
    this.dispatchEvent(new Event("stream"));
  }

  stop() {
    this.controller?.abort();
  }
}
