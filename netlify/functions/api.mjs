import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 10000,
});

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

// ---------- Validation ----------
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

// ---------- Simple rate limit (best effort: resets when the function restarts) ----------
const hits = new Map();
function tooMany(ip, limit = 20, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > limit;
}

async function readBody(req) {
  const text = await req.text();
  if (text.length > 5000) return null;
  try {
    return JSON.parse(text || '{}');
  } catch {
    return null;
  }
}

export default async (req, context) => {
  const route = new URL(req.url).pathname.replace(/\/+$/, '');

  try {
    // ---- List bikes ----
    if (req.method === 'GET' && route === '/api/bikes') {
      const { rows } = await pool.query(
        'SELECT bike_id, name, type, size, image, price_per_day, available FROM bikes WHERE image IS NOT NULL ORDER BY bike_id'
      );
      return json(rows);
    }

    if (req.method !== 'POST') return json({ error: 'Not found.' }, 404);

    if (tooMany(context.ip || 'unknown')) {
      return json({ error: 'Too many attempts. Please wait a few minutes and try again.' }, 429);
    }
    const body = await readBody(req);
    if (!body) return json({ error: 'Invalid request.' }, 400);

    // ---- Rent a bike ----
    if (route === '/api/rentals') {
      const bikeId = cleanId(body.bike_id);
      const phone = cleanPhone(body.phone);
      const name = cleanName(body.name);
      if (!bikeId) return json({ error: 'Choose a valid bike.' }, 400);
      if (!phone) return json({ error: 'Enter a valid phone number (7 to 14 digits).' }, 400);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const bike = await client.query('SELECT bike_id, available, name FROM bikes WHERE bike_id = $1 FOR UPDATE', [bikeId]);
        if (bike.rowCount === 0) {
          await client.query('ROLLBACK');
          return json({ error: 'That bike does not exist.' }, 404);
        }
        if (!bike.rows[0].available) {
          await client.query('ROLLBACK');
          return json({ error: 'Sorry, that bike was just rented. Pick another one.' }, 409);
        }
        let customer = await client.query('SELECT customer_id, name FROM customers WHERE phone = $1', [phone]);
        if (customer.rowCount === 0) {
          if (!name) {
            await client.query('ROLLBACK');
            return json({ error: 'Enter your name (letters only, 2 to 40 characters).' }, 400);
          }
          customer = await client.query(
            'INSERT INTO customers (name, phone) VALUES ($1, $2) RETURNING customer_id, name',
            [name, phone]
          );
        }
        await client.query('INSERT INTO rentals (customer_id, bike_id) VALUES ($1, $2)', [customer.rows[0].customer_id, bikeId]);
        await client.query('UPDATE bikes SET available = false WHERE bike_id = $1', [bikeId]);
        await client.query('COMMIT');
        return json({ message: `Done, ${customer.rows[0].name}. The ${bike.rows[0].name} is yours.` }, 201);
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    }

    // ---- Find my rentals ----
    if (route === '/api/rentals/lookup') {
      const phone = cleanPhone(body.phone);
      if (!phone) return json({ error: 'Enter a valid phone number.' }, 400);
      const { rows } = await pool.query(
        `SELECT b.bike_id, b.name, b.type, b.size, b.image, r.date_rented
           FROM rentals r
           JOIN customers c USING (customer_id)
           JOIN bikes b USING (bike_id)
          WHERE c.phone = $1 AND r.date_returned IS NULL
          ORDER BY b.bike_id`,
        [phone]
      );
      return json(rows);
    }

    // ---- Return a bike ----
    if (route === '/api/returns') {
      const bikeId = cleanId(body.bike_id);
      const phone = cleanPhone(body.phone);
      if (!bikeId || !phone) return json({ error: 'Phone number and bike are required.' }, 400);

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
          return json({ error: 'You do not have that bike rented.' }, 404);
        }
        await client.query('UPDATE rentals SET date_returned = NOW() WHERE rental_id = $1', [rental.rows[0].rental_id]);
        await client.query('UPDATE bikes SET available = true WHERE bike_id = $1', [bikeId]);
        await client.query('COMMIT');
        return json({ message: 'Thank you for returning your bike.' });
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    }

    return json({ error: 'Not found.' }, 404);
  } catch (e) {
    console.error(e); // details stay in Netlify's function logs
    return json({ error: 'Something went wrong on our side. Please try again.' }, 500);
  }
};

// Send every /api/* request to this function
export const config = { path: '/api/*' };