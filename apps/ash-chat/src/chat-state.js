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
