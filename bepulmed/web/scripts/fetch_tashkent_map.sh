#!/usr/bin/env bash
# Скачивает офлайн-карту Ташкента (векторные тайлы, данные © OpenStreetMap, ODbL) из открытой
# ежедневной сборки Protomaps и кладёт в public/maps/ — дальше она попадает в APK/iOS.
# Нужен интернет (запускается в GitHub Actions или на вашем компьютере).
#   MAXZOOM=15 BBOX=69.05,41.13,69.52,41.47 ./scripts/fetch_tashkent_map.sh
set -euo pipefail
cd "$(dirname "$0")/.."
BBOX="${BBOX:-69.05,41.13,69.52,41.47}"     # Ташкент с окраинами (w,s,e,n)
MAXZOOM="${MAXZOOM:-15}"
OUT=public/maps
mkdir -p "$OUT" .cache

# 1. Утилита pmtiles (официальный релиз protomaps/go-pmtiles)
PM=.cache/pmtiles
if [ ! -x "$PM" ]; then
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) PAT='Linux_x86_64\.tar\.gz' ;; Linux-aarch64) PAT='Linux_arm64\.tar\.gz' ;;
    Darwin-arm64) PAT='Darwin_arm64\.zip' ;; Darwin-x86_64) PAT='Darwin_x86_64\.zip' ;; *) echo "Неизвестная платформа"; exit 1 ;;
  esac
  # В GitHub Actions — с токеном: без него общий IP раннеров упирается в лимит API (HTTP 403)
  AUTH=(); [ -n "${GITHUB_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer $GITHUB_TOKEN")
  URL=$(curl -fsSL --retry 3 "${AUTH[@]}" https://api.github.com/repos/protomaps/go-pmtiles/releases/latest \
    | grep -o "\"browser_download_url\": *\"[^\"]*$PAT\"" | head -1 | cut -d'"' -f4)
  [ -n "$URL" ] || { echo "Не нашёл релиз go-pmtiles"; exit 1; }
  if [[ "$URL" == *.zip ]]; then curl -fsSL -o .cache/pm.zip "$URL" && unzip -o -q .cache/pm.zip pmtiles -d .cache; else curl -fsSL "$URL" | tar -xz -C .cache pmtiles; fi
  chmod +x "$PM"
fi

# 2. Последняя доступная ежедневная сборка Protomaps
# PMTILES_SOURCE=https://…/planet.pmtiles — свой источник (если адрес сборок Protomaps изменится)
SRC="${PMTILES_SOURCE:-}"; VER="${PMTILES_VERSION:-$(python3 -c "import datetime as d;print(d.date.today())")}"
for i in $( [ -z "$SRC" ] && seq 0 14 ); do
  D=$(python3 -c "import datetime as d;print((d.datetime.now(d.timezone.utc)-d.timedelta(days=$i)).strftime('%Y%m%d'))")
  if curl -fsI "https://build.protomaps.com/$D.pmtiles" >/dev/null 2>&1; then SRC="https://build.protomaps.com/$D.pmtiles"; VER="${D:0:4}-${D:4:2}-${D:6:2}"; break; fi
done
[ -n "$SRC" ] || { echo "Нет доступной сборки на build.protomaps.com"; exit 1; }
echo "→ Источник: $SRC"

# 3. Вырезаем Ташкент
"$PM" extract "$SRC" "$OUT/tashkent.pmtiles" --bbox="$BBOX" --maxzoom="$MAXZOOM"
BYTES=$(wc -c < "$OUT/tashkent.pmtiles" | tr -d ' ')
IFS=, read -r W S E N <<<"$BBOX"
cat > "$OUT/tashkent.json" <<JSON
{"file":"tashkent.pmtiles","version":"$VER","bbox":[$W,$S,$E,$N],"maxzoom":$MAXZOOM,"bytes":$BYTES,"source":"Protomaps basemap, © OpenStreetMap contributors (ODbL)"}
JSON
echo "✅ $OUT/tashkent.pmtiles — $((BYTES/1024/1024)) МБ, данные от $VER"
