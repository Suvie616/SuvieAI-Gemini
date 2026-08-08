/**
 * SUUWETHAAN AI — frontend
 * Chat + file attachments + code rendering + image create/edit + Firebase history
 */

import {
  initFirebase,
  isFirebaseReady,
  getFirebaseInitError,
  formatAuthError,
  watchAuth,
  signInWithGoogle,
  signOutUser,
  currentUser,
  createChat,
  listChats,
  loadChat,
  saveTurn,
  deleteChat,
} from "./js/firebase-app.js";

const chatbox = document.getElementById("chatbox");
const form = document.getElementById("chatForm");
const input = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const statusPill = document.getElementById("statusPill");
const newChatBtn = document.getElementById("newChatBtn");
const chatListEl = document.getElementById("chatList");
const googleSignInBtn = document.getElementById("googleSignInBtn");
const googleRedirectBtn = document.getElementById("googleRedirectBtn");
const signInBox = document.getElementById("signInBox");
const userCard = document.getElementById("userCard");
const userAvatar = document.getElementById("userAvatar");
const userName = document.getElementById("userName");
const userEmail = document.getElementById("userEmail");
const signOutBtn = document.getElementById("signOutBtn");
const chatTitleEl = document.getElementById("chatTitle");
const sidebarHint = document.getElementById("sidebarHint");
const authErrorEl = document.getElementById("authError");
const menuToggle = document.getElementById("menuToggle");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");
const sidebar = document.querySelector(".sidebar");
const fileInput = document.getElementById("fileInput");
const attachBtn = document.getElementById("attachBtn");
const attachPreview = document.getElementById("attachPreview");
const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightboxImg");
const lightboxClose = document.getElementById("lightboxClose");

/** @type {{role: string, content: string, images?: string[]}[]} */
let history = [];
let messagesEl = null;
let isSending = false;
let user = null;
let activeChatId = null;
let chatSummaries = [];
/** @type {{id:string,name:string,type:string,mime:string,data:string,preview?:string}[]} */
let pendingAttachments = [];
let activeMode = "auto"; // auto | chat | image

const MAX_ATTACH = 6;
const MAX_IMAGE_MB = 6;
const MAX_TEXT_CHARS = 80000;
const TEXT_EXTS = new Set([
  "py","js","ts","tsx","jsx","json","md","txt","html","css","java","go","rs",
  "c","cpp","h","php","rb","sh","sql","yml","yaml","toml","xml","csv","env",
]);

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function setStatus(mode, label) {
  statusPill.classList.remove("busy", "error");
  if (mode) statusPill.classList.add(mode);
  statusPill.innerHTML = `<span class="status-dot"></span>${label}`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function autoResizeInput() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 160) + "px";
}

function welcomeHtml() {
  return `
    <div class="welcome" id="welcome">
      <div class="welcome-icon" aria-hidden="true">✨</div>
      <h2>Hey, I'm SUUWETHAAN AI</h2>
      <p>Chat, write code, attach files, or create &amp; edit images.</p>
      <div class="suggestions">
        <button type="button" class="suggestion" data-prompt="Write a clean Python function that validates emails and include tests">Code: email validator</button>
        <button type="button" class="suggestion" data-prompt="Generate an image of a cozy cyberpunk cafe at night, neon rain, cinematic" data-mode="image">Create image</button>
        <button type="button" class="suggestion" data-prompt="Explain this code step by step and suggest improvements">Explain my code</button>
        <button type="button" class="suggestion" data-prompt="Edit the attached image: make it brighter and more cinematic" data-mode="image">Edit attached image</button>
      </div>
    </div>`;
}

function bindSuggestions(root = document) {
  root.querySelectorAll(".suggestion").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.getAttribute("data-mode");
      if (mode) setMode(mode);
      sendMessage(btn.getAttribute("data-prompt") || btn.textContent);
    });
  });
}

function setMode(mode) {
  activeMode = mode === "image" || mode === "chat" ? mode : "auto";
  document.querySelectorAll(".mode-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === activeMode);
  });
}

// --------------------------------------------------------------------------
// Markdown-lite (code blocks + inline) + scroll helpers
// --------------------------------------------------------------------------

const COPY_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`;
const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>`;

