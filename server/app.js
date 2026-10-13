const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { openDatabase, passwordHash, passwordMatches, tokenHash } = require('./db');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml' };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isoDay = () => new Date().toISOString().slice(0, 10);

function clean(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function required(value, label, min = 1, max = 200) {
  const text = clean(value, max);
  if (text.length < min) throw new HttpError(400, `${label} is required (${min} characters minimum).`);
  return text;
}
function json(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'content-length':Buffer.byteLength(body), ...headers });
  res.end(body);
}
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim()).filter(Boolean).map(x => {
    const at = x.indexOf('='); return [x.slice(0, at), x.slice(at + 1)];
  }));
}
async function body(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Use application/json.');
  let raw = '';
  for await (const part of req) {
    raw += part;
    if (raw.length > 16384) throw new HttpError(413, 'Request is too large.');
  }
  try { return JSON.parse(raw || '{}'); } catch { throw new HttpError(400, 'Invalid JSON.'); }
}
function actorFor(db, req) {
  const token = parseCookies(req).ewaste_session;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return db.prepare(`SELECT u.id,u.name,u.email,u.role FROM sessions s
    JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`)
    .get(tokenHash(token), Math.floor(Date.now()/1000)) || null;
}
function requireActor(actor, roles) {
  if (!actor) throw new HttpError(401, 'Please sign in.');
  if (roles && !roles.includes(actor.role)) throw new HttpError(403, 'This action is not available for your role.');
}
function audit(db, actorId, action, entityType, entityId) {
  db.prepare('INSERT INTO audit_log(actor_id,action,entity_type,entity_id) VALUES(?,?,?,?)')
    .run(actorId, action, entityType, entityId);
}
function addEvent(db, pickupId, actorId, status, note = '') {
  db.prepare('INSERT INTO trace_events(pickup_id,actor_id,status,note) VALUES(?,?,?,?)')
    .run(pickupId, actorId, status, note);
}
function pickupRow(db, id) {
  return db.prepare(`SELECT p.*, c.name AS category, u.name AS customer_name,
      co.name AS collector_name, re.name AS recycler_name, ce.name AS center_name, ce.city AS center_city,
      cert.certificate_no, cert.method AS recycling_method, cert.issued_at
    FROM pickups p
    JOIN categories c ON c.id=p.category_id
    JOIN users u ON u.id=p.customer_id
    LEFT JOIN users co ON co.id=p.collector_id
    LEFT JOIN users re ON re.id=p.recycler_id
    LEFT JOIN centers ce ON ce.id=p.center_id
    LEFT JOIN certificates cert ON cert.pickup_id=p.id WHERE p.id=?`).get(id);
}
function authorizedPickup(actor, pickup) {
  return actor && (actor.role === 'admin' || actor.id === pickup.customer_id ||
    (actor.role === 'collector' && actor.id === pickup.collector_id) ||
    (actor.role === 'recycler' && ['collected','received','recycled'].includes(pickup.status)));
}
function fullPickup(db, id) {
  const pickup = pickupRow(db, id);
  if (!pickup) throw new HttpError(404, 'Pickup not found.');
  return { ...pickup, timeline: db.prepare(`SELECT e.status,e.note,e.created_at,u.name AS actor_name
    FROM trace_events e LEFT JOIN users u ON u.id=e.actor_id
    WHERE e.pickup_id=? ORDER BY e.id`).all(id) };
}
function setStatus(db, pickup, actor, status, note = '', extra = {}) {
  const fields = ['status=?','updated_at=CURRENT_TIMESTAMP'];
  const values = [status];
  for (const [key,value] of Object.entries(extra)) { fields.push(`${key}=?`); values.push(value); }
  values.push(pickup.id);
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE pickups SET ${fields.join(',')} WHERE id=?`).run(...values);
    addEvent(db, pickup.id, actor.id, status, note);
    audit(db, actor.id, `pickup.${status}`, 'pickup', pickup.id);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
function createApp({ db, publicDir = PUBLIC_DIR } = {}) {
  if (!db) throw new Error('Database is required.');
  return http.createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
    res.setHeader('content-security-policy', "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = url.pathname;
      const method = req.method;
      if (['POST','PATCH','PUT','DELETE'].includes(method) && req.headers.origin) {
        const origin = new URL(req.headers.origin);
        if (origin.host !== req.headers.host) throw new HttpError(403, 'Cross-origin request rejected.');
      }
      if (pathname === '/api/health' && method === 'GET') return json(res, 200, { status:'ok', service:'e-waste-system' });
      if (pathname === '/api/categories' && method === 'GET') return json(res, 200, db.prepare('SELECT * FROM categories ORDER BY id').all());
      if (pathname === '/api/centers' && method === 'GET') return json(res, 200, db.prepare('SELECT * FROM centers WHERE active=1 ORDER BY id').all());
      const actor = actorFor(db, req);
      if (pathname === '/api/auth/me' && method === 'GET') return json(res, 200, { user: actor });
      if (pathname === '/api/auth/register' && method === 'POST') {
        const input = await body(req);
        const name = required(input.name, 'Name', 2, 80);
        const email = required(input.email, 'Email', 3, 120).toLowerCase();
        const password = required(input.password, 'Password', 12, 200);
        if (!EMAIL.test(email)) throw new HttpError(400, 'Enter a valid email address.');
        if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) throw new HttpError(409, 'Email is already registered.');
        const result = db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)')
          .run(name, email, passwordHash(password), 'customer');
        audit(db, result.lastInsertRowid, 'user.register', 'user', result.lastInsertRowid);
        return json(res, 201, { id: Number(result.lastInsertRowid), name, email, role:'customer' });
      }
      if (pathname === '/api/auth/login' && method === 'POST') {
        const input = await body(req);
        const email = clean(input.email, 120).toLowerCase();
        const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
        if (!user || !passwordMatches(String(input.password || ''), user.password_hash)) throw new HttpError(401, 'Invalid email or password.');
        const token = randomBytes(32).toString('hex');
        db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)')
          .run(tokenHash(token), user.id, Math.floor(Date.now()/1000) + 7*86400);
        res.setHeader('set-cookie', `ewaste_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
        return json(res, 200, { user:{ id:user.id, name:user.name, email:user.email, role:user.role } });
      }
      if (pathname === '/api/auth/logout' && method === 'POST') {
        const token = parseCookies(req).ewaste_session;
        if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));
        res.setHeader('set-cookie', 'ewaste_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
        return json(res, 200, { ok:true });
      }
      if (pathname === '/api/track' && method === 'GET') {
        const code = clean(url.searchParams.get('code'), 40).toUpperCase();
        const p = db.prepare(`SELECT p.id,p.tracking_code,p.item_name,p.quantity,p.estimated_weight_kg,p.actual_weight_kg,
          p.status,p.created_at,p.updated_at,c.name AS category,ce.name AS center_name,ce.city AS center_city,
          cert.certificate_no,cert.issued_at FROM pickups p
          JOIN categories c ON c.id=p.category_id LEFT JOIN centers ce ON ce.id=p.center_id
          LEFT JOIN certificates cert ON cert.pickup_id=p.id WHERE p.tracking_code=?`).get(code);
        if (!p) throw new HttpError(404, 'Tracking code not found.');
        const timeline = db.prepare('SELECT status,created_at FROM trace_events WHERE pickup_id=? ORDER BY id').all(p.id);
        delete p.id;
        return json(res, 200, { ...p, timeline });
      }
      if (pathname === '/api/pickups' && method === 'POST') {
        requireActor(actor, ['customer']);
        const input = await body(req);
        const categoryId = Number(input.categoryId);
        if (!db.prepare('SELECT id FROM categories WHERE id=?').get(categoryId)) throw new HttpError(400, 'Choose a valid category.');
        const itemName = required(input.itemName, 'Item name', 3, 100);
        const quantity = Number(input.quantity);
        const weight = Number(input.estimatedWeightKg);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw new HttpError(400, 'Quantity must be between 1 and 100.');
        if (!Number.isFinite(weight) || weight <= 0 || weight > 1000) throw new HttpError(400, 'Estimated weight must be between 0 and 1000 kg.');
        const address = required(input.address, 'Pickup address', 10, 300);
        const preferredDate = required(input.preferredDate, 'Preferred date', 10, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(preferredDate) || preferredDate < isoDay() || !Number.isFinite(Date.parse(preferredDate)))
          throw new HttpError(400, 'Choose a valid current or future date.');
        const code = `EWT-${new Date().getFullYear()}-${randomBytes(4).toString('hex').toUpperCase()}`;
        db.exec('BEGIN');
        let id;
        try {
          const result = db.prepare(`INSERT INTO pickups(tracking_code,customer_id,category_id,item_name,quantity,
            estimated_weight_kg,address,preferred_date,notes) VALUES(?,?,?,?,?,?,?,?,?)`)
            .run(code, actor.id, categoryId, itemName, quantity, weight, address, preferredDate, clean(input.notes, 500));
          id = Number(result.lastInsertRowid);
          addEvent(db, id, actor.id, 'requested', 'Pickup request submitted');
          audit(db, actor.id, 'pickup.create', 'pickup', id);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return json(res, 201, fullPickup(db, id));
      }
      if (pathname === '/api/pickups' && method === 'GET') {
        requireActor(actor);
        let where = '', args = [];
        if (actor.role === 'customer') { where='WHERE p.customer_id=?'; args=[actor.id]; }
        if (actor.role === 'collector') { where='WHERE p.collector_id=?'; args=[actor.id]; }
        if (actor.role === 'recycler') { where="WHERE p.status IN ('collected','received','recycled')"; }
        const rows = db.prepare(`SELECT p.id,p.tracking_code,p.item_name,p.quantity,p.estimated_weight_kg,
          p.actual_weight_kg,p.status,p.preferred_date,p.created_at,c.name AS category,u.name AS customer_name,
          co.name AS collector_name,ce.name AS center_name,cert.certificate_no
          FROM pickups p JOIN categories c ON c.id=p.category_id JOIN users u ON u.id=p.customer_id
          LEFT JOIN users co ON co.id=p.collector_id LEFT JOIN centers ce ON ce.id=p.center_id
          LEFT JOIN certificates cert ON cert.pickup_id=p.id ${where} ORDER BY p.id DESC`).all(...args);
        return json(res, 200, rows);
      }
      const detail = pathname.match(/^\/api\/pickups\/(\d+)$/);
      if (detail && method === 'GET') {
        requireActor(actor);
        const p = fullPickup(db, Number(detail[1]));
        if (!authorizedPickup(actor, p)) throw new HttpError(403, 'Not allowed to view this pickup.');
        return json(res, 200, p);
      }
      if (detail && method === 'DELETE') {
        requireActor(actor, ['customer']);
        const p = pickupRow(db, Number(detail[1]));
        if (!p || p.customer_id !== actor.id) throw new HttpError(404, 'Pickup not found.');
        if (p.status !== 'requested') throw new HttpError(409, 'Only an unassigned request can be cancelled.');
        setStatus(db, p, actor, 'cancelled', 'Cancelled by customer');
        return json(res, 200, fullPickup(db, p.id));
      }
      if (pathname === '/api/admin/dashboard' && method === 'GET') {
        requireActor(actor, ['admin']);
        const summary = db.prepare(`SELECT COUNT(*) AS total,
          SUM(status IN ('requested','assigned','accepted')) AS awaiting_collection,
          SUM(status IN ('collected','received')) AS processing,
          SUM(status='recycled') AS recycled,
          COALESCE(ROUND(SUM(CASE WHEN status='recycled' THEN actual_weight_kg ELSE 0 END),1),0) AS recycled_kg
          FROM pickups`).get();
        const byStatus = db.prepare('SELECT status,COUNT(*) AS count FROM pickups GROUP BY status ORDER BY status').all();
        return json(res, 200, { summary, byStatus });
      }
      if (pathname === '/api/admin/users' && method === 'GET') {
        requireActor(actor, ['admin']);
        return json(res, 200, db.prepare('SELECT id,name,email,role,created_at FROM users ORDER BY role,name').all());
      }
      if (pathname === '/api/admin/users' && method === 'POST') {
        requireActor(actor, ['admin']);
        const input = await body(req);
        const role = clean(input.role, 20);
        if (!['collector','recycler'].includes(role)) throw new HttpError(400, 'Choose collector or recycler role.');
        const name = required(input.name, 'Name', 2, 80);
        const email = required(input.email, 'Email', 3, 120).toLowerCase();
        const password = required(input.password, 'Password', 12, 200);
        if (!EMAIL.test(email)) throw new HttpError(400, 'Enter a valid email address.');
        if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) throw new HttpError(409, 'Email is already registered.');
        const result = db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)').run(name,email,passwordHash(password),role);
        audit(db,actor.id,'user.create','user',result.lastInsertRowid);
        return json(res,201,{ id:Number(result.lastInsertRowid),name,email,role });
      }
      if (pathname === '/api/admin/audit' && method === 'GET') {
        requireActor(actor, ['admin']);
        return json(res, 200, db.prepare(`SELECT a.*,u.name AS actor_name FROM audit_log a
          LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 100`).all());
      }
      const assign = pathname.match(/^\/api\/admin\/pickups\/(\d+)\/assign$/);
      if (assign && method === 'PATCH') {
        requireActor(actor, ['admin']);
        const p = pickupRow(db, Number(assign[1]));
        if (!p) throw new HttpError(404, 'Pickup not found.');
        if (!['requested','assigned'].includes(p.status)) throw new HttpError(409, 'This pickup cannot be assigned now.');
        const input = await body(req);
        const collector = db.prepare("SELECT id FROM users WHERE id=? AND role='collector'").get(Number(input.collectorId));
        if (!collector) throw new HttpError(400, 'Choose a valid collector.');
        setStatus(db,p,actor,'assigned','Collector assigned',{collector_id:collector.id});
        return json(res,200,fullPickup(db,p.id));
      }
      const collect = pathname.match(/^\/api\/collector\/pickups\/(\d+)\/status$/);
      if (collect && method === 'PATCH') {
        requireActor(actor, ['collector']);
        const p = pickupRow(db, Number(collect[1]));
        if (!p || p.collector_id !== actor.id) throw new HttpError(404, 'Assigned pickup not found.');
        const input = await body(req);
        const next = clean(input.status, 20);
        if (!((p.status === 'assigned' && next === 'accepted') || (p.status === 'accepted' && next === 'collected')))
          throw new HttpError(409, 'Invalid collection status transition.');
        setStatus(db,p,actor,next,next === 'collected' ? 'Items collected from customer' : 'Pickup accepted');
        return json(res,200,fullPickup(db,p.id));
      }
      const recycle = pathname.match(/^\/api\/recycler\/pickups\/(\d+)\/status$/);
      if (recycle && method === 'PATCH') {
        requireActor(actor, ['recycler']);
        const p = pickupRow(db, Number(recycle[1]));
        if (!p) throw new HttpError(404, 'Pickup not found.');
        const input = await body(req);
        const next = clean(input.status, 20);
        if (!((p.status === 'collected' && next === 'received') || (p.status === 'received' && next === 'recycled')))
          throw new HttpError(409, 'Invalid recycling status transition.');
        if (p.recycler_id && p.recycler_id !== actor.id) throw new HttpError(403, 'Another recycler owns this pickup.');
        const centerId = Number(input.centerId);
        const center = db.prepare('SELECT id FROM centers WHERE id=? AND active=1').get(centerId || p.center_id);
        if (!center) throw new HttpError(400, 'Choose a valid recycling center.');
        if (next === 'received') {
          setStatus(db,p,actor,'received','Received at recycling center',{recycler_id:actor.id,center_id:center.id});
        } else {
          const actual = Number(input.actualWeightKg);
          if (!Number.isFinite(actual) || actual <= 0 || actual > 1000) throw new HttpError(400, 'Enter actual weight between 0 and 1000 kg.');
          const methodName = required(input.method, 'Recycling method', 3, 120);
          db.exec('BEGIN');
          try {
            db.prepare("UPDATE pickups SET status='recycled',actual_weight_kg=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
              .run(actual,p.id);
            const certNo = `CERT-${p.tracking_code}`;
            db.prepare('INSERT INTO certificates(pickup_id,certificate_no,method) VALUES(?,?,?)').run(p.id,certNo,methodName);
            addEvent(db,p.id,actor.id,'recycled',`Processed by ${methodName}`);
            audit(db,actor.id,'pickup.recycled','pickup',p.id);
            db.exec('COMMIT');
          } catch (error) { db.exec('ROLLBACK'); throw error; }
        }
        return json(res,200,fullPickup(db,p.id));
      }
      if (pathname.startsWith('/api/')) throw new HttpError(404, 'Endpoint not found.');
      if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
      const file = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
      const target = path.resolve(publicDir, file);
      if (!target.startsWith(publicDir + path.sep) && target !== path.join(publicDir,'index.html')) throw new HttpError(403, 'Forbidden.');
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new HttpError(404, 'Page not found.');
      const data = fs.readFileSync(target);
      res.writeHead(200, {'content-type': MIME[path.extname(target)] || 'application/octet-stream', 'content-length':data.length});
      return res.end(method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (error instanceof HttpError) return json(res,error.status,{error:error.message});
      console.error(error);
      return json(res,500,{error:'Internal server error.'});
    }
  });
}

if (require.main === module) {
  const file = path.resolve(process.env.DATA_DIR || path.join(__dirname,'..','data'), 'ewaste.db');
  const db = openDatabase(file);
  const port = Number(process.env.PORT || 8092);
  createApp({db}).listen(port,'0.0.0.0',() => console.log(`EcoTrace listening on http://localhost:${port}`));
}

module.exports = { createApp };
