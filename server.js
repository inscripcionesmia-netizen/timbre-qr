const express = require("express");
const path = require("path");
const fs = require("fs");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 3000;
const CONFIG_PATH = path.join(__dirname, "config.json");

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const clients = [];

// Cargar configuración desde archivo (persiste entre restarts)
function cargarConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, "utf8");
      return JSON.parse(data);
    }
  } catch (e) {
    console.error("[CONFIG] Error leyendo config.json:", e.message);
  }
  return {};
}

function guardarConfig() {
  try {
    const data = JSON.stringify(
      { whatsappNum: config.whatsappNum, whatsappKey: config.whatsappKey, telegramUser: config.telegramUser },
      null,
      2
    );
    fs.writeFileSync(CONFIG_PATH, data, "utf8");
  } catch (e) {
    console.error("[CONFIG] Error guardando config.json:", e.message);
  }
}

const saved = cargarConfig();
let config = {
  whatsappNum: process.env.WA_NUM || saved.whatsappNum || "",
  whatsappKey: process.env.WA_KEY || saved.whatsappKey || "",
  waActivo: Boolean((process.env.WA_NUM || saved.whatsappNum) && (process.env.WA_KEY || saved.whatsappKey)),
  telegramUser: process.env.TG_USER || saved.telegramUser || "",
  tgActivo: Boolean(process.env.TG_USER || saved.telegramUser),
};

function enviarWhatsApp(mensaje) {
  return new Promise((resolve) => {
    if (!config.waActivo) return resolve(false);
    const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(config.whatsappNum)}&text=${encodeURIComponent(mensaje)}&apikey=${encodeURIComponent(config.whatsappKey)}`;
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        console.log(`[WA] Código: ${res.statusCode} — ${data.slice(0, 60)}`);
        resolve(res.statusCode === 200);
      });
    }).on("error", (err) => {
      console.error("[WA] Error:", err.message);
      resolve(false);
    });
  });
}

function enviarTelegram(mensaje) {
  return new Promise((resolve) => {
    if (!config.tgActivo) return resolve(false);
    const user = config.telegramUser.startsWith("@") ? config.telegramUser : "@" + config.telegramUser;
    const url = `https://api.callmebot.com/text.php?user=${encodeURIComponent(user)}&text=${encodeURIComponent(mensaje)}`;
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        console.log(`[TG] Código: ${res.statusCode} — ${data.slice(0, 60)}`);
        resolve(res.statusCode === 200);
      });
    }).on("error", (err) => {
      console.error("[TG] Error:", err.message);
      resolve(false);
    });
  });
}

app.get("/api/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);

  const clientId = Date.now();
  const client = { id: clientId, res };
  clients.push(client);
  console.log(`[SSE] Conectado (id=${clientId}). Total: ${clients.length}`);

  req.on("close", () => {
    const idx = clients.indexOf(client);
    if (idx !== -1) clients.splice(idx, 1);
    console.log(`[SSE] Desconectado (id=${clientId}). Total: ${clients.length}`);
  });
});

app.post("/api/llamar", async (req, res) => {
  const ahora = new Date().toLocaleString("es-EC", { timeZone: "America/Guayaquil" });
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "desconocida";
  console.log(`[LLAMADA] ¡Timbre! ${ahora} — IP: ${ip}`);

  const payload = JSON.stringify({
    tipo: "timbre",
    timestamp: ahora,
    mensaje: "¡Alguien está en la puerta!",
    ip,
  });

  clients.forEach((c) => c.res.write(`event: timbre\ndata: ${payload}\n\n`));

  const texto = `🔔 TIMBRE QR - ${ahora} | Alguien esta tocando la puerta! IP: ${ip}`;
  enviarWhatsApp(texto);
  enviarTelegram(texto);

  res.json({ ok: true, mensaje: "Llamando a la puerta..." });
});

app.get("/api/config", (_req, res) => {
  res.json({
    whatsappNum: config.whatsappNum,
    whatsappKey: config.whatsappKey ? "****" + config.whatsappKey.slice(-4) : "",
    waActivo: config.waActivo,
    telegramUser: config.telegramUser,
    tgActivo: config.tgActivo,
  });
});

app.post("/api/config", (req, res) => {
  const { whatsappNum, whatsappKey, telegramUser } = req.body;

  if (whatsappNum !== undefined) {
    let num = String(whatsappNum).replace(/[\s\-]/g, "").replace(/^\+/, "");
    if (num && !/^\d{7,15}$/.test(num)) {
      return res.status(400).json({ error: "Número inválido" });
    }
    config.whatsappNum = num;
  }
  if (whatsappKey !== undefined) {
    config.whatsappKey = String(whatsappKey);
  }
  if (telegramUser !== undefined) {
    config.telegramUser = String(telegramUser).replace(/^@/, "");
  }

  config.waActivo = Boolean(config.whatsappNum && config.whatsappKey);
  config.tgActivo = Boolean(config.telegramUser);
  guardarConfig();
  console.log(`[CONFIG] WA:${config.waActivo} TG:${config.tgActivo}`);

  res.json({ ok: true, waActivo: config.waActivo, tgActivo: config.tgActivo });
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", clients: clients.length, whatsapp: config.waActivo, telegram: config.tgActivo });
});

app.listen(PORT, () => {
  console.log(`[SERVER] Timbre QR iniciado en http://localhost:${PORT}`);
  console.log(`[SERVER] Admin : http://localhost:${PORT}/admin.html`);
  console.log(`[SERVER] WhatsApp : ${config.waActivo ? "ACTIVO" : "INACTIVO"}`);
  console.log(`[SERVER] Telegram : ${config.tgActivo ? "ACTIVO" : "INACTIVO"}`);
});
