'use strict';
const express  = require('express');
const session  = require('express-session');
const bcrypt   = require('bcryptjs');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

// ── Ensure directories exist ─────────────────────────────────
['data', 'uploads/team'].forEach(d => {
  const p = path.join(ROOT, d);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// ── File paths ───────────────────────────────────────────────
const CONFIG_FILE = path.join(ROOT, 'data', 'config.json');
const FEES_FILE   = path.join(ROOT, 'data', 'fees.json');
const TEAM_FILE   = path.join(ROOT, 'data', 'team.json');

const readJSON  = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJSON = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

if (!fs.existsSync(CONFIG_FILE)) {
  writeJSON(CONFIG_FILE, { passwordHash: null, setupComplete: false });
}

// ── Photo upload (multer) ────────────────────────────────────
const storage = multer.diskStorage({
  destination: path.join(ROOT, 'uploads', 'team'),
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, /^image\/(jpeg|png|gif|webp)$/.test(file.mimetype));
  }
});

// ── Middleware ───────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(ROOT, 'uploads')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'bmc-admin-session-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 }
}));

const requireAuth = (req, res, next) =>
  req.session.authenticated ? next() : res.status(401).json({ error: 'Unauthorised' });

// ── Public API ───────────────────────────────────────────────
app.get('/api/fees', (req, res) => {
  res.json(fs.existsSync(FEES_FILE) ? readJSON(FEES_FILE) : {});
});

app.get('/api/team', (req, res) => {
  res.json(fs.existsSync(TEAM_FILE) ? readJSON(TEAM_FILE) : {});
});

// ── Auth routes ──────────────────────────────────────────────
app.get('/api/admin/status', (req, res) => {
  const cfg = readJSON(CONFIG_FILE);
  res.json({ authenticated: !!req.session.authenticated, setupComplete: cfg.setupComplete });
});

app.post('/api/admin/setup', (req, res) => {
  const cfg = readJSON(CONFIG_FILE);
  if (cfg.setupComplete) return res.status(400).json({ error: 'Already configured' });
  const { password } = req.body;
  if (!password || password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  cfg.passwordHash  = bcrypt.hashSync(password, 12);
  cfg.setupComplete = true;
  writeJSON(CONFIG_FILE, cfg);
  req.session.authenticated = true;
  res.json({ ok: true });
});

app.post('/api/admin/login', (req, res) => {
  const cfg = readJSON(CONFIG_FILE);
  if (!cfg.setupComplete) return res.status(400).json({ error: 'Not yet configured' });
  if (bcrypt.compareSync(req.body.password, cfg.passwordHash)) {
    req.session.authenticated = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Incorrect password' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.post('/api/admin/change-password', requireAuth, (req, res) => {
  const cfg = readJSON(CONFIG_FILE);
  const { current, newPassword } = req.body;
  if (!bcrypt.compareSync(current, cfg.passwordHash))
    return res.status(401).json({ error: 'Current password is incorrect' });
  if (!newPassword || newPassword.length < 8)
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  cfg.passwordHash = bcrypt.hashSync(newPassword, 12);
  writeJSON(CONFIG_FILE, cfg);
  res.json({ ok: true });
});

// ── Protected admin API ──────────────────────────────────────
app.put('/api/admin/fees', requireAuth, (req, res) => {
  const data = { ...req.body, lastUpdated: new Date().toISOString().split('T')[0] };
  writeJSON(FEES_FILE, data);
  res.json({ ok: true });
});

app.put('/api/admin/team', requireAuth, (req, res) => {
  writeJSON(TEAM_FILE, req.body);
  res.json({ ok: true });
});

app.post('/api/admin/upload-photo', requireAuth, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ url: '/uploads/team/' + req.file.filename });
});

// ── Serve admin panel ────────────────────────────────────────
app.use('/admin', express.static(path.join(ROOT, 'admin')));

// ── Serve public site ────────────────────────────────────────
app.use(express.static(ROOT));
app.use((req, res) => res.status(404).sendFile(path.join(ROOT, 'index.html')));

app.listen(PORT, () => {
  console.log(`\n  BMC site running → http://localhost:${PORT}`);
  console.log(`  Admin panel      → http://localhost:${PORT}/admin\n`);
});
