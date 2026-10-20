const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.VEYRUN_DATA || path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CHAT_FILE = path.join(DATA_DIR, 'chat.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  const temp = file + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}
const users = readJson(USERS_FILE, {});
let chatHistory = readJson(CHAT_FILE, []);
const sockets = new Map(); // ws -> username
const trades = new Map();
let nextTradeId = 1;
const sessions = new Map();

const STARTER_INVENTORY = { 'Bronze sword': 1, 'Cooked shrimp': 3 };
function safeUser(s) { return typeof s === 'string' && /^[A-Za-z0-9_]{3,18}$/.test(s); }
function cleanText(s, max=240) {
  return String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
function publicState(username) {
  const u = users[username];
  return {
    players: [...new Set([...sockets.values()])].map(username => ({ username })),
    friends: u.friends || [],
    chat: chatHistory.slice(-80),
    requests: [...trades.values()].filter(t => t.to === username && t.status === 'pending').map(t => ({
      id: t.id, from: t.from, offerItem: t.offerItem, offerQty: t.offerQty,
      offerGold: t.offerGold, requestItem: t.requestItem, requestQty: t.requestQty,
      requestGold: t.requestGold
    })),
    inventory: u.inventory || { ...STARTER_INVENTORY },
    gold: Number(u.gold || 0)
  };
}
function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function broadcast(obj) {
  for (const ws of sockets.keys()) send(ws, obj);
}
function sendState(username) {
  for (const [ws, name] of sockets) if (name === username) send(ws, { type: 'state', state: publicState(username) });
}
function sendAllStates() {
  for (const name of new Set(sockets.values())) sendState(name);
}
function error(ws, message) { send(ws, { type: 'error', message }); }
function addChat(username, text) {
  const message = { username, text: cleanText(text), time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) };
  chatHistory.push(message);
  chatHistory = chatHistory.slice(-200);
  writeJson(CHAT_FILE, chatHistory);
  broadcast({ type: 'chat', message });
}
function hashPassword(password, salt=crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, record) {
  try {
    const got = crypto.scryptSync(password, record.salt, 64);
    const expected = Buffer.from(record.hash, 'hex');
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  } catch { return false; }
}
function auth(ws, msg, isRegister) {
  const username = cleanText(msg.username, 18);
  const password = String(msg.password || '');
  if (!safeUser(username)) return error(ws, 'Username must be 3–18 letters, numbers or underscores.');
  if (password.length < 8 || password.length > 128) return error(ws, 'Password must be 8–128 characters.');
  if (isRegister) {
    if (users[username]) return error(ws, 'That username is already taken.');
    const pw = hashPassword(password);
    users[username] = { ...pw, gold: 100, inventory: { ...STARTER_INVENTORY }, friends: [], createdAt: new Date().toISOString() };
    writeJson(USERS_FILE, users);
  } else {
    if (!users[username] || !verifyPassword(password, users[username])) return error(ws, 'Username or password is incorrect.');
  }
  // Keep one active connection per account.
  for (const [other, name] of sockets) if (name === username) {
    send(other, { type: 'notice', message: 'Your account signed in from another connection.' });
    other.close(4001, 'Account signed in elsewhere');
  }
  sockets.set(ws, username);
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(ws, token);
  send(ws, { type: 'auth_ok', username, token, state: publicState(username) });
  addChat('System', `${username} joined the frontier.`);
  sendAllStates();
}
function online(ws) { return sockets.get(ws); }
function validateQty(q) { return Number.isInteger(q) && q >= 0 && q <= 1000000; }
function handleTradeRequest(ws, msg) {
  const from = online(ws), to = cleanText(msg.to, 18);
  if (!from) return error(ws, 'Sign in first.');
  if (!safeUser(to) || !users[to]) return error(ws, 'That player account does not exist.');
  if (to === from) return error(ws, 'You cannot trade with yourself.');
  if (![...sockets.values()].includes(to)) return error(ws, 'That player is offline.');
  const offerItem = cleanText(msg.offerItem, 50), requestItem = cleanText(msg.requestItem, 50);
  const offerQty = Number(msg.offerQty || 0), requestQty = Number(msg.requestQty || 0);
  const offerGold = Number(msg.offerGold || 0), requestGold = Number(msg.requestGold || 0);
  if (![offerQty, requestQty, offerGold, requestGold].every(validateQty)) return error(ws, 'Invalid trade quantity.');
  if ((!offerItem && !offerGold && !requestItem && !requestGold) ||
      (offerItem && offerQty < 1) || (!offerItem && offerQty !== 0) ||
      (requestItem && requestQty < 1) || (!requestItem && requestQty !== 0)) return error(ws, 'Enter a valid offer and request.');
  const inv = users[from].inventory || {};
  if (offerItem && Number(inv[offerItem] || 0) < offerQty) return error(ws, 'You do not own enough of that item.');
  if (Number(users[from].gold || 0) < offerGold) return error(ws, 'You do not have enough coins.');
  const id = String(nextTradeId++);
  const t = { id, from, to, offerItem, offerQty, offerGold, requestItem, requestQty, requestGold, status: 'pending', createdAt: Date.now() };
  trades.set(id, t);
  for (const [sock, name] of sockets) if (name === to) send(sock, { type: 'trade_request', request: t });
  send(ws, { type: 'notice', message: `Trade request sent to ${to}.` });
  sendState(from);
}
function handleTradeAccept(ws, msg) {
  const username = online(ws), t = trades.get(String(msg.id));
  if (!username) return error(ws, 'Sign in first.');
  if (!t || t.to !== username || t.status !== 'pending') return error(ws, 'That trade request is no longer available.');
  if (Date.now() - t.createdAt > 120000) { t.status = 'expired'; return error(ws, 'That trade request expired.'); }
  const a = users[t.from], b = users[t.to];
  a.inventory = a.inventory || {}; b.inventory = b.inventory || {};
  if (Number(a.gold || 0) < t.offerGold || (t.offerItem && Number(a.inventory[t.offerItem] || 0) < t.offerQty)) {
    t.status = 'declined'; return tradeResult(t, false, 'Trade cancelled: the sender no longer has the offered items or coins.');
  }
  if (Number(b.gold || 0) < t.requestGold || (t.requestItem && Number(b.inventory[t.requestItem] || 0) < t.requestQty)) {
    t.status = 'declined'; return tradeResult(t, false, 'You cannot complete this trade: you do not have the requested items or coins.');
  }
  const newA = { ...a.inventory }, newB = { ...b.inventory };
  if (t.offerItem) { newA[t.offerItem] = (newA[t.offerItem] || 0) - t.offerQty; newB[t.offerItem] = (newB[t.offerItem] || 0) + t.offerQty; }
  if (t.requestItem) { newB[t.requestItem] = (newB[t.requestItem] || 0) - t.requestQty; newA[t.requestItem] = (newA[t.requestItem] || 0) + t.requestQty; }
  a.inventory = Object.fromEntries(Object.entries(newA).filter(([k,v]) => v > 0));
  b.inventory = Object.fromEntries(Object.entries(newB).filter(([k,v]) => v > 0));
  a.gold = Number(a.gold || 0) - t.offerGold + t.requestGold;
  b.gold = Number(b.gold || 0) + t.offerGold - t.requestGold;
  t.status = 'accepted';
  writeJson(USERS_FILE, users);
  tradeResult(t, true, `Trade with ${t.from} completed.`);
  addChat('System', `${t.from} and ${t.to} completed a trade.`);
}
function tradeResult(t, ok, message) {
  for (const [sock, name] of sockets) {
    if (name === t.from || name === t.to) send(sock, { type: 'trade_result', ok, message, state: publicState(name) });
  }
  sendAllStates();
}
function handleMessage(ws, raw) {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return error(ws, 'Invalid message.'); }
  if (!msg || typeof msg.type !== 'string') return error(ws, 'Invalid message type.');
  if (msg.type === 'register') return auth(ws, msg, true);
  if (msg.type === 'login') return auth(ws, msg, false);
  const username = online(ws);
  if (!username) return error(ws, 'Sign in first.');
  if (msg.type === 'chat') {
    const text = cleanText(msg.text, 240);
    if (!text) return;
    if (/https?:\/\/|www\./i.test(text)) return error(ws, 'Links are disabled in world chat.');
    return addChat(username, text);
  }
  if (msg.type === 'friend_add' || msg.type === 'friend_remove') {
    const target = cleanText(msg.username, 18);
    if (!safeUser(target) || !users[target] || target === username) return error(ws, 'That friend account is not valid.');
    users[username].friends = users[username].friends || [];
    if (msg.type === 'friend_add') {
      if (!users[username].friends.includes(target)) users[username].friends.push(target);
      send(ws, { type: 'notice', message: `${target} added to your friends.` });
    } else {
      users[username].friends = users[username].friends.filter(n => n !== target);
      send(ws, { type: 'notice', message: `${target} removed from your friends.` });
    }
    writeJson(USERS_FILE, users); return sendState(username);
  }
  if (msg.type === 'trade_request') return handleTradeRequest(ws, msg);
  if (msg.type === 'trade_accept') return handleTradeAccept(ws, msg);
  if (msg.type === 'trade_decline') {
    const t = trades.get(String(msg.id));
    if (!t || t.to !== username || t.status !== 'pending') return error(ws, 'That trade request is no longer available.');
    t.status = 'declined'; tradeResult(t, false, `${username} declined the trade request.`); return;
  }
  if (msg.type === 'ping') return send(ws, { type: 'pong' });
  error(ws, 'Unknown action.');
}
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, {'content-type':'application/json'}); return res.end(JSON.stringify({ok:true,service:'Veyrun Online'})); }
  if (req.url === '/' || req.url === '/index.html') {
    const file = path.join(__dirname, 'veyrun_v20.html');
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end('Place veyrun_v20.html beside server.js'); }
    res.writeHead(200, {'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
    return fs.createReadStream(file).pipe(res);
  }
  res.writeHead(404); res.end('Not found');
});
const wss = new WebSocket.Server({ server, maxPayload: 4096 });
wss.on('connection', ws => {
  ws.on('message', raw => handleMessage(ws, raw));
  ws.on('close', () => {
    const username = sockets.get(ws);
    sockets.delete(ws); sessions.delete(ws);
    if (username) { addChat('System', `${username} left the frontier.`); sendAllStates(); }
  });
  ws.on('error', () => {});
});
server.listen(PORT, HOST, () => console.log(`Veyrun Online listening on http://${HOST}:${PORT} (WebSocket ws://${HOST}:${PORT})`));
