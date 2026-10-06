require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

const isProd = process.env.NODE_ENV === 'production';
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProd ? { rejectUnauthorized: false } : false, // most hosted Postgres requires SSL
  max: 10,
});

const app = express();
app.disable('x-powered-by');
if (isProd) app.set('trust proxy', 1); // needed behind Render/Railway/Nginx so rate limiting sees real IPs

// ---------- Security headers (CSP blocks injected scripts) ----------
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: isProd ? [] : null,
      },
    },
  })
);

// Force HTTPS in production
if (isProd) {
  app.use((req, res, next) => (req.secure ? next() : res.redirect(301, 'https://' + req.headers.host + req.url)));
}

app.use(express.json({ limit: '5kb' })); // tiny body limit, no big payload attacks

// ---------- Rate limiting ----------
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false });
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});
app.use('/api', apiLimiter);

// ---------- Validation helpers ----------
function cleanPhone(raw) {
  if (typeof raw !== 'string') return null;
  const p = raw.replace(/[\s\-()]/g, '');
  return /^\+?[0-9]{7,14}$/.test(p) ? p : null;
}
function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const n = raw.trim().replace(/\s+/g, ' ');
  return /^[\p{L}][\p{L} .'\-]{1,39}$/u.test(n) ? n : null;
}
function cleanId(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 2147483647 ? n : null;
}

// ---------- API ----------
// All bikes with live availability
app.get('/api/bikes', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT bike_id, name, type, size, image, price_per_day, available FROM bikes WHERE image IS NOT NULL ORDER BY bike_id'
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// Rent a bike
app.post('/api/rentals', writeLimiter, async (req, res, next) => {
  const bikeId = cleanId(req.body.bike_id);
  const phone = cleanPhone(req.body.phone);
  const name = cleanName(req.body.name);
  if (!bikeId) return res.status(400).json({ error: 'Choose a valid bike.' });
  if (!phone) return res.status(400).json({ error: 'Enter a valid phone number (7 to 14 digits).' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the bike row so two people cannot rent it at the same moment
    const bike = await client.query('SELECT bike_id, available, name FROM bikes WHERE bike_id = $1 FOR UPDATE', [bikeId]);
    if (bike.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'That bike does not exist.' });
    }
    if (!bike.rows[0].available) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Sorry, that bike was just rented. Pick another one.' });
    }

    let customer = await client.query('SELECT customer_id, name FROM customers WHERE phone = $1', [phone]);
    if (customer.rowCount === 0) {
      if (!name) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Enter your name (letters only, 2 to 40 characters).' });
      }
      customer = await client.query(
        'INSERT INTO customers (name, phone) VALUES ($1, $2) RETURNING customer_id, name',
        [name, phone]
      );
    }

    await client.query('INSERT INTO rentals (customer_id, bike_id) VALUES ($1, $2)', [customer.rows[0].customer_id, bikeId]);
    await client.query('UPDATE bikes SET available = false WHERE bike_id = $1', [bikeId]);
    await client.query('COMMIT');

    res.status(201).json({ message: `Done, ${customer.rows[0].name}. The ${bike.rows[0].name} is yours.` });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    next(e);
  } finally {
    client.release();
  }
});

// Find a customer's open rentals (POST so the phone number never appears in URLs or logs)
app.post('/api/rentals/lookup', writeLimiter, async (req, res, next) => {
  const phone = cleanPhone(req.body.phone);
  if (!phone) return res.status(400).json({ error: 'Enter a valid phone number.' });
  try {
    const { rows } = await pool.query(
      `SELECT b.bike_id, b.name, b.type, b.size, b.image, r.date_rented
         FROM rentals r
         JOIN customers c USING (customer_id)
         JOIN bikes b USING (bike_id)
        WHERE c.phone = $1 AND r.date_returned IS NULL
        ORDER BY b.bike_id`,
      [phone]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// Return a bike
app.post('/api/returns', writeLimiter, async (req, res, next) => {
  const bikeId = cleanId(req.body.bike_id);
  const phone = cleanPhone(req.body.phone);
  if (!bikeId || !phone) return res.status(400).json({ error: 'Phone number and bike are required.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rental = await client.query(
      `SELECT r.rental_id
         FROM rentals r JOIN customers c USING (customer_id)
        WHERE c.phone = $1 AND r.bike_id = $2 AND r.date_returned IS NULL
        FOR UPDATE OF r`,
      [phone, bikeId]
    );
    if (rental.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'You do not have that bike rented.' });
    }
    await client.query('UPDATE rentals SET date_returned = NOW() WHERE rental_id = $1', [rental.rows[0].rental_id]);
    await client.query('UPDATE bikes SET available = true WHERE bike_id = $1', [bikeId]);
    await client.query('COMMIT');
    res.json({ message: 'Thank you for returning your bike.' });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    next(e);
  } finally {
    client.release();
  }
});

// ---------- Static website ----------
app.use(express.static(path.join(__dirname, 'public'), { maxAge: isProd ? '7d' : 0 }));

// ---------- Errors: log details on the server, show nothing sensitive to users ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Wisdom Ventures running on http://localhost:${port}`));
