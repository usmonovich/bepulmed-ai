import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthorizeUrl,
  dmedConfig,
  exchangeCode,
  loadDmed,
  matchFreeMed,
  parseAppointments,
  parseCallback,
  parsePatient,
  parsePrescriptions,
  pkceChallenge,
  sha256,
} from "./dmed";

const store: Record<string, string> = {};
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  (globalThis as any).localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => (store[k] = v), removeItem: (k: string) => delete store[k] };
});
const CFG = { VITE_DMED_CLIENT_ID: "bepulmed-test", VITE_DMED_REDIRECT: "uz.bepulmed.app:/oauth2redirect" };

describe("DMED: настройки", () => {
  it("без client_id модуль выключен", () => expect(dmedConfig({ VITE_DMED_CLIENT_ID: "" })).toBeNull());
  it("по умолчанию — тестовый контур DHP", () => {
    const c = dmedConfig(CFG)!;
    expect(c.fhirBase).toBe("https://playground.dhp.uz/fhir");
    expect(c.tokenUrl).toBe("https://sso.dhp.uz/oauth/token");
  });
  it("боевой контур", () => expect(dmedConfig({ ...CFG, VITE_DMED_ENV: "production" })!.fhirBase).toBe("https://fhir.dhp.uz"));
  it("посторонние и http-адреса запрещены", () => {
    expect(() => dmedConfig({ ...CFG, VITE_DMED_FHIR: "https://evil.example/fhir" })).toThrow(/dmed_host_not_allowed/);
    expect(() => dmedConfig({ ...CFG, VITE_DMED_SSO: "http://sso.dhp.uz" })).toThrow(/dmed_host_not_allowed/);
  });
});

describe("DMED: PKCE и вход", () => {
  it("SHA-256 совпадает с node:crypto", () => {
    for (const s of ["", "abc", "x".repeat(55), "y".repeat(64), "z".repeat(1000), "Привет DMED"]) {
      const want = createHash("sha256").update(s).digest("hex");
      expect(Buffer.from(sha256(new TextEncoder().encode(s))).toString("hex")).toBe(want);
    }
  });
  it("вектор из RFC 7636", () => expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"));
  it("ссылка входа: code + S256, без client_secret", () => {
    const u = new URL(buildAuthorizeUrl(dmedConfig(CFG)!));
    expect(u.origin + u.pathname).toBe("https://sso.dhp.uz/oauth/authorize");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("redirect_uri")).toBe("uz.bepulmed.app:/oauth2redirect");
    expect(u.searchParams.has("client_secret")).toBe(false);
    const pend = JSON.parse(store.bm_dmed_pending);
    expect(u.searchParams.get("code_challenge")).toBe(pkceChallenge(pend.verifier));
  });
  it("возврат: верный state → код; чужой state, просрочка, отказ — ошибки; повтор невозможен", () => {
    const u = new URL(buildAuthorizeUrl(dmedConfig(CFG)!, 1000));
    const st = u.searchParams.get("state");
    const pend = JSON.parse(store.bm_dmed_pending);
    expect(parseCallback(`uz.bepulmed.app:/oauth2redirect?code=C1&state=${st}`, 2000)).toEqual({ ok: true, code: "C1", verifier: pend.verifier });
    expect(parseCallback(`uz.bepulmed.app:/oauth2redirect?code=C1&state=${st}`, 2000)).toEqual({ ok: false, error: "expired" });
    buildAuthorizeUrl(dmedConfig(CFG)!, 1000);
    expect(parseCallback("uz.bepulmed.app:/oauth2redirect?code=C2&state=fake", 2000)).toEqual({ ok: false, error: "state_mismatch" });
    buildAuthorizeUrl(dmedConfig(CFG)!, 1000);
    expect(parseCallback("uz.bepulmed.app:/oauth2redirect?code=C3&state=x", 1000 + 11 * 60e3)).toEqual({ ok: false, error: "expired" });
    buildAuthorizeUrl(dmedConfig(CFG)!, 1000);
    expect(parseCallback("uz.bepulmed.app:/oauth2redirect?error=access_denied&state=x", 2000)).toEqual({ ok: false, error: "denied" });
    expect(parseCallback("https://app/?foo=1")).toBeNull();
  });
  it("обмен кода: form-urlencoded с code_verifier, без секрета", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ access_token: "AT", expires_in: 600, patient: "p1" }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const t = await exchangeCode(dmedConfig(CFG)!, "C1", "V1", 0);
    expect(t).toEqual({ access: "AT", expiresAt: 600000, patient: "p1" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sso.dhp.uz/oauth/token");
    const body = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(body)).toEqual({ grant_type: "authorization_code", code: "C1", redirect_uri: "uz.bepulmed.app:/oauth2redirect", client_id: "bepulmed-test", code_verifier: "V1" });
    expect(init.credentials).toBe("omit");
    vi.unstubAllGlobals();
  });
});

