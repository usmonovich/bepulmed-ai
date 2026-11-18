import { useMemo, useRef, useState } from "react";
import { analyzeText, type Analysis, type LabRow } from "../lib/labs";
import { clearHistory, loadHistory, previousValue, readImage, readPdf, saveHistory, type SavedLab } from "../lib/docInput";

const copy = {
  ru: {
    eyebrow: "МЕДИЦИНСКИЕ ДОКУМЕНТЫ",
    title: "Сканер и разбор анализов, рецептов, выписок",
    intro: "Сфотографируйте бланк, выберите фото или PDF, либо вставьте текст. Всё распознаётся и разбирается на телефоне — работает без интернета.",
    camera: "Сфотографировать",
    gallery: "Фото или PDF",
    working: "Распознаю текст…",
    scan: "Распознать документ",
    preparing: "Подготовка распознавания…",
    processing: "Обрабатываю изображение…",
    done: "Распознавание завершено",
    retry: "Распознать ещё раз",
    clear: "Очистить",
    copy: "Копировать текст",
    extracted: "Распознанный текст",
    type: "Предполагаемый тип документа",
    prescription: "Рецепт или назначение",
    lab: "Результаты лабораторных анализов",
    document: "Медицинский документ",
    unknown: "Тип документа не определён",
    empty: "Текст не найден. Попробуйте сделать более чёткое фото при хорошем освещении.",
    limit: "Файл слишком большой. Максимальный размер — 10 МБ.",
    format: "Выберите изображение (JPG, PNG, WEBP) или PDF.",
    error: "Не удалось прочитать документ. Попробуйте другое фото или вставьте текст вручную.",
    privacyTitle: "Конфиденциальность",
    privacy: "Документ распознаётся и анализируется только на этом устройстве: никуда не отправляется (ни на сервер BepulMed, ни в ИИ). Результаты сохраняются, только если нажать «Сохранить на телефоне», и удаляются одной кнопкой. Не используйте чужие документы без разрешения.",
    safetyTitle: "Важно для безопасности",
    safety: "Распознавание может ошибаться в названиях препаратов, дозировках и числах — сверяйте разбор с оригиналом. Не начинайте, не отменяйте и не меняйте лечение по результату OCR. Сверьте данные с оригиналом и уточните назначения у врача или фармацевта.",
    noDiagnosis: "Разбор — подсказка, а не диагноз. Отклонение от нормы само по себе не означает болезнь; выводы делает врач.",
    selectHint: "Анализы крови и биохимия, сахар и HbA1c, холестерин, гормоны щитовидной железы, МНО; рецепты; выписки и заключения (диагноз, коды МКБ-10, рекомендации).",
    progress: "Прогресс",
  },
  uz: {
    eyebrow: "TIBBIY HUJJATLAR",
    title: "Tahlil, retsept va ko‘chirmalarni skanerlash va tahlil qilish",
    intro: "Blankni suratga oling, rasm yoki PDF tanlang yoki matnni qo‘ying. Hammasi telefonning o‘zida tanib olinadi va tahlil qilinadi — internetsiz ishlaydi.",
    camera: "Suratga olish",
    gallery: "Rasm yoki PDF",
    working: "Matn tanilmoqda…",
    scan: "Hujjatni tanish",
    preparing: "Tanib olish tayyorlanmoqda…",
    processing: "Rasm qayta ishlanmoqda…",
    done: "Matnni tanish tugadi",
    retry: "Qayta tanish",
    clear: "Tozalash",
    copy: "Matnni nusxalash",
    extracted: "Tanilgan matn",
    type: "Hujjatning taxminiy turi",
    prescription: "Retsept yoki tavsiya",
    lab: "Laboratoriya tahlillari natijalari",
    document: "Tibbiy hujjat",
    unknown: "Hujjat turi aniqlanmadi",
    empty: "Matn topilmadi. Yaxshi yorug‘likda aniqroq suratga oling.",
    limit: "Fayl juda katta. Maksimal hajm — 10 MB.",
    format: "Rasm (JPG, PNG, WEBP) yoki PDF tanlang.",
    error: "Hujjatni o‘qib bo‘lmadi. Boshqa rasm tanlang yoki matnni qo‘lda qo‘ying.",
    privacyTitle: "Maxfiylik",
    privacy: "Hujjat faqat shu qurilmada tanib olinadi va tahlil qilinadi: hech qayerga (BepulMed serveriga ham, sun’iy intellektga ham) yuborilmaydi. Natijalar faqat «Telefonda saqlash» bosilsa saqlanadi va bir tugma bilan o‘chiriladi. Ruxsatsiz boshqa odamning hujjatidan foydalanmang.",
    safetyTitle: "Xavfsizlik muhim",
    safety: "Tanib olishda dori nomlari, dozalar va raqamlarda xato bo‘lishi mumkin — tahlilni asl hujjat bilan solishtiring. OCR natijasiga qarab davolanishni boshlamang, to‘xtatmang yoki o‘zgartirmang. Ma’lumotlarni asl hujjat bilan solishtiring va shifokor yoki farmatsevt bilan aniqlashtiring.",
    noDiagnosis: "Tahlil — maslahat, tashxis emas. Me’yordan chetlanish o‘z-o‘zidan kasallik degani emas; xulosani shifokor qiladi.",
    selectHint: "Qon va bioximiya tahlillari, qand va HbA1c, xolesterin, qalqonsimon bez gormonlari, XMN; retseptlar; ko‘chirma va xulosalar (tashxis, XKT-10 kodlari, tavsiyalar).",
    progress: "Jarayon",
  },
} as const;


