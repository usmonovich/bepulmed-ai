# BepulMed AI

**Открыть веб-версию:** https://usmonovich.github.io/bepulmed-ai/ · **APK:** раздел [Releases](https://github.com/usmonovich/bepulmed-ai/releases)

Медицинский навигатор для Узбекистана (Ташкент): Telegram Mini App, Android APK и iOS.
Работает в основном без интернета: карта, справочник поликлиник и врачей, первая помощь,
бесплатные лекарства по госпрограмме, офлайн-сканер и разбор анализов, рецептов и выписок.

| Папка | Что внутри |
|---|---|
| `bepulmed/web` | Интерфейс (React + Vite + Tailwind) |
| `bepulmed/worker` | Сервер (Cloudflare Worker + D1) |
| `BepulMedAndroid` | Android-обёртка (WebView), сборка `build.sh` |
| `BepulMedIOS` | iOS-проект (WKWebView, Xcode / XcodeGen) |
| `.github/workflows` | Сборка APK и IPA в GitHub Actions |

Быстрый старт: `cd bepulmed/web && npm ci && npm run build`, затем `cd BepulMedAndroid && bash build.sh`.
Изменения по версиям — `CHANGELOG_*_RU.md`.
