# SuuvieAI

ChatGPT-style chat app:

- **Flask** backend → Google **Gemini**
- **Firebase** Auth (Google sign-in) + **Firestore** chat history
- Runs inside **VS Code** (Run and Debug)

---

## Run inside VS Code (recommended)

1. **Unzip** and open the folder in VS Code  
   `File → Open Folder… → suuvieai`

2. Install recommended extensions when prompted  
   (Python + debugpy)

3. **Setup once**  
   - `Terminal → Run Task… → SuuvieAI: Setup (venv + install)`  
   - Or in the VS Code terminal:
     ```bash
     python -m venv .venv
     # Windows:
     .venv\Scripts\activate
     # Mac/Linux:
     source .venv/bin/activate
     pip install -r requirements.txt
     ```
   - Select the interpreter: `Ctrl+Shift+P` → **Python: Select Interpreter** → `.venv`

4. **Firebase** (required for saving chats)  
   - Open `js/firebase-config.js`  
   - Paste your Firebase web config (see below)  
   - Enable Google sign-in + Firestore (see below)

5. **Run**  
   - Press **F5**  
   - Or Run and Debug → **SuuvieAI: Run Server**  
   - Open **http://127.0.0.1:5000** (Simple Browser or Chrome)

Keep the VS Code terminal running. Stop with the red square or `Ctrl+C`.

---

## Firebase setup (one time)

### A) Web app config
1. [Firebase Console](https://console.firebase.google.com/) → your project  
2. ⚙️ Project settings → **Your apps** → Web (`</>`)  
3. Copy the `firebaseConfig` object  
4. Paste into `js/firebase-config.js`

### B) Google sign-in
1. **Build → Authentication → Get started**  
2. **Sign-in method → Google → Enable → Save**  
3. **Settings → Authorized domains** → ensure `localhost` is listed  

### C) Firestore
1. **Build → Firestore Database → Create database**  
2. Start in **test mode** (or production + paste rules)  
3. **Rules** tab → paste contents of `firestore.rules` → **Publish**

### D) Google Cloud (if sign-in popup errors)
- Cloud Console → APIs → enable **Identity Toolkit API** if prompted  
- OAuth consent screen configured (External is fine for testing)

---

## What gets stored

```
users/{yourGoogleUid}/chats/{chatId}
  title, preview, createdAt, updatedAt

users/{yourGoogleUid}/chats/{chatId}/messages/{messageId}
  role: "user" | "assistant"
  content, createdAt
```

Only **you** can read/write your own path (see `firestore.rules`).

---

## Project layout

```
suuvieai/
├── .vscode/               ← Run/Debug inside VS Code
│   ├── launch.json
│   ├── tasks.json
│   ├── settings.json
│   └── extensions.json
├── js/
│   ├── firebase-config.js ← PASTE your Firebase config here
│   └── firebase-app.js    ← Auth + Firestore helpers
├── app.py                 ← Flask + Gemini proxy
├── index.html
├── style.css
├── script.js
├── firestore.rules
├── .env                   ← Gemini API key
├── requirements.txt
└── README.md
```

---

## .env (Gemini)

Already filled if you received this package:

```env
API_KEY=your_gemini_key
API_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
MODEL_NAME=gemini-3.6-flash
```

---

## Troubleshooting

| Problem | Fix |
|--------|-----|
| F5 does nothing | Install **Python** + **Python Debugger** extensions |
| `No module named flask` | Run task **SuuvieAI: Setup** and select `.venv` interpreter |
| Sign-in popup blocked | Allow popups for localhost; `localhost` must be authorized domain |
| `Missing or insufficient permissions` | Publish `firestore.rules` |
| Chats don't save | Sign in with Google first; check browser console |
| API key error on chat | Check `.env` `API_KEY` and restart F5 |

---

## Outside VS Code (optional)

```bash
# Windows
start.bat

# Mac/Linux
chmod +x start.sh && ./start.sh
```
