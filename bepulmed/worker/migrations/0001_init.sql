-- BepulMed AI: запись, очередь, сотрудники, журнал. SQLite (Cloudflare D1).
PRAGMA foreign_keys = ON;

CREATE TABLE clinics (
  id TEXT PRIMARY KEY,
  name_ru TEXT NOT NULL,
  name_uz TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('clinic','hospital')),
  address TEXT,
  phone TEXT,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0,    -- 1 = вымышленная клиника для демонстрации
  connected INTEGER NOT NULL DEFAULT 0,  -- 1 = клиника подключена, запись доступна
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE doctors (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id),
  full_name TEXT NOT NULL,
  specialty TEXT NOT NULL,          -- код: therapy, cardiology, ...
  room TEXT,
  ticket_prefix TEXT NOT NULL,      -- буква талона: T, K ...
  active INTEGER NOT NULL DEFAULT 1
);

-- Шаблон рабочего дня. weekday: 0 = понедельник … 6 = воскресенье. Минуты от полуночи по Ташкенту.
CREATE TABLE doctor_schedules (
  doctor_id TEXT NOT NULL REFERENCES doctors(id),
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  slot_minutes INTEGER NOT NULL CHECK (slot_minutes BETWEEN 5 AND 120),
  PRIMARY KEY (doctor_id, weekday),
  CHECK (end_min > start_min)
);

CREATE TABLE slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id TEXT NOT NULL REFERENCES doctors(id),
  local_date TEXT NOT NULL,        -- YYYY-MM-DD (Asia/Tashkent)
  starts_at TEXT NOT NULL,         -- ISO UTC
  ends_at TEXT NOT NULL,
  ordinal INTEGER NOT NULL,        -- порядковый номер слота в дне → номер талона
  UNIQUE (doctor_id, starts_at)
);
CREATE INDEX slots_by_day ON slots(doctor_id, local_date);

CREATE TABLE appointments (
  id TEXT PRIMARY KEY,
  slot_id INTEGER NOT NULL REFERENCES slots(id),
  doctor_id TEXT NOT NULL REFERENCES doctors(id),
  clinic_id TEXT NOT NULL REFERENCES clinics(id),
  local_date TEXT NOT NULL,
  patient_key TEXT NOT NULL,       -- tg:<id> | demo:<uuid> | walkin:<uuid>
  patient_label TEXT NOT NULL,     -- короткое имя для регистратуры (без мед. данных)
  channel TEXT NOT NULL CHECK (channel IN ('telegram','demo','registry')),
  status TEXT NOT NULL CHECK (status IN ('booked','checked_in','in_progress','done','cancelled','no_show')),
  ticket TEXT NOT NULL,
  idem_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  called_at TEXT,
  checked_in_at TEXT,
  started_at TEXT,
  finished_at TEXT
);
-- Главная защита от двойной записи: одна активная запись на слот (частичный уникальный индекс).
CREATE UNIQUE INDEX one_active_booking_per_slot ON appointments(slot_id)
  WHERE status IN ('booked','checked_in','in_progress');
-- Повторный клик/повтор запроса не создаёт вторую запись.
CREATE UNIQUE INDEX one_booking_per_idem_key ON appointments(patient_key, idem_key);
CREATE INDEX appt_by_patient ON appointments(patient_key, status);
CREATE INDEX appt_by_day ON appointments(doctor_id, local_date);

CREATE TABLE doctor_delays (
  doctor_id TEXT NOT NULL REFERENCES doctors(id),
  local_date TEXT NOT NULL,
  delay_min INTEGER NOT NULL CHECK (delay_min BETWEEN 0 AND 600),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (doctor_id, local_date)
);

CREATE TABLE clinic_staff (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('registrar','doctor','admin')),
  doctor_id TEXT REFERENCES doctors(id),  -- для роли doctor: чьими приёмами управляет
  token_hash TEXT NOT NULL UNIQUE,        -- SHA-256 токена; сам токен не хранится
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE queue_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id TEXT NOT NULL REFERENCES appointments(id),
  type TEXT NOT NULL,
  actor TEXT NOT NULL,                    -- patient | staff:<id>
  at TEXT NOT NULL
);
CREATE INDEX events_by_appt ON queue_events(appointment_id);

-- Журнал действий сотрудников: кто, когда, что изменил и почему. Только INSERT.
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  staff_role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_id TEXT,
  before_status TEXT,
  after_status TEXT,
  reason TEXT,
  at TEXT NOT NULL
);
CREATE INDEX audit_by_clinic ON audit_logs(clinic_id, at);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
