import { describe, expect, it, vi } from "vitest";
import { openStatus, parseDgisSchedule, parseOsmHours, statusText, tashkentClock, weekText } from "../src/hours";
import { checkPublicQuery } from "../src/publicQuery";
import { buildDgisUrl, lookup2gis, mapDgis } from "../src/places2gis";
import worker, { type Env } from "../src/index";

// Ср 18.11.2026 в Ташкенте = UTC+5
const at = (iso: string) => Date.parse(iso + "+05:00");

describe("часы работы", () => {
  it("ташкентское время", () => expect(tashkentClock(at("2026-11-18T10:30:00"))).toEqual({ day: 2, min: 630 }));
  it("будни и суббота", () => {
    const w = parseOsmHours("Mo-Fr 08:00-18:00; Sa 09:00-14:00")!;
    expect(statusText(openStatus(w, at("2026-11-19T10:00:00")), "ru")).toBe("Открыто до 18:00");
    expect(statusText(openStatus(w, at("2026-11-19T17:45:00")), "ru")).toBe("Открыто до 18:00 · скоро закроется");
    expect(statusText(openStatus(w, at("2026-11-19T19:00:00")), "ru")).toBe("Закрыто · откроется завтра в 08:00");
    expect(statusText(openStatus(w, at("2026-11-22T12:00:00")), "ru")).toBe("Закрыто · откроется завтра в 08:00"); // Вс → Пн
    expect(statusText(openStatus(w, at("2026-11-21T07:00:00")), "ru")).toBe("Закрыто · откроется сегодня в 09:00");
    expect(weekText(w, "ru")).toBe("Пн–Пт 08:00–18:00, Сб 09:00–14:00, Вс выходной");
  });
  it("круглосуточно и после полуночи", () => {
    expect(statusText(openStatus(parseOsmHours("24/7")!, at("2026-11-19T03:00:00")), "ru")).toBe("Круглосуточно");
    expect(weekText(parseOsmHours("24/7")!, "ru")).toBe("Круглосуточно, без выходных");
    const late = parseOsmHours("Mo-Su 08:00-02:00")!;
    expect(statusText(openStatus(late, at("2026-11-20T01:00:00")), "ru")).toBe("Открыто до 02:00");
    expect(openStatus(late, at("2026-11-20T03:00:00")).open).toBe(false);
  });
  it("перерыв, перечисление дней, off, только время", () => {
    const w = parseOsmHours("Mo,We 09:00-13:00,14:00-18:00; Su off")!;
    expect(openStatus(w, at("2026-11-18T13:30:00")).open).toBe(false);
    expect(statusText(openStatus(w, at("2026-11-18T13:30:00")), "ru")).toBe("Закрыто · откроется сегодня в 14:00");
    expect(parseOsmHours("08:00-20:00")![6]).toEqual([[480, 1200]]);
  });
  it("непонятный формат — null (часы показываются текстом)", () => {
    expect(parseOsmHours("по записи")).toBeNull();
    expect(parseOsmHours("Mo-Fr 08:00-18:00; PH off")).not.toBeNull();
    expect(parseOsmHours("")).toBeNull();
  });
  it("расписание 2GIS", () => {
    const w = parseDgisSchedule({ Mon: { working_hours: [{ from: "08:00", to: "23:00" }] }, Wed: { working_hours: [{ from: "08:00", to: "23:00" }] } })!;
    expect(statusText(openStatus(w, at("2026-11-18T22:00:00")), "ru")).toBe("Открыто до 23:00");
    expect(openStatus(parseDgisSchedule({ is_24x7: true })!, Date.now()).open).toBe(true);
    expect(parseDgisSchedule({})).toBeNull();
  });
});

describe("онлайн-справка: наружу только общедоступный запрос", () => {
  it.each([
    ["pharmacy", "аптека", "chilonzor"],
    ["clinic", "Семейная поликлиника №35", undefined],
    ["pharmacy", "метформин", undefined],
    ["dentist", "стоматология", "yunusobod"],
  ])("пропускает %s «%s»", (kind, q, district) => {
    const r = checkPublicQuery({ kind, q, district });
    expect(r.ok).toBe(true);
  });
  it.each([
    ["у меня болит голова", "personal"],
    ["сыну 5 лет температура", "personal"],
    ["аптека для мамы", "personal"],
    ["bolam isitma", "personal"],
    ["позвоните +998 90 123 45 67", "pii"],
    ["31234567890123", "pii"],
    ["a@b.uz", "pii"],
    ["<script>", "invalid"],
    ["x".repeat(80), "invalid"],
  ])("не пропускает «%s» (%s)", (q, reason) => expect(checkPublicQuery({ kind: "pharmacy", q })).toEqual({ ok: false, reason }));
  it("неизвестный район отбрасывается, точные координаты не принимаются", () => {
    expect(checkPublicQuery({ kind: "pharmacy", q: "аптека", district: "41.2995,69.2401" })).toEqual({ ok: true, query: { kind: "pharmacy", q: "аптека", district: undefined } });
  });
});

const DGIS = {
  meta: { code: 200 },
  result: { items: [
    { id: "70000001", name: "Grand Pharm", address_name: "ул. Бунёдкор, 12", point: { lat: 41.28, lon: 69.2 }, rubrics: [{ name: "Аптеки" }], schedule: { is_24x7: true }, reviews: { general_rating: 4.63, general_review_count: 128 } },
    { id: "70000002", name: "Дори-Дармон №5", schedule: { Mon: { working_hours: [{ from: "08:00", to: "20:00" }] } }, reviews: {} },
  ] },
};

