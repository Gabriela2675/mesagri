#!/usr/bin/env bash
# =============================================================================
# Mesagri · compila el APK de Android (versión autónoma: todo corre en el celular)
#
# Necesita (Ubuntu o Debian):
#   sudo apt install openjdk-17-jdk aapt dalvik-exchange zipalign apksigner android-sdk-platform-23
# y las dependencias del proyecto (npm ci en la raíz).
# Uso:  bash apps/android/build.sh        → deja Mesagri.apk en la raíz del proyecto
# =============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
ANDROID_JAR="${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}"
DX="$(command -v dalvik-exchange || command -v dx)"
OUT="$HERE/build"
APK="${APK_OUT:-$ROOT/Mesagri.apk}"
VERSION="$(sed -n 's/.*android:versionName="\([^"]*\)".*/\1/p' "$HERE/AndroidManifest.xml" | head -1)"

for t in aapt javac zipalign apksigner; do command -v "$t" >/dev/null || { echo "Falta $t (ver la cabecera de este archivo)"; exit 1; }; done
[ -n "$DX" ] || { echo "Falta dalvik-exchange (dx)"; exit 1; }
[ -f "$ANDROID_JAR" ] || { echo "Falta android.jar ($ANDROID_JAR)"; exit 1; }
# shellcheck disable=SC1091
source "$HERE/firma/clave.env"

echo "==> App web autónoma (vite build --mode autonoma)"
(cd "$ROOT/apps/web" && npx vite build --mode autonoma --logLevel warn)

echo "==> Recursos y manifiesto"
rm -rf "$OUT" && mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/assets"
cp -r "$ROOT/apps/web/dist-app" "$OUT/assets/www"
rm -f "$OUT/assets/www/sw.js"   # dentro del APK la app ya está en el celular: sin service worker
sed -i "s/static final String VERSION = \"[^\"]*\"/static final String VERSION = \"$VERSION\"/" "$HERE/src/pe/mesagri/app/BuildInfo.java"
aapt package -f -m -J "$OUT/gen" -M "$HERE/AndroidManifest.xml" -S "$HERE/res" -A "$OUT/assets" -I "$ANDROID_JAR" -F "$OUT/base.apk" -0 woff2 -0 png

echo "==> Código Java"
javac --release 8 -nowarn -encoding UTF-8 -classpath "$ANDROID_JAR" -d "$OUT/classes" $(find "$HERE/src" "$OUT/gen" -name '*.java') 2>&1 | grep -v "^warning: \[options\]" || true
[ -f "$OUT/classes/pe/mesagri/app/MainActivity.class" ] || { echo "No compiló el código Java"; exit 1; }
"$DX" --dex --min-sdk-version=24 --output="$OUT/classes.dex" "$OUT/classes"
(cd "$OUT" && aapt add base.apk classes.dex >/dev/null)

echo "==> Alinear y firmar"
zipalign -f -p 4 "$OUT/base.apk" "$OUT/aligned.apk"
apksigner sign --ks "$HERE/firma/mesagri.jks" --ks-key-alias mesagri --ks-pass "pass:$MESAGRI_KEY_PASS" --key-pass "pass:$MESAGRI_KEY_PASS" --min-sdk-version 24 --out "$APK" "$OUT/aligned.apk"
apksigner verify --min-sdk-version 24 "$APK"
rm -f "$APK.idsig"
echo "Listo: $APK ($(du -h "$APK" | cut -f1)) · versión $VERSION"