const R5_RX = {
  resourceType: "Bundle",
  entry: [
    { resource: { resourceType: "MedicationRequest", id: "m1", status: "active", authoredOn: "2026-11-10", medication: { concept: { text: "Метформин 850 мг" } }, dosageInstruction: [{ text: "по 1 таб. 2 раза в день" }], requester: { display: "Каримова Н." } } },
    { resource: { resourceType: "MedicationRequest", id: "m2", status: "completed", authoredOn: "2026-10-01", medication: { concept: { coding: [{ code: "X", display: "Парацетамол 500 мг" }] } } } },
    { resource: { resourceType: "MedicationRequest", id: "m3", status: "entered-in-error", authoredOn: "2026-11-11", medication: { concept: { text: "Ошибка" } } } },
  ],
};
const R4_RX = { entry: [{ resource: { resourceType: "MedicationRequest", id: "r4", status: "active", authoredOn: "2026-11-01", medicationCodeableConcept: { text: "Эналаприл 10 мг" } } }] };

describe("DMED: разбор FHIR", () => {
  it("рецепты R5 и R4, сортировка, ошибочные скрыты, бесплатные отмечены", () => {
    const r = parsePrescriptions(R5_RX);
    expect(r.map((x) => x.id)).toEqual(["m1", "m2"]);
    expect(r[0]).toMatchObject({ name: "Метформин 850 мг", dosage: "по 1 таб. 2 раза в день", requester: "Каримова Н.", date: "2026-11-10" });
    expect(r[0].free?.ru).toMatch(/етформин/);
    expect(r[1].free).toBeUndefined(); // парацетамола нет в перечне
    expect(parsePrescriptions(R4_RX)[0].name).toBe("Эналаприл 10 мг");
  });
  it("бесплатные: только точное совпадение МНН", () => {
    expect(matchFreeMed("Метформин 1000 мг")).toBeTruthy();
    expect(matchFreeMed("Витамин C")).toBeUndefined();
    expect(matchFreeMed("")).toBeUndefined();
  });
  it("пациент и поликлиника прикрепления", () => {
    expect(parsePatient({ id: "p1", name: [{ family: "Каримов", given: ["Алишер"] }], generalPractitioner: [{ reference: "Practitioner/9" }, { reference: "Organization/35" }] })).toEqual({ id: "p1", name: "Каримов Алишер", birthDate: undefined, gp: "Organization/35" });
  });
  it("записи: только предстоящие и не отменённые", () => {
    const now = Date.parse("2026-11-18T10:00:00Z");
    const b = { entry: [
      { resource: { resourceType: "Appointment", id: "a1", status: "booked", start: "2026-11-20T04:30:00Z", serviceType: [{ concept: { text: "Терапевт" } }], participant: [{ actor: { display: "Каримова Н." } }] } },
      { resource: { resourceType: "Appointment", id: "a2", status: "booked", start: "2026-11-01T04:30:00Z" } },
      { resource: { resourceType: "Appointment", id: "a3", status: "cancelled", start: "2026-11-21T04:30:00Z" } },
    ] };
    expect(parseAppointments(b, now)).toEqual([{ id: "a1", start: "2026-11-20T04:30:00Z", status: "booked", service: "Терапевт", who: "Каримова Н." }]);
  });
});

describe("DMED: загрузка", () => {
  it("читает пациента, поликлинику, рецепты, записи; токен только в заголовке", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push(url);
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer AT");
      const j = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
      if (url.endsWith("/Patient/p1")) return j({ resourceType: "Patient", id: "p1", name: [{ text: "Каримов Алишер" }], generalPractitioner: [{ reference: "Organization/35" }] });
      if (url.includes("/MedicationRequest?")) return j(R5_RX);
      if (url.includes("/Appointment?")) return j({ entry: [] });
      if (url.endsWith("/Organization/35")) return j({ resourceType: "Organization", name: "Семейная поликлиника №35", contact: [{ address: { text: "Чиланзар, 9 кв." }, telecom: [{ system: "phone", value: "+998 71 276-00-00" }] }] });
      return new Response("", { status: 404 });
    }));
    const d = await loadDmed(dmedConfig(CFG)!, { access: "AT", expiresAt: Date.now() + 60e3, patient: "p1" });
    expect(d.patient.name).toBe("Каримов Алишер");
    expect(d.clinic).toEqual({ name: "Семейная поликлиника №35", address: "Чиланзар, 9 кв.", phone: "+998 71 276-00-00" });
    expect(d.prescriptions).toHaveLength(2);
    expect(calls.every((u) => u.startsWith("https://playground.dhp.uz/fhir/"))).toBe(true);
    expect(calls.some((u) => u.includes("access_token") || u.includes("AT"))).toBe(false);
    vi.unstubAllGlobals();
  });
  it("без id пациента принимает только однозначный результат поиска", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ entry: [{ resource: { resourceType: "Patient", id: "a" } }, { resource: { resourceType: "Patient", id: "b" } }] }), { status: 200 })));
    await expect(loadDmed(dmedConfig(CFG)!, { access: "AT", expiresAt: Date.now() + 60e3 })).rejects.toThrow("patient_ambiguous");
    vi.unstubAllGlobals();
  });
  it("просроченный токен не используется", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(loadDmed(dmedConfig(CFG)!, { access: "AT", expiresAt: 1 })).rejects.toThrow("unauthorized");
    expect(f).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
