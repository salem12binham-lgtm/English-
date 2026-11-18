// Vercel Serverless Function: /api/chat
// يستقبل طلبات الذكاء الاصطناعي من موقع "إنجليزي يومي" ويرسلها لـ Claude
// المتغيرات في Vercel → Settings → Environment Variables:
//   ANTHROPIC_API_KEY  (إجباري)
//   ALLOWED_EMAILS     (اختياري) الإيميلات المسموحة مفصولة بفاصلة
//   CLAUDE_MODEL       (اختياري) لتغيير النموذج

const FIREBASE_WEB_KEY = process.env.FIREBASE_API_KEY || "AIzaSyC4WCrpS45SnpnD_zJhxp0ptkm_HNEC0Tg";
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    // التحقق من تسجيل الدخول (Firebase)
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "unauthorized" });
    const look = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_WEB_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: token }) }
    );
    const lj = await look.json().catch(() => ({}));
    const email = lj?.users?.[0]?.email?.toLowerCase();
    if (!look.ok || !email) return res.status(401).json({ error: "unauthorized" });
    const allowed = (process.env.ALLOWED_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    if (allowed.length && !allowed.includes(email)) return res.status(403).json({ error: "not allowed" });

    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return res.status(500).json({ error: "API_KEY missing" });

    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    let { system = "", messages = [], max_tokens = 1000 } = body || {};
    if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: "no messages" });

    // تنظيف: أول رسالة لازم تكون من المستخدم، وما يصير رسالتين متتاليتين من نفس الطرف
    const clean = [];
    for (const m of messages) {
      if (!m || !m.content || (m.role !== "user" && m.role !== "assistant")) continue;
      if (!clean.length && m.role !== "user") continue;
      const last = clean[clean.length - 1];
      if (last && last.role === m.role) last.content += "\n" + m.content;
      else clean.push({ role: m.role, content: String(m.content) });
    }
    if (clean.length && clean[clean.length - 1].role !== "user") clean.pop();
    if (!clean.length) return res.status(400).json({ error: "no messages" });

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, system, messages: clean, max_tokens: Math.max(800, Math.min(+max_tokens || 1000, 4000)) })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ error: j?.error?.message || ("Claude HTTP " + r.status) });

    // نجمع كل أجزاء النص (أحياناً أول جزء مو نص)
    const text = (j.content || []).filter(c => c.type === "text").map(c => c.text).join("").trim();
    return res.status(200).json({ text, stop_reason: j.stop_reason || "" });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
};