describe("2GIS", () => {
  it("запрос: центр района, без координат пользователя, ключ только в URL сервера", () => {
    const u = new URL(buildDgisUrl({ kind: "pharmacy", q: "аптека", district: "chilonzor" }, "K"));
    expect(u.host).toBe("catalog.api.2gis.com");
    expect(u.searchParams.get("point")).toBe("69.203,41.276");
    expect(u.searchParams.get("q")).toBe("аптека Ташкент");
    expect(u.searchParams.get("fields")).toContain("items.reviews");
  });
  it("разбор: рейтинг, отзывы, расписание, ссылка", () => {
    const [a, b] = mapDgis(DGIS);
    expect(a).toMatchObject({ name: "Grand Pharm", rating: 4.6, reviews: 128, rubrics: ["Аптеки"], link: "https://2gis.uz/tashkent/search/Grand%20Pharm" });
    expect(openStatus(a.week!, Date.now()).open).toBe(true);
    expect(b.rating).toBeUndefined();
  });
  it("ничего не найдено → пусто", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ meta: { code: 404 } }), { status: 200 }));
    expect(await lookup2gis({ kind: "pharmacy", q: "аптека" }, "K", f as unknown as typeof fetch)).toEqual([]);
  });
});

describe("/api/lookup", () => {
  const call = (qs: string, env: Partial<Env>) => worker.fetch(new Request(`https://x/api/lookup?${qs}`), env as Env, { waitUntil() {} } as unknown as ExecutionContext);
  it("личный запрос отклоняется до обращения к 2GIS", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const r = await call("kind=pharmacy&q=" + encodeURIComponent("у меня болит живот"), { DGIS_KEY: "K" });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "query_personal" });
    expect(f).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it("без ключа — 503, понятная ошибка", async () => {
    const r = await call("kind=pharmacy&q=аптека", {});
    expect(r.status).toBe(503);
  });
  it("с ключом — данные 2GIS", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(DGIS), { status: 200 })));
    const r = await call("kind=pharmacy&q=" + encodeURIComponent("аптека") + "&district=chilonzor", { DGIS_KEY: "K" });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { places: { name: string }[] };
    expect(j.places.map((p) => p.name)).toEqual(["Grand Pharm", "Дори-Дармон №5"]);
    vi.unstubAllGlobals();
  });
});

import { doctorsFromFhir, doctorsFromRows, toSpecialty } from "../src/doctors";

describe("справочник врачей", () => {
  it("специальности: коды, русские и узбекские названия", () => {
    expect(toSpecialty("neurology")).toBe("neurology");
    expect(toSpecialty("Врач-невропатолог")).toBe("neurology");
    expect(toSpecialty("nevrolog")).toBe("neurology");
    expect(toSpecialty("Neurology")).toBe("neurology");
    expect(toSpecialty("Акушер-гинеколог")).toBe("gynecology");
    expect(toSpecialty("непонятно")).toBe("other");
  });
  it("строки базы → неделя приёма", () => {
    const d = doctorsFromRows([
      { id: "a", full_name: "А", specialty: "neurology", room: "1", weekday: 0, start_min: 480, end_min: 720 },
      { id: "a", full_name: "А", specialty: "neurology", room: "1", weekday: 2, start_min: 480, end_min: 720 },
      { id: "b", full_name: "Б", specialty: "family", room: null, weekday: null, start_min: null, end_min: null },
    ]);
    expect(d.find((x) => x.id === "a")!.week![2]).toEqual([[480, 720]]);
    expect(d.find((x) => x.id === "b")!.week).toBeNull();
  });
  it("DMED / FHIR PractitionerRole: R4 availableTime и R5 availability", () => {
    const b = {
      entry: [
        { resource: { resourceType: "Practitioner", id: "p1", name: [{ family: "Юсупова", given: ["Малика"] }] } },
        { resource: { resourceType: "PractitionerRole", id: "r1", practitioner: { reference: "Practitioner/p1" }, specialty: [{ text: "Невролог" }], availableTime: [{ daysOfWeek: ["tue", "thu"], availableStartTime: "08:00:00", availableEndTime: "13:00:00" }] } },
        { resource: { resourceType: "PractitionerRole", id: "r2", practitioner: { display: "Каримова Н." }, specialty: [{ coding: [{ display: "General practice" }] }], availability: [{ availableTime: [{ daysOfWeek: ["mon", "tue", "wed", "thu", "fri", "sat"], availableStartTime: "08:00:00", availableEndTime: "20:00:00" }] }] } },
        { resource: { resourceType: "PractitionerRole", id: "r3", active: false, specialty: [{ text: "Хирург" }] } },
      ],
    };
    const d = doctorsFromFhir(b);
    expect(d).toHaveLength(2);
    expect(d[0]).toMatchObject({ name: "Юсупова Малика", specialty: "neurology", source: "dmed" });
    expect(d[0].week![1]).toEqual([[480, 780]]);
    expect(d[0].week![0]).toEqual([]);
    expect(d[1]).toMatchObject({ name: "Каримова Н.", specialty: "family" });
    expect(d[1].week![5]).toEqual([[480, 1200]]);
  });
});
