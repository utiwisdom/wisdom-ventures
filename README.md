# Wisdom Ventures – Bike Rental Website

Node.js + Express + PostgreSQL. Same database as your bike-shop.sh script (bikes, customers, rentals).

## Run it locally
1. Install Node.js 18+ and make sure PostgreSQL is running.
2. `psql -U wisdom -d bikes -h localhost -f schema.sql`   (adds the website columns and seeds 6 bikes only if the table is empty)
3. `cp .env.example .env` and put your real database password in it.
4. `npm install`
5. `npm start` then open http://localhost:3000

## Security built in
- Parameterised SQL everywhere (no SQL injection), strict input validation
- helmet security headers + Content-Security-Policy (blocks injected scripts)
- Rate limiting on every API route, tighter on rent/return
- Row locking inside transactions + a unique index, so one bike can never be rented twice
- Phone numbers sent in POST bodies, never in URLs
- Secrets only in .env (git-ignored); generic error messages to users, details only in server logs
- HTTPS redirect and SSL database connection when NODE_ENV=production

## Put it online (real website)
Push this folder to GitHub, then deploy on Render or Railway:
- Create a hosted PostgreSQL there, run schema.sql against it
- Set env vars: DATABASE_URL, NODE_ENV=production
- Start command: `npm start`
Add your own domain (e.g. wisdomventures.ng) in the host's dashboard; HTTPS certificate is automatic.