function renderMarkdown(text) {
  if (!text) return "";
  const blocks = [];
  // fenced code blocks
  let html = String(text).replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const i = blocks.length;
    const safeLang = String(lang || "text").trim().replace(/[^\w+-]/g, "") || "text";
    const rawCode = code.replace(/\n$/, "");
    const safeCode = escapeHtml(rawCode);
    const fname = guessFileName(safeLang, rawCode, i);
    blocks.push(
      `<div class="code-block" data-lang="${safeLang}" data-filename="${escapeHtml(fname)}">
        <div class="code-head">
          <span class="code-lang">${safeLang}</span>
          <div class="code-actions">
            <button type="button" class="copy-btn" data-copy="${i}" title="Copy code">${COPY_ICON}<span>Copy</span></button>
            <button type="button" class="arena-add-btn" data-copy="${i}" title="Add to Code Arena">+ Arena</button>
            <button type="button" class="dl-btn" data-copy="${i}" title="Download file">↓ File</button>
            <button type="button" class="live-btn" data-copy="${i}" title="Live preview">Live</button>
          </div>
        </div>
        <div class="code-file-row">
          <span class="code-fname">${escapeHtml(fname)}</span>
        </div>
        <pre><code class="language-${safeLang}" data-code-idx="${i}">${safeCode}</code></pre>
      </div>`
    );
    return `\u0000BLOCK${i}\u0000`;
  });

  // escape remaining plain text
  html = escapeHtml(html);

  // headings
  html = html.replace(/(^|\n)###### (.+)/g, "$1<h4>$2</h4>");
  html = html.replace(/(^|\n)##### (.+)/g, "$1<h4>$2</h4>");
  html = html.replace(/(^|\n)#### (.+)/g, "$1<h4>$2</h4>");
  html = html.replace(/(^|\n)### (.+)/g, "$1<h4>$2</h4>");
  html = html.replace(/(^|\n)## (.+)/g, "$1<h3>$2</h3>");
  html = html.replace(/(^|\n)# (.+)/g, "$1<h3>$2</h3>");

  // bold / italic / inline code
  html = html.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");

  // simple lists
  html = html.replace(/(^|\n)(?:- |\* )(.+)/g, "$1<li>$2</li>");
  html = html.replace(/(?:<li>.*<\/li>\n?)+/g, (m) => `<ul>${m.replace(/\n/g, "")}</ul>`);
  html = html.replace(/(^|\n)(\d+)\. (.+)/g, "$1<li>$3</li>");

  // paragraphs: split on blank lines, keep blocks
  html = html
    .split(/\n{2,}/)
    .map((chunk) => {
      const c = chunk.trim();
      if (!c) return "";
      if (c.includes("\u0000BLOCK")) return c.replace(/\n/g, "");
      if (/^<(h3|h4|ul|ol|div)/.test(c)) return c.replace(/\n/g, "<br>");
      return `<p>${c.replace(/\n/g, "<br>")}</p>`;
    })
    .join("");

  html = html.replace(/\u0000BLOCK(\d+)\u0000/g, (_, i) => blocks[Number(i)]);
  return html;
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function bindCodeCopy(root) {
  root.querySelectorAll(".copy-btn").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = btn.getAttribute("data-copy");
      const codeEl = root.querySelector(`code[data-code-idx="${idx}"]`);
      const text = codeEl ? codeEl.textContent : "";
      const ok = await copyTextToClipboard(text);
      btn.classList.toggle("copied", ok);
      btn.innerHTML = ok
        ? `${CHECK_ICON}<span>Copied</span>`
        : `${COPY_ICON}<span>Failed</span>`;
      setTimeout(() => {
        btn.classList.remove("copied");
        btn.innerHTML = `${COPY_ICON}<span>Copy</span>`;
      }, 1600);
    });
  });

  root.querySelectorAll(".arena-add-btn").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const block = btn.closest(".code-block");
      const idx = btn.getAttribute("data-copy");
      const codeEl = root.querySelector(`code[data-code-idx="${idx}"]`);
      const code = codeEl ? codeEl.textContent : "";
      const lang = block?.dataset.lang || "text";
      const name = block?.dataset.filename || guessFileName(lang, code);
      addArenaFile(name, code, lang, { open: true, flash: true });
      btn.textContent = "Added ✓";
      setTimeout(() => { btn.textContent = "+ Arena"; }, 1400);
    });
  });

  root.querySelectorAll(".dl-btn").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const block = btn.closest(".code-block");
      const idx = btn.getAttribute("data-copy");
      const codeEl = root.querySelector(`code[data-code-idx="${idx}"]`);
      const code = codeEl ? codeEl.textContent : "";
      const name = block?.dataset.filename || "file.txt";
      downloadTextFile(name, code);
      btn.textContent = "Saved";
      setTimeout(() => { btn.textContent = "↓ File"; }, 1200);
    });
  });

  root.querySelectorAll(".live-btn").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const block = btn.closest(".code-block");
      const idx = btn.getAttribute("data-copy");
      const codeEl = root.querySelector(`code[data-code-idx="${idx}"]`);
      const code = codeEl ? codeEl.textContent : "";
      const lang = block?.dataset.lang || "html";
      const name = block?.dataset.filename || guessFileName(lang, code);
      openLivePreview(name, code, lang);
    });
  });
}

function scrollChatToBottom(force = false) {
  if (!chatbox) return;
  const distance =
    chatbox.scrollHeight - chatbox.scrollTop - chatbox.clientHeight;
  // auto-follow unless user scrolled far up (unless forced)
  if (force || distance < 140) {
    requestAnimationFrame(() => {
      chatbox.scrollTo({
        top: chatbox.scrollHeight,
        behavior: force ? "smooth" : "auto",
      });
      // second pass after images/layout
      setTimeout(() => {
        chatbox.scrollTop = chatbox.scrollHeight;
      }, 40);
    });
  }
  updateScrollFab();
}

function scrollToElement(el) {
  if (!chatbox || !el) return;
  // put the start of the AI reply near the top-ish of the chat viewport
  const boxRect = chatbox.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const offset = elRect.top - boxRect.top + chatbox.scrollTop - 24;
  chatbox.scrollTo({ top: Math.max(0, offset), behavior: "smooth" });
  // if reply is short, still end near bottom
  setTimeout(() => {
    const stillBelow =
      el.offsetTop + el.offsetHeight >
      chatbox.scrollTop + chatbox.clientHeight - 40;
    if (stillBelow) {
      // keep following the bottom of the new reply
      chatbox.scrollTo({
        top: el.offsetTop + el.offsetHeight - chatbox.clientHeight + 32,
        behavior: "smooth",
      });
    }
    updateScrollFab();
  }, 280);
}

function updateScrollFab() {
  const fab = document.getElementById("scrollFab");
  if (!fab || !chatbox) return;
  const distance =
    chatbox.scrollHeight - chatbox.scrollTop - chatbox.clientHeight;
  fab.classList.toggle("show", distance > 180);
}

function ensureScrollFab() {
  if (document.getElementById("scrollFab")) return;
  const main = document.querySelector(".main");
  if (!main) return;
  const fab = document.createElement("button");
  fab.type = "button";
  fab.id = "scrollFab";
  fab.className = "scroll-fab";
  fab.innerHTML = "↓ Latest";
  fab.title = "Jump to latest message";
  fab.addEventListener("click", () => scrollChatToBottom(true));
  main.appendChild(fab);
  chatbox?.addEventListener("scroll", () => updateScrollFab(), { passive: true });
}

// --------------------------------------------------------------------------
// Message UI
// --------------------------------------------------------------------------

function ensureMessagesContainer() {
  document.getElementById("welcome")?.remove();
  if (!messagesEl || !messagesEl.isConnected) {
    messagesEl = document.createElement("div");
    messagesEl.className = "messages";
    chatbox.appendChild(messagesEl);
  }
  return messagesEl;
}

function openLightbox(src) {
  if (!lightbox || !lightboxImg) return;
  lightboxImg.src = src;
  lightbox.classList.remove("hidden");
}

function closeLightbox() {
  lightbox?.classList.add("hidden");
  if (lightboxImg) lightboxImg.src = "";
}

