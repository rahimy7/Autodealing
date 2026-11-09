#!/usr/bin/env bash
# Genera el AAB firmado de OmniAI para subir a Play Store.
#
#   ./scripts/build-android-aab.sh
#
# El keystore vive en ~/.keystores/, NO dentro del repo: `expo prebuild --clean`
# borra android/ entera y `git clean -xdf` se lleva todo lo ignorado, y perder la
# clave de subida significa no poder volver a actualizar la app publicada.
#
# La primera ejecución crea el keystore. Si no pasas OMNIAI_KEYSTORE_PASSWORD, se
# genera una contraseña aleatoria y se imprime UNA sola vez: guárdala.

set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$MOBILE_DIR/android"
CRED_DIR="$HOME/.keystores"
KEYSTORE="$CRED_DIR/omniai-upload.jks"
CREDS="$CRED_DIR/omniai-upload.properties"
ALIAS="upload"
# 25 años: Play exige que la clave de subida caduque después de 2033.
VALIDITY_DAYS=9125
DNAME="CN=OmniAI, O=rvrservice, L=Distrito Nacional, ST=Santo Domingo, C=DO"

command -v keytool >/dev/null 2>&1 || {
  echo "❌ keytool no encontrado. Instala un JDK 17+ o exporta el de Android Studio:" >&2
  echo "   export JAVA_HOME=\"/Applications/Android Studio.app/Contents/jbr/Contents/Home\"" >&2
  exit 1
}

umask 077
mkdir -p "$CRED_DIR"

if [[ -f "$KEYSTORE" ]]; then
  [[ -f "$CREDS" ]] || {
    echo "❌ Existe $KEYSTORE pero falta $CREDS con sus contraseñas." >&2
    echo "   Recupéralo de tu gestor de contraseñas y vuelve a crear ese archivo." >&2
    exit 1
  }
  echo "🔐 Usando el keystore existente: $KEYSTORE"
else
  # `tr </dev/urandom | head -c 32` parece lo obvio, pero head cierra el pipe y el
  # SIGPIPE resultante mata el script entero por culpa de `pipefail`. Con `head -c`
  # a la izquierda la entrada se agota sola y nadie recibe la señal.
  PW="${OMNIAI_KEYSTORE_PASSWORD:-$(head -c 512 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | cut -c1-32)}"
  echo "🔐 Creando keystore de subida en $KEYSTORE (alias '$ALIAS', $VALIDITY_DAYS días)"
  keytool -genkeypair -v \
    -keystore "$KEYSTORE" \
    -alias "$ALIAS" \
    -keyalg RSA -keysize 2048 \
    -validity "$VALIDITY_DAYS" \
    -storepass "$PW" -keypass "$PW" \
    -dname "$DNAME"
  cat > "$CREDS" <<EOF
storeFile=$KEYSTORE
storePassword=$PW
keyAlias=$ALIAS
keyPassword=$PW
EOF
  echo ""
  echo "⚠️  GUARDA ESTA CONTRASEÑA EN TU GESTOR DE CONTRASEÑAS AHORA:"
  echo ""
  echo "        $PW"
  echo ""
  echo "   Sin ella (y sin $KEYSTORE) no podrás publicar ninguna actualización."
  unset PW
fi

[[ -d "$ANDROID_DIR" ]] || {
  echo "❌ No existe android/. Genérala primero:  npx expo prebuild -p android --clean" >&2
  exit 1
}

# Gradle lee las credenciales de android/keystore.properties, que el prebuild borra;
# por eso se copia desde ~/.keystores en cada build en vez de vivir ahí.
cp "$CREDS" "$ANDROID_DIR/keystore.properties"

echo "🏗  Compilando :app:bundleRelease (la primera vez tarda varios minutos)…"
cd "$ANDROID_DIR"
./gradlew :app:bundleRelease

AAB="$ANDROID_DIR/app/build/outputs/bundle/release/app-release.aab"
[[ -f "$AAB" ]] || { echo "❌ No se generó el AAB en $AAB" >&2; exit 1; }

# Un AAB firmado con el keystore de debug lo rechaza Play Store, y el síntoma
# aparece recién al subirlo. Mejor detectarlo aquí.
if keytool -printcert -jarfile "$AAB" 2>/dev/null | grep -q "CN=Android Debug"; then
  echo "❌ El AAB quedó firmado con el keystore de DEBUG. Play Store lo rechazará." >&2
  echo "   Revisa que plugins/withReleaseSigning.js siga aplicándose en el prebuild." >&2
  exit 1
fi

echo ""
echo "🎉 AAB firmado: $AAB ($(du -h "$AAB" | cut -f1))"
keytool -printcert -jarfile "$AAB" | grep -E "Propietario|Owner|SHA1:|SHA256:" | head -5
