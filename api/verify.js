// api/verify.js — только для Roblox лоадера, всегда JSON

const BIN_URL    = "https://api.jsonbin.io/v3/b/" + process.env.BIN_ID + "/latest";
const BIN_UPDATE = "https://api.jsonbin.io/v3/b/" + process.env.BIN_ID;
const API_KEY    = process.env.JSONBIN_KEY;

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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  const { key, hwid } = req.query;

  try {
    const db = await loadDB();
    cleanExpired(db);
    const now = Date.now();
    const entry = db.keys[key];

    if (!entry || entry.expires < now) {
      return res.end(JSON.stringify({ valid: false, user: "", expires: 0, hwidMismatch: false }));
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

    return res.end(JSON.stringify({ valid, user: entry.user, expires: entry.expires, hwidMismatch }));
  } catch(e) {
    return res.end(JSON.stringify({ valid: false, error: e.message }));
  }
}