function appendMessage(role, content, { error = false, images = [], attachments = [], scrollMode = "bottom" } = {}) {
  const container = ensureMessagesContainer();
  const row = document.createElement("div");
  row.className = `msg ${role}${error ? " error" : ""}`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? "You" : "AI";

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  // AI toolbar with copy-all
  if (role === "assistant" && !error) {
    const toolbar = document.createElement("div");
    toolbar.className = "bubble-toolbar";
    const label = document.createElement("span");
    label.className = "bubble-label";
    label.textContent = "SUUWETHAAN AI";
    const copyAll = document.createElement("button");
    copyAll.type = "button";
    copyAll.className = "copy-reply-btn";
    copyAll.innerHTML = `${COPY_ICON}<span>Copy</span>`;
    copyAll.title = "Copy full reply";
    copyAll.addEventListener("click", async () => {
      const ok = await copyTextToClipboard(content || "");
      copyAll.classList.toggle("copied", ok);
      copyAll.innerHTML = ok
        ? `${CHECK_ICON}<span>Copied</span>`
        : `${COPY_ICON}<span>Failed</span>`;
      setTimeout(() => {
        copyAll.classList.remove("copied");
        copyAll.innerHTML = `${COPY_ICON}<span>Copy</span>`;
      }, 1600);
    });
    toolbar.appendChild(label);
    toolbar.appendChild(copyAll);
    bubble.appendChild(toolbar);
  }

  const bodyWrap = document.createElement("div");
  if (role === "assistant" && !error) bodyWrap.className = "bubble-body";

  // user attachments chips
  if (attachments?.length) {
    const wrap = document.createElement("div");
    wrap.className = "msg-attachs";
    attachments.forEach((a) => {
      if (a.type === "image" && (a.preview || a.data)) {
        const img = document.createElement("img");
        img.className = "msg-thumb";
        img.src = a.preview || a.data;
        img.alt = a.name || "image";
        img.addEventListener("click", () => openLightbox(img.src));
        wrap.appendChild(img);
      } else {
        const chip = document.createElement("span");
        chip.className = "msg-file-chip";
        chip.textContent = `📎 ${a.name || "file"}`;
        wrap.appendChild(chip);
      }
    });
    bodyWrap.appendChild(wrap);
  }

  if (content) {
    const body = document.createElement("div");
    body.className = "bubble-text";
    if (error || role === "user") {
      body.textContent = content;
    } else {
      body.innerHTML = renderMarkdown(content);
      bindCodeCopy(body);
    }
    bodyWrap.appendChild(body);
  }

  if (images?.length) {
    const gallery = document.createElement("div");
    gallery.className = "msg-images";
    images.forEach((src) => {
      const fig = document.createElement("figure");
      fig.className = "gen-image";
      const img = document.createElement("img");
      img.src = src;
      img.alt = "Generated image";
      img.loading = "lazy";
      img.addEventListener("load", () => scrollChatToBottom());
      img.addEventListener("click", () => openLightbox(src));
      const actions = document.createElement("div");
      actions.className = "gen-image-actions";
      const dl = document.createElement("a");
      dl.href = src;
      dl.download = `suuwethaan-${Date.now()}.png`;
      dl.textContent = "Download";
      dl.className = "img-action";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "img-action";
      edit.textContent = "Edit this";
      edit.addEventListener("click", () => {
        pendingAttachments = [
          {
            id: uid(),
            name: "edit-source.png",
            type: "image",
            mime: "image/png",
            data: src,
            preview: src,
          },
        ];
        renderAttachPreview();
        setMode("image");
        input.value = "Edit this image: ";
        autoResizeInput();
        input.focus();
      });
      actions.appendChild(edit);
      actions.appendChild(dl);
      fig.appendChild(img);
      fig.appendChild(actions);
      gallery.appendChild(fig);
    });
    bodyWrap.appendChild(gallery);
  }

  if (bodyWrap.childNodes.length) bubble.appendChild(bodyWrap);

  row.appendChild(avatar);
  row.appendChild(bubble);
  container.appendChild(row);

  if (scrollMode === "reply" && role === "assistant") {
    scrollToElement(row);
  } else if (scrollMode !== "none") {
    scrollChatToBottom(scrollMode === "smooth");
  } else {
    updateScrollFab();
  }
  return row;
}

function appendTyping() {
  const container = ensureMessagesContainer();
  const row = document.createElement("div");
  row.className = "msg assistant";
  row.id = "typingRow";
  row.innerHTML = `
    <div class="avatar">AI</div>
    <div class="bubble">
      <div class="bubble-body">
        <div class="typing" aria-label="typing"><span></span><span></span><span></span></div>
      </div>
    </div>`;
  container.appendChild(row);
  scrollChatToBottom(true);
}

function removeTyping() {
  document.getElementById("typingRow")?.remove();
}

function setSending(busy) {
  isSending = busy;
  sendBtn.disabled = busy;
  input.disabled = busy;
  attachBtn.disabled = busy;
  if (busy) setStatus("busy", activeMode === "image" ? "Creating…" : "Thinking…");
  else {
    setStatus(null, "Ready");
    input.focus();
  }
}

function resetToWelcome(title = "SUUWETHAAN AI") {
  history = [];
  messagesEl = null;
  activeChatId = null;
  pendingAttachments = [];
  renderAttachPreview();
  chatbox.innerHTML = welcomeHtml();
  bindSuggestions(chatbox);
  chatTitleEl.textContent = title;
  highlightActiveChat();
}

function renderLoadedMessages(messages, title) {
  const list = Array.isArray(messages) ? messages : [];
  history = list.map((m) => ({
    role: m.role,
    content: m.content,
    images: m.images || [],
  }));
  messagesEl = null;
  chatbox.innerHTML = "";
  if (!list.length) {
    chatbox.innerHTML = `<div class="welcome" id="welcome"><div class="welcome-icon">💬</div><h2>${escapeHtml(title || "Chat")}</h2><p>No messages yet.</p></div>`;
  } else {
    list.forEach((m) =>
      appendMessage(m.role, m.content, {
        images: m.images || [],
        attachments: m.attachments || [],
        scrollMode: "none",
      })
    );
    scrollChatToBottom(true);
  }
  chatTitleEl.textContent = title || "Chat";
  highlightActiveChat();
}

// --------------------------------------------------------------------------
// Attachments
// --------------------------------------------------------------------------

function renderAttachPreview() {
  if (!attachPreview) return;
  if (!pendingAttachments.length) {
    attachPreview.classList.add("hidden");
    attachPreview.innerHTML = "";
    return;
  }
  attachPreview.classList.remove("hidden");
  attachPreview.innerHTML = "";
  pendingAttachments.forEach((a) => {
    const chip = document.createElement("div");
    chip.className = "attach-chip";
    if (a.type === "image" && a.preview) {
      const img = document.createElement("img");
      img.src = a.preview;
      img.alt = a.name;
      chip.appendChild(img);
    } else {
      const icon = document.createElement("span");
      icon.className = "attach-icon";
      icon.textContent = "📄";
      chip.appendChild(icon);
    }
    const meta = document.createElement("span");
    meta.className = "attach-name";
    meta.textContent = a.name;
    const x = document.createElement("button");
    x.type = "button";
    x.className = "attach-x";
    x.textContent = "×";
    x.title = "Remove";
    x.addEventListener("click", () => {
      pendingAttachments = pendingAttachments.filter((p) => p.id !== a.id);
      renderAttachPreview();
    });
    chip.appendChild(meta);
    chip.appendChild(x);
    attachPreview.appendChild(chip);
  });
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error || new Error("read failed"));
    r.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error || new Error("read failed"));
    r.readAsText(file);
  });
}

