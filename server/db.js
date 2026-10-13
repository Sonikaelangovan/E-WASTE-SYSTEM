const { DatabaseSync } = require('node:sqlite');
const { scryptSync, randomBytes, timingSafeEqual, createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

function passwordMatches(password, saved) {
  if (typeof saved !== 'string' || !saved.includes(':')) return false;
  const [salt, hex] = saved.split(':');
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function openDatabase(file, env = process.env) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('customer','collector','recycler','admin')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      icon TEXT NOT NULL,
      description TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS centers (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      city TEXT NOT NULL,
      phone TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS pickups (
      id INTEGER PRIMARY KEY,
      tracking_code TEXT NOT NULL UNIQUE,
      customer_id INTEGER NOT NULL REFERENCES users(id),
      category_id INTEGER NOT NULL REFERENCES categories(id),
      item_name TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      estimated_weight_kg REAL NOT NULL CHECK(estimated_weight_kg > 0),
      address TEXT NOT NULL,
      preferred_date TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','assigned','accepted','collected','received','recycled','cancelled')),
      collector_id INTEGER REFERENCES users(id),
      recycler_id INTEGER REFERENCES users(id),
      center_id INTEGER REFERENCES centers(id),
      actual_weight_kg REAL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS trace_events (
      id INTEGER PRIMARY KEY,
      pickup_id INTEGER NOT NULL REFERENCES pickups(id) ON DELETE CASCADE,
      actor_id INTEGER REFERENCES users(id),
      status TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS certificates (
      id INTEGER PRIMARY KEY,
      pickup_id INTEGER NOT NULL UNIQUE REFERENCES pickups(id),
      certificate_no TEXT NOT NULL UNIQUE,
      method TEXT NOT NULL,
      issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY,
      actor_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_pickups_customer ON pickups(customer_id);
    CREATE INDEX IF NOT EXISTS idx_pickups_collector ON pickups(collector_id);
    CREATE INDEX IF NOT EXISTS idx_pickups_status ON pickups(status);
    CREATE INDEX IF NOT EXISTS idx_events_pickup ON trace_events(pickup_id);
  `);
  if (db.prepare('SELECT COUNT(*) AS n FROM categories').get().n === 0) {
    const add = db.prepare('INSERT INTO categories(name,icon,description) VALUES(?,?,?)');
    for (const row of [
      ['Phones & tablets','phone','Smartphones, tablets, chargers and accessories'],
      ['Computers','laptop','Laptops, desktops, monitors and peripherals'],
      ['Home appliances','appliance','Small and large household electronics'],
      ['Batteries','battery','Rechargeable batteries and power banks'],
      ['Cables & parts','cable','Wires, circuit boards and electronic components'],
      ['Other electronics','other','Any other end-of-life electronic device']
    ]) add.run(...row);
  }
  if (db.prepare('SELECT COUNT(*) AS n FROM centers').get().n === 0) {
    db.prepare('INSERT INTO centers(name,address,city,phone) VALUES(?,?,?,?)')
      .run('EcoTrace Collection Hub', '12 Circular Avenue, Industrial Estate', 'Chennai', '+91 44 4000 8092');
    db.prepare('INSERT INTO centers(name,address,city,phone) VALUES(?,?,?,?)')
      .run('EcoTrace Recycling Center', '48 Green Works Road, Ambattur', 'Chennai', '+91 44 4000 8093');
  }
  for (const [role, label] of [['admin','Administrator'],['collector','Collection Partner'],['recycler','Recycling Partner']]) {
    const email = env[`${role.toUpperCase()}_EMAIL`];
    const password = env[`${role.toUpperCase()}_PASSWORD`];
    if (!email || !password || password.length < 12 || password.startsWith('replace-')) continue;
    if (!db.prepare('SELECT id FROM users WHERE email=?').get(email)) {
      db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)')
        .run(label, email.toLowerCase(), passwordHash(password), role);
    }
  }
  return db;
}

module.exports = { openDatabase, passwordHash, passwordMatches, tokenHash };
