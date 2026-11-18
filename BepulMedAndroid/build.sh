#!/usr/bin/env bash
# Сборка APK без Android Studio и Gradle: aapt2 + javac + dx + zipalign + apksigner.
# Ubuntu/Debian: sudo apt-get install aapt apksigner zipalign dalvik-exchange openjdk-17-jdk-headless
# Использование: ./build.sh [путь/к/bepulmed/web/dist]   → build/BepulMed-AI-<версия>.apk
set -euo pipefail
cd "$(dirname "$0")"

VERSION_NAME="2.13"
VERSION_CODE="33"
PKG="uz.bepulmed.app"
MIN_SDK=26
TARGET_SDK=34
WEB_DIST="${1:-../bepulmed/web/dist}"
OUT=build
APP=app/src/main

ANDROID_JAR="${ANDROID_JAR:-.cache/android-$TARGET_SDK.jar}"
if [ ! -f "$ANDROID_JAR" ]; then
  mkdir -p .cache
  echo "→ Скачиваю android.jar (API $TARGET_SDK)…"
  curl -fsSL -o "$ANDROID_JAR" "https://raw.githubusercontent.com/Sable/android-platforms/master/android-$TARGET_SDK/android.jar"
fi
DX="$(command -v dx || true)"; [ -z "$DX" ] && [ -x /usr/lib/android-sdk/build-tools/debian/dx ] && DX=/usr/lib/android-sdk/build-tools/debian/dx
D8="$(command -v d8 || true)"   # Android SDK (GitHub Actions): d8 вместо dx
[ -z "$DX" ] && [ -z "$D8" ] && { echo "Нет dx/d8"; exit 1; }
for t in aapt2 javac zipalign apksigner keytool; do command -v $t >/dev/null || { echo "Нет $t"; exit 1; }; done

# 1. Интерфейс в assets/www
if [ -f "$WEB_DIST/index.html" ]; then
  echo "→ Копирую интерфейс из $WEB_DIST"
  rm -rf "$APP/assets/www" && mkdir -p "$APP/assets/www" && cp -r "$WEB_DIST"/. "$APP/assets/www/"
fi
[ -f "$APP/assets/www/index.html" ] || { echo "Нет $APP/assets/www/index.html — соберите web: cd bepulmed/web && npm run build"; exit 1; }

rm -rf "$OUT" && mkdir -p "$OUT"/{gen,classes,res}

# 2. Ресурсы и манифест
sed "s|<manifest |<manifest package=\"$PKG\" |" "$APP/AndroidManifest.xml" > "$OUT/AndroidManifest.xml"
aapt2 compile --dir "$APP/res" -o "$OUT/res/res.zip"
aapt2 link -o "$OUT/unsigned.apk" -I "$ANDROID_JAR" --manifest "$OUT/AndroidManifest.xml" \
  --java "$OUT/gen" -A "$APP/assets" -0 pmtiles --min-sdk-version $MIN_SDK --target-sdk-version $TARGET_SDK \
  --version-code $VERSION_CODE --version-name $VERSION_NAME "$OUT/res/res.zip"

# 3. Java → class → dex
javac -nowarn -encoding UTF-8 -source 8 -target 8 -bootclasspath "$ANDROID_JAR" -classpath "$ANDROID_JAR" \
  -d "$OUT/classes" $(find "$APP/java" "$OUT/gen" -name '*.java') 2>&1 | grep -v "warning: \[options\]" || true
ls "$OUT/classes/uz/bepulmed/app/MainActivity.class" >/dev/null
if [ -n "$DX" ]; then
  "$DX" --dex --min-sdk-version=$MIN_SDK --output="$OUT/classes.dex" "$OUT/classes"
else
  mkdir -p "$OUT/dex" && "$D8" --min-api $MIN_SDK --lib "$ANDROID_JAR" --output "$OUT/dex" $(find "$OUT/classes" -name '*.class') && mv "$OUT/dex/classes.dex" "$OUT/classes.dex"
fi
(cd "$OUT" && zip -q unsigned.apk classes.dex)

# 4. Выравнивание и подпись
zipalign -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
KS="${KEYSTORE:-bepulmed-release.jks}"
if [ ! -f "$KS" ]; then
  echo "→ Создаю ключ подписи $KS (сохраните его: обновления APK подписываются тем же ключом)"
  keytool -genkeypair -keystore "$KS" -storepass "${KS_PASS:-bepulmed}" -keypass "${KS_PASS:-bepulmed}" -alias bepulmed \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=BepulMed AI, O=BepulMed, C=UZ" >/dev/null 2>&1
fi
APK="$OUT/BepulMed-AI-$VERSION_NAME.apk"
apksigner sign --ks "$KS" --ks-pass "pass:${KS_PASS:-bepulmed}" --ks-key-alias bepulmed --min-sdk-version $MIN_SDK --out "$APK" "$OUT/aligned.apk"
apksigner verify --min-sdk-version $MIN_SDK "$APK"
echo "✅ $APK ($(du -h "$APK" | cut -f1))"