async function addFiles(fileList) {
  const files = Array.from(fileList || []);
  for (const file of files) {
    if (pendingAttachments.length >= MAX_ATTACH) {
      alert(`Max ${MAX_ATTACH} attachments.`);
      break;
    }
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const isImage = file.type.startsWith("image/");
    const isText =
      !isImage &&
      (file.type.startsWith("text/") ||
        TEXT_EXTS.has(ext) ||
        file.type === "application/json" ||
        file.type === "application/xml");

    try {
      if (isImage) {
        if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
          alert(`${file.name} is too large (max ${MAX_IMAGE_MB}MB).`);
          continue;
        }
        const data = await readFileAsDataURL(file);
        pendingAttachments.push({
          id: uid(),
          name: file.name,
          type: "image",
          mime: file.type || "image/png",
          data,
          preview: data,
        });
      } else if (isText) {
        let text = await readFileAsText(file);
        if (text.length > MAX_TEXT_CHARS) {
          text = text.slice(0, MAX_TEXT_CHARS) + "\n/* truncated */";
        }
        pendingAttachments.push({
          id: uid(),
          name: file.name,
          type: TEXT_EXTS.has(ext) ? "code" : "text",
          mime: file.type || "text/plain",
          data: text,
        });
      } else {
        // try as text fallback
        try {
          let text = await readFileAsText(file);
          if (text.length > MAX_TEXT_CHARS) text = text.slice(0, MAX_TEXT_CHARS);
          pendingAttachments.push({
            id: uid(),
            name: file.name,
            type: "file",
            mime: file.type || "text/plain",
            data: text,
          });
        } catch {
          alert(`Unsupported file: ${file.name}`);
        }
      }
    } catch (err) {
      console.error(err);
      alert(`Could not read ${file.name}`);
    }
  }
  renderAttachPreview();
}

// --------------------------------------------------------------------------
// Auth UI
// --------------------------------------------------------------------------

function showAuthError(text) {
  if (!authErrorEl) return;
  if (!text) {
    authErrorEl.textContent = "";
    authErrorEl.classList.add("hidden");
    authErrorEl.style.display = "none";
    return;
  }
  authErrorEl.textContent = text;
  authErrorEl.classList.remove("hidden");
  authErrorEl.style.display = "block";
}

function hideEl(el) {
  if (!el) return;
  el.classList.add("hidden");
  el.style.display = "none";
  el.setAttribute("hidden", "");
}

function showEl(el, display = "") {
  if (!el) return;
  el.classList.remove("hidden");
  el.removeAttribute("hidden");
  el.style.display = display || "";
}

function renderAuthUi() {
  const signedIn = Boolean(user && user.uid);
  document.body.classList.toggle("is-signed-in", signedIn);
  document.body.classList.toggle("is-signed-out", !signedIn);

  if (signedIn) {
    hideEl(signInBox);
    hideEl(googleSignInBtn);
    hideEl(googleRedirectBtn);
    showEl(userCard, "flex");
    if (userName) userName.textContent = user.displayName || "Signed in";
    if (userEmail) userEmail.textContent = user.email || user.uid || "";
    if (userAvatar) {
      if (user.photoURL) {
        userAvatar.src = user.photoURL;
        showEl(userAvatar, "block");
      } else hideEl(userAvatar);
    }
    if (sidebarHint) sidebarHint.textContent = "Files · code · images · history synced.";
    showAuthError("");
  } else {
    showEl(signInBox, "flex");
    showEl(googleSignInBtn, "inline-flex");
    showEl(googleRedirectBtn, "");
    hideEl(userCard);
    if (sidebarHint) {
      sidebarHint.textContent = isFirebaseReady()
        ? "Sign in to save chats. Attachments work either way."
        : getFirebaseInitError() || "Firebase optional for history.";
    }
    if (chatListEl) {
      chatListEl.innerHTML = `<p class="history-empty">${
        isFirebaseReady() ? "Sign in to sync chats." : "Local session only."
      }</p>`;
    }
  }
}

function applySignedInUser(nextUser) {
  user = nextUser || null;
  renderAuthUi();
}

async function handleSignIn(mode) {
  if (!isFirebaseReady()) {
    alert(getFirebaseInitError() || "Firebase not configured.");
    return;
  }
  if (window.location.hostname === "127.0.0.1") {
    const url = new URL(window.location.href);
    url.hostname = "localhost";
    window.location.replace(url.toString());
    return;
  }
  try {
    setStatus("busy", "Signing in…");
    const cred = await signInWithGoogle(mode);
    if (cred?.user) {
      applySignedInUser(cred.user);
      setStatus(null, "Signed in");
      await refreshChatList();
    } else {
      const u = currentUser();
      if (u) {
        applySignedInUser(u);
        await refreshChatList();
      }
    }
  } catch (err) {
    const nice = formatAuthError(err);
    showAuthError(nice);
    alert(nice);
    setStatus("error", "Sign-in failed");
  }
}

// --------------------------------------------------------------------------
// History sidebar
// --------------------------------------------------------------------------

function highlightActiveChat() {
  chatListEl?.querySelectorAll(".chat-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.chatId === activeChatId);
  });
}

function renderChatList() {
  if (!chatListEl) return;
  chatListEl.innerHTML = "";
  if (!user) {
    chatListEl.innerHTML = `<p class="history-empty">Sign in to sync chats.</p>`;
    return;
  }
  if (!chatSummaries.length) {
    chatListEl.innerHTML = `<p class="history-empty">No saved chats yet.</p>`;
    return;
  }
  chatSummaries.forEach((chat) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "chat-item" + (chat.id === activeChatId ? " active" : "");
    item.dataset.chatId = chat.id;
    item.innerHTML = `
      <div class="chat-item-main">
        <span class="chat-item-title"></span>
        <span class="chat-item-preview"></span>
      </div>
      <span class="chat-item-delete" title="Delete">×</span>`;
    item.querySelector(".chat-item-title").textContent = chat.title || "New chat";
    item.querySelector(".chat-item-preview").textContent =
      chat.preview || `${chat.messages?.length || 0} messages`;
    item.querySelector(".chat-item-delete").addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await removeChat(chat.id);
    });
    item.addEventListener("click", (e) => {
      if (e.target.closest(".chat-item-delete")) return;
      openChat(chat.id);
    });
    chatListEl.appendChild(item);
  });
}

async function refreshChatList() {
  if (!user) {
    chatSummaries = [];
    renderChatList();
    return;
  }
  try {
    chatSummaries = await listChats(user.uid);
  } catch (err) {
    console.error(err);
    chatSummaries = [];
  }
  renderChatList();
}

async function openChat(chatId) {
  if (!user || !chatId) return;
  setStatus("busy", "Loading…");
  try {
    const chat = await loadChat(user.uid, chatId);
    activeChatId = chatId;
    renderLoadedMessages(chat.messages, chat.title || "Chat");
    await refreshChatList();
    setStatus(null, "Ready");
    closeMobileSidebar();
  } catch (err) {
    console.error(err);
    setStatus("error", "Load failed");
  }
}

