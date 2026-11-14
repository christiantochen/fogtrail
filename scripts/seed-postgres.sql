-- Test data for the PostgreSQL driver. Safe to run more than once.
-- Local:  psql -U postgres -f scripts/seed-postgres.sql
-- Creates database `shop` (schemas `public` and `billing`), a read-only role and a
-- read-write one. The read-write role exists only so tests can prove the server itself
-- refuses writes from Fogtrail's read-only transaction. Passwords here are for
-- throwaway test servers.
DROP DATABASE IF EXISTS shop WITH (FORCE);
DROP ROLE IF EXISTS fogtrail_ro;
DROP ROLE IF EXISTS fogtrail_rw;
CREATE DATABASE shop ENCODING 'UTF8' TEMPLATE template0;
\connect shop

CREATE TYPE plan AS ENUM ('free', 'pro');

CREATE TABLE customers (
  id serial PRIMARY KEY,
  name varchar(80) NOT NULL,
  email varchar(120) UNIQUE,
  plan plan NOT NULL DEFAULT 'free',
  notes text,
  tags text[],
  created_at timestamptz NOT NULL DEFAULT '2026-01-01 09:00:00+00'
);
COMMENT ON TABLE customers IS 'People who buy things';
COMMENT ON COLUMN customers.email IS 'Login address';

INSERT INTO customers (name, email, plan, notes, tags) VALUES
  ('Ada', 'ada@example.com', 'pro', E'héllo wörld — 日本語', '{vip,early}'),
  ('Grace', 'grace@example.com', 'free', NULL, NULL),
  ('Linus', NULL, 'pro', '', '{}'),
  ('Edsger', 'edsger@example.com', 'free', E'line one\nline two', '{"has space","quote\"d"}');

CREATE TABLE products (
  sku varchar(20) PRIMARY KEY,
  title varchar(120) NOT NULL,
  price numeric(10,2) NOT NULL,
  attrs jsonb,
  photo bytea,
  active boolean NOT NULL DEFAULT true,
  weight_kg double precision
);
INSERT INTO products VALUES
  ('LAMP-1', 'Lamp', 25.00, '{"color":"brass","watts":9}', '\x89504e470d0a1a0a', true, 1.25),
  ('DESK-1', 'Desk', 180.50, NULL, NULL, true, 22.0),
  ('OLD-1', 'Retired chair', 0.00, '[]', NULL, false, NULL);

CREATE TABLE orders (
  id serial PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES customers (id),
  sku varchar(20) NOT NULL REFERENCES products (sku),
  qty smallint NOT NULL DEFAULT 1,
  placed_at timestamptz NOT NULL DEFAULT '2026-02-03 10:30:00+00'
);
CREATE INDEX idx_orders_customer ON orders (customer_id);
-- A partial index and an expression index, which MySQL cannot have.
CREATE INDEX idx_orders_big ON orders (qty) WHERE qty > 1;
CREATE INDEX idx_orders_day ON orders (date(placed_at AT TIME ZONE 'UTC'));
INSERT INTO orders (customer_id, sku, qty) VALUES (1,'LAMP-1',2),(1,'DESK-1',1),(2,'LAMP-1',1);

-- Long enough to page through (250 rows, 100 per page).
CREATE TABLE events (
  id bigserial PRIMARY KEY,
  kind varchar(20) NOT NULL,
  payload text
);
INSERT INTO events (kind, payload)
  SELECT CASE WHEN i % 2 = 1 THEN 'tick' ELSE 'tock' END, 'event ' || i
  FROM generate_series(1, 250) AS i;

-- No primary key, to see how the browser copes.
CREATE TABLE loose_notes (note varchar(40));
INSERT INTO loose_notes VALUES ('one'), ('two');

CREATE VIEW paying_customers AS SELECT id, name FROM customers WHERE plan = 'pro';
CREATE MATERIALIZED VIEW mv_plan_counts AS SELECT plan, count(*) AS n FROM customers GROUP BY plan;

-- Mixed case and a reserved word need quotes everywhere.
CREATE TABLE "Weird Name" ("select" integer, "back""quote" integer, "MixedCase" text);
INSERT INTO "Weird Name" VALUES (1, 2, 'x');

-- A second schema, so the schema list has more than `public`.
CREATE SCHEMA billing;
CREATE TABLE billing.invoices (
  id serial PRIMARY KEY,
  customer_id integer NOT NULL,
  total numeric(12,2) NOT NULL
);
INSERT INTO billing.invoices (customer_id, total) VALUES (1, 205.50), (2, 25.00);

CREATE ROLE fogtrail_ro LOGIN PASSWORD 'ro-test-pw';
GRANT CONNECT ON DATABASE shop TO fogtrail_ro;
GRANT USAGE ON SCHEMA public, billing TO fogtrail_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public, billing TO fogtrail_ro;
CREATE ROLE fogtrail_rw LOGIN PASSWORD 'rw-test-pw';
GRANT CONNECT ON DATABASE shop TO fogtrail_rw;
GRANT ALL ON SCHEMA public, billing TO fogtrail_rw;
GRANT ALL ON ALL TABLES IN SCHEMA public, billing TO fogtrail_rw;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public, billing TO fogtrail_rw;
ANALYZE;
