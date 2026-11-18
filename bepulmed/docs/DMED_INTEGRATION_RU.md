# DMED — подключение (2.8)

## Статус
Код готов, **подключение выключено**, пока приложение не зарегистрировано на SSO DMED.
Без регистрации ни один запрос в DMED не отправляется (экран DMED показывает «не подключено»).

## Основа — официальная спецификация
Руководство «Цифровая платформа здравоохранения Узбекистана» (Uzinfocom, Минздрав; FHIR, раздел API access):
- FHIR: `https://playground.dhp.uz/fhir` (тест), `https://fhir.dhp.uz` (боевой).
- Вход: OAuth 2.0 через `sso.dhp.uz`; для приложения без своего сервера — authorization code + PKCE.
- Клиент регистрируется на SSO и получает `client_id` и `redirect_uri`. Процедура регистрации в руководстве не описана.

## Что нужно получить у Uzinfocom / DMED (+998 71 202 50 00, info@dmed.uz)
1. Регистрацию клиента: `client_id`, разрешённый `redirect_uri` = `uz.bepulmed.app:/oauth2redirect`
   (для веб-версии — адрес Mini App).
2. Точные адреса `authorize` и `token` (в руководстве указан только путь `/oauth/token`; в коде заданы
   `https://sso.dhp.uz/oauth/authorize` и `https://sso.dhp.uz/oauth/token`, меняются переменными сборки).
3. Scopes для чтения пациентом своих данных и как SSO сообщает id пациента (поле `patient` в ответе токена
   поддерживается; без него приложение ищет `Patient` и принимает только однозначный результат).
4. Доступ к тестовому контуру и тестовые учётные записи.
5. Партнёрское соглашение, требования к согласию, аудиту и сертификации.

## Как включить
```sh
# bepulmed/web/.env.production.local  (не коммитить)
VITE_DMED_CLIENT_ID=<выдал Uzinfocom>
VITE_DMED_ENV=playground            # или production
# при необходимости:
# VITE_DMED_AUTHORIZE_URL=https://sso.dhp.uz/...
# VITE_DMED_TOKEN_URL=https://sso.dhp.uz/...
# VITE_DMED_SCOPE=openid
```
Затем пересобрать веб и приложения (`BepulMedAndroid/build.sh`, `BepulMedIOS/prepare_www.sh`).

## Что делает приложение
- Экран согласия → вход на сайте DMED (Android — системный браузер, iOS — ASWebAuthenticationSession).
- Только чтение FHIR: `Patient`, поликлиника прикрепления (`generalPractitioner` → `Organization`),
  `MedicationRequest` (электронные рецепты), `Appointment` (предстоящие записи). Поддержаны R5 и R4.
- Рецепты сверяются с перечнем бесплатных лекарств (приказ МЗ № 18 от 23.04.2026) — отметка «бесплатно по программе».
- Токен и данные — только в памяти; не сохраняются, не уходят на сервер BepulMed и во внешний ИИ.
- Хосты — только `*.dhp.uz`, `*.medcore.uz`, https. ПИНФЛ не запрашивается.
- Код: `web/src/lib/dmed.ts`, `web/src/components/Dmed.tsx`; нативно — `MainActivity.java` (openAuth, http,
  intent-filter), `NativeBridge.swift` (openAuth, http). Тесты: `web/src/lib/dmed.test.ts`.

## Ограничения
- С настоящим SSO/FHIR DMED не проверялось (нет регистрации). Проверено на поддельных sso/fhir в e2e.
- Запись к врачу через DMED (создание `Appointment`) не делалась — нужно отдельное разрешение (scopes на запись).