async function removeChat(chatId) {
  if (!user || !confirm("Delete this chat?")) return;
  try {
    await deleteChat(user.uid, chatId);
    if (activeChatId === chatId) resetToWelcome();
    await refreshChatList();
  } catch (err) {
    console.error(err);
    await refreshChatList();
  }
}

async function ensureActiveChat() {
  if (!user) return null;
  if (activeChatId) return activeChatId;
  activeChatId = await createChat(user.uid, "New chat");
  await refreshChatList();
  return activeChatId;
}

// --------------------------------------------------------------------------
// Send
// --------------------------------------------------------------------------

function explainHttpError(status, data) {
  if (data?.error) return String(data.error);
  if (status === 405) {
    return "405 — run python app.py and open http://localhost:5000 (not Live Server).";
  }
  if (!status) return "Server offline. Run: python app.py";
  return `Request failed (${status})`;
}

function historyForApi() {
  // only send text history to keep payload small
  return history.slice(-16).map((h) => ({
    role: h.role,
    content: h.content || "",
  }));
}

async function sendMessage(rawText) {
  const userMessage = (rawText || "").trim();
  const attachments = pendingAttachments.slice();
  if ((!userMessage && !attachments.length) || isSending) return;

  if (window.location.protocol === "file:") {
    appendMessage("assistant", "Run python app.py and open http://localhost:5000", {
      error: true,
    });
    return;
  }

  // show user bubble with attachment thumbs
  appendMessage("user", userMessage || "(attachments)", {
    scrollMode: "smooth",
    attachments: attachments.map((a) => ({
      name: a.name,
      type: a.type,
      preview: a.preview,
      data: a.type === "image" ? a.data : undefined,
    })),
  });

  // clear composer attachments after send
  pendingAttachments = [];
  renderAttachPreview();
  setSending(true);
  appendTyping();

  try {
    const payloadAttachments = attachments.map((a) => ({
      name: a.name,
      type: a.type,
      mime: a.mime,
      data: a.data,
    }));

    const res = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: userMessage,
        history: historyForApi(),
        attachments: payloadAttachments,
        mode: activeMode,
      }),
    });

    let data = {};
    const raw = await res.text();
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { error: raw?.slice(0, 200) };
    }

    removeTyping();

    if (!res.ok || data.error) {
      appendMessage("assistant", explainHttpError(res.status, data), {
        error: true,
        scrollMode: "reply",
      });
      setStatus("error", "Error");
      return;
    }

    const reply = data.reply || (data.images?.length ? "Here's your image." : "(empty)");
    const images = Array.isArray(data.images) ? data.images : [];
    // Jump chat to the new AI response
    appendMessage("assistant", reply, { images, scrollMode: "reply" });

    history.push({ role: "user", content: userMessage || "(attachments)" });
    history.push({ role: "assistant", content: reply, images });

    if (user) {
      try {
        const chatId = await ensureActiveChat();
        // store text + small note about images (not full base64 in firestore to avoid huge docs)
        const storeReply =
          reply +
          (images.length ? `\n\n[${images.length} image(s) generated in this turn]` : "");
        const result = await saveTurn(
          user.uid,
          chatId,
          userMessage || `(${attachments.length} attachment(s))`,
          storeReply
        );
        if (result?.chat?.title) chatTitleEl.textContent = result.chat.title;
        await refreshChatList();
        setStatus(null, result?.cloud ? "Saved ✓" : "Saved locally");
      } catch (err) {
        console.error(err);
      }
    } else {
      setStatus(null, data.mode === "image" ? "Image ready" : "Ready");
    }
    setTimeout(() => {
      if (!isSending) setStatus(null, "Ready");
    }, 1500);
  } catch (err) {
    removeTyping();
    console.error(err);
    appendMessage("assistant", "Network error — run python app.py", { error: true });
    setStatus("error", "Offline");
  } finally {
    setSending(false);
  }
}

// --------------------------------------------------------------------------
// Mobile
// --------------------------------------------------------------------------

function openMobileSidebar() {
  sidebar?.classList.add("open");
  if (sidebarBackdrop) sidebarBackdrop.hidden = false;
}
function closeMobileSidebar() {
  sidebar?.classList.remove("open");
  if (sidebarBackdrop) sidebarBackdrop.hidden = true;
}

// --------------------------------------------------------------------------
// Events
// --------------------------------------------------------------------------

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value;
  input.value = "";
  autoResizeInput();
  sendMessage(text);
});

input.addEventListener("input", autoResizeInput);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

attachBtn?.addEventListener("click", () => fileInput?.click());
fileInput?.addEventListener("change", async () => {
  await addFiles(fileInput.files);
  fileInput.value = "";
});

// drag & drop
["dragenter", "dragover"].forEach((ev) => {
  chatbox.addEventListener(ev, (e) => {
    e.preventDefault();
    chatbox.classList.add("drag-over");
  });
});
["dragleave", "drop"].forEach((ev) => {
  chatbox.addEventListener(ev, (e) => {
    e.preventDefault();
    chatbox.classList.remove("drag-over");
  });
});
chatbox.addEventListener("drop", async (e) => {
  const files = e.dataTransfer?.files;
  if (files?.length) await addFiles(files);
});

// paste images
input.addEventListener("paste", async (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  const files = [];
  for (const it of items) {
    if (it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (f) files.push(f);
    }
  }
  if (files.length) {
    e.preventDefault();
    await addFiles(files);
  }
});

document.querySelectorAll(".mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => setMode(btn.dataset.mode));
});

newChatBtn?.addEventListener("click", async () => {
  if (user) {
    try {
      activeChatId = await createChat(user.uid, "New chat");
      history = [];
      messagesEl = null;
      pendingAttachments = [];
      renderAttachPreview();
      chatbox.innerHTML = welcomeHtml();
      bindSuggestions(chatbox);
      chatTitleEl.textContent = "New chat";
      await refreshChatList();
    } catch {
      resetToWelcome();
    }
  } else resetToWelcome();
  closeMobileSidebar();
  input.focus();
});

googleSignInBtn?.addEventListener("click", () => handleSignIn("popup"));
googleRedirectBtn?.addEventListener("click", () => handleSignIn("redirect"));
signOutBtn?.addEventListener("click", async () => {
  try {
    await signOutUser();
    applySignedInUser(null);
    chatSummaries = [];
    activeChatId = null;
    renderChatList();
    resetToWelcome();
  } catch (err) {
    console.error(err);
  }
});

