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

  // Receipt email sent back to the applicant
  const receiptHtml = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { margin:0; padding:0; background:#f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; }
  .wrap { max-width:600px; margin:32px auto; background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,.08); }
  .header { background:#003865; padding:32px 36px; text-align:center; }
  .header .tick { font-size:2.5rem; margin-bottom:12px; }
  .header h1 { margin:0; color:#fff; font-size:22px; font-weight:700; letter-spacing:-.3px; }
  .header p { margin:8px 0 0; color:rgba(255,255,255,.75); font-size:14px; }
  .body { padding:32px 36px; }
  .greeting { font-size:16px; color:#0f172a; margin-bottom:16px; line-height:1.6; }
  .summary-box { background:#f0f9ff; border:1px solid #bae6fd; border-radius:10px; padding:20px 24px; margin:24px 0; }
  .summary-box h3 { margin:0 0 14px; font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; color:#0369a1; }
  .summary-row { display:flex; gap:8px; margin-bottom:10px; font-size:14px; }
  .summary-row:last-child { margin-bottom:0; }
  .summary-label { color:#64748b; font-weight:600; min-width:80px; }
  .summary-value { color:#0f172a; }
  .next-steps { margin:24px 0; }
  .next-steps h3 { font-size:14px; font-weight:700; color:#334155; margin:0 0 12px; }
  .step { display:flex; gap:12px; margin-bottom:12px; align-items:flex-start; }
  .step-num { background:#003865; color:#fff; font-size:11px; font-weight:700; width:22px; height:22px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0; margin-top:1px; }
  .step p { margin:0; font-size:14px; color:#475569; line-height:1.5; }
  .divider { border:none; border-top:1px solid #e2e8f0; margin:24px 0; }
  .contact-strip { display:flex; gap:16px; flex-wrap:wrap; }
  .contact-item { flex:1; min-width:160px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:14px 16px; }
  .contact-item .clabel { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:#94a3b8; margin-bottom:4px; }
  .contact-item a { font-size:14px; font-weight:600; color:#003865; text-decoration:none; }
  .footer { background:#f8fafc; border-top:1px solid #e2e8f0; padding:18px 36px; text-align:center; }
  .footer p { margin:0 0 4px; font-size:11px; color:#94a3b8; }
  .footer p:last-child { margin:0; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="tick">✅</div>
    <h1>We've received your expression of interest!</h1>
    <p>Beaudesert Medical Centre — Careers</p>
  </div>
  <div class="body">
    <p class="greeting">Hi ${esc(firstname.trim())},<br><br>
    Thanks for reaching out — we've received your expression of interest for the <strong>${esc(role)}</strong> position and our practice manager will be reviewing it shortly.</p>

    <div class="summary-box">
      <h3>Your Submission</h3>
      <div class="summary-row"><span class="summary-label">Name</span><span class="summary-value">${esc(fullName)}</span></div>
      <div class="summary-row"><span class="summary-label">Role</span><span class="summary-value">${esc(role)}</span></div>
      <div class="summary-row"><span class="summary-label">Email</span><span class="summary-value">${esc(email)}</span></div>
      <div class="summary-row"><span class="summary-label">Phone</span><span class="summary-value">${phone ? esc(phone) : '—'}</span></div>
      <div class="summary-row"><span class="summary-label">Submitted</span><span class="summary-value">${esc(submitted)}</span></div>
    </div>

    <div class="next-steps">
      <h3>What happens next?</h3>
      <div class="step"><div class="step-num">1</div><p>Our practice manager will review your expression of interest, usually within <strong>2–3 business days</strong>.</p></div>
      <div class="step"><div class="step-num">2</div><p>If there's a good fit — either now or when a position opens up — we'll be in touch directly by email or phone.</p></div>
      <div class="step"><div class="step-num">3</div><p>In the meantime, feel free to call us if you have any questions.</p></div>
    </div>

    <hr class="divider">

    <div class="contact-strip">
      <div class="contact-item">
        <div class="clabel">Phone</div>
        <a href="tel:0755411422">(07) 5541 1422</a>
      </div>
      <div class="contact-item">
        <div class="clabel">Email</div>
        <a href="mailto:manager@beaumed.com.au">manager@beaumed.com.au</a>
      </div>
      <div class="contact-item">
        <div class="clabel">Address</div>
        <a href="https://maps.google.com/?q=47+William+St+Beaudesert">47 William St, Beaudesert</a>
      </div>
    </div>
  </div>
  <div class="footer">
    <p><strong>Beaudesert Medical Centre</strong> · 47 William Street, Beaudesert QLD 4285</p>
    <p>This is an automated confirmation. Please do not reply to this email — contact us at the details above.</p>
  </div>
</div>
</body>
</html>`;

  try {
    // Send notification to practice (testing: routed to personal Gmail)
    await transporter.sendMail({
      from:    `"BMC Website" <${process.env.SMTP_USER || 'noreply@beaumed.com.au'}>`,
      to:      process.env.CAREERS_TO || 'mikehurley84@gmail.com',
      replyTo: email,
      subject: `Expression of Interest — ${role} — ${fullName}`,
      html
    });

    // Send receipt confirmation to the applicant
    await transporter.sendMail({
      from:    `"Beaudesert Medical Centre" <${process.env.SMTP_USER || 'noreply@beaumed.com.au'}>`,
      to:      email,
      subject: `We've received your expression of interest — Beaudesert Medical Centre`,
      html:    receiptHtml
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Careers email error:', err);
    res.status(500).json({ error: 'Failed to send — please call or email us directly.' });
  }
});

// ── Auth helpers ─────────────────────────────────────────────
// If ADMIN_PASSWORD env var is set, it takes priority over the local config file.
// This means the password survives every Render redeploy without needing a
// persistent disk. Set it once in Render → Environment and you're done.
const ENV_PW = process.env.ADMIN_PASSWORD || null;

function checkPassword(attempt) {
  if (ENV_PW) return attempt === ENV_PW;
  const cfg = fs.existsSync(CONFIG_FILE) ? readJSON(CONFIG_FILE) : {};
  return cfg.passwordHash ? bcrypt.compareSync(attempt, cfg.passwordHash) : false;
}

function isSetupComplete() {
  if (ENV_PW) return true;
  const cfg = fs.existsSync(CONFIG_FILE) ? readJSON(CONFIG_FILE) : {};
  return !!cfg.setupComplete;
}

// ── Auth routes ──────────────────────────────────────────────
app.get('/api/admin/status', (req, res) => {
  res.json({ authenticated: !!req.session.authenticated, setupComplete: isSetupComplete() });
});

app.post('/api/admin/setup', (req, res) => {
  if (isSetupComplete()) return res.status(400).json({ error: 'Already configured' });
  const { password } = req.body;
  if (!password || password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const cfg = fs.existsSync(CONFIG_FILE) ? readJSON(CONFIG_FILE) : {};
  cfg.passwordHash  = bcrypt.hashSync(password, 12);
  cfg.setupComplete = true;
  writeJSON(CONFIG_FILE, cfg);
  req.session.authenticated = true;
  res.json({ ok: true });
});

app.post('/api/admin/login', (req, res) => {
  if (!isSetupComplete()) return res.status(400).json({ error: 'Not yet configured' });
  if (checkPassword(req.body.password)) {
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
  if (ENV_PW) {
    return res.status(400).json({ error: 'Password is set via the ADMIN_PASSWORD environment variable on Render — update it there.' });
  }
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
