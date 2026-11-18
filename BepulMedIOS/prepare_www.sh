#!/bin/sh
# Собирает веб-интерфейс BepulMed и кладёт его в iOS-приложение (BepulMed/www).
set -e
cd "$(dirname "$0")"
WEB=../bepulmed/web
( cd "$WEB" && npm ci && npm run build )
rm -rf BepulMed/www
cp -R "$WEB/dist" BepulMed/www
rm -f BepulMed/www/sw.js   # service worker нужен только веб-версии
echo "✅ BepulMed/www готов ($(du -sh BepulMed/www | cut -f1)). Откройте BepulMed.xcodeproj в Xcode."
