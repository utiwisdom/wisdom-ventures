# Wisdom Ventures – Bike Rental

A bike rental website where customers see live availability, rent a bike in under a minute, and return it with their phone number. Built for small rental shops that still track bookings in notebooks or WhatsApp.

**Live demo:** https://wisdom-ventures-bikes.netlify.app/

## The problem

Small rental businesses in Nigeria often manage bookings by phone calls and paper. Bikes get double-booked, customers can't check what is free, and owners can't see which items earn the most. This project replaces that with one system: a public booking page backed by a real database the owner can query.

## What it does

- Shows all bikes with live availability (Available / Rented out)
- Filter by Road or Mountain
- Rent a bike with a phone number and name (new customers are created automatically)
- Return a bike by looking up rentals with the same phone number
- Prevents double-booking, even if two people click Rent at the same moment

## How it works

```
Browser (HTML, CSS, JavaScript)
        ↓  fetch /api/...
Netlify Function (Node.js API)
        ↓  SQL over SSL
Neon (PostgreSQL)
```

| Part | File | Job |
|---|---|---|
| Front end | `public/index.html`, `styles.css`, `app.js` | What visitors see; sends requests to the API |
| API (production) | `netlify/functions/api.mjs` | Validates requests and talks to the database |
| API (local testing) | `server.js` | Same logic as an Express server for development |
| Database | `schema.sql` | Tables, indexes and starter bikes |
| Config | `netlify.toml` | Publish folder, functions folder, security headers |

The browser never touches the database. Only the API holds the connection string (`DATABASE_URL`), stored as an environment variable.

## Tech stack

- **Front end:** HTML, CSS, vanilla JavaScript
- **Back end:** Node.js, Netlify Functions (production), Express (local)
- **Database:** PostgreSQL on Neon, `pg` driver
- **Hosting and deploys:** Netlify, auto-deploy from GitHub

## Database design

- `bikes` (bike_id, name, type, size, image, price_per_day, available)
- `customers` (customer_id, name, phone), one customer per phone number
- `rentals` (rental_id, customer_id, bike_id, date_rented, date_returned)

A unique index allows only **one open rental per bike**, so double-booking is blocked at the database level.

## API

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/bikes` | List bikes and availability |
| POST | `/api/rentals` | Rent a bike |
| POST | `/api/rentals/lookup` | Find a customer's open rentals |
| POST | `/api/returns` | Return a bike |

## Security

- Parameterised SQL everywhere (blocks SQL injection)
- Strict validation of phone, name and bike ID
- Row locking inside transactions, plus a unique index, so a bike can't be rented twice
- Phone numbers travel in POST bodies, never in URLs
- Content-Security-Policy and other security headers set in `netlify.toml`
- Secrets kept in environment variables, never in the repo
- Page text inserted with `textContent`, not `innerHTML`, to avoid script injection
- Generic error messages for users; details stay in server logs

## Run it locally

1. Install Node.js 18+ and PostgreSQL, and start PostgreSQL.
2. Create the database and tables:
```bash
   psql -U <your_user> -d bikes -h localhost -f schema.sql
```
3. Copy `.env.example` to `.env` and set `DATABASE_URL` with your password.
4. Install and run:
```bash
   npm install
   npm start
```
5. Open http://localhost:3000

## Deploy (GitHub + Netlify + Neon)

1. Create a Neon project and run `schema.sql` in its SQL Editor.
2. Push this repo to GitHub.
3. In Netlify, import the repo. Publish directory is `public`, functions directory is `netlify/functions`, and the build command stays empty.
4. Add an environment variable `DATABASE_URL` with your Neon **pooled** connection string (ending in `?sslmode=require`).
5. Deploy. Later changes deploy automatically on `git push`.

## Managing data

Update the live database from the Neon SQL Editor, for example:

```sql
-- add a bike (put the photo in public/images/ first)
INSERT INTO bikes (type, size, name, image, price_per_day)
VALUES ('Road', 28, 'Gravel Bike', 'gravel.jpg', 9000);

-- change a price
UPDATE bikes SET price_per_day = 9000 WHERE bike_id = 4;

-- who has a bike right now
SELECT c.name, c.phone, b.name AS bike, r.date_rented
FROM rentals r
JOIN customers c USING (customer_id)
JOIN bikes b USING (bike_id)
WHERE r.date_returned IS NULL;
```

## Known limitations and next steps

- No online payment yet (planned: Paystack or Flutterwave)
- Returns need only a phone number; a PIN or SMS code would be safer
- No admin dashboard; shop data is managed with SQL for now
- Rate limiting on Netlify is best-effort, because serverless functions restart often
- Neon's free tier sleeps when idle, so the first request can be slow
- No rental duration or total price calculation shown to customers yet

## Built by

Uti Wisdom, data engineer in training, secondary school teacher and ALX mentor in Warri, Nigeria.

The rent and return logic started as a Bash and PostgreSQL course project (`bike-shop.sh`). I extended it into a full web application with a database schema, API, front end and deployment. I used an AI assistant (Claude) to help write code and troubleshoot, and I tested, debugged and deployed the system myself.

- GitHub: https://github.com/utiwisdom
- LinkedIn: https://www.linkedin.com/in/uti-wisdom-286602228/
- Portfolio: https://datascienceportfol.io/wisdomuti8