const X = {
  ru: {
    paste: "Вставить текст",
    pasteHint: "Вставьте текст анализа или выписки (например, из DMED, PDF или сообщения лаборатории)",
    analyze: "Разобрать",
    pdfRead: "Читаю PDF…",
    analysis: "Разбор документа",
    labs: "Показатели",
    found: (n: number, a: number) => `Найдено показателей: ${n}${a ? `, вне нормы: ${a}` : ", все в пределах нормы"}`,
    none: "Показатели анализов не распознаны. Проверьте текст ниже — его можно исправить и нажать «Разобрать».",
    st: { low: "ниже нормы", normal: "в норме", high: "выше нормы", "critical-low": "критически низко", "critical-high": "критически высоко", unknown: "норма не указана" },
    normDoc: "норма по бланку",
    normBuiltin: "ориентир для взрослых (на бланке нормы нет)",
    urgentTitle: "Есть критическое значение",
    urgent: "Такие значения требуют срочной медицинской помощи. Если самочувствие плохое — звоните 103. Если чувствуете себя нормально — в тот же день свяжитесь с врачом, назначившим анализ: возможна ошибка распознавания или лаборатории.",
    call: "🚑 Позвонить 103",
    doctor: "К кому обратиться",
    find: "Найти врача",
    rx: "Лекарства в документе",
    free: "бесплатно по госпрограмме",
    notFree: "нет в перечне бесплатных",
    dx: "Диагноз / заключение",
    icd: "Коды МКБ-10",
    rec: "Рекомендации",
    dates: "Даты",
    save: "💾 Сохранить на телефоне",
    saved: "Сохранено на этом устройстве",
    clearHist: "Удалить сохранённые",
    prev: "раньше",
    edit: "Распознанный текст (можно исправить)",
    kind: { lab: "Результаты анализов", prescription: "Рецепт / назначение", discharge: "Выписка / заключение", document: "Медицинский документ", unknown: "Тип не определён" },
    pdfScan: "PDF без текста — распознал как скан",
    sources: "Критические значения — по спискам лабораторий (UChicago Medicine, Mayo Clinic Labs); глюкоза и HbA1c — критерии ADA.",
  },
  uz: {
    paste: "Matnni qo‘yish",
    pasteHint: "Tahlil yoki ko‘chirma matnini qo‘ying (masalan, DMED, PDF yoki laboratoriya xabaridan)",
    analyze: "Tahlil qilish",
    pdfRead: "PDF o‘qilmoqda…",
    analysis: "Hujjat tahlili",
    labs: "Ko‘rsatkichlar",
    found: (n: number, a: number) => `Topilgan ko‘rsatkichlar: ${n}${a ? `, me’yordan tashqari: ${a}` : ", hammasi me’yorda"}`,
    none: "Tahlil ko‘rsatkichlari topilmadi. Quyidagi matnni tekshiring — tuzatib, «Tahlil qilish»ni bosing.",
    st: { low: "me’yordan past", normal: "me’yorda", high: "me’yordan yuqori", "critical-low": "o‘ta past", "critical-high": "o‘ta yuqori", unknown: "me’yor ko‘rsatilmagan" },
    normDoc: "blankdagi me’yor",
    normBuiltin: "kattalar uchun mo‘ljal (blankda me’yor yo‘q)",
    urgentTitle: "O‘ta xavfli qiymat bor",
    urgent: "Bunday qiymatlar shoshilinch tibbiy yordamni talab qiladi. Ahvolingiz yomon bo‘lsa — 103 ga qo‘ng‘iroq qiling. O‘zingizni yaxshi his qilsangiz — shu kuni tahlilni buyurgan shifokor bilan bog‘laning: tanib olish yoki laboratoriya xatosi bo‘lishi mumkin.",
    call: "🚑 103 ga qo‘ng‘iroq",
    doctor: "Kimga murojaat qilish",
    find: "Shifokorni topish",
    rx: "Hujjatdagi dorilar",
    free: "davlat dasturi bo‘yicha bepul",
    notFree: "bepul ro‘yxatda yo‘q",
    dx: "Tashxis / xulosa",
    icd: "XKT-10 kodlari",
    rec: "Tavsiyalar",
    dates: "Sanalar",
    save: "💾 Telefonda saqlash",
    saved: "Shu qurilmada saqlandi",
    clearHist: "Saqlanganlarni o‘chirish",
    prev: "avval",
    edit: "Tanilgan matn (tuzatish mumkin)",
    kind: { lab: "Tahlil natijalari", prescription: "Retsept / tavsiya", discharge: "Ko‘chirma / xulosa", document: "Tibbiy hujjat", unknown: "Turi aniqlanmadi" },
    pdfScan: "Matnsiz PDF — skan sifatida tanildi",
    sources: "O‘ta xavfli qiymatlar — laboratoriyalar ro‘yxatlari bo‘yicha (UChicago Medicine, Mayo Clinic Labs); glyukoza va HbA1c — ADA mezonlari.",
  },
} as const;

