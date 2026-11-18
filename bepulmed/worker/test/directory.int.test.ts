// Открытый справочник врачей на настоящем локальном D1 (миграции применяет global-setup).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import worker, { type Env } from "../src/index";
import { openStatus } from "../src/hours";

let env: Env;
let dispose: () => Promise<void>;
const get = async (path: string, e: Env = env) => {
  const r = await worker.fetch(new Request(`https://t.dev${path}`), e, { waitUntil() {} } as unknown as ExecutionContext);
  return { status: r.status, body: (await r.json()) as any, headers: r.headers };
};

beforeAll(async () => {
  const p = await getPlatformProxy<Env>({ persist: { path: "/tmp/bepulmed-it/v3" } });
  env = { DB: p.env.DB } as Env; // запись НЕ одобрена: справочник врачей всё равно должен работать
  dispose = p.dispose;
  const db = env.DB!;
  await db.batch([
    db.prepare("DELETE FROM doctor_schedules WHERE doctor_id LIKE 'dir-%'"),
    db.prepare("DELETE FROM doctors WHERE id LIKE 'dir-%'"),
    db.prepare("DELETE FROM clinics WHERE id = 'dir-clinic'"),
    db.prepare("INSERT INTO clinics (id, name_ru, name_uz, kind, lat, lon, is_demo, connected, facility_ref) VALUES ('dir-clinic','СП №35','35-OP','clinic',41.28,69.2,0,1,'test-fp35')"),
    db.prepare("INSERT INTO doctors (id, clinic_id, full_name, specialty, room, ticket_prefix, schedule_checked_at) VALUES ('dir-neuro','dir-clinic','Юсупова М. А.','neurology','214','N','2026-11-17T09:00:00Z')"),
    db.prepare("INSERT INTO doctors (id, clinic_id, full_name, specialty, room, ticket_prefix) VALUES ('dir-fam','dir-clinic','Каримова Н. Т.','family','105','F')"),
    db.prepare("INSERT INTO doctor_schedules (doctor_id, weekday, start_min, end_min, slot_minutes) VALUES ('dir-neuro',1,480,780,15)"),
    db.prepare("INSERT INTO doctor_schedules (doctor_id, weekday, start_min, end_min, slot_minutes) VALUES ('dir-neuro',3,840,1080,15)"),
    db.prepare("INSERT INTO doctor_schedules (doctor_id, weekday, start_min, end_min, slot_minutes) VALUES ('dir-fam',0,480,1200,15)"),
  ]);
});
afterAll(async () => dispose?.());

describe("/api/directory/doctors", () => {
  it("врачи и часы приёма — даже когда запись выключена", async () => {
    const r = await get("/api/directory/doctors?facility=test-fp35");
    expect(r.status).toBe(200);
    expect(r.body.source).toBe("bepulmed");
    expect(r.body.checkedAt).toBe("2026-11-17T09:00:00Z");
    const neuro = r.body.doctors.find((d: any) => d.specialty === "neurology");
    expect(neuro).toMatchObject({ name: "Юсупова М. А.", room: "214" });
    expect(neuro.week[1]).toEqual([[480, 780]]); // вторник 08:00–13:00
    expect(neuro.week[3]).toEqual([[840, 1080]]); // четверг 14:00–18:00
    // 18.11.2026 — среда: невролог не принимает (приём во вторник и четверг)
    expect(openStatus(neuro.week, Date.parse("2026-11-18T10:00:00+05:00")).open).toBe(false);
    expect(r.headers.get("Cache-Control")).toContain("max-age");
  });
  it("в ответе нет ничего о пациентах", async () => {
    const r = await get("/api/directory/doctors?facility=test-fp35");
    const s = JSON.stringify(r.body);
    expect(s).not.toMatch(/patient|phone|telegram|ticket/i);
  });
  it("неизвестная поликлиника — пусто; мусор в параметре — 400", async () => {
    expect((await get("/api/directory/doctors?facility=nope")).body).toEqual({ doctors: [], source: null, checkedAt: null });
    expect((await get("/api/directory/doctors?facility=a%27%3B--")).status).toBe(400);
  });
  it("без базы — пусто, без ошибки", async () => {
    expect((await get("/api/directory/doctors?facility=test-fp35", {} as Env)).body).toEqual({ doctors: [], source: null });
  });
});

