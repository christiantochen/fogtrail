-- Test data for the MySQL driver. Safe to run more than once.
-- Local:  mysql -u root < scripts/seed-mysql.sql      (or through your own admin user)
-- Creates schema `shop`, a read-only user and a read-write one. The read-write
-- user exists only so tests can prove the server itself refuses writes from
-- Fogtrail's read-only session. Passwords here are for throwaway test servers.
SET NAMES utf8mb4;
DROP DATABASE IF EXISTS shop;
CREATE DATABASE shop CHARACTER SET utf8mb4;
USE shop;

CREATE TABLE customers (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  email VARCHAR(120) NULL UNIQUE,
  plan ENUM('free','pro') NOT NULL DEFAULT 'free',
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT '2026-01-01 09:00:00'
) COMMENT='People who buy things';

INSERT INTO customers (name, email, plan, notes) VALUES
  ('Ada', 'ada@example.com', 'pro', 'héllo wörld — 日本語'),
  ('Grace', 'grace@example.com', 'free', NULL),
  ('Linus', NULL, 'pro', ''),
  ('Edsger', 'edsger@example.com', 'free', 'line one\nline two');

CREATE TABLE products (
  sku VARCHAR(20) NOT NULL PRIMARY KEY,
  title VARCHAR(120) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  attrs JSON NULL,
  photo BLOB NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  weight_kg DOUBLE NULL
);
INSERT INTO products VALUES
  ('LAMP-1', 'Lamp', 25.00, '{"color":"brass","watts":9}', UNHEX('89504E470D0A1A0A'), 1, 1.25),
  ('DESK-1', 'Desk', 180.50, NULL, NULL, 1, 22.0),
  ('OLD-1', 'Retired chair', 0.00, '[]', NULL, 0, NULL);

CREATE TABLE orders (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  customer_id INT UNSIGNED NOT NULL,
  sku VARCHAR(20) NOT NULL,
  qty SMALLINT NOT NULL DEFAULT 1,
  placed_at TIMESTAMP NOT NULL DEFAULT '2026-02-03 10:30:00',
  KEY idx_customer (customer_id),
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_orders_product FOREIGN KEY (sku) REFERENCES products (sku)
);
INSERT INTO orders (customer_id, sku, qty) VALUES (1,'LAMP-1',2),(1,'DESK-1',1),(2,'LAMP-1',1);

-- Long enough to page through (250 rows, 100 per page).
CREATE TABLE events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  kind VARCHAR(20) NOT NULL,
  payload TEXT NULL
);
INSERT INTO events (kind, payload)
  WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 250)
  SELECT IF(i % 2, 'tick', 'tock'), CONCAT('event ', i) FROM n;

-- No primary key, to see how the browser copes.
CREATE TABLE loose_notes (note VARCHAR(40));
INSERT INTO loose_notes VALUES ('one'), ('two');

CREATE VIEW paying_customers AS SELECT id, name FROM customers WHERE plan = 'pro';

CREATE TABLE `weird name` (`select` INT, `back``tick` INT);
INSERT INTO `weird name` VALUES (1, 2);

DROP USER IF EXISTS 'fogtrail_ro'@'%';
DROP USER IF EXISTS 'fogtrail_rw'@'%';
CREATE USER 'fogtrail_ro'@'%' IDENTIFIED BY 'ro-test-pw';
GRANT SELECT, SHOW VIEW ON shop.* TO 'fogtrail_ro'@'%';
CREATE USER 'fogtrail_rw'@'%' IDENTIFIED BY 'rw-test-pw';
GRANT ALL ON shop.* TO 'fogtrail_rw'@'%';
