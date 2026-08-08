"""
SUUWETHAAN AI — Flask backend
- Chat (text + file attachments)
- Image create / edit via Gemini
- Code-friendly system prompt
"""

from __future__ import annotations

import base64
import mimetypes
import os
import re
import socket
import sys
import traceback
from pathlib import Path
from typing import Any

try:
    import requests
    from dotenv import load_dotenv
    from flask import Flask, jsonify, request, send_from_directory
except ImportError as exc:
    print("\n❌ Missing packages. Install them first:\n")
    print("   pip install -r requirements.txt\n")
    print(f"   Details: {exc}\n")
    sys.exit(1)

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

API_KEY = (os.getenv("API_KEY") or "").strip()
API_BASE_URL = (
    os.getenv("API_BASE_URL") or "https://generativelanguage.googleapis.com/v1beta/openai"
).rstrip("/")
MODEL_NAME = (os.getenv("MODEL_NAME") or "gemini-flash-lite-latest").strip()
IMAGE_MODEL = (os.getenv("IMAGE_MODEL") or "gemini-3.1-flash-image").strip()

HOST = os.getenv("HOST", "0.0.0.0")
# Render injects PORT; local default 5000
PORT = int(os.getenv("PORT") or os.getenv("WEB_PORT") or "5000")
PUBLIC_HOST = os.getenv("PUBLIC_HOST", "localhost")

MAX_TEXT_FILE_CHARS = 80_000
MAX_IMAGE_BYTES = 8 * 1024 * 1024  # 8MB decoded
MAX_ATTACHMENTS = 8

app = Flask(__name__)

SYSTEM_PROMPT = (
    "You are SUUWETHAAN AI, a friendly modern assistant with strong coding skills.\n"
    "- Write clear, working code with brief explanations.\n"
    "- Use fenced markdown code blocks with a language tag (```python, ```js, etc).\n"
    "- When the user attaches files, use their contents as context.\n"
    "- When the user attaches images, describe/analyze/edit-instructions carefully.\n"
    "- Keep a warm, concise tone."
)

IMAGE_HINT = re.compile(
    r"\b("
    r"generate|create|draw|paint|make|design|render|imagine|"
    r"edit|modify|change|transform|restyle|upscale|remove background|"
    r"image|picture|photo|illustration|logo|icon|artwork|thumbnail"
    r")\b",
    re.I,
)


def _find_free_port(preferred: int) -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("127.0.0.1", preferred))
            return preferred
        except OSError:
            sock.bind(("127.0.0.1", 0))
            return int(sock.getsockname()[1])


def _strip_data_url(data_url: str) -> tuple[str, str]:
    """Return (mime, base64_payload)."""
    if not data_url:
        return "application/octet-stream", ""
    m = re.match(r"^data:([^;]+);base64,(.+)$", data_url, re.S)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    # raw base64
    return "application/octet-stream", data_url.strip()


def _wants_image_output(message: str, mode: str, has_image_attach: bool) -> bool:
    if mode in ("image", "image_edit", "generate_image", "edit_image"):
        return True
    text = (message or "").lower()
    if has_image_attach and re.search(
        r"\b(edit|modify|change|transform|restyle|remove|replace|add|make it)\b", text
    ):
        return True
    if re.search(
        r"\b(generate|create|draw|make|design|render)\b.{0,40}\b(image|picture|photo|logo|icon|art|illustration)\b",
        text,
    ):
        return True
    if re.search(
        r"\b(image|picture|photo|logo|icon)\b.{0,40}\b(of|with|showing|that)\b",
        text,
    ):
        return True
    return False


