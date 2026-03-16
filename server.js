const express = require("express");
const app = express();

const KEY_DURATION_MS   = 6 * 60 * 60 * 1000;
const NONCE_DURATION_MS = 15 * 60 * 1000;
const BIN_URL    = `https://api.jsonbin.io/v3/b/${process.env.BIN_ID}/latest`;
const BIN_UPDATE = `https://api.jsonbin.io/v3/b/${process.env.BIN_ID}`;
const API_KEY    = process.env.JSONBIN_KEY;

function randStr(len) {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let r = "";
  for (let i = 0; i < len; i++) r += c[Math.floor(Math.random()*c.length)];
  return r;
}

function generateKey() {
  return "CEL-"+randStr(4)+"-"+randStr(4)+"-"+randStr(4);
}

async function loadDB() {
  const r = await fetch(BIN_URL, {headers:{"X-Master-Key":API_KEY}});
  const j = await r.json();
  return j.record || {keys:{},nonces:{}};
}

async function saveDB(db) {
  await fetch(BIN_UPDATE, {
    method:"PUT",
    headers:{"Content-Type":"application/json","X-Master-Key":API_KEY},
    body:JSON.stringify(db)
  });
}

function cleanExpired(db) {
  const now = Date.now();
  for (const k in db.keys)   if (db.keys[k].expires   < now) delete db.keys[k];
  for (const n in db.nonces) if (db.nonces[n].expires < now) delete db.nonces[n];
}

function pageHTML(title, body, color="#e0e0ff") {
  return `<!DOCTYPE html><html><head><title>Celestial Hub</title>
<style>*{margin:0;padding:0;box-sizing:border-box}
body{background:#07070f;color:#fff;font-family:'Segoe UI',sans-serif;
display:flex;align-items:center;justify-content:center;
min-height:100vh;flex-direction:column;gap:18px;padding:20px}
h2{font-size:20px;letter-spacing:1px;color:#aaa}
.card{background:#0f0f1c;border:1px solid #2a2a3e;border-radius:14px;
padding:28px 40px;text-align:center;max-width:440px;width:100%}
.key{font-size:20px;letter-spacing:3px;font-family:monospace;color:#e0e0ff;
background:#080814;border:1px solid #333;border-radius:10px;padding:14px 24px;margin:10px 0}
.sub{color:#555;font-size:12px;margin-top:8px}
.copy{background:#141428;border:1px solid #3a3a5a;color:#aaa;
padding:9px 22px;border-radius:8px;cursor:pointer;font-size:13px;margin-top:10px}
.copy:hover{border-color:#c88040;color:#c88040}
.warn{color:#e05555;font-size:14px}
</style></head><body>
<h2>⚛ Celestial Hub</h2>
<div class="card">
<p style="color:${color};font-size:15px;margin-bottom:12px">${title}</p>
${body}
</div></body></html>`;
}

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

// VERIFY — всегда JSON
app.get("/verify", async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  const {key, hwid} = req.query;
  try {
    const db = await loadDB();
    cleanExpired(db);
    const entry = db.keys[key];
    const now = Date.now();
    if (!entry || entry.expires < now) {
      return res.end(JSON.stringify({valid:false,user:"",expires:0,hwidMismatch:false}));
    }
    let valid=false, hwidMismatch=false;
    if (!entry.hwid || entry.hwid==="") {
      entry.hwid = hwid; valid=true;
      await saveDB(db);
    } else if (entry.hwid===hwid) {
      valid=true;
    } else {
      hwidMismatch=true;
    }
    return res.end(JSON.stringify({valid,user:entry.user,expires:entry.expires,hwidMismatch}));
  } catch(e) {
    return res.end(JSON.stringify({valid:false,error:e.message}));
  }
});

// GETKEY — HTML страница
app.get("/getkey", async (req, res) => {
  res.setHeader("Content-Type", "text/html");
  const safeUser = (req.query.user||"unknown").substring(0,40);
  const n = req.query.n || "";
  try {
    const db = await loadDB();
    cleanExpired(db);

    if (n) {
      const entry = db.nonces[n];
      if (!entry || entry.expires<Date.now() || entry.used) {
        return res.end(pageHTML("Outdated link!",
          `<p class="warn">This page has already been viewed or expired.</p>
           <p class="sub" style="margin-top:12px">Press <b>Get Key</b> in the loader for a new link.</p>`,
          "#e05555"));
      }
      entry.used = true;
      const keyEntry = db.keys[entry.key];
      const expStr = keyEntry ? new Date(keyEntry.expires).toUTCString() : "6 hours";
      await saveDB(db);
      return res.end(pageHTML("Your key is ready!",
        `<div class="key">${entry.key}</div>
         <button class="copy" onclick="navigator.clipboard.writeText('${entry.key}');this.textContent='Copied!';this.style.color='#55e080'">Copy Key</button>
         <p class="sub">Valid 6 hours · Expires: ${expStr}</p>
         <p class="sub" style="margin-top:6px">Paste into the Celestial Hub loader</p>`,
        "#55e080"));
    }

    const newKey = generateKey();
    const keyExpires = Date.now()+KEY_DURATION_MS;
    db.keys[newKey] = {user:safeUser, expires:keyExpires, hwid:""};
    const nonce = randStr(48);
    db.nonces[nonce] = {key:newKey, expires:Date.now()+NONCE_DURATION_MS, used:false};
    await saveDB(db);

    const proto = req.headers["x-forwarded-proto"]||"https";
    const host  = req.headers.host;
    const refreshUrl = `${proto}://${host}/getkey?user=${encodeURIComponent(safeUser)}&n=${nonce}`;
    const expStr = new Date(keyExpires).toUTCString();

    return res.end(pageHTML("Your key is ready!",
      `<div class="key">${newKey}</div>
       <button class="copy" onclick="navigator.clipboard.writeText('${newKey}');this.textContent='Copied!';this.style.color='#55e080'">Copy Key</button>
       <p class="sub">Valid 6 hours · Expires: ${expStr}</p>
       <p class="sub" style="margin-top:6px">Paste into the Celestial Hub loader</p>
       <script>try{history.replaceState(null,'','${refreshUrl}');}catch(e){}</script>`,
      "#55e080"));
  } catch(e) {
    return res.end(pageHTML("Error",`<p class="warn">${e.message}</p>`,"#e05555"));
  }
});

app.get("/", (req, res) => res.json({
  status: "ok",
  hasBinId: !!process.env.BIN_ID,
  hasApiKey: !!process.env.JSONBIN_KEY,
  binId: process.env.BIN_ID ? process.env.BIN_ID.substring(0,8)+"..." : "MISSING"
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
