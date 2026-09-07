#!/usr/bin/env bash
set -e

echo "=========================================================="
echo "   RYSA VENDEDORES - BUILD AUTOMÁTICO DE APK RELEASE      "
echo "=========================================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

DIST_ANDROID="$PROJECT_ROOT/dist/android"
mkdir -p "$DIST_ANDROID"

echo ""
echo "[1/7] Verificando Node.js y npm..."
node -v
npm -v

echo ""
echo "[2/7] Verificando Java JDK..."
if [ -z "$JAVA_HOME" ]; then
    echo "JAVA_HOME no está definido. Intentando detectar..."
    if command -v java >/dev/null; then
        export JAVA_HOME="$(dirname $(dirname $(readlink -f $(which java))))"
    fi
fi
echo "JAVA_HOME: $JAVA_HOME"

echo ""
echo "[3/7] Verificando Android SDK..."
if [ -z "$ANDROID_HOME" ]; then
    if [ -d "$HOME/Android/Sdk" ]; then
        export ANDROID_HOME="$HOME/Android/Sdk"
    elif [ -d "$HOME/Library/Android/sdk" ]; then
        export ANDROID_HOME="$HOME/Library/Android/sdk"
    fi
fi
echo "ANDROID_HOME: $ANDROID_HOME"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

echo ""
echo "[4/7] Verificando dependencias npm..."
if [ ! -d "node_modules" ]; then
    npm install
fi

echo ""
echo "[5/7] Verificando proyecto nativo Android..."
if [ ! -d "android" ]; then
    npx expo prebuild --platform android --no-install
fi

echo "sdk.dir=$ANDROID_HOME" > android/local.properties

echo ""
echo "[6/7] Configurando firmado de Release..."
KEYSTORE_FILE="android/app/rysa-release.keystore"
KEYPROPS_FILE="android/key.properties"

KEY_PASS="${RYSA_KEYSTORE_PASSWORD:-RysaReleaseKey2026}"

if [ ! -f "$KEYSTORE_FILE" ]; then
    keytool -genkeypair -v -storetype PKCS12 -keystore "$KEYSTORE_FILE" \
        -alias "rysa-release-key" -keyalg RSA -keysize 2048 -validity 10000 \
        -storepass "$KEY_PASS" -keypass "$KEY_PASS" \
        -dname "CN=Grupo RYSA, OU=Comercial, O=Grupo RYSA, L=Guadalajara, ST=Jalisco, C=MX"
fi

if [ ! -f "$KEYPROPS_FILE" ]; then
cat <<EOF > "$KEYPROPS_FILE"
storeFile=rysa-release.keystore
storePassword=$KEY_PASS
keyAlias=rysa-release-key
keyPassword=$KEY_PASS
EOF
fi

echo ""
echo "[7/7] Compilando APK Release con Gradle..."
cd android
chmod +x gradlew
./gradlew assembleRelease --no-daemon

cd "$PROJECT_ROOT"

FOUND_APK=""
if [ -f "android/app/build/outputs/apk/release/app-release.apk" ]; then
    FOUND_APK="android/app/build/outputs/apk/release/app-release.apk"
else
    FOUND_APK="$(find android/app/build/outputs/apk -name "*.apk" | head -n 1)"
fi

if [ -z "$FOUND_APK" ]; then
    echo "ERROR: No se encontró el APK generado."
    exit 1
fi

FINAL_APK="$DIST_ANDROID/RYSA-Vendedores-v1.0.0-release.apk"
cp "$FOUND_APK" "$FINAL_APK"
cp "$FOUND_APK" "$DIST_ANDROID/app-release.apk"

SIZE_BYTES="$(wc -c < "$FINAL_APK" | tr -d ' ')"
SIZE_MB="$(awk "BEGIN {printf \"%.2f\", $SIZE_BYTES/1048576}")"

echo ""
echo "=========================================================="
echo "                BUILD SUCCESSFUL                          "
echo "=========================================================="
echo "  Aplicación:   RYSA Vendedores"
echo "  Package:      com.gruporysa.vendedores"
echo "  VersionName:  1.0.0"
echo "  VersionCode:  1"
echo "  Ruta APK:     $FINAL_APK"
echo "  Tamaño APK:   $SIZE_MB MB ($SIZE_BYTES bytes)"
echo "  Estado Firma: Firmado (Release)"
echo "=========================================================="