def _build_user_content(text: str, attachments: list[dict]) -> Any:
    """
    Build OpenAI-style multimodal content for one user turn.
    Text attachment: {name, type, mime, data (dataURL or text)}
    """
    parts: list[dict] = []
    file_notes: list[str] = []

    for att in attachments[:MAX_ATTACHMENTS]:
        name = (att.get("name") or "file").strip()
        kind = (att.get("type") or "").lower()  # image | text | code | file
        mime = (att.get("mime") or "").lower()
        data = att.get("data") or ""

        if kind == "image" or mime.startswith("image/"):
            mime2, b64 = _strip_data_url(data) if data.startswith("data:") else (mime or "image/png", data)
            # size guard
            try:
                raw_len = len(base64.b64decode(b64[:100] + "=="))  # cheap check
            except Exception:
                raw_len = 0
            if len(b64) > MAX_IMAGE_BYTES * 1.4:
                file_notes.append(f"[Skipped large image: {name}]")
                continue
            parts.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime2};base64,{b64}" if not data.startswith("data:") else data},
                }
            )
            file_notes.append(f"[Attached image: {name}]")
        else:
            # text / code / generic
            content = data
            if data.startswith("data:"):
                # decode text from data url if needed
                mime2, b64 = _strip_data_url(data)
                try:
                    content = base64.b64decode(b64).decode("utf-8", errors="replace")
                except Exception:
                    content = ""
            content = str(content)[:MAX_TEXT_FILE_CHARS]
            lang = ""
            ext = Path(name).suffix.lower().lstrip(".")
            if ext in {
                "py", "js", "ts", "tsx", "jsx", "html", "css", "json", "md",
                "java", "go", "rs", "c", "cpp", "h", "php", "rb", "sh", "sql",
                "yml", "yaml", "toml", "xml", "txt",
            }:
                lang = ext if ext != "md" else "markdown"
                if ext == "py":
                    lang = "python"
                if ext in ("ts", "tsx"):
                    lang = "typescript"
                if ext in ("js", "jsx"):
                    lang = "javascript"
            file_notes.append(f"Attached file `{name}`:\n```{lang}\n{content}\n```")

    body = (text or "").strip()
    if file_notes:
        preface = "\n\n".join(file_notes)
        body = f"{body}\n\n{preface}".strip() if body else preface

    if not parts:
        return body or "(empty)"

    # multimodal: text first then images
    content: list[dict] = [{"type": "text", "text": body or "Please look at the attached image(s)."}]
    content.extend(parts)
    return content


def _history_to_messages(history: list, attachments_by_turn: bool = False) -> list[dict]:
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for turn in (history or [])[-16:]:
        role = turn.get("role")
        content = turn.get("content")
        if role not in ("user", "assistant") or content is None:
            continue
        # history content may already be string; skip huge data urls in history images array
        if isinstance(content, list):
            # keep as multimodal
            messages.append({"role": role, "content": content})
        else:
            messages.append({"role": role, "content": str(content)})
    return messages


def _extract_reply_and_images(payload: dict) -> tuple[str, list[str]]:
    """Parse chat.completion style response into text + image data URLs."""
    images: list[str] = []
    text = ""

    try:
        msg = payload["choices"][0]["message"]
    except Exception:
        return "", []

    content = msg.get("content")
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        chunks = []
        for part in content:
            if not isinstance(part, dict):
                chunks.append(str(part))
                continue
            ptype = part.get("type")
            if ptype in ("text", "output_text") or "text" in part:
                chunks.append(part.get("text") or "")
            elif ptype in ("image_url", "image"):
                url = (
                    (part.get("image_url") or {}).get("url")
                    or part.get("url")
                    or ""
                )
                if url:
                    images.append(url)
            elif ptype == "inline_data" or part.get("inline_data"):
                inline = part.get("inline_data") or {}
                mime = inline.get("mime_type") or "image/png"
                data = inline.get("data") or ""
                if data:
                    images.append(f"data:{mime};base64,{data}")
        text = "".join(chunks)

    # Some gateways put images on message.images
    for img in msg.get("images") or []:
        if isinstance(img, dict):
            url = (img.get("image_url") or {}).get("url") or img.get("url")
            if url:
                images.append(url)
        elif isinstance(img, str):
            images.append(img)

    return text or "", images


def _call_chat(messages: list[dict], model: str | None = None) -> tuple[str | None, list[str], str | None, int]:
    url = f"{API_BASE_URL}/chat/completions"
    model = model or MODEL_NAME
    try:
        response = requests.post(
            url,
            headers={
                "Authorization": f"Bearer {API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": messages,
                "temperature": 0.7,
            },
            timeout=120,
        )
    except requests.exceptions.Timeout:
        return None, [], "The AI service timed out. Please try again.", 504
    except requests.exceptions.RequestException as exc:
        return None, [], f"Could not reach the AI service: {exc}", 502

    if response.status_code != 200:
        detail = None
        try:
            err_body = response.json()
            # Gemini sometimes returns a list: [{"error": {...}}]
            if isinstance(err_body, list) and err_body:
                err_body = err_body[0] if isinstance(err_body[0], dict) else {"error": err_body}
            err = err_body.get("error") if isinstance(err_body, dict) else None
            if isinstance(err, dict):
                detail = err.get("message")
            else:
                detail = err or (err_body.get("message") if isinstance(err_body, dict) else None)
        except Exception:
            detail = (response.text or "")[:400]
        if response.status_code == 429 or (detail and "quota" in str(detail).lower()):
            detail = (
                "Gemini free-tier quota exceeded (limit hit for this Google project).\n\n"
                "What to do:\n"
                "1) Wait for the quota to reset (often daily)\n"
                "2) Check usage: https://ai.dev/rate-limit\n"
                "3) Create a key on a different Google account/project, or enable billing\n"
                "4) Update API_KEY in Render Environment and redeploy\n\n"
                "Your app is fine — Google is rate-limiting the API key."
            )
        return None, [], detail or f"AI service returned status {response.status_code}.", 502

    try:
        payload = response.json()
        text, images = _extract_reply_and_images(payload)
        return text, images, None, 200
    except Exception:
        traceback.print_exc()
        return None, [], "Unexpected response format from the AI service.", 502


