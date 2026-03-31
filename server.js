const express   = require('express');
const Datastore = require('nedb-promises');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const https     = require('https');
const http      = require('http');
const path      = require('path');
const fs        = require('fs');

const app = express();

// ─── Config ───────────────────────────────────────────────────────────────────

const CONFIG_PATH = path.join(__dirname, 'auth.json');
const STATS_PATH  = path.join(__dirname, 'stats.json');
const JWT_SECRET  = process.env.JWT_SECRET || 'myshop-secret-change-me';

async function ensureConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const hash = await bcrypt.hash('user', 10);
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({
      username:    'user',
      passwordHash: hash,
      firstLogin:  true,
      shareToken:  null,
      ha: { url: null, token: null, notifyService: 'notify' },
    }, null, 2));
  }
  if (!fs.existsSync(STATS_PATH)) {
    fs.writeFileSync(STATS_PATH, JSON.stringify({
      totalAdded: 0, totalCleared: 0, lastAdded: null, lastCleared: null,
    }, null, 2));
  }
}

function loadConfig() { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
function saveConfig(d) { fs.writeFileSync(CONFIG_PATH, JSON.stringify(d, null, 2)); }
function loadStats()  { return JSON.parse(fs.readFileSync(STATS_PATH, 'utf8')); }
function saveStats(d) { fs.writeFileSync(STATS_PATH, JSON.stringify(d, null, 2)); }

function bumpStats(field) {
  const s = loadStats();
  s[field === 'add' ? 'totalAdded' : 'totalCleared']++;
  s[field === 'add' ? 'lastAdded' : 'lastCleared'] = new Date().toISOString();
  saveStats(s);
}

// ─── Title Case ───────────────────────────────────────────────────────────────

function titleCase(str) {
  return str.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// ─── Home Assistant notify ────────────────────────────────────────────────────

function notifyHA(itemName) {
  const cfg = loadConfig();
  if (!cfg.ha?.url || !cfg.ha?.token) return;
  try {
    const url = new URL(`${cfg.ha.url}/api/services/notify/${cfg.ha.notifyService || 'notify'}`);
    const body = JSON.stringify({ message: `🛒 Added to shopping list: ${itemName}`, title: 'My Shop' });
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.ha.token}` },
    }, () => {});
    req.on('error', e => console.error('[HA notify]', e.message));
    req.write(body);
    req.end();
  } catch (e) { console.error('[HA notify]', e.message); }
}

// ─── Database ─────────────────────────────────────────────────────────────────

const db = Datastore.create({ filename: path.join(__dirname, 'shopping.db'), autoload: true });

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  // Share token in query string (for Sarah)
  const cfg = loadConfig();
  if (req.query.share && cfg.shareToken && req.query.share === cfg.shareToken) return next();
  // Share token in header
  if (req.headers['x-share-token'] && cfg.shareToken && req.headers['x-share-token'] === cfg.shareToken) return next();
  // JWT
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try { req.user = jwt.verify(header.slice(7), JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

// ─── Auth Routes ──────────────────────────────────────────────────────────────

app.post('/auth/login', async (req, res) => {
  const cfg = loadConfig();
  const { username, password } = req.body;
  if (username !== cfg.username) return res.status(401).json({ error: 'Wrong username or password' });
  const ok = await bcrypt.compare(password, cfg.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Wrong username or password' });
  const token = jwt.sign({ auth: true }, JWT_SECRET);
  res.json({ token, firstLogin: !!cfg.firstLogin });
});

app.post('/auth/change-credentials', requireAuth, async (req, res) => {
  const { username, password } = req.body;
  if (!username?.trim()) return res.status(400).json({ error: 'Username required' });
  if (!password || password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
  const cfg = loadConfig();
  const hash = await bcrypt.hash(password, 10);
  saveConfig({ ...cfg, username: username.trim(), passwordHash: hash, firstLogin: false });
  res.json({ success: true });
});

// ─── Admin Routes ─────────────────────────────────────────────────────────────

// Get stats
app.get('/admin/stats', requireAuth, (req, res) => {
  const stats = loadStats();
  const cfg = loadConfig();
  res.json({ ...stats, hasShareToken: !!cfg.shareToken, shareToken: cfg.shareToken, ha: { url: cfg.ha?.url || null, notifyService: cfg.ha?.notifyService || 'notify', configured: !!(cfg.ha?.url && cfg.ha?.token) } });
});

// Generate / regenerate share token
app.post('/admin/share-token', requireAuth, (req, res) => {
  const cfg = loadConfig();
  const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  saveConfig({ ...cfg, shareToken: token });
  res.json({ shareToken: token });
});

// Revoke share token
app.delete('/admin/share-token', requireAuth, (req, res) => {
  const cfg = loadConfig();
  saveConfig({ ...cfg, shareToken: null });
  res.json({ success: true });
});

// Save HA config
app.post('/admin/ha-config', requireAuth, (req, res) => {
  const { url, token, notifyService } = req.body;
  const cfg = loadConfig();
  saveConfig({ ...cfg, ha: { url: url?.trim() || null, token: token?.trim() || null, notifyService: notifyService?.trim() || 'notify' } });
  res.json({ success: true });
});

// Test HA notify
app.post('/admin/ha-test', requireAuth, (req, res) => {
  notifyHA('Test item (from admin)');
  res.json({ success: true, message: 'Test notification sent to Home Assistant' });
});

// ─── HA Add Endpoint (uses share token for auth) ──────────────────────────────

app.post('/ha/add', async (req, res) => {
  const cfg = loadConfig();
  const key = req.headers['x-share-token'] || req.query.share;
  if (!cfg.shareToken || key !== cfg.shareToken) return res.status(401).json({ error: 'Invalid token' });
  const { name, quantity = '1' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Item name required' });
  try {
    const all = await db.find({});
    const maxOrder = all.reduce((m, d) => Math.max(m, d.order || 0), 0);
    const itemName = titleCase(name.trim());
    await db.insert({ name: itemName, category: 'Other', quantity: String(quantity), checked: false, order: maxOrder + 1, created_at: new Date().toISOString() });
    bumpStats('add');
    res.json({ success: true, name: itemName });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Items API ────────────────────────────────────────────────────────────────

function serialize(doc) {
  return { id: doc._id, name: doc.name, category: doc.category, quantity: doc.quantity, checked: doc.checked, order: doc.order || 0, created_at: doc.created_at };
}

app.get('/api/items', async (req, res) => {
  try { const docs = await db.find({}).sort({ checked: 1, order: 1, created_at: -1 }); res.json(docs.map(serialize)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/items', async (req, res) => {
  const { name, category = 'Other', quantity = '1' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Item name required' });
  try {
    const all = await db.find({});
    const maxOrder = all.reduce((m, d) => Math.max(m, d.order || 0), 0);
    const itemName = titleCase(name.trim());
    const doc = await db.insert({ name: itemName, category, quantity: String(quantity), checked: false, order: maxOrder + 1, created_at: new Date().toISOString() });
    bumpStats('add');
    notifyHA(itemName);
    res.status(201).json(serialize(doc));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/items/:id', requireAuth, async (req, res) => {
  const { checked, name, category, quantity } = req.body;
  const update = {};
  if (checked  !== undefined) update.checked  = checked;
  if (name     !== undefined) update.name     = titleCase(name);
  if (category !== undefined) update.category = category;
  if (quantity !== undefined) update.quantity = String(quantity);
  if (!Object.keys(update).length) return res.status(400).json({ error: 'Nothing to update' });
  try {
    await db.update({ _id: req.params.id }, { $set: update });
    const doc = await db.findOne({ _id: req.params.id });
    res.json(serialize(doc));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/items/reorder', requireAuth, async (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });
  try { for (const { id, order: o } of order) await db.update({ _id: id }, { $set: { order: o } }); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/items/:id', requireAuth, async (req, res) => {
  try { await db.remove({ _id: req.params.id }, {}); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/items/checked/clear', requireAuth, async (req, res) => {
  try {
    const n = await db.remove({ checked: true }, { multi: true });
    if (n > 0) bumpStats('clear');
    res.json({ deleted: n });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
ensureConfig().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Shopping list: http://0.0.0.0:${PORT}`);
    console.log(`Default login — username: user  password: user`);
  });
});
