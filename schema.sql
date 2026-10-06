-- Wisdom Ventures: run once with:  psql -U wisdom -d bikes -h localhost -f schema.sql
-- Safe to re-run: it only adds what is missing and never deletes your data.

CREATE TABLE IF NOT EXISTS bikes (
  bike_id   SERIAL PRIMARY KEY,
  type      VARCHAR(20) NOT NULL,
  size      INT NOT NULL,
  available BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS customers (
  customer_id SERIAL PRIMARY KEY,
  phone       VARCHAR(15) NOT NULL,
  name        VARCHAR(40) NOT NULL
);

CREATE TABLE IF NOT EXISTS rentals (
  rental_id     SERIAL PRIMARY KEY,
  customer_id   INT NOT NULL REFERENCES customers(customer_id),
  bike_id       INT NOT NULL REFERENCES bikes(bike_id),
  date_rented   DATE NOT NULL DEFAULT NOW(),
  date_returned DATE
);

-- Website additions
ALTER TABLE bikes ADD COLUMN IF NOT EXISTS name  VARCHAR(60);
ALTER TABLE bikes ADD COLUMN IF NOT EXISTS image VARCHAR(80);
ALTER TABLE bikes ADD COLUMN IF NOT EXISTS price_per_day INT NOT NULL DEFAULT 5000; -- Naira

-- One customer per phone number (the app looks customers up by phone)
CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_unique ON customers(phone);
-- A bike can only have ONE open rental at a time (blocks double-renting at database level)
CREATE UNIQUE INDEX IF NOT EXISTS one_open_rental_per_bike ON rentals(bike_id) WHERE date_returned IS NULL;

-- Seed the fleet only if the table is empty
INSERT INTO bikes (type, size, name, image, price_per_day)
SELECT * FROM (VALUES
  ('Road',     27, 'Carbon Road, Matte Black', 'road-black.jpg',   8000),
  ('Road',     27, 'Disc Road, Pearl White',   'road-white.jpg',   8000),
  ('Road',     27, 'Alloy Road, Midnight Blue','road-navy.jpg',    7000),
  ('Mountain', 27, 'Hardtail, Stealth Black',  'mtb-hardtail.jpg', 6000),
  ('Mountain', 29, 'Trail Full Suspension',    'mtb-trail.jpg',   10000),
  ('Mountain', 29, 'XC Full Suspension',       'mtb-xc.jpg',      10000)
) AS v(type, size, name, image, price_per_day)
WHERE NOT EXISTS (SELECT 1 FROM bikes);

-- If your bikes table already had rows, give them names/images yourself, e.g.:
-- UPDATE bikes SET name='Carbon Road, Matte Black', image='road-black.jpg', price_per_day=8000 WHERE bike_id=1;