def _call_native_generate_image(prompt: str, image_parts: list[dict] | None = None) -> tuple[str | None, list[str], str | None, int]:
    """
    Gemini native generateContent for image models.
    image_parts: [{mime, b64}]
    """
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{IMAGE_MODEL}:generateContent"
    )
    parts: list[dict] = [{"text": prompt}]
    for im in image_parts or []:
        parts.append(
            {
                "inline_data": {
                    "mime_type": im.get("mime") or "image/png",
                    "data": im.get("b64") or "",
                }
            }
        )

    body = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            # request image if supported; harmless if ignored
            "responseModalities": ["TEXT", "IMAGE"],
        },
    }

    try:
        response = requests.post(
            url,
            headers={
                "x-goog-api-key": API_KEY,
                "Content-Type": "application/json",
            },
            json=body,
            timeout=120,
        )
    except requests.exceptions.Timeout:
        return None, [], "Image generation timed out.", 504
    except requests.exceptions.RequestException as exc:
        return None, [], f"Image service error: {exc}", 502

    if response.status_code != 200:
        # fallback without responseModalities
        if response.status_code in (400, 404):
            body.pop("generationConfig", None)
            try:
                response = requests.post(
                    url,
                    headers={
                        "x-goog-api-key": API_KEY,
                        "Content-Type": "application/json",
                    },
                    json=body,
                    timeout=120,
                )
            except Exception as exc:
                return None, [], f"Image service error: {exc}", 502

    if response.status_code != 200:
        detail = None
        try:
            err = response.json().get("error") or {}
            detail = err.get("message") if isinstance(err, dict) else str(err)
        except Exception:
            detail = (response.text or "")[:400]
        if response.status_code == 429:
            detail = (
                "Image model quota exceeded on this API key (free tier limit). "
                "Wait a bit, try again later, or enable billing in Google AI Studio. "
                "Chat/code/file features still work."
            )
        return None, [], detail or f"Image API status {response.status_code}", 502

    try:
        payload = response.json()
        candidates = payload.get("candidates") or []
        texts: list[str] = []
        images: list[str] = []
        for cand in candidates:
            content = (cand.get("content") or {})
            for part in content.get("parts") or []:
                if "text" in part and part["text"]:
                    texts.append(part["text"])
                inline = part.get("inlineData") or part.get("inline_data")
                if inline and inline.get("data"):
                    mime = inline.get("mimeType") or inline.get("mime_type") or "image/png"
                    images.append(f"data:{mime};base64,{inline['data']}")
        text = "\n".join(texts).strip() or (
            "Here's the generated image." if images else ""
        )
        if not images and not text:
            return None, [], "Model returned no image or text.", 502
        return text, images, None, 200
    except Exception:
        traceback.print_exc()
        return None, [], "Could not parse image response.", 502


def _attachments_image_parts(attachments: list[dict]) -> list[dict]:
    out = []
    for att in attachments or []:
        kind = (att.get("type") or "").lower()
        mime = (att.get("mime") or "").lower()
        data = att.get("data") or ""
        if kind == "image" or mime.startswith("image/") or (
            isinstance(data, str) and data.startswith("data:image/")
        ):
            mime2, b64 = _strip_data_url(data) if data.startswith("data:") else (mime or "image/png", data)
            if b64:
                out.append({"mime": mime2, "b64": b64, "name": att.get("name") or "image"})
    return out


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.after_request
def _headers(resp):
    resp.headers["Cache-Control"] = "no-store"
    origin = request.headers.get("Origin", "*")
    resp.headers["Access-Control-Allow-Origin"] = origin
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return resp


@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/index.html")
def index_html():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/style.css")
def style_css():
    return send_from_directory(BASE_DIR, "style.css")


@app.route("/script.js")
def script_js():
    return send_from_directory(BASE_DIR, "script.js")


@app.route("/js/<path:filename>")
def js_files(filename):
    return send_from_directory(BASE_DIR / "js", filename)


