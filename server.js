const express = require("express");
const path = require("path");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Almacena todas las conexiones SSE activas
const clients = [];

// Configuración de WhatsApp (se puede sobrescribir vía API)
let config = {
  whatsappNum: process.env.WA_NUM || "",
  whatsappKey: process.env.WA_KEY || "",
  activo: Boolean(process.env.WA_NUM && process.env.WA_KEY),
};

function enviarWhatsApp(mensaje) {
  return new Promise((resolve) => {
    if (!config.activo) return resolve(false);

    const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(config.whatsappNum)}&text=${encodeURIComponent(mensaje)}&apikey=${encodeURIComponent(config.whatsappKey)}`;

    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        console.log(`[WHATSAPP] Enviado. Código: ${res.statusCode} — ${data.slice(0, 100)}`);
        resolve(res.statusCode === 200);
      });
    }).on("error", (err) => {
      console.error("[WHATSAPP] Error:", err.message);
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

  // Enviar WhatsApp en segundo plano
  const textoWA = `🔔 TIMBRE QR - ${ahora}%0A¡Alguien está tocando la puerta!%0AIP: ${ip}`;
  enviarWhatsApp(textoWA);

  res.json({ ok: true, mensaje: "Llamando a la puerta..." });
});

app.get("/api/config", (_req, res) => {
  res.json({
    whatsappNum: config.whatsappNum,
    whatsappKey: config.whatsappKey ? "****" + config.whatsappKey.slice(-4) : "",
    activo: config.activo,
  });
});

app.post("/api/config", (req, res) => {
  const { whatsappNum, whatsappKey } = req.body;

  if (whatsappNum !== undefined) {
    // Limpiar: quitar +, espacios, guiones
    let num = String(whatsappNum).replace(/[\s\-]/g, "").replace(/^\+/, "");
    if (!/^\d{7,15}$/.test(num)) {
      return res.status(400).json({ error: "Número inválido (solo dígitos, 7-15)" });
    }
    config.whatsappNum = num;
  }
  if (whatsappKey !== undefined) {
    config.whatsappKey = String(whatsappKey);
  }

  config.activo = Boolean(config.whatsappNum && config.whatsappKey);
  console.log(`[CONFIG] WhatsApp ${config.activo ? "ACTIVADO" : "DESACTIVADO"} — num: ${config.whatsappNum}`);

  res.json({ ok: true, activo: config.activo });
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", clients: clients.length, whatsapp: config.activo });
});

app.listen(PORT, () => {
  console.log(`[SERVER] Timbre QR iniciado en http://localhost:${PORT}`);
  console.log(`[SERVER] Visitante : http://localhost:${PORT}`);
  console.log(`[SERVER] Admin     : http://localhost:${PORT}/admin.html`);
  console.log(`[SERVER] WhatsApp  : ${config.activo ? "ACTIVO" : "INACTIVO — configura desde el panel admin"}`);
});
