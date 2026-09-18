const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const PORT = process.env.PORT || 5000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const FILE_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/heic': '.heic',
  'image/webp': '.webp',
  'application/pdf': '.pdf'
};

const DOC_TYPES_ENUM = ['national_id_photo', 'selfie', 'driving_licence', 'vehicle_registration', 'insurance_certificate'];

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${FILE_EXT[file.mimetype] || ''}`)
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, !!FILE_EXT[file.mimetype])
});

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://unpkg.com', "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
      connectSrc: ["'self'"]
    }
  }
}));

const allowedOrigin = process.env.ALLOWED_ORIGIN ? process.env.ALLOWED_ORIGIN.split(',') : [`http://localhost:${PORT}`];
app.use(cors({ origin: allowedOrigin }));
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html')) res.set('Cache-Control', 'no-store');
  next();
});
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/uploads', express.static(UPLOAD_DIR));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many attempts. Try again later.' } });
const otpLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 15, message: { error: 'Too many verification attempts. Try again later.' } });

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'routewise',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  waitForConnections: true,
  connectionLimit: 10
});

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

function makeOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function otpResponse(res, code, phone) {
  if (process.env.NODE_ENV === 'production') {
    console.log(`[otp] verification code for ${phone}: ${code}`);
    return res.json({ ok: true, message: 'Verification code sent.' });
  }
  res.json({ ok: true, message: 'Verification code sent.', demo_code: code });
}

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'connected' });
  } catch (err) {
    res.status(500).json({ ok: false, db: 'unreachable', message: err.message });
  }
});

