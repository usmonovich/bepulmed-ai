-- Лист ожидания: если на день нет свободного времени, пациент встаёт в очередь на освобождение.
-- Когда запись отменяют, освободившееся время на OFFER_TTL минут удерживается для первого в листе.
CREATE TABLE waitlist (
  id TEXT PRIMARY KEY,
  doctor_id TEXT NOT NULL REFERENCES doctors(id),
  clinic_id TEXT NOT NULL REFERENCES clinics(id),
  local_date TEXT NOT NULL,
  patient_key TEXT NOT NULL,
  patient_label TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('telegram','demo','registry')),
  status TEXT NOT NULL CHECK (status IN ('waiting','offered','booked','cancelled','expired')),
  offered_slot_id INTEGER REFERENCES slots(id),
  offer_expires_at TEXT,
  appointment_id TEXT REFERENCES appointments(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Один пациент — одно место в листе на врача и день.
CREATE UNIQUE INDEX one_waitlist_per_patient_day ON waitlist(patient_key, doctor_id, local_date)
  WHERE status IN ('waiting','offered');
-- Одно освободившееся время — одно активное предложение (защита от гонки двух обработчиков).
CREATE UNIQUE INDEX one_offer_per_slot ON waitlist(offered_slot_id) WHERE status = 'offered';
CREATE INDEX waitlist_queue ON waitlist(doctor_id, local_date, status, created_at);
CREATE INDEX waitlist_by_patient ON waitlist(patient_key, status);
