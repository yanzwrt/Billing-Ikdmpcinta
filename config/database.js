/**
 * Inisialisasi database SQLite untuk billing RTRWnet
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, '../database');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const dbPath = path.join(dbDir, 'billing.db');

let db;
try {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('cache_size = -64000');
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = MEMORY');
  db.pragma('mmap_size = 134217728');
  db.pragma('busy_timeout = 5000');
} catch (err) {
  console.error('[DB] Gagal membuka database:', err.message);
  process.exit(1);
}

const getAppSetting = (key, defaultValue = null) => {
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
    return row ? JSON.parse(row.value) : defaultValue;
  } catch (e) {
    return defaultValue;
  }
};

const saveAppSetting = (key, value) => {
  try {
    const jsonValue = JSON.stringify(value);
    db.prepare('INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\', \'+7 hours\'))').run(key, jsonValue);
    return true;
  } catch (e) {
    return false;
  }
};

try {
  db.function('NOW_LOCAL', () => {
    const tz = getAppSetting('timezone', 'Asia/Jakarta');
    const now = new Date();
    const options = {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    };
    const formatter = new Intl.DateTimeFormat('en-US', options);
    const parts = formatter.formatToParts(now);
    const p = {};
    parts.forEach(part => p[part.type] = part.value);
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
  });
} catch (e) {}

// Hapus tabel port lama yang memiliki constraint bentrok, lalu buat baru
  db.exec(`DROP TABLE IF EXISTS odp_ports;`);
  db.exec(`DROP TABLE IF EXISTS odp_box_splitters;`);
db.exec(`
  CREATE TABLE IF NOT EXISTS areas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS expense_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    parent_id INTEGER REFERENCES expense_categories(id),
    description TEXT,
    icon TEXT DEFAULT 'bi bi-tag',
    color TEXT DEFAULT '#6366f1',
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    category TEXT NOT NULL,
    subcategory TEXT,
    amount INTEGER NOT NULL,
    description TEXT NOT NULL,
    vendor TEXT,
    receipt_number TEXT,
    payment_method TEXT DEFAULT 'cash',
    recorded_by_role TEXT,
    recorded_by_name TEXT,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS cash_in (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    category TEXT NOT NULL,
    amount INTEGER NOT NULL,
    description TEXT,
    reference_type TEXT,
    reference_id INTEGER,
    receipt_number TEXT,
    payment_method TEXT DEFAULT 'cash',
    recorded_by_role TEXT,
    recorded_by_name TEXT,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price INTEGER NOT NULL DEFAULT 0,
    speed_down INTEGER DEFAULT 0,
    speed_up INTEGER DEFAULT 0,
    description TEXT DEFAULT '',
    billing_type TEXT DEFAULT 'postpaid',
    duration_days INTEGER DEFAULT 30,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nik TEXT DEFAULT '',
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    address TEXT DEFAULT '',
    area TEXT DEFAULT '',
    package_id INTEGER REFERENCES packages(id) ON DELETE SET NULL,
    genieacs_tag TEXT DEFAULT '',
    pppoe_username TEXT DEFAULT '',
    isolir_profile TEXT DEFAULT 'isolir',
    status TEXT DEFAULT 'active',
    install_date DATE,
    expired_at DATETIME DEFAULT NULL,
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS technicians (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    area TEXT DEFAULT '',
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS cashiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS collectors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    area TEXT DEFAULT '',
    is_active INTEGER DEFAULT 1,
    auto_approve INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS collector_payment_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    collector_id INTEGER NOT NULL REFERENCES collectors(id) ON DELETE CASCADE,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL DEFAULT 0,
    note TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    decided_by_role TEXT DEFAULT '',
    decided_by_name TEXT DEFAULT '',
    decided_note TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now', '+7 hours')),
    decided_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    period_month INTEGER NOT NULL,
    period_year INTEGER NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0,
    status TEXT DEFAULT 'unpaid',
    paid_at DATETIME,
    paid_by_name TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'open',
    technician_id INTEGER REFERENCES technicians(id) ON DELETE SET NULL,
    technician_notes TEXT DEFAULT '',
    photos TEXT DEFAULT '',
    photo_metadata TEXT DEFAULT '',
    customer_photos TEXT DEFAULT '',
    customer_photo_metadata TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now', '+7 hours')),
    updated_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS routers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER DEFAULT 8728,
    user TEXT NOT NULL,
    password TEXT NOT NULL,
    description TEXT DEFAULT '',
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS promo_slides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT DEFAULT '',
    description TEXT DEFAULT '',
    image_path TEXT NOT NULL,
    url TEXT DEFAULT '',
    open_in_new_tab INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    start_date DATE,
    end_date DATE,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours')),
    updated_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS olts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    snmp_community TEXT DEFAULT 'public',
    snmp_port INTEGER DEFAULT 161,
    brand TEXT DEFAULT 'zte',
    description TEXT DEFAULT '',
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS odps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_odp_id INTEGER REFERENCES odps(id) ON DELETE SET NULL,
    splitter_type TEXT DEFAULT 'PLC',
    splitter_ratio TEXT DEFAULT '1:8',
    input_power_dbm REAL DEFAULT -9.0,
    olt_id INTEGER REFERENCES olts(id) ON DELETE SET NULL,
    pon_port TEXT DEFAULT '',
    port_capacity INTEGER NOT NULL DEFAULT 16,
    lat TEXT,
    lng TEXT,
    description TEXT,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );


  CREATE TABLE IF NOT EXISTS odp_box_splitters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    odp_id INTEGER NOT NULL REFERENCES odps(id) ON DELETE CASCADE,
    splitter_index INTEGER DEFAULT 1,
    splitter_type TEXT DEFAULT 'PLC',
    splitter_ratio TEXT DEFAULT '1:8',
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS odp_ports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    odp_id INTEGER NOT NULL REFERENCES odps(id) ON DELETE CASCADE,
    splitter_id INTEGER NOT NULL REFERENCES odp_box_splitters(id) ON DELETE CASCADE,
    port_number INTEGER NOT NULL,
    target_type TEXT DEFAULT 'EMPTY',
    target_id INTEGER DEFAULT NULL,
    output_power_dbm REAL DEFAULT 0.0,
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now', '+7 hours')),
    UNIQUE(splitter_id, port_number)
  );

  CREATE TABLE IF NOT EXISTS voucher_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    router_id INTEGER REFERENCES routers(id) ON DELETE SET NULL,
    profile_name TEXT NOT NULL,
    qty_total INTEGER NOT NULL DEFAULT 0,
    qty_created INTEGER NOT NULL DEFAULT 0,
    qty_failed INTEGER NOT NULL DEFAULT 0,
    price INTEGER NOT NULL DEFAULT 0,
    validity TEXT DEFAULT '',
    prefix TEXT DEFAULT '',
    code_length INTEGER NOT NULL DEFAULT 4,
    status TEXT DEFAULT 'creating',
    created_by TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now', '+7 hours')),
    updated_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS vouchers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES voucher_batches(id) ON DELETE CASCADE,
    router_id INTEGER REFERENCES routers(id) ON DELETE SET NULL,
    code TEXT NOT NULL,
    password TEXT NOT NULL,
    profile_name TEXT NOT NULL,
    comment TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    used_at DATETIME,
    last_seen_comment TEXT DEFAULT '',
    last_seen_uptime TEXT DEFAULT '',
    last_seen_at DATETIME,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours')),
    UNIQUE(router_id, code)
  );

  CREATE TABLE IF NOT EXISTS public_voucher_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    router_id INTEGER REFERENCES routers(id) ON DELETE SET NULL,
    profile_name TEXT NOT NULL,
    validity TEXT DEFAULT '',
    price INTEGER NOT NULL DEFAULT 0,
    buyer_phone TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    paid_at DATETIME,
    fulfilled_at DATETIME,
    voucher_code TEXT DEFAULT '',
    voucher_password TEXT DEFAULT '',
    voucher_comment TEXT DEFAULT '',
    wa_sent INTEGER NOT NULL DEFAULT 0,
    wa_sent_at DATETIME,
    wa_error TEXT DEFAULT '',
    payment_gateway TEXT DEFAULT '',
    payment_order_id TEXT DEFAULT '',
    payment_link TEXT DEFAULT '',
    payment_reference TEXT DEFAULT '',
    payment_payload TEXT,
    payment_expires_at DATETIME,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours')),
    updated_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS public_ppob_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER,
    buyer_phone TEXT NOT NULL,
    sku TEXT NOT NULL,
    product_name TEXT DEFAULT '',
    target TEXT NOT NULL,
    price INTEGER NOT NULL DEFAULT 0,
    payment_gateway TEXT DEFAULT '',
    payment_order_id TEXT DEFAULT '',
    payment_link TEXT DEFAULT '',
    payment_reference TEXT DEFAULT '',
    payment_payload TEXT,
    payment_expires_at DATETIME,
    status TEXT DEFAULT 'pending', 
    paid_at DATETIME,
    fulfilled_at DATETIME,
    digi_ref_id TEXT DEFAULT '',
    digi_trx_id TEXT DEFAULT '',
    digi_sn TEXT DEFAULT '',
    digi_message TEXT DEFAULT '',
    wa_sent INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours')),
    updated_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS customer_topup_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0,
    payment_gateway TEXT DEFAULT '',
    payment_order_id TEXT DEFAULT '',
    payment_link TEXT DEFAULT '',
    payment_reference TEXT DEFAULT '',
    payment_payload TEXT,
    payment_expires_at DATETIME,
    qris_unique_code INTEGER,
    qris_amount_unique INTEGER,
    qris_assigned_at DATETIME,
    qris_paid_notif_id INTEGER,
    status TEXT DEFAULT 'pending',
    paid_at DATETIME,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours')),
    updated_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS agent_topup_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0,
    payment_gateway TEXT DEFAULT '',
    payment_order_id TEXT DEFAULT '',
    payment_link TEXT DEFAULT '',
    payment_reference TEXT DEFAULT '',
    payment_payload TEXT,
    payment_expires_at DATETIME,
    status TEXT DEFAULT 'pending',
    paid_at DATETIME,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours')),
    updated_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    balance INTEGER NOT NULL DEFAULT 0,
    billing_fee INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS agent_hotspot_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    router_id INTEGER REFERENCES routers(id) ON DELETE SET NULL,
    profile_name TEXT NOT NULL,
    validity TEXT DEFAULT '',
    buy_price INTEGER NOT NULL DEFAULT 0,
    sell_price INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours')),
    UNIQUE(agent_id, router_id, profile_name)
  );

  CREATE TABLE IF NOT EXISTS agent_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    router_id INTEGER REFERENCES routers(id) ON DELETE SET NULL,
    profile_name TEXT DEFAULT '',
    voucher_code TEXT DEFAULT '',
    voucher_password TEXT DEFAULT '',
    amount_invoice INTEGER NOT NULL DEFAULT 0,
    amount_buy INTEGER NOT NULL DEFAULT 0,
    amount_sell INTEGER NOT NULL DEFAULT 0,
    fee INTEGER NOT NULL DEFAULT 0,
    balance_before INTEGER NOT NULL DEFAULT 0,
    balance_after INTEGER NOT NULL DEFAULT 0,
    note TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS digiflazz_staff_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL DEFAULT 'admin',
    actor_phone TEXT DEFAULT '',
    actor_name TEXT DEFAULT '',
    sku TEXT NOT NULL,
    target TEXT NOT NULL,
    ref_id TEXT NOT NULL UNIQUE,
    trx_id TEXT DEFAULT '',
    sn TEXT DEFAULT '',
    status TEXT DEFAULT '',
    message TEXT DEFAULT '',
    price INTEGER NOT NULL DEFAULT 0,
    sell_price INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS webhook_payment_notifs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service TEXT DEFAULT '',
    content TEXT NOT NULL,
    parsed_amount INTEGER,
    parsed_ok INTEGER NOT NULL DEFAULT 0,
    matched_invoice_id INTEGER,
    matched_voucher_order_id INTEGER,
    ip TEXT DEFAULT '',
    user_agent TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE INDEX IF NOT EXISTS idx_odp_box_splitters_odp ON odp_box_splitters(odp_id);
  CREATE INDEX IF NOT EXISTS idx_odp_ports_odp ON odp_ports(odp_id);
  CREATE INDEX IF NOT EXISTS idx_odp_ports_splitter ON odp_ports(splitter_id);
  CREATE INDEX IF NOT EXISTS idx_voucher_batches_router ON voucher_batches(router_id);
  CREATE INDEX IF NOT EXISTS idx_vouchers_batch ON vouchers(batch_id);
  CREATE INDEX IF NOT EXISTS idx_vouchers_code ON vouchers(code);
  CREATE INDEX IF NOT EXISTS idx_public_voucher_orders_status ON public_voucher_orders(status);
  CREATE INDEX IF NOT EXISTS idx_public_voucher_orders_created ON public_voucher_orders(created_at);

  CREATE INDEX IF NOT EXISTS idx_agents_username ON agents(username);
  CREATE INDEX IF NOT EXISTS idx_agent_prices_agent ON agent_hotspot_prices(agent_id);
  CREATE INDEX IF NOT EXISTS idx_agent_prices_router_profile ON agent_hotspot_prices(router_id, profile_name);
  CREATE INDEX IF NOT EXISTS idx_agent_tx_agent ON agent_transactions(agent_id);
  CREATE INDEX IF NOT EXISTS idx_agent_tx_created ON agent_transactions(created_at);
  CREATE INDEX IF NOT EXISTS idx_digi_staff_tx_created ON digiflazz_staff_transactions(created_at);
  CREATE INDEX IF NOT EXISTS idx_digi_staff_tx_role ON digiflazz_staff_transactions(role);
  CREATE INDEX IF NOT EXISTS idx_digi_staff_tx_ref ON digiflazz_staff_transactions(ref_id);

  CREATE INDEX IF NOT EXISTS idx_collectors_username ON collectors(username);
  CREATE INDEX IF NOT EXISTS idx_collector_pay_req_status ON collector_payment_requests(status);
  CREATE INDEX IF NOT EXISTS idx_collector_pay_req_invoice ON collector_payment_requests(invoice_id);
  CREATE INDEX IF NOT EXISTS idx_collector_pay_req_collector ON collector_payment_requests(collector_id);
  CREATE INDEX IF NOT EXISTS idx_collector_pay_req_created ON collector_payment_requests(created_at);

  CREATE INDEX IF NOT EXISTS idx_webhook_payment_notifs_created ON webhook_payment_notifs(created_at);
  CREATE INDEX IF NOT EXISTS idx_webhook_payment_notifs_service ON webhook_payment_notifs(service);

  -- ─── INVENTORY / WAREHOUSE ───────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS inventory_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS inventory_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER REFERENCES inventory_categories(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    brand TEXT DEFAULT '',
    model TEXT DEFAULT '',
    unit TEXT DEFAULT 'pcs',
    min_stock INTEGER DEFAULT 5,
    description TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS inventory_stock (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    serial_number TEXT UNIQUE,
    quantity INTEGER NOT NULL DEFAULT 0,
    condition TEXT DEFAULT 'new',
    location TEXT DEFAULT 'Gudang Utama',
    status TEXT DEFAULT 'available',
    assigned_to_customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    note TEXT DEFAULT '',
    updated_at DATETIME DEFAULT (datetime('now', '+7 hours')),
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS inventory_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER REFERENCES inventory_items(id) ON DELETE SET NULL,
    stock_id INTEGER REFERENCES inventory_stock(id) ON DELETE SET NULL,
    type TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    actor TEXT DEFAULT 'Admin',
    note TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE INDEX IF NOT EXISTS idx_inventory_items_cat ON inventory_items(category_id);
  CREATE INDEX IF NOT EXISTS idx_inventory_stock_item ON inventory_stock(item_id);
  CREATE INDEX IF NOT EXISTS idx_inventory_stock_sn ON inventory_stock(serial_number);
  CREATE INDEX IF NOT EXISTS idx_inventory_logs_item ON inventory_logs(item_id);
  CREATE INDEX IF NOT EXISTS idx_inventory_logs_created ON inventory_logs(created_at);

  CREATE TABLE IF NOT EXISTS genieacs_servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    cwmp_url TEXT,
    username TEXT,
    password TEXT,
    location TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    device_count INTEGER DEFAULT 0,
    last_sync DATETIME,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS wa_chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    direction TEXT NOT NULL DEFAULT 'outbound',
    gateway TEXT NOT NULL DEFAULT 'baileys',
    sender_phone TEXT,
    recipient_phone TEXT,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    customer_name TEXT,
    message_text TEXT NOT NULL,
    status TEXT DEFAULT 'sent',
    meta_message_id TEXT,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );
  CREATE INDEX IF NOT EXISTS idx_wa_chat_messages_phone ON wa_chat_messages(sender_phone, recipient_phone);
  CREATE INDEX IF NOT EXISTS idx_wa_chat_messages_created ON wa_chat_messages(created_at);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS voucher_packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    router_id INTEGER REFERENCES routers(id) ON DELETE SET NULL,
    profile_name TEXT NOT NULL,
    price INTEGER NOT NULL DEFAULT 0,
    validity TEXT DEFAULT '',
    prefix TEXT DEFAULT '',
    code_length INTEGER NOT NULL DEFAULT 6,
    charset TEXT DEFAULT 'mixed',
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours')),
    updated_at DATETIME DEFAULT (datetime('now', '+7 hours')),
    UNIQUE(router_id, profile_name)
  );

  CREATE TABLE IF NOT EXISTS radius_nas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nasname TEXT NOT NULL UNIQUE,
    shortname TEXT DEFAULT '',
    secret TEXT NOT NULL,
    description TEXT DEFAULT '',
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS radius_accounting (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    nas_ip TEXT DEFAULT '',
    framed_ip TEXT DEFAULT '',
    session_id TEXT NOT NULL,
    status_type INTEGER DEFAULT 1,
    input_octets INTEGER DEFAULT 0,
    output_octets INTEGER DEFAULT 0,
    input_gigawords INTEGER DEFAULT 0,
    output_gigawords INTEGER DEFAULT 0,
    session_time INTEGER DEFAULT 0,
    terminate_cause INTEGER DEFAULT 0,
    calling_station_id TEXT DEFAULT '',
    called_station_id TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now', '+7 hours')),
    updated_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE INDEX IF NOT EXISTS idx_radius_acct_user ON radius_accounting(username);
  CREATE INDEX IF NOT EXISTS idx_radius_acct_session ON radius_accounting(session_id);
  CREATE INDEX IF NOT EXISTS idx_radius_acct_status ON radius_accounting(status_type);
`);

try { db.exec("ALTER TABLE odp_ports ADD COLUMN splitter_index INTEGER DEFAULT 1"); } catch (e) {}

module.exports = db;
module.exports.getAppSetting = getAppSetting;
module.exports.saveAppSetting = saveAppSetting;