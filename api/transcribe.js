// Vercel Serverless Function: /api/transcribe
// يحوّل صوتك في المحادثة إلى نص بدقة عالية (Whisper من OpenAI) — أدق بكثير من مايك المتصفح مع اللكنة العربية
// المتغيرات في Vercel → Settings → Environment Variables:
//   OPENAI_API_KEY   (إجباري)  من platform.openai.com/api-keys
//   ALLOWED_EMAILS   (اختياري) نفس اللي تستخدمه لـ api/chat.js
// إذا ما حطيت OPENAI_API_KEY، الموقع يرجع تلقائياً لمايك المتصفح العادي.

const FIREBASE_WEB_KEY = process.env.FIREBASE_API_KEY || "AIzaSyC4WCrpS45SnpnD_zJhxp0ptkm_HNEC0Tg";
const MODEL = process.env.TRANSCRIBE_MODEL || "whisper-1";

module.exports = async (req, res) => {
  // الموقع يسأل: هل التحويل الدقيق مفعّل؟
  if (req.method === "GET") return res.status(200).json({ ready: !!process.env.OPENAI_API_KEY });
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return res.status(501).json({ error: "no key" });

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

    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    const { audio = "", mime = "audio/mp4", prompt = "" } = body || {};
    const buf = Buffer.from(audio, "base64");
    if (buf.length < 1000) return res.status(200).json({ text: "" });
    if (buf.length > 4 * 1024 * 1024) return res.status(413).json({ error: "التسجيل طويل جداً" });

    const ext = /mp4|m4a|aac/.test(mime) ? "m4a" : /ogg/.test(mime) ? "ogg" : /wav/.test(mime) ? "wav" : "webm";
    const fd = new FormData();
    fd.append("file", new Blob([buf], { type: mime.split(";")[0] || "audio/mp4" }), "audio." + ext);
    fd.append("model", MODEL);
    fd.append("language", "en");
    // جملة Emma الأخيرة تساعده يفهم سياق كلامك
    if (prompt) fd.append("prompt", String(prompt).slice(0, 500));

    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: "Bearer " + key }, body: fd
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ error: j?.error?.message || ("OpenAI HTTP " + r.status) });
    return res.status(200).json({ text: j.text || "" });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
};
