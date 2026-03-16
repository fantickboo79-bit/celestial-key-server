// Celestial Hub — Key Server (Vercel + JSONBin)
// api/key.js

const KEY_DURATION_MS   = 6 * 60 * 60 * 1000;
const NONCE_DURATION_MS = 15 * 60 * 1000;
const BIN_URL = "https://api.jsonbin.io/v3/b/" + process.env.BIN_ID + "/latest";
const BIN_UPDATE = "https://api.jsonbin.io/v3/b/" + process.env.BIN_ID;
const API_KEY = process.env.JSONBIN_KEY;

function randStr(len) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let r = "";
  for (let i = 0; i < len; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return r;
}

function generateKey() {
  return "CEL-" + randStr(4) + "-" + randStr(4) + "-" + randStr(4);
}

async function loadDB() {
  const r = await fetch(BIN_URL, { headers: { "X-Master-Key": API_KEY } });
  const j = await r.json();
  return j.record || { keys: {}, nonces: {} };
}

async function saveDB(db) {
  await fetch(BIN_UPDATE, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Master-Key": API_KEY },
    body: JSON.stringify(db)
  });
}

function cleanExpired(db) {
  const now = Date.now();
  for (const k in db.keys)   if (db.keys[k].expires   < now) delete db.keys[k];
  for (const n in db.nonces) if (db.nonces[n].expires < now) delete db.nonces[n];
}

function pageHTML(title, body, color = "#e0e0ff") {
  return `<!DOCTYPE html><html><head><title>Celestial Hub</title>
<style>*{margin:0;padding:0;box-sizing:border-box}
body{background:#07070f;color:#fff;font-family:'Segoe UI',sans-serif;
display:flex;align-items:center;justify-content:center;
min-height:100vh;flex-direction:column;gap:18px;padding:20px}
h2{font-size:20px;letter-spacing:1px;color:#aaa}
.card{background:#0f0f1c;border:1px solid #2a2a3e;border-radius:14px;
padding:28px 40px;text-align:center;max-width:440px;width:100%}
.key{font-size:20px;letter-spacing:3px;font-family:monospace;color:#e0e0ff;
background:#080814;border:1px solid #333;border-radius:10px;
padding:14px 24px;margin:10px 0}
.sub{color:#555;font-size:12px;margin-top:8px}
.copy{background:#141428;border:1px solid #3a3a5a;color:#aaa;
padding:9px 22px;border-radius:8px;cursor:pointer;font-size:13px;
margin-top:10px;transition:all .2s}
.copy:hover{border-color:#c88040;color:#c88040}
.warn{color:#e05555;font-size:14px}
</style></head><body>
<h2>⚛ Celestial Hub</h2>
<div class="card">
<p style="color:${color};font-size:15px;margin-bottom:12px">${title}</p>
${body}
</div></body></html>`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { action, user, n, key, hwid } = req.query;

  // ── verify — всегда JSON ──────────────────────────
  if (action === "verify") {
    try {
      const db = await loadDB();
      cleanExpired(db);
      const now = Date.now();
      const entry = db.keys[key];
      if (!entry || entry.expires < now) {
        return res.json({ valid: false, user: "", expires: 0, hwidMismatch: false });
      }
      let valid = false, hwidMismatch = false;
      if (!entry.hwid || entry.hwid === "") {
        entry.hwid = hwid;
        valid = true;
        await saveDB(db);
      } else if (entry.hwid === hwid) {
        valid = true;
      } else {
        hwidMismatch = true;
      }
      return res.json({ valid, user: entry.user, expires: entry.expires, hwidMismatch });
    } catch(e) {
      return res.json({ valid: false, error: e.message });
    }
  }

  // ── getkey — HTML страница ────────────────────────
  if (action === "getkey") {
    const safeUser = (user || "unknown").substring(0, 40);
    res.setHeader("Content-Type", "text/html");

    try {
      const db = await loadDB();
      cleanExpired(db);

      // С nonce — обновление страницы = Outdated
      if (n) {
        const entry = db.nonces[n];
        if (!entry || entry.expires < Date.now() || entry.used) {
          return res.send(pageHTML(
            "Outdated link!",
            `<p class="warn">This page has already been viewed or the link expired.</p>
             <p class="sub" style="margin-top:12px">Press <b>Get Key</b> in the loader for a new link.</p>`,
            "#e05555"
          ));
        }
        entry.used = true;
        const keyEntry = db.keys[entry.key];
        const expStr = keyEntry ? new Date(keyEntry.expires).toUTCString() : "6 hours";
        await saveDB(db);
        return res.send(pageHTML(
          "Your key is ready!",
          `<div class="key">${entry.key}</div>
           <button class="copy" onclick="navigator.clipboard.writeText('${entry.key}');
           this.textContent='Copied!';this.style.borderColor='#55e080';this.style.color='#55e080'">Copy Key</button>
           <p class="sub">Valid for <b>6 hours</b> &nbsp;·&nbsp; Expires: ${expStr}</p>
           <p class="sub" style="margin-top:6px">Paste into the Celestial Hub loader</p>`,
          "#55e080"
        ));
      }

      // Первый заход — генерируем ключ + nonce
      const newKey = generateKey();
      const keyExpires = Date.now() + KEY_DURATION_MS;
      db.keys[newKey] = { user: safeUser, expires: keyExpires, hwid: "" };

      const nonce = randStr(48);
      db.nonces[nonce] = { key: newKey, expires: Date.now() + NONCE_DURATION_MS, used: false };
      await saveDB(db);

      const expStr = new Date(keyExpires).toUTCString();
      const proto = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers.host;
      const refreshUrl = `${proto}://${host}/api/key?action=getkey&user=${encodeURIComponent(safeUser)}&n=${nonce}`;

      return res.send(pageHTML(
        "Your key is ready!",
        `<div class="key">${newKey}</div>
         <button class="copy" onclick="navigator.clipboard.writeText('${newKey}');
         this.textContent='Copied!';this.style.borderColor='#55e080';this.style.color='#55e080'">Copy Key</button>
         <p class="sub">Valid for <b>6 hours</b> &nbsp;·&nbsp; Expires: ${expStr}</p>
         <p class="sub" style="margin-top:6px">Paste into the Celestial Hub loader</p>
         <script>try{history.replaceState(null,'','${refreshUrl}');}catch(e){}</script>`,
        "#55e080"
      ));
    } catch(e) {
      return res.send(pageHTML("Error", `<p class="warn">${e.message}</p>`, "#e05555"));
    }
  }

  return res.json({ error: "Unknown action" });
}