menuToggle?.addEventListener("click", openMobileSidebar);
sidebarBackdrop?.addEventListener("click", closeMobileSidebar);
lightboxClose?.addEventListener("click", closeLightbox);
lightbox?.addEventListener("click", (e) => {
  if (e.target === lightbox) closeLightbox();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeLightbox();
});


// --------------------------------------------------------------------------
// Code Arena workspace + live preview
// --------------------------------------------------------------------------

const ARENA_KEY = "suuwethaan_code_arena_v1";
/** @type {{id:string,name:string,lang:string,content:string,updatedAt:number}[]} */
let arenaFiles = [];
let arenaActiveId = null;

const EXT_MAP = {
  javascript: "js", js: "js", jsx: "jsx", typescript: "ts", ts: "ts", tsx: "tsx",
  python: "py", py: "py", html: "html", htm: "html", css: "css", scss: "scss",
  json: "json", md: "md", markdown: "md", bash: "sh", shell: "sh", sh: "sh",
  java: "java", go: "go", rust: "rs", rs: "rs", c: "c", cpp: "cpp", "c++": "cpp",
  php: "php", rb: "rb", ruby: "rb", sql: "sql", xml: "xml", yaml: "yml", yml: "yml",
  text: "txt", txt: "txt", svg: "svg",
};

function guessFileName(lang, code = "", idx = 0) {
  const l = String(lang || "text").toLowerCase();
  const ext = EXT_MAP[l] || (l.length <= 5 ? l : "txt");
  // try to detect html document
  if (/<!doctype html>|<html[\s>]/i.test(code)) return `index-${idx + 1}.html`;
  if (ext === "css" && /body\s*\{/.test(code)) return `styles-${idx + 1}.css`;
  if (ext === "js" && /function\s+|const\s+|=>/.test(code)) return `script-${idx + 1}.js`;
  if (ext === "py") return `main-${idx + 1}.py`;
  return `file-${idx + 1}.${ext}`;
}

function loadArena() {
  try {
    const raw = localStorage.getItem(ARENA_KEY);
    arenaFiles = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arenaFiles)) arenaFiles = [];
  } catch {
    arenaFiles = [];
  }
}

function saveArena() {
  try {
    localStorage.setItem(ARENA_KEY, JSON.stringify(arenaFiles));
  } catch (e) {
    console.warn("arena save failed", e);
  }
  updateArenaBadge();
}

function updateArenaBadge() {
  const badge = document.getElementById("arenaBadge");
  if (!badge) return;
  if (!arenaFiles.length) {
    badge.classList.add("hidden");
    badge.textContent = "0";
  } else {
    badge.classList.remove("hidden");
    badge.textContent = String(arenaFiles.length);
  }
}

function mimeForName(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const map = {
    html: "text/html", htm: "text/html", css: "text/css", js: "text/javascript",
    mjs: "text/javascript", json: "application/json", svg: "image/svg+xml",
    py: "text/x-python", txt: "text/plain", md: "text/markdown",
  };
  return map[ext] || "text/plain";
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content ?? ""], { type: mimeForName(filename) + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "file.txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function downloadAllArenaZip() {
  if (!arenaFiles.length) {
    alert("Code Arena is empty.");
    return;
  }
  // Minimal ZIP (store only) so we don't need a library
  const zipBlob = await buildSimpleZip(
    arenaFiles.map((f) => ({ name: f.name, data: f.content || "" }))
  );
  downloadBlob(`SUUWETHAAN-Arena-${Date.now()}.zip`, zipBlob);
}

/** Store-only ZIP builder (no compression) */
async function buildSimpleZip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;

  function u16(n) {
    const b = new Uint8Array(2);
    b[0] = n & 255; b[1] = (n >> 8) & 255;
    return b;
  }
  function u32(n) {
    const b = new Uint8Array(4);
    b[0] = n & 255; b[1] = (n >> 8) & 255; b[2] = (n >> 16) & 255; b[3] = (n >> 24) & 255;
    return b;
  }
  function crc32(buf) {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  }

  for (const f of files) {
    const nameBytes = enc.encode(f.name.replace(/\\/g, "/"));
    const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    local.set([0x50, 0x4b, 0x03, 0x04], 0);
    local.set(u16(20), 4);
    local.set(u16(0), 6);
    local.set(u16(0), 8); // store
    local.set(u16(0), 10);
    local.set(u16(0), 12);
    local.set(u32(crc), 14);
    local.set(u32(data.length), 18);
    local.set(u32(data.length), 22);
    local.set(u16(nameBytes.length), 26);
    local.set(u16(0), 28);
    local.set(nameBytes, 30);
    parts.push(local, data);

    const cen = new Uint8Array(46 + nameBytes.length);
    cen.set([0x50, 0x4b, 0x01, 0x02], 0);
    cen.set(u16(20), 4);
    cen.set(u16(20), 6);
    cen.set(u16(0), 8);
    cen.set(u16(0), 10);
    cen.set(u16(0), 12);
    cen.set(u16(0), 14);
    cen.set(u32(crc), 16);
    cen.set(u32(data.length), 20);
    cen.set(u32(data.length), 24);
    cen.set(u16(nameBytes.length), 28);
    cen.set(u16(0), 30);
    cen.set(u16(0), 32);
    cen.set(u16(0), 34);
    cen.set(u16(0), 36);
    cen.set(u32(0), 38);
    cen.set(u32(offset), 42);
    cen.set(nameBytes, 46);
    central.push(cen);
    offset += local.length + data.length;
  }

  const centralSize = central.reduce((s, x) => s + x.length, 0);
  const end = new Uint8Array(22);
  end.set([0x50, 0x4b, 0x05, 0x06], 0);
  end.set(u16(0), 4);
  end.set(u16(0), 6);
  end.set(u16(files.length), 8);
  end.set(u16(files.length), 10);
  end.set(u32(centralSize), 12);
  end.set(u32(offset), 16);
  end.set(u16(0), 20);

  return new Blob([...parts, ...central, end], { type: "application/zip" });
}

function addArenaFile(name, content, lang = "text", { open = true, flash = false } = {}) {
  loadArena();
  let finalName = (name || guessFileName(lang, content)).trim() || "file.txt";
  // unique name
  const base = finalName.replace(/(\.[^.]+)?$/, "");
  const ext = (finalName.match(/\.[^.]+$/) || [""])[0];
  let n = 1;
  while (arenaFiles.some((f) => f.name === finalName && f.id !== arenaActiveId)) {
    finalName = `${base}-${n}${ext}`;
    n += 1;
  }
  const existing = arenaFiles.find((f) => f.name === finalName);
  if (existing) {
    existing.content = content;
    existing.lang = lang;
    existing.updatedAt = Date.now();
    arenaActiveId = existing.id;
  } else {
    const file = {
      id: uid(),
      name: finalName,
      lang: lang || "text",
      content: content || "",
      updatedAt: Date.now(),
    };
    arenaFiles.unshift(file);
    arenaActiveId = file.id;
  }
  saveArena();
  renderArena();
  if (open) openArena();
  if (flash) setStatus(null, "Added to Arena");
  return arenaActiveId;
}

