
// Celestial Hub — Key Server (Vercel)
// api/key.js

const KEY_DURATION_MS   = 6 * 60 * 60 * 1000;   // 6 часов
const NONCE_DURATION_MS = 15 * 60 * 1000;         // nonce живёт 15 минут

// In-memory хранилище (Vercel serverless — используем глобальные переменные)
// Для продакшена лучше использовать Vercel KV, но для начала это работает
if (!global._keys)   global._keys   = {};  // { key: {user, expires, hwid} }
if (!global._nonces) global._nonces = {};  // { nonce: {key, expires, used} }

function randStr(len) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let r = "";
  for (let i = 0; i < len; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return r;
}

function generateKey() {
  return "CEL-" + randStr(4) + "-" + randStr(4) + "-" + randStr(4);
}

function cleanExpired() {
  const now = Date.now();
  for (const k in global._keys)   if (global._keys[k].expires   < now) delete global._keys[k];
  for (const n in global._nonces) if (global._nonces[n].expires < now) delete global._nonces[n];
}

function html(title, body, color = "#e0e0ff") {
  return `<!DOCTYPE html><html><head><title>Celestial Hub</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
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

function outdated(res) {
  res.setHeader("Content-Type", "text/html");
  return res.send(html(
    "Outdated link!",
    `<p class="warn">This page has already been viewed or the link expired.</p>
     <p class="sub" style="margin-top:12px">Press <b>Get Key</b> in the loader to get a fresh link.</p>`,
    "#e05555"
  ));
}

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { action, user, n, key, hwid } = req.query;
  cleanExpired();

  // ── getkey ──────────────────────────────────────────
  if (action === "getkey") {
    const safeUser = (user || "unknown").substring(0, 40);

    // С nonce — обновление страницы
    if (n) {
      const entry = global._nonces[n];
      if (!entry || entry.expires < Date.now() || entry.used) {
        return outdated(res);
      }
      // Сжигаем
      entry.used = true;
      const keyEntry = global._keys[entry.key];
      const expStr = keyEntry ? new Date(keyEntry.expires).toUTCString() : "unknown";
      res.setHeader("Content-Type", "text/html");
      return res.send(html(
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
    global._keys[newKey] = { user: safeUser, expires: keyExpires, hwid: "" };

    const nonce = randStr(48);
    global._nonces[nonce] = { key: newKey, expires: Date.now() + NONCE_DURATION_MS, used: false };

    const expStr = new Date(keyExpires).toUTCString();
    const refreshUrl = `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}/api/key?action=getkey&user=${encodeURIComponent(safeUser)}&n=${nonce}`;

    res.setHeader("Content-Type", "text/html");
    return res.send(html(
      "Your key is ready!",
      `<div class="key">${newKey}</div>
       <button class="copy" onclick="navigator.clipboard.writeText('${newKey}');
       this.textContent='Copied!';this.style.borderColor='#55e080';this.style.color='#55e080'">Copy Key</button>
       <p class="sub">Valid for <b>6 hours</b> &nbsp;·&nbsp; Expires: ${expStr}</p>
       <p class="sub" style="margin-top:6px">Paste into the Celestial Hub loader</p>
       <script>try{history.replaceState(null,'','${refreshUrl}');}catch(e){}</script>`,
      "#55e080"
    ));
  }

  // ── verify ──────────────────────────────────────────
  if (action === "verify") {
    const entry = global._keys[key];
    const now = Date.now();

    if (!entry || entry.expires < now) {
      return res.json({ valid: false, user: "", expires: 0, hwidMismatch: false });
    }

    let valid = false, hwidMismatch = false;
    if (!entry.hwid || entry.hwid === "0" || entry.hwid === "") {
      entry.hwid = hwid;
      valid = true;
    } else if (entry.hwid === hwid) {
      valid = true;
    } else {
      hwidMismatch = true;
    }

    return res.json({ valid, user: entry.user, expires: entry.expires, hwidMismatch });
  }

  return res.json({ error: "Unknown action" });
}