/** Специалист → текст для поиска в справочнике (Directory понимает специальности по словам). */
const DOCTOR: Record<NonNullable<LabRow["analyte"]["doctor"]>, { ru: string; uz: string; q: string }> = {
  family: { ru: "Семейный врач (без направления)", uz: "Oilaviy shifokor (yo‘llanmasiz)", q: "семейный врач" },
  endocrinology: { ru: "Эндокринолог — по направлению семейного врача", uz: "Endokrinolog — oilaviy shifokor yo‘llanmasi bilan", q: "эндокринолог" },
  cardiology: { ru: "Кардиолог — по направлению семейного врача", uz: "Kardiolog — oilaviy shifokor yo‘llanmasi bilan", q: "кардиолог" },
  nephrology: { ru: "Нефролог — по направлению семейного врача", uz: "Nefrolog — oilaviy shifokor yo‘llanmasi bilan", q: "семейный врач" },
  gastro: { ru: "Гастроэнтеролог — по направлению семейного врача", uz: "Gastroenterolog — oilaviy shifokor yo‘llanmasi bilan", q: "семейный врач" },
  hematology: { ru: "Гематолог — по направлению семейного врача", uz: "Gematolog — oilaviy shifokor yo‘llanmasi bilan", q: "семейный врач" },
};

const fmt = (n: number) => (Math.round(n * 100) / 100).toString().replace(".", ",");

function statusColor(s: LabRow["status"]) {
  if (s.startsWith("critical")) return "bg-red-600 text-white";
  if (s === "low" || s === "high") return "bg-amber-100 text-amber-900";
  if (s === "normal") return "bg-emerald-100 text-emerald-900";
  return "bg-gray-100 text-gray-700";
}

