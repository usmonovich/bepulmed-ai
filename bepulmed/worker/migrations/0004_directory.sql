-- Открытый справочник врачей: связь подключённой клиники с учреждением из справочника приложения
-- (id из web/src/data/tashkentFacilities.ts, например «fp35»). Расписание — doctor_schedules.
ALTER TABLE clinics ADD COLUMN facility_ref TEXT;
CREATE INDEX clinics_by_facility ON clinics(facility_ref);
-- Когда регистратура последний раз подтвердила расписание (показывается пациенту).
ALTER TABLE doctors ADD COLUMN schedule_checked_at TEXT;