function getActiveArenaFile() {
  return arenaFiles.find((f) => f.id === arenaActiveId) || null;
}

function renderArena() {
  const list = document.getElementById("arenaFileList");
  const editor = document.getElementById("arenaEditor");
  const activeName = document.getElementById("arenaActiveName");
  const empty = document.getElementById("arenaEmpty");
  if (!list || !editor) return;

  list.innerHTML = "";
  if (!arenaFiles.length) {
    list.innerHTML = `<p class="arena-empty" id="arenaEmpty">No files yet. Ask AI for code, then click <b>+ Arena</b> on a code block.</p>`;
    editor.value = "";
    editor.disabled = true;
    if (activeName) activeName.textContent = "No file selected";
    updateArenaBadge();
    return;
  }

  arenaFiles
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .forEach((f) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "arena-file" + (f.id === arenaActiveId ? " active" : "");
      row.innerHTML = `
        <span class="arena-file-icon">${iconFor(f.name)}</span>
        <span class="arena-file-meta">
          <span class="arena-file-name"></span>
          <span class="arena-file-sub"></span>
        </span>
        <span class="arena-file-x" title="Remove">×</span>`;
      row.querySelector(".arena-file-name").textContent = f.name;
      row.querySelector(".arena-file-sub").textContent = `${f.lang || "file"} · ${(f.content || "").length} chars`;
      row.addEventListener("click", (e) => {
        if (e.target.closest(".arena-file-x")) return;
        arenaActiveId = f.id;
        renderArena();
      });
      row.querySelector(".arena-file-x").addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        arenaFiles = arenaFiles.filter((x) => x.id !== f.id);
        if (arenaActiveId === f.id) arenaActiveId = arenaFiles[0]?.id || null;
        saveArena();
        renderArena();
      });
      list.appendChild(row);
    });

  const active = getActiveArenaFile();
  if (active) {
    editor.disabled = false;
    if (document.activeElement !== editor) editor.value = active.content || "";
    if (activeName) activeName.textContent = active.name;
  } else {
    editor.disabled = true;
    editor.value = "";
    if (activeName) activeName.textContent = "No file selected";
  }
  updateArenaBadge();
}

function iconFor(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (ext === "html" || ext === "htm") return "🌐";
  if (ext === "css") return "🎨";
  if (ext === "js" || ext === "ts") return "⚡";
  if (ext === "py") return "🐍";
  if (ext === "json") return "{}";
  if (ext === "svg") return "◇";
  return "📄";
}

function openArena() {
  const panel = document.getElementById("codeArena");
  const bd = document.getElementById("arenaBackdrop");
  if (!panel) return;
  loadArena();
  renderArena();
  panel.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
  if (bd) {
    bd.hidden = false;
    bd.classList.remove("hidden");
  }
  document.body.classList.add("arena-open");
}

function closeArena() {
  const panel = document.getElementById("codeArena");
  const bd = document.getElementById("arenaBackdrop");
  panel?.classList.remove("open");
  panel?.setAttribute("aria-hidden", "true");
  if (bd) {
    bd.hidden = true;
    bd.classList.add("hidden");
  }
  document.body.classList.remove("arena-open");
}