@app.route("/health", methods=["GET"])
def health():
    return jsonify(
        {
            "ok": True,
            "model": MODEL_NAME,
            "image_model": IMAGE_MODEL,
            "api_configured": bool(API_KEY and API_KEY != "your_api_key_here"),
            "features": ["chat", "files", "code", "image_generate", "image_edit"],
        }
    )


@app.route("/chat", methods=["POST", "OPTIONS"])
def chat():
    if request.method == "OPTIONS":
        return ("", 204)

    try:
        data = request.get_json(silent=True) or {}
        user_message = (data.get("message") or "").strip()
        history = data.get("history") or []
        attachments = data.get("attachments") or []
        mode = (data.get("mode") or "auto").lower()  # auto | chat | image

        if not user_message and not attachments:
            return jsonify({"error": "Message or attachment required."}), 400

        if not API_KEY or API_KEY == "your_api_key_here":
            return jsonify({"error": "API key not configured in .env"}), 500

        if not isinstance(attachments, list):
            attachments = []
        attachments = attachments[:MAX_ATTACHMENTS]

        image_parts = _attachments_image_parts(attachments)
        wants_image = _wants_image_output(user_message, mode, bool(image_parts))

        # -------- Image generate / edit path --------
        if wants_image and mode != "chat":
            prompt = user_message or (
                "Edit this image as requested." if image_parts else "Generate an image."
            )
            if image_parts:
                prompt = (
                    f"{prompt}\n\n"
                    f"(User attached {len(image_parts)} image(s) to edit/use as reference.)"
                )

            text, images, err, status = _call_native_generate_image(prompt, image_parts)
            if err:
                # Quota / model issues: still try chat fallback for edit guidance,
                # but keep the image error visible to the user.
                messages = _history_to_messages(history)
                content = _build_user_content(
                    (
                        user_message
                        or "Please create or edit an image based on the attachments and request."
                    )
                    + "\n\nIf you cannot output a binary image, describe the design clearly "
                    "and provide SVG code in a fenced code block.",
                    attachments,
                )
                messages.append({"role": "user", "content": content})
                text2, images2, err2, status2 = _call_chat(messages)
                if images2:
                    return jsonify(
                        {
                            "reply": text2 or "Here's your image.",
                            "images": images2,
                            "mode": "chat_fallback",
                        }
                    )
                # Prefer clear image-quota error when no image returned
                if "quota" in (err or "").lower() or status == 429:
                    note = (
                        f"⚠️ Image generation unavailable right now:\n{err}\n\n"
                        f"{text2 or 'Try again later, or use Chat mode for code/SVG designs.'}"
                    )
                    return jsonify({"reply": note, "images": [], "mode": "image_quota"})
                if err2 and not text2:
                    return jsonify({"error": err}), status
                return jsonify(
                    {
                        "reply": text2 or text or err,
                        "images": [],
                        "mode": "chat_fallback",
                    }
                )
            return jsonify(
                {
                    "reply": text or ("Here's your image." if images else ""),
                    "images": images,
                    "mode": "image",
                }
            )

        # -------- Normal multimodal chat (files + code + vision) --------
        messages = _history_to_messages(history)
        content = _build_user_content(user_message, attachments)
        messages.append({"role": "user", "content": content})

        text, images, err, status = _call_chat(messages)
        if err:
            return jsonify({"error": err}), status

        return jsonify(
            {
                "reply": text or "(empty response)",
                "images": images or [],
                "mode": "chat",
            }
        )
    except Exception as exc:
        traceback.print_exc()
        return jsonify({"error": f"Server error: {exc}"}), 500


@app.route("/chat", methods=["GET"])
def chat_get_hint():
    return jsonify(
        {
            "ok": True,
            "message": "POST JSON {message, history, attachments[], mode}",
            "features": ["files", "code", "image create/edit"],
        }
    )


if __name__ == "__main__":
    port = _find_free_port(PORT)
    key_ok = bool(API_KEY and API_KEY != "your_api_key_here")
    public_url = f"http://{PUBLIC_HOST}:{port}"

    print()
    print("=" * 56)
    print("  SUUWETHAAN AI")
    print("=" * 56)
    print(f"  Open  →  {public_url}")
    print("  Features: chat · files · code · image create/edit")
    print(f"  Chat model  : {MODEL_NAME}")
    print(f"  Image model : {IMAGE_MODEL}")
    print(f"  Key         : {'configured ✓' if key_ok else 'MISSING'}")
    print("=" * 56)
    print()

    app.run(host=HOST, port=port, debug=False, use_reloader=False)
