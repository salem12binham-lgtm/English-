// api/chat.js — Vercel serverless function للمحادثة والتصحيح بالذكاء الاصطناعي
const MODEL = process.env.AI_MODEL || "claude-haiku-5-5";
const FB_KEY = process.env.FIREBASE_API_KEY || "AIzaSyC4WCrpS45SnpnD_zJhxp0ptkm_HNEC0Tg";

function clean(msgs) {
  const out = [];
  for (const m of Array.isArray(msgs) ? msgs : []) {
    if (!m || !m.content || (m.role !== "user" && m.role !== "assistant")) continue;
    if (!out.length && m.role !== "user") continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += "\n" + m.content;
    else out.push({ role: m.role, content: String(m.content) });
  }
  return out;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  try {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return res.status(500).json({ error: "ANTHROPIC_API_KEY missing" });

    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "unauthorized" });
    const lr = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FB_KEY}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: token })
    });
    const lj = await lr.json().catch(() => ({}));
    const email = (lj.users && lj.users[0] && lj.users[0].email || "").toLowerCase();
    if (!lr.ok || !email) return res.status(401).json({ error: "unauthorized" });
    const allowed = (process.env.ALLOWED_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    if (allowed.length && !allowed.includes(email)) return res.status(403).json({ error: "not allowed" });

    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body || "{}");
    const { system = "", messages = [], max_tokens = 700 } = body || {};
    const msgs = clean(messages);
    if (!msgs.length) return res.status(400).json({ error: "no messages" });

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, system, messages: msgs, max_tokens: Math.min(+max_tokens || 700, 2000) })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: "AI: " + ((j.error && j.error.message) || r.status) });
    const text = (j.content || []).filter(c => c.type === "text").map(c => c.text).join("");
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
};
