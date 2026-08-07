# SuuvieAI

ChatGPT-style app with:

- **Gemini** chat (code-friendly)
- **File attachments** (images + code/text)
- **Image create / edit**
- **Firebase** Google sign-in + Firestore history
- Runs in **VS Code** or terminal

---

## Quick start

```bash
git clone <your-repo-url>
cd suuvieai
python -m venv .venv

# Windows
.venv\Scripts\activate
# Mac/Linux
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env
# edit .env → add GEMINI API_KEY

# optional Firebase
cp js/firebase-config.example.js js/firebase-config.js
# paste your Firebase web config into js/firebase-config.js

python app.py
```

Open **http://localhost:5000** (use `localhost`, not `127.0.0.1`, for Google sign-in).

### Windows one-click
Double-click `start.bat`

### VS Code
1. Open folder  
2. Run Task → **SuuvieAI: Setup**  
3. Select `.venv` interpreter  
4. Press **F5**

---

## Environment (`.env`)

```env
API_KEY=your_gemini_key
API_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
MODEL_NAME=gemini-3.6-flash
IMAGE_MODEL=gemini-3.1-flash-image
```

Get a free key: https://aistudio.google.com/apikey

**Never commit `.env`.**

---

## Firebase (optional, for chat history)

1. Copy `js/firebase-config.example.js` → `js/firebase-config.js`
2. Paste web config from Firebase Console
3. Enable **Google** sign-in
4. Create **Firestore** and publish `firestore.rules`

See `FIREBASE_SETUP.txt`.

---

## Features

| Feature | How |
|--------|-----|
| Chat | Type and Enter |
| Attach files | 📎 / drag-drop / paste image |
| Code | AI returns copyable fenced blocks |
| Create image | Mode **Image** or “generate an image…” |
| Edit image | Attach image → Mode **Image** → edit prompt |
| History | Sign in with Google |

---

## Safety before GitHub

Do **not** push:

- `.env` (Gemini key)
- Real keys inside `js/firebase-config.js` (use placeholders + example file)

Firebase web `apiKey` is a client key, but still better to let each user paste their own.

---

## License

MIT — use freely.
