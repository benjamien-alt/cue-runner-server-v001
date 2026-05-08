/**
 * CUE RUNNER — Live Broadcast Server v2
 * ─────────────────────────────────────
 * Relay server met keepalive ping/pong voor Render.com free tier.
 */

const WebSocket = require('ws');
const http      = require('http');
const fs        = require('fs');
const path      = require('path');

const PORT = process.env.PORT || 3001;
const PING_INTERVAL = 25000; // ping every 25s (Render drops idle after ~55s)

const log = (...args) => console.log(new Date().toISOString().slice(11,19), ...args);

// ── HTTP server ──
const httpServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const url = req.url.split('?')[0];

  if (url === '/' || url === '/viewer' || url === '/viewer.html') {
    const filePath = path.join(__dirname, 'cue-runner-viewer.html');
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
  }

  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      clients: wss.clients.size,
      broadcaster: !!broadcaster,
      uptime: Math.round(process.uptime())
    }));
    return;
  }

  // Redirect everything else to viewer
  res.writeHead(302, { 'Location': '/viewer' });
  res.end();
});

// ── WebSocket server ──
const wss = new WebSocket.Server({ server: httpServer });

let broadcaster = null;
let lastState   = null;

// ── Keepalive: ping all clients every 25s ──
// This prevents Render's load balancer from dropping idle connections
setInterval(() => {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.ping(); // WebSocket protocol ping — browser auto-responds with pong
    }
  });
}, PING_INTERVAL);

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  log(`+ Verbonden: ${ip} (totaal: ${wss.clients.size})`);

  // Mark connection as alive for ping tracking
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  // Send last known state immediately so viewer isn't blank
  if (lastState) {
    try { ws.send(lastState); } catch(e) {}
  }

  ws.on('message', (data) => {
    const raw = data.toString();

    // Skip ping messages from client
    if (raw === '__ping__') {
      try { ws.send('__pong__'); } catch(e) {}
      return;
    }

    // Validate it's JSON state from the broadcaster
    try { JSON.parse(raw); } catch(e) {
      log('Ongeldige data ontvangen, genegeerd');
      return;
    }

    // Register as broadcaster if not already
    if (ws !== broadcaster) {
      if (broadcaster && broadcaster.readyState === WebSocket.OPEN) {
        log('Nieuwe broadcaster — oude verbroken');
        broadcaster.close();
      }
      broadcaster = ws;
      log(`Broadcaster: ${ip}`);
    }

    lastState = raw;

    // Relay to all viewers
    let relayed = 0;
    wss.clients.forEach(client => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        try { client.send(lastState); relayed++; } catch(e) {}
      }
    });
  });

  ws.on('close', () => {
    if (ws === broadcaster) {
      broadcaster = null;
      lastState = null;
      log('Broadcaster losgekoppeld');
      // Notify viewers
      wss.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN) {
          try { c.send(JSON.stringify({ disconnected: true })); } catch(e) {}
        }
      });
    }
    log(`- Weg: ${ip} (nog: ${wss.clients.size})`);
  });

  ws.on('error', err => log('WS fout:', err.message));
});

httpServer.listen(PORT, '0.0.0.0', () => {
  log('════════════════════════════════');
  log(`CUE RUNNER server draait op :${PORT}`);
  log(`Viewer: http://localhost:${PORT}/viewer`);
  log('════════════════════════════════');
});