import { sha256Hex } from "../src/staff";

describe("PUT /api/staff/directory — регистратура публикует расписание", () => {
  const REG = "dirreg_" + "r".repeat(40);
  const DOC = "dirdoc_" + "d".repeat(40);
  const put = async (body: unknown, token: string) => {
    const r = await worker.fetch(new Request("https://t.dev/api/staff/directory", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }), env, { waitUntil() {} } as unknown as ExecutionContext);
    return { status: r.status, body: (await r.json()) as any };
  };
  beforeAll(async () => {
    const db = env.DB!;
    await db.batch([
      db.prepare("DELETE FROM clinic_staff WHERE id IN ('dir-s-reg','dir-s-doc')"),
      db.prepare("INSERT INTO clinic_staff (id, clinic_id, name, role, doctor_id, token_hash) VALUES ('dir-s-reg','dir-clinic','Регистратура','registrar',NULL,?)").bind(await sha256Hex(REG)),
      db.prepare("INSERT INTO clinic_staff (id, clinic_id, name, role, doctor_id, token_hash) VALUES ('dir-s-doc','dir-clinic','Врач','doctor','dir-neuro',?)").bind(await sha256Hex(DOC)),
    ]);
  });
  const WEEK = (a: number, b: number) => [[a, b], [a, b], [a, b], [a, b], [a, b], null, null];

  it("регистратор публикует — пациент сразу видит (запись при этом выключена)", async () => {
    const r = await put({ doctors: [{ id: "dir-neuro", fullName: "Юсупова М. А.", specialty: "neurology", room: "214", week: [null, [480, 780], null, [840, 1080], null, null, null] }, { fullName: "Азимов Ш.", specialty: "cardiology", room: "301", week: WEEK(840, 1080) }] }, REG);
    expect(r).toEqual({ status: 200, body: { published: 2 } });
    const g = await get("/api/directory/doctors?facility=test-fp35");
    expect(g.body.doctors.map((d: any) => d.name).sort()).toEqual(["Азимов Ш.", "Юсупова М. А."]); // «Каримова» снята с публикации
    expect(g.body.doctors.find((d: any) => d.specialty === "cardiology").week[0]).toEqual([[840, 1080]]);
    const log = await env.DB!.prepare("SELECT action, reason FROM audit_logs WHERE staff_id = 'dir-s-reg' ORDER BY id DESC LIMIT 1").first<any>();
    expect(log).toEqual({ action: "publish_directory", reason: "2 doctors" });
  });
  it("врач (не регистратура) публиковать не может; без токена — 401", async () => {
    expect((await put({ doctors: [] }, DOC)).status).toBe(403);
    expect((await put({ doctors: [] }, "x".repeat(30))).status).toBe(401);
  });
  it("ошибки данных и чужой врач отклоняются", async () => {
    expect((await put({ doctors: [{ fullName: "А", specialty: "neurology", week: WEEK(480, 600) }] }, REG)).body.error).toBe("bad_name");
    expect((await put({ doctors: [{ fullName: "Абв Где", specialty: "magic", week: WEEK(480, 600) }] }, REG)).body.error).toBe("bad_specialty");
    expect((await put({ doctors: [{ fullName: "Абв Где", specialty: "neurology", week: WEEK(600, 480) }] }, REG)).body.error).toBe("bad_time");
    expect((await put({ doctors: [{ id: "doc-therapy", fullName: "Чужой", specialty: "therapy", week: WEEK(480, 600) }] }, REG)).status).toBe(403);
  });
});

describe("GET /api/staff/directory", () => {
  it("регистратура видит свой список для редактирования", async () => {
    const r = await worker.fetch(new Request("https://t.dev/api/staff/directory", { headers: { Authorization: `Bearer ${"dirreg_" + "r".repeat(40)}` } }), env, { waitUntil() {} } as unknown as ExecutionContext);
    const b = (await r.json()) as any;
    expect(r.status).toBe(200);
    expect(b.clinic).toEqual({ name: "СП №35", facilityRef: "test-fp35" });
    expect(b.doctors.length).toBe(2);
  });
});