app.post('/api/register', authLimiter, async (req, res) => {
  const first_name = (req.body?.first_name || '').trim();
  const last_name = (req.body?.last_name || '').trim();
  const email = (req.body?.email || '').trim().toLowerCase();
  const phone = (req.body?.phone || '').trim();
  const password = req.body?.password || '';
  if (!first_name || !last_name || !email || !phone || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  try {
    const [existing] = await pool.query('SELECT driver_id FROM drivers WHERE email = ?', [email]);
    if (existing.length) return res.status(409).json({ error: 'An account with this email already exists. Try signing in.' });

    await pool.query(
      'INSERT INTO drivers (first_name, last_name, email, phone, password_hash) VALUES (?,?,?,?,?)',
      [first_name, last_name, email, phone, hashPassword(password)]
    );

    const code = makeOtp();
    await pool.query(
      'INSERT INTO otp_codes (phone, code, expires_at) VALUES (?,?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))',
      [phone, code]
    );

    otpResponse(res, code, phone);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/resend-otp', authLimiter, async (req, res) => {
  const phone = (req.body?.phone || '').trim();
  if (!phone) return res.status(400).json({ error: 'Phone number is required' });
  try {
    const code = makeOtp();
    await pool.query(
      'INSERT INTO otp_codes (phone, code, expires_at) VALUES (?,?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))',
      [phone, code]
    );
    otpResponse(res, code, phone);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/verify-otp', otpLimiter, async (req, res) => {
  const phone = (req.body?.phone || '').trim();
  const code = (req.body?.code || '').trim();
  try {
    const [rows] = await pool.query(
      'SELECT otp_id FROM otp_codes WHERE phone = ? AND code = ? AND verified = 0 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
      [phone, code]
    );
    if (!rows.length) return res.status(400).json({ error: 'Invalid or expired code.' });

    await pool.query('UPDATE otp_codes SET verified = 1 WHERE otp_id = ?', [rows[0].otp_id]);
    const [driver] = await pool.query('SELECT driver_id, first_name, last_name, email, phone, status FROM drivers WHERE phone = ?', [phone]);
    res.json({ ok: true, driver: driver[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', authLimiter, async (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase();
  const password = req.body?.password || '';
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  try {
    const [rows] = await pool.query(
      'SELECT driver_id, first_name, last_name, email, phone, status, onboarded FROM drivers WHERE email = ? AND password_hash = ?',
      [email, hashPassword(password)]
    );
    if (!rows.length) return res.status(401).json({ error: 'Incorrect email or password' });
    res.json({ ok: true, driver: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received or unsupported file type (use JPG, PNG, HEIC, WEBP or PDF).' });
  const { driver_id, doc_type } = req.body || {};
  const cleanup = () => fs.unlink(req.file.path, () => {});
  if (!driver_id || !doc_type) { cleanup(); return res.status(400).json({ error: 'driver_id and doc_type are required' }); }
  if (!Object.values(DOC_TYPES_ENUM).includes(doc_type)) { cleanup(); return res.status(400).json({ error: 'Unknown document type' }); }
  try {
    const [prev] = await pool.query('SELECT file_path FROM documents WHERE driver_id = ? AND doc_type = ?', [driver_id, doc_type]);
    if (prev.length && prev[0].file_path) {
      fs.unlink(path.join(UPLOAD_DIR, path.basename(prev[0].file_path)), () => {});
    }
    const publicPath = '/uploads/' + req.file.filename;
    await pool.query(
      `INSERT INTO documents (driver_id, doc_type, file_name, mime_type, file_path, size_kb, uploaded_at)
       VALUES (?,?,?,?,?,?,NOW())
       ON DUPLICATE KEY UPDATE file_name=VALUES(file_name), mime_type=VALUES(mime_type), file_path=VALUES(file_path), size_kb=VALUES(size_kb), uploaded_at=NOW()`,
      [driver_id, doc_type, req.file.originalname, req.file.mimetype, publicPath, Math.max(1, Math.round(req.file.size / 1024))]
    );
    const [row] = await pool.query('SELECT document_id FROM documents WHERE driver_id = ? AND doc_type = ?', [driver_id, doc_type]);
    res.json({ ok: true, document_id: row[0].document_id, path: publicPath, name: req.file.originalname, mime: req.file.mimetype, size: req.file.size });
  } catch (err) {
    cleanup();
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/application', async (req, res) => {
  const { driver_id, personal, identity, vehicle } = req.body || {};
  if (!driver_id) return res.status(400).json({ error: 'Driver id is required' });
  try {
    await pool.query(
      `UPDATE drivers SET first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name), date_of_birth = ?, national_id = ?, address_line = ?, city = ? WHERE driver_id = ?`,
      [personal.first_name || null, personal.last_name || null, personal.dob, identity.id_number || personal.national_id, personal.address, personal.city, driver_id]
    );

    const [veh] = await pool.query('SELECT vehicle_id FROM vehicles WHERE driver_id = ?', [driver_id]);
    if (veh.length) {
      await pool.query(
        'UPDATE vehicles SET vehicle_type=?, make=?, model=?, year_made=?, reg_number=?, insurance_provider=?, insurance_expiry=? WHERE vehicle_id=?',
        [vehicle.type, vehicle.make, vehicle.model, vehicle.year, vehicle.reg_number, vehicle.insurance, vehicle.insurance_expiry, veh[0].vehicle_id]
      );
    } else {
      await pool.query(
        'INSERT INTO vehicles (driver_id, vehicle_type, make, model, year_made, reg_number, insurance_provider, insurance_expiry) VALUES (?,?,?,?,?,?,?,?)',
        [driver_id, vehicle.type, vehicle.make, vehicle.model, vehicle.year, vehicle.reg_number, vehicle.insurance, vehicle.insurance_expiry]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/application/submit', async (req, res) => {
  const { driver_id } = req.body || {};
  if (!driver_id) return res.status(400).json({ error: 'Driver id is required' });
  try {
    await pool.query(
      `INSERT INTO applications (driver_id, status, submitted_at)
       VALUES (?, 'submitted', NOW())
       ON DUPLICATE KEY UPDATE status = 'submitted', submitted_at = NOW()`,
      [driver_id]
    );
    await pool.query('UPDATE drivers SET onboarded = 1 WHERE driver_id = ?', [driver_id]);
    res.json({ ok: true, status: 'submitted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/application/:driverId', async (req, res) => {
  const { driverId } = req.params;
  try {
    const [app] = await pool.query('SELECT * FROM applications WHERE driver_id = ? ORDER BY application_id DESC LIMIT 1', [driverId]);
    if (!app.length) return res.json({ ok: true, application: null });
    res.json({ ok: true, application: app[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/application/review', async (req, res) => {
  const { driver_id, decision, notes } = req.body || {};
  if (!driver_id || !['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be approved or rejected' });
  }
  try {
    await pool.query(
      'UPDATE applications SET status = ?, reviewed_at = NOW(), review_notes = ?, reviewed_by = ? WHERE driver_id = ?',
      [decision, notes || null, 'Operations admin', driver_id]
    );
    const driverStatus = decision === 'approved' ? 'active' : 'rejected';
    await pool.query('UPDATE drivers SET status = ? WHERE driver_id = ?', [driverStatus, driver_id]);
    res.json({ ok: true, status: decision });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Routewise portal API running on http://localhost:${PORT}`));