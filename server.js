'use strict';
const express    = require('express');
const session    = require('express-session');
const bcrypt     = require('bcryptjs');
const multer     = require('multer');
const nodemailer = require('nodemailer');
const path       = require('path');
const fs         = require('fs');

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

// ── Email transporter ────────────────────────────────────────
// Set these environment variables on Render (or in your shell for local dev):
//   SMTP_HOST  — e.g. smtp.gmail.com
//   SMTP_PORT  — e.g. 587
//   SMTP_USER  — the sending address (e.g. noreply@beaumed.com.au or a Gmail)
//   SMTP_PASS  — the password / app password for that account
const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'smtp.gmail.com',
  port:   parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || ''
  }
});

// ── Public API ───────────────────────────────────────────────
app.get('/api/fees', (req, res) => {
  res.json(fs.existsSync(FEES_FILE) ? readJSON(FEES_FILE) : {});
});

app.get('/api/team', (req, res) => {
  res.json(fs.existsSync(TEAM_FILE) ? readJSON(TEAM_FILE) : {});
});

// ── Careers / Expression of Interest ────────────────────────
app.post('/api/careers', async (req, res) => {
  const { firstname, lastname, email, phone, role, message } = req.body;

  // Basic validation
  if (!firstname || !lastname || !email || !role) {
    return res.status(400).json({ error: 'Please fill in all required fields.' });
  }
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const fullName  = `${firstname.trim()} ${lastname.trim()}`;
  const submitted = new Date().toLocaleString('en-AU', {
    timeZone: 'Australia/Brisbane',
    dateStyle: 'full', timeStyle: 'short'
  });

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { margin:0; padding:0; background:#f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; }
  .wrap { max-width:600px; margin:32px auto; background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,.08); }
  .header { background:#003865; padding:28px 36px; }
  .header h1 { margin:0; color:#fff; font-size:20px; font-weight:700; letter-spacing:-.3px; }
  .header p { margin:4px 0 0; color:rgba(255,255,255,.7); font-size:13px; }
  .badge { display:inline-block; margin-top:12px; background:rgba(255,255,255,.15); color:#fff; font-size:12px; font-weight:600; padding:4px 12px; border-radius:20px; letter-spacing:.04em; }
  .body { padding:32px 36px; }
  .row { display:flex; gap:16px; margin-bottom:20px; }
  .field { flex:1; }
  .field.full { flex:100%; }
  .label { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; color:#64748b; margin-bottom:4px; }
  .value { font-size:15px; color:#0f172a; font-weight:500; line-height:1.4; }
  .value a { color:#0073b6; text-decoration:none; }
  .divider { border:none; border-top:1px solid #e2e8f0; margin:24px 0; }
  .message-box { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:16px 20px; }
  .message-box .label { margin-bottom:8px; }
  .message-box .value { font-size:14px; color:#334155; font-weight:400; white-space:pre-wrap; }
  .reply-cta { background:#e0f2fe; border:1px solid #bae6fd; border-radius:8px; padding:14px 20px; margin-top:24px; }
  .reply-cta p { margin:0; font-size:13px; color:#0369a1; }
  .reply-cta strong { color:#075985; }
  .footer { background:#f8fafc; border-top:1px solid #e2e8f0; padding:18px 36px; text-align:center; }
  .footer p { margin:0; font-size:11px; color:#94a3b8; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <h1>Expression of Interest</h1>
    <p>Beaudesert Medical Centre — Careers</p>
    <div class="badge">📋 New Application</div>
  </div>
  <div class="body">
    <div class="row">
      <div class="field">
        <div class="label">Full Name</div>
        <div class="value">${esc(fullName)}</div>
      </div>
      <div class="field">
        <div class="label">Role Interested In</div>
        <div class="value">${esc(role)}</div>
      </div>
    </div>
    <div class="row">
      <div class="field">
        <div class="label">Email Address</div>
        <div class="value"><a href="mailto:${esc(email)}">${esc(email)}</a></div>
      </div>
      <div class="field">
        <div class="label">Phone Number</div>
        <div class="value">${phone ? esc(phone) : '<span style="color:#94a3b8">Not provided</span>'}</div>
      </div>
    </div>
    <hr class="divider">
    <div class="message-box">
      <div class="label">Message / About Themselves</div>
      <div class="value">${message ? esc(message) : '<em style="color:#94a3b8">No message provided.</em>'}</div>
    </div>
    <div class="reply-cta">
      <p>To reply, simply hit <strong>Reply</strong> — this email is set up to go directly to <strong>${esc(email)}</strong>.</p>
    </div>
  </div>
  <div class="footer">
    <p>Submitted ${esc(submitted)} · Beaudesert Medical Centre website</p>
  </div>
</div>
</body>
</html>`;

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  try {
    await transporter.sendMail({
      from:    `"BMC Website" <${process.env.SMTP_USER || 'noreply@beaumed.com.au'}>`,
      to:      'manager@beaumed.com.au',
      replyTo: email,
      subject: `Expression of Interest — ${role} — ${fullName}`,
      html
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Careers email error:', err);
    res.status(500).json({ error: 'Failed to send — please call or email us directly.' });
  }
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