function buildLiveHtml(name, code, lang) {
  const l = (lang || "").toLowerCase();
  const ext = (name.split(".").pop() || "").toLowerCase();
  const isHtml =
    l === "html" ||
    ext === "html" ||
    ext === "htm" ||
    /<!doctype html>|<html[\s>]/i.test(code || "");
  if (isHtml) return code;

  if (l === "svg" || ext === "svg" || /^\s*<svg[\s>]/i.test(code || "")) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;display:grid;place-items:center;background:#0b0d14}svg{max-width:90vw;max-height:90vh}</style></head><body>${code}</body></html>`;
  }

  if (l === "css" || ext === "css") {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;font-family:Inter,system-ui,sans-serif;background:#0b0d14;color:#eef0f6}
      body{padding:2rem}
      .demo{max-width:520px;margin:10vh auto;padding:1.5rem;border-radius:16px;border:1px solid rgba(255,255,255,.1);background:#151925}
      button{margin-top:1rem;padding:.7rem 1rem;border:0;border-radius:10px;background:linear-gradient(135deg,#7c6cf0,#9b7bff);color:#fff;font-weight:600}
      ${code}
    </style></head><body><div class="demo"><h1>CSS Live Preview</h1><p>Your stylesheet is applied to this demo card.</p><button>Demo button</button></div></body></html>`;
  }

  if (l === "javascript" || l === "js" || ext === "js") {
    const safe = String(code || "").replace(/<\/script/gi, "<\\/script");
    const open = "<" + "script>";
    const close = "</" + "script>";
    return (
      `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;background:#0b0d14;color:#e8ebf4;font-family:ui-monospace,Menlo,Consolas,monospace}
      #out{padding:1rem;white-space:pre-wrap}
      .ok{color:#6ee7b7}.err{color:#fca5a5}
    </style></head><body><div id="out"></div>` +
      open +
      `
      const out = document.getElementById('out');
      const log = (...a) => { out.innerHTML += '<div class="ok">' + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + '</div>'; };
      const error = (...a) => { out.innerHTML += '<div class="err">' + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + '</div>'; };
      console.log = log; console.error = error; console.warn = log;
      try { ${safe}
} catch (e) { error(String(e && e.stack || e)); }
    ` +
      close +
      `</body></html>`
    );
  }

  const esc = String(code || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const safeName = String(name || "file").replace(/</g, "&lt;");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#0b0d14;color:#e6edf3;font-family:ui-monospace,Menlo,monospace;padding:1.25rem}
    h1{font-family:Inter,system-ui,sans-serif;font-size:1rem;color:#c4b5fd}
    pre{white-space:pre-wrap}
  </style></head><body><h1>${safeName}</h1><pre>${esc}</pre>
  <p style="color:#8b92a8">Live preview runs best for HTML, CSS, JS, or SVG. This file is shown as text.</p>
  </body></html>`;
}

let liveObjectUrl = null;

function openLivePreview(name, code, lang) {
  const modal = document.getElementById("liveModal");
  const frame = document.getElementById("liveFrame");
  const title = document.getElementById("liveTitle");
  if (!modal || !frame) return;

  const html = buildLiveHtml(name, code, lang);
  if (liveObjectUrl) URL.revokeObjectURL(liveObjectUrl);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  liveObjectUrl = URL.createObjectURL(blob);
  frame.src = liveObjectUrl;
  if (title) title.textContent = name || "preview";
  modal.hidden = false;
  modal.classList.remove("hidden");
  document.body.classList.add("live-open");
  // stash for refresh/open tab
  modal.dataset.liveName = name || "preview";
  modal.dataset.liveLang = lang || "";
  modal.dataset.liveCode = code || "";
}

function closeLivePreview() {
  const modal = document.getElementById("liveModal");
  const frame = document.getElementById("liveFrame");
  if (frame) frame.src = "about:blank";
  if (liveObjectUrl) {
    URL.revokeObjectURL(liveObjectUrl);
    liveObjectUrl = null;
  }
  if (modal) {
    modal.hidden = true;
    modal.classList.add("hidden");
  }
  document.body.classList.remove("live-open");
}

function refreshLivePreview() {
  const modal = document.getElementById("liveModal");
  if (!modal || modal.classList.contains("hidden")) return;
  openLivePreview(modal.dataset.liveName, modal.dataset.liveCode, modal.dataset.liveLang);
}

function openLiveInTab() {
  const modal = document.getElementById("liveModal");
  if (!modal) return;
  const html = buildLiveHtml(modal.dataset.liveName, modal.dataset.liveCode, modal.dataset.liveLang);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function initCodeArena() {
  loadArena();
  renderArena();

  document.getElementById("arenaToggle")?.addEventListener("click", () => {
    const panel = document.getElementById("codeArena");
    if (panel?.classList.contains("open")) closeArena();
    else openArena();
  });
  document.getElementById("arenaClose")?.addEventListener("click", closeArena);
  document.getElementById("arenaBackdrop")?.addEventListener("click", closeArena);

  document.getElementById("arenaEditor")?.addEventListener("input", (e) => {
    const active = getActiveArenaFile();
    if (!active) return;
    active.content = e.target.value;
    active.updatedAt = Date.now();
    saveArena();
    // update subtitle counts lightly
    const row = document.querySelector(`.arena-file.active .arena-file-sub`);
    if (row) row.textContent = `${active.lang || "file"} · ${active.content.length} chars`;
  });

  document.getElementById("arenaNewFile")?.addEventListener("click", () => {
    const name = prompt("File name", "index.html");
    if (!name) return;
    const ext = (name.split(".").pop() || "txt").toLowerCase();
    addArenaFile(name, defaultTemplate(ext), ext, { open: true });
  });

  document.getElementById("arenaDownloadActive")?.addEventListener("click", () => {
    const active = getActiveArenaFile();
    if (!active) return alert("Select a file first.");
    // flush editor
    const editor = document.getElementById("arenaEditor");
    if (editor && !editor.disabled) active.content = editor.value;
    downloadTextFile(active.name, active.content);
  });

  document.getElementById("arenaDownloadAll")?.addEventListener("click", () => {
    const editor = document.getElementById("arenaEditor");
    const active = getActiveArenaFile();
    if (active && editor && !editor.disabled) {
      active.content = editor.value;
      saveArena();
    }
    downloadAllArenaZip();
  });

  document.getElementById("arenaClear")?.addEventListener("click", () => {
    if (!arenaFiles.length) return;
    if (!confirm("Clear all files from Code Arena?")) return;
    arenaFiles = [];
    arenaActiveId = null;
    saveArena();
    renderArena();
  });

  document.getElementById("arenaCopyFile")?.addEventListener("click", async () => {
    const active = getActiveArenaFile();
    if (!active) return;
    const editor = document.getElementById("arenaEditor");
    const text = editor && !editor.disabled ? editor.value : active.content;
    const ok = await copyTextToClipboard(text || "");
    setStatus(null, ok ? "Copied file" : "Copy failed");
  });

  const previewActive = () => {
    const active = getActiveArenaFile();
    if (!active) return alert("Select a file first.");
    const editor = document.getElementById("arenaEditor");
    if (editor && !editor.disabled) active.content = editor.value;
    openLivePreview(active.name, active.content, active.lang);
  };
  document.getElementById("arenaPreviewFile")?.addEventListener("click", previewActive);
  document.getElementById("arenaLiveBtn")?.addEventListener("click", previewActive);

  document.getElementById("liveClose")?.addEventListener("click", closeLivePreview);
  document.getElementById("liveRefresh")?.addEventListener("click", refreshLivePreview);
  document.getElementById("liveOpenTab")?.addEventListener("click", openLiveInTab);
  document.getElementById("liveModal")?.addEventListener("click", (e) => {
    if (e.target.id === "liveModal") closeLivePreview();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!document.getElementById("liveModal")?.classList.contains("hidden")) closeLivePreview();
      else if (document.getElementById("codeArena")?.classList.contains("open")) closeArena();
    }
  });
}

function defaultTemplate(ext) {
  if (ext === "html" || ext === "htm") {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SUUWETHAAN Live</title>
  <style>
    body { font-family: system-ui, sans-serif; background:#0b0d14; color:#eef0f6; display:grid; place-items:center; min-height:100vh; margin:0; }
    .card { padding:2rem 2.2rem; border-radius:18px; background:#151925; border:1px solid rgba(255,255,255,.08); }
    button { margin-top:1rem; border:0; border-radius:10px; padding:.7rem 1rem; background:linear-gradient(135deg,#7c6cf0,#9b7bff); color:white; font-weight:700; cursor:pointer; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Hello from Code Arena</h1>
    <p>Edit me, then hit Live view.</p>
    <button onclick="alert('Live server works!')">Click me</button>
  </div>
</body>
</html>`;
  }
  if (ext === "css") return "body {\n  font-family: system-ui, sans-serif;\n}\n";
  if (ext === "js") return 'console.log("Hello from Code Arena");\n';
  if (ext === "py") return 'print("Hello from Code Arena")\n';
  return "";
}


// --------------------------------------------------------------------------
// Boot
// --------------------------------------------------------------------------

bindSuggestions();
ensureScrollFab();
initCodeArena();
const firebaseOk = initFirebase();
renderAuthUi();
setMode("auto");

if (window.location.hostname === "127.0.0.1") {
  showAuthError("Use http://localhost:5000 — not 127.0.0.1");
}

async function onAuthChanged(u) {
  applySignedInUser(u);
  if (u) {
    setStatus(null, "Signed in");
    await refreshChatList();
    if (!activeChatId && !history.length) resetToWelcome();
  } else {
    chatSummaries = [];
    activeChatId = null;
    renderChatList();
    if (!history.length) resetToWelcome();
  }
}

if (firebaseOk && isFirebaseReady()) {
  watchAuth(onAuthChanged);
  setTimeout(() => {
    const u = currentUser();
    if (u) applySignedInUser(u);
  }, 400);
}

input.focus();
