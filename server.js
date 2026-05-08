/**
 * CUE RUNNER — Live Broadcast Server
 * ─────────────────────────────────────
 * Relay server: one broadcaster (the Cue Runner app) sends state,
 * all viewers receive it in real-time. Read-only for viewers.
 *
 * Install:  npm install ws
 * Run:      node server.js
 * Optional: PORT=3001 node server.js
 */

const WebSocket = require('ws');
const http      = require('http');
const fs        = require('fs');
const path      = require('path');

const PORT = process.env.PORT || 3001;

// ── HTTP server (serves viewer.html if present) ──
const httpServer = http.createServer((req, res) => {
  // CORS headers for browser clients
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const url = req.url.split('?')[0]; // strip query params

  let filePath = null;
  if (url === '/' || url === '/viewer' || url === '/viewer.html') {
    filePath = path.join(__dirname, 'cue-runner-viewer.html');
  }

  if (filePath && fs.existsSync(filePath)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(filePath).pipe(res);
  } else if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      viewers: wss ? wss.clients.size : 0,
      broadcaster: !!broadcaster,
      uptime: Math.round(process.uptime())
    }));
  } else {
    res.writeHead(302, { 'Location': '/viewer' });
    res.end();
  }
});

// ── WebSocket server ──
const wss = new WebSocket.Server({ server: httpServer });

let broadcaster = null;   // The one Cue Runner instance broadcasting
let viewers      = new Set(); // Read-only viewer connections
let lastState    = null;  // Cache last state for late-joining viewers

const log = (...args) => console.log(new Date().toISOString().slice(11,19), ...args);

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  log(`Client verbonden: ${ip} (totaal: ${wss.clients.size})`);

  // Send last known state immediately (so viewers aren't blank on connect)
  if (lastState) {
    ws.send(lastState);
  }

  ws.on('message', (data) => {
    // Any client that sends data is the broadcaster
    if (ws !== broadcaster) {
      if (broadcaster && broadcaster.readyState === WebSocket.OPEN) {
        log(`Nieuwe broadcaster van ${ip}, oude afgesloten.`);
        broadcaster.close();
      }
      broadcaster = ws;
      log(`Broadcaster geregistreerd: ${ip}`);
    }

    // Cache the state
    lastState = data.toString();

    // Relay to all viewers (everyone except broadcaster)
    let count = 0;
    wss.clients.forEach(client => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(lastState);
        count++;
      }
    });
  });

  ws.on('close', () => {
    if (ws === broadcaster) {
      broadcaster = null;
      log('Broadcaster losgekoppeld.');
      // Notify viewers
      const msg = JSON.stringify({ disconnected: true });
      wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
    } else {
      viewers.delete(ws);
    }
    log(`Client weg. Nog verbonden: ${wss.clients.size}`);
  });

  ws.on('error', err => log('WS fout:', err.message));

  viewers.add(ws);
});

httpServer.listen(PORT, '0.0.0.0', () => {
  log(`═══════════════════════════════════════`);
  log(`CUE RUNNER Broadcast Server draait`);
  log(`WebSocket:  ws://0.0.0.0:${PORT}`);
  log(`Viewer URL: http://localhost:${PORT}/viewer`);
  log(`═══════════════════════════════════════`);
  log(`Stuur vanuit Cue Runner app naar: ws://JOUW-IP:${PORT}`);
  log(`Viewers gaan naar: http://JOUW-IP:${PORT}/viewer`);
  log(`of http://JOUW-IP:${PORT}/viewer?server=ws://JOUW-IP:${PORT}`);
});