export function MedicalScanner({ lang, onSos, onFindDoctor }: { lang: "ru" | "uz"; onSos?: () => void; onFindDoctor?: (query: string) => void }) {
  const L = copy[lang];
  const T = X[lang];
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [text, setText] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [history, setHistory] = useState<SavedLab[]>(() => loadHistory());
  const [savedNow, setSavedNow] = useState(false);

  function reset() {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview("");
    setText("");
    setAnalysis(null);
    setStatus("");
    setProgress(0);
    setError("");
    setSavedNow(false);
    if (cameraRef.current) cameraRef.current.value = "";
    if (galleryRef.current) galleryRef.current.value = "";
  }

  function choose(next: File | undefined) {
    if (!next) return;
    setError("");
    const isPdf = next.type === "application/pdf" || /\.pdf$/i.test(next.name);
    if (next.size > 10 * 1024 * 1024) return setError(L.limit);
    if (!next.type.startsWith("image/") && !isPdf) return setError(L.format);
    if (preview) URL.revokeObjectURL(preview);
    setFile(next);
    setPreview(isPdf ? "" : URL.createObjectURL(next));
    setText("");
    setAnalysis(null);
    setStatus("");
    setProgress(0);
    setSavedNow(false);
  }

  function run(t: string) {
    setText(t);
    setAnalysis(t.trim() ? analyzeText(t) : null);
    setSavedNow(false);
  }

  async function recognize() {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    setProgress(0);
    setStatus(L.preparing);
    const onProgress = (stage: "prepare" | "ocr" | "pdf", pct: number) => {
      setStatus(stage === "pdf" ? T.pdfRead : stage === "ocr" ? L.processing : L.preparing);
      setProgress(pct);
    };
    try {
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      let recognized: string;
      let note = "";
      if (isPdf) {
        const r = await readPdf(file, onProgress);
        recognized = r.text;
        if (r.ocr) note = ` · ${T.pdfScan}`;
      } else recognized = await readImage(file, onProgress);
      run(recognized.trim());
      setStatus(L.done + note);
      if (!recognized.trim()) setError(L.empty);
    } catch {
      setError(L.error);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function copyText() {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setError(lang === "ru" ? "Не удалось скопировать текст в этом браузере." : "Bu brauzerda matnni nusxalab bo‘lmadi.");
    }
  }

  function save() {
    if (!analysis?.labs.length) return;
    const values: Record<string, number> = {};
    for (const r of analysis.labs) if (r.canonical != null) values[r.analyte.id] = r.canonical;
    setHistory(saveHistory({ at: new Date().toISOString(), values }));
    setSavedNow(true);
  }

  // «Раньше» — последнее сохранённое ДО текущего разбора
  const prevHistory = useMemo(() => (savedNow ? history.slice(0, -1) : history), [history, savedNow]);
  const doctors = useMemo(() => {
    const set = new Set<keyof typeof DOCTOR>();
    for (const r of analysis?.labs ?? []) if (r.status !== "normal" && r.status !== "unknown" && r.analyte.doctor) set.add(r.analyte.doctor);
    return [...set];
  }, [analysis]);

  return (
    <div className="h-full overflow-y-auto p-3 pb-5">
      <div className="rounded-2xl bg-[var(--card)] p-4">
        <div className="mb-2 text-[10px] font-bold tracking-[0.16em] text-[var(--link)]">{L.eyebrow}</div>
        <h1 className="text-xl font-bold leading-tight">{L.title}</h1>
        <p className="mt-2 text-sm text-[var(--hint)]">{L.intro}</p>
        <p className="mt-2 text-xs text-[var(--hint)]">{L.selectHint}</p>

        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => choose(e.target.files?.[0])} />
        <input ref={galleryRef} type="file" accept="image/*,application/pdf,.pdf" className="hidden" onChange={(e) => choose(e.target.files?.[0])} />

        <div className="mt-4 grid grid-cols-3 gap-2">
          <button onClick={() => cameraRef.current?.click()} className="rounded-xl bg-[var(--btn)] px-2 py-3 text-xs font-semibold text-[var(--btn-text)]">
            📷 {L.camera}
          </button>
          <button onClick={() => galleryRef.current?.click()} className="rounded-xl border border-black/15 px-2 py-3 text-xs font-semibold">
            🖼️ {L.gallery}
          </button>
          <button onClick={() => setPasteOpen((v) => !v)} className="rounded-xl border border-black/15 px-2 py-3 text-xs font-semibold" data-testid="paste-toggle">
            📝 {T.paste}
          </button>
        </div>

        {pasteOpen && (
          <div className="mt-3">
            <textarea data-testid="paste-text" placeholder={T.pasteHint} className="min-h-32 w-full rounded-xl border border-black/10 bg-white p-3 text-sm outline-none" id="bm-paste" />
            <button
              onClick={() => {
                const v = (document.getElementById("bm-paste") as HTMLTextAreaElement | null)?.value ?? "";
                setFile(null);
                setPreview("");
                setError("");
                run(v);
                setStatus("");
              }}
              className="mt-2 w-full rounded-lg bg-[var(--btn)] px-3 py-2 text-sm font-semibold text-[var(--btn-text)]"
            >
              {T.analyze}
            </button>
          </div>
        )}

        {file && (
          <div className="mt-4 overflow-hidden rounded-xl border border-black/10">
            {preview ? <img src={preview} alt="Предпросмотр медицинского документа" className="max-h-72 w-full bg-white object-contain" /> : <div className="bg-white p-4 text-sm">📄 {file.name}</div>}
            <div className="flex gap-2 p-2">
              <button disabled={busy} onClick={() => void recognize()} className="flex-1 rounded-lg bg-[var(--btn)] px-3 py-2 text-sm font-semibold text-[var(--btn-text)] disabled:opacity-50">
                {busy ? L.working : text ? L.retry : L.scan}
              </button>
              <button disabled={busy} onClick={reset} className="rounded-lg border border-black/15 px-3 py-2 text-sm">{L.clear}</button>
            </div>
          </div>
        )}

        {busy && (
          <div className="mt-3">
            <div className="flex justify-between text-xs text-[var(--hint)]"><span>{status}</span><span>{progress}%</span></div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-black/10">
              <div className="h-full rounded-full bg-[var(--link)] transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
        {!busy && status && <p className="mt-3 text-xs text-[var(--link)]">{status}</p>}
        {error && <p role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
      </div>

      {analysis && (
        <div className="mt-3 rounded-2xl border border-black/10 p-4" data-testid="analysis">
          <div className="text-xs font-semibold text-[var(--hint)]">{L.type}</div>
          <div className="mt-1 text-sm font-semibold" data-testid="doc-kind">{T.kind[analysis.kind]}</div>

          {analysis.urgent && (
            <div className="mt-3 rounded-xl bg-red-600 p-3 text-white" role="alert" data-testid="urgent">
              <div className="font-bold">⚠️ {T.urgentTitle}</div>
              <p className="mt-1 text-xs leading-relaxed">{T.urgent}</p>
              <div className="mt-2 flex gap-2">
                <a href="tel:103" className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-red-700">{T.call}</a>
                {onSos && <button onClick={onSos} className="rounded-lg border border-white/60 px-3 py-2 text-xs font-semibold">SOS</button>}
              </div>
            </div>
          )}

          {(analysis.labs.length > 0 || analysis.kind === "lab") && (
            <>
              <h2 className="mt-4 font-bold">{T.labs}</h2>
              <p className="text-xs text-[var(--hint)]" data-testid="lab-summary">{analysis.labs.length ? T.found(analysis.labs.length, analysis.abnormal) : T.none}</p>
              <ul className="mt-2 space-y-2">
                {analysis.labs.map((r) => {
                  const name = lang === "uz" ? r.analyte.uz : r.analyte.ru;
                  const unit = r.unit ?? (r.range?.from === "builtin" ? r.analyte.unit : "");
                  const prev = r.canonical != null ? previousValue(prevHistory, r.analyte.id) : null;
                  const expl = r.status === "low" || r.status === "critical-low" ? r.analyte.low : r.status === "high" || r.status === "critical-high" ? r.analyte.high : undefined;
                  return (
                    <li key={r.analyte.id} className="rounded-xl bg-[var(--card)] p-3" data-testid={`lab-${r.analyte.id}`} data-status={r.status}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-semibold">{name}</div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusColor(r.status)}`}>{T.st[r.status]}</span>
                      </div>
                      <div className="mt-1 text-sm">
                        <b>{fmt(r.value)}</b> {unit}
                        {r.range && (
                          <span className="text-xs text-[var(--hint)]">
                            {" "}· {r.range.low != null && r.range.high != null ? `${fmt(r.range.low)}–${fmt(r.range.high)}` : r.range.high != null ? `≤ ${fmt(r.range.high)}` : `≥ ${fmt(r.range.low!)}`}{" "}
                            {r.range.from === "builtin" ? `${r.analyte.unit} (${T.normBuiltin})` : `(${T.normDoc})`}
                          </span>
                        )}
                      </div>
                      {prev && (
                        <div className="mt-1 text-xs text-[var(--hint)]">
                          {T.prev} ({new Date(prev.at).toLocaleDateString(lang === "uz" ? "uz-UZ" : "ru-RU")}): {fmt(prev.value)} {r.analyte.unit}{" "}
                          {r.canonical! > prev.value ? "↑" : r.canonical! < prev.value ? "↓" : "="}
                        </div>
                      )}
                      {expl && <p className="mt-1 text-xs leading-relaxed">{lang === "uz" ? expl.uz : expl.ru}</p>}
                    </li>
                  );
                })}
              </ul>
              {doctors.length > 0 && (
                <div className="mt-3 rounded-xl border border-black/10 p-3" data-testid="doctors">
                  <div className="text-sm font-bold">👩‍⚕️ {T.doctor}</div>
                  {doctors.map((d) => (
                    <div key={d} className="mt-2 flex items-center justify-between gap-2 text-xs">
                      <span>{lang === "uz" ? DOCTOR[d].uz : DOCTOR[d].ru}</span>
                      {onFindDoctor && <button onClick={() => onFindDoctor(DOCTOR[d].q)} className="shrink-0 rounded-lg border border-black/15 px-2 py-1 font-semibold">{T.find}</button>}
                    </div>
                  ))}
                </div>
              )}
              {analysis.labs.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button disabled={savedNow} onClick={save} className="rounded-lg border border-black/15 px-3 py-2 text-xs font-semibold disabled:opacity-60" data-testid="save-labs">
                    {savedNow ? `✓ ${T.saved}` : T.save}
                  </button>
                  {history.length > 0 && (
                    <button onClick={() => { clearHistory(); setHistory([]); setSavedNow(false); }} className="rounded-lg px-3 py-2 text-xs text-[var(--hint)] underline">
                      {T.clearHist} ({history.length})
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {analysis.rx.length > 0 && (
            <>
              <h2 className="mt-4 font-bold">💊 {T.rx}</h2>
              <ul className="mt-2 space-y-1" data-testid="rx">
                {analysis.rx.map((m, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--card)] px-3 py-2 text-sm">
                    <span>{m.name}{m.dose ? <span className="text-xs text-[var(--hint)]"> · {m.dose}</span> : null}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${m.free ? "bg-emerald-100 text-emerald-900" : "bg-gray-100 text-gray-600"}`}>{m.free ? T.free : T.notFree}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {(analysis.doc.diagnosis.length > 0 || analysis.doc.icd.length > 0 || analysis.doc.recommendations.length > 0) && (
            <div data-testid="discharge">
              {analysis.doc.diagnosis.length > 0 && (
                <>
                  <h2 className="mt-4 font-bold">🩺 {T.dx}</h2>
                  {analysis.doc.diagnosis.map((d, i) => <p key={i} className="mt-1 text-sm">{d}</p>)}
                </>
              )}
              {analysis.doc.icd.length > 0 && (
                <>
                  <h2 className="mt-4 font-bold">{T.icd}</h2>
                  <ul className="mt-1 space-y-1">
                    {analysis.doc.icd.map((c) => (
                      <li key={c.code} className="text-sm"><b>{c.code}</b> — {lang === "uz" ? c.chapter.uz : c.chapter.ru}</li>
                    ))}
                  </ul>
                </>
              )}
              {analysis.doc.recommendations.length > 0 && (
                <>
                  <h2 className="mt-4 font-bold">📋 {T.rec}</h2>
                  <ul className="mt-1 list-disc pl-5 text-sm">
                    {analysis.doc.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </>
              )}
              {analysis.doc.dates.length > 0 && <p className="mt-2 text-xs text-[var(--hint)]">{T.dates}: {analysis.doc.dates.join(", ")}</p>}
            </div>
          )}

          <p className="mt-4 text-xs text-[var(--hint)]">{L.noDiagnosis}</p>
          <p className="mt-1 text-[10px] text-[var(--hint)]">{T.sources}</p>
        </div>
      )}

      {text && (
        <div className="mt-3 rounded-2xl border border-black/10 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-bold">{T.edit}</h2>
            <button onClick={() => void copyText()} className="rounded-lg border border-black/15 px-3 py-2 text-xs font-medium">📋 {L.copy}</button>
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} className="mt-2 min-h-56 w-full resize-y rounded-xl bg-[var(--card)] p-3 text-sm leading-relaxed outline-none" data-testid="ocr-text" />
          <button onClick={() => run(text)} className="mt-2 rounded-lg bg-[var(--btn)] px-3 py-2 text-xs font-semibold text-[var(--btn-text)]">{T.analyze}</button>
        </div>
      )}

      <div className="mt-3 rounded-2xl border border-amber-300/60 bg-amber-50 p-4 text-amber-950">
        <div className="text-sm font-bold">⚠️ {L.safetyTitle}</div>
        <p className="mt-1 text-xs leading-relaxed">{L.safety}</p>
      </div>
      <div className="mt-3 rounded-2xl bg-[var(--card)] p-4">
        <div className="text-sm font-bold">🔒 {L.privacyTitle}</div>
        <p className="mt-1 text-xs leading-relaxed text-[var(--hint)]">{L.privacy}</p>
      </div>
    </div>
  );
}
