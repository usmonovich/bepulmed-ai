-- ДЕМОНСТРАЦИОННЫЕ данные: вымышленная клиника и врачи. Не реальные люди и не реальное учреждение.
INSERT INTO clinics (id, name_ru, name_uz, kind, address, phone, lat, lon, is_demo, connected) VALUES
  ('demo-clinic', 'Демо-клиника BepulMed (вымышленная)', 'BepulMed demo-klinikasi (shartli)', 'clinic',
   'Тестовый адрес, Ташкент', NULL, 41.3135, 69.2795, 1, 1);

INSERT INTO doctors (id, clinic_id, full_name, specialty, room, ticket_prefix) VALUES
  ('doc-therapy', 'demo-clinic', 'Демо-врач А. (терапевт)', 'therapy', '101', 'T'),
  ('doc-cardio',  'demo-clinic', 'Демо-врач Б. (кардиолог)', 'cardiology', '205', 'K');

-- Пн–Сб 08:00–18:00: терапевт по 15 минут, кардиолог по 20 минут. Воскресенье — выходной.
INSERT INTO doctor_schedules (doctor_id, weekday, start_min, end_min, slot_minutes) VALUES
  ('doc-therapy',0,480,1080,15),('doc-therapy',1,480,1080,15),('doc-therapy',2,480,1080,15),
  ('doc-therapy',3,480,1080,15),('doc-therapy',4,480,1080,15),('doc-therapy',5,480,1080,15),
  ('doc-cardio',0,480,1080,20),('doc-cardio',1,480,1080,20),('doc-cardio',2,480,1080,20),
  ('doc-cardio',3,480,1080,20),('doc-cardio',4,480,1080,20),('doc-cardio',5,480,1080,20);
