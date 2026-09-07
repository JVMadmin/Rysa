# GUÍA DE COMPILACIÓN Y GENERACIÓN DE APK — RYSA VENDEDORES

Esta guía detalla el entorno, configuración de firmado, proceso de compilación y pasos de instalación del APK de producción para **RYSA Vendedores**.

---

## 1. RESUMEN DE LA APLICACIÓN Y APK DE PRODUCCIÓN

| Parámetro | Valor |
| :--- | :--- |
| **Nombre de la Aplicación** | `RYSA Vendedores` |
| **Package / Application ID** | `com.gruporysa.vendedores` |
| **Versión (VersionName)** | `1.0.2` |
| **Código de Versión (VersionCode)** | `3` |
| **Tipo de Build** | `Release` (Firmado para instalación directa) |
| **Arquitectura Nativa** | `arm64-v8a` (dispositivos Android modernos) |
| **SDK Mínimo (minSdkVersion)** | `24` (Android 7.0+) |
| **SDK Objetivo (targetSdkVersion)** | `34` (Android 14 estándar) |
| **Backend de Producción** | `https://gruporysa.com/api` |
| **Ruta del APK generado** | `dist/android/RYSA-Vendedores-v1.0.2-release.apk` |
| **Ruta alternativa** | `dist/android/app-release.apk` |

---

## 2. REQUISITOS DEL SISTEMA Y DEPENDENCIAS

Para compilar el proyecto en una máquina Windows, Linux o macOS se requiere:

1. **Node.js**: v20.x o v22.x LTS (npm v10+)
2. **Java Development Kit (JDK)**: JDK 21 LTS (recomendado: *Eclipse Adoptium Temurin 21*)
   - Variable `JAVA_HOME` apuntando a la raíz del JDK.
   - Ejemplo en Windows: `C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot`
3. **Android SDK**:
   - Variable `ANDROID_HOME` y `ANDROID_SDK_ROOT` apuntando a: `%LOCALAPPDATA%\Android\Sdk`
   - Componentes requeridos:
     - `platforms;android-35` / `platforms;android-36`
     - `build-tools;35.0.0`
     - `platform-tools` (con `adb`)
     - `cmdline-tools;latest`
4. **Herramienta Google Android CLI**:
   - Instalada en `%USERPROFILE%\AppData\AndroidCLI\android.exe` para gestión desasistida del SDK y licencias.

---

## 3. CONFIGURACIÓN DE FIRMA (RELEASE KEYSTORE)

El build de release está configurado para firmar automáticamente con un keystore PKCS12 dedicado:

- **Archivo de Keystore:** `android/app/rysa-release.keystore`
- **Alias de clave:** `rysa-release-key`
- **Algoritmo:** `RSA 2048 bits`
- **Validez:** 10,000 días
- **Archivo de propiedades:** `android/key.properties` (excluido en `.gitignore` por seguridad):
  ```properties
  storeFile=rysa-release.keystore
  storePassword=<PASSWORD_CONFIGURADA>
  keyAlias=rysa-release-key
  keyPassword=<PASSWORD_CONFIGURADA>
  ```

> **Nota de Seguridad:** Tanto `*.keystore`, `*.jks` como `key.properties` están listados en `.gitignore` para evitar filtraciones accidentales de credenciales en repositorios públicos o compartidos.

---

## 4. COMPILACIÓN AUTOMATIZADA

Se proporcionan scripts listos para ejecutar la compilación con un solo comando:

### En Windows (PowerShell)
```powershell
npm run build:android
```
O directamente:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-android-release.ps1
```

### En Linux / macOS / Git Bash
```bash
./scripts/build-android-release.sh
```

### ¿Qué hace el script automatizado?
1. Valida versiones de Node.js, Java JDK y Android SDK.
2. Comprueba dependencias de `package.json`.
3. Valida la existencia del directorio nativo `android/` (o ejecuta `expo prebuild`).
4. Valida y autogenera el keystore de producción y `key.properties` si no existieran.
5. **Mitigación de Windows MAX_PATH**: Si la ruta del proyecto es muy larga, mapea temporalmente una unidad virtual corta con `subst` (ej. `X:\`) para evitar que Ninja/CMake fallen por rutas superiores a 260 caracteres.
6. Ejecuta `./gradlew assembleRelease --no-daemon`.
7. Copia el APK firmado a `dist/android/RYSA-Vendedores-v1.0.0-release.apk` y muestra un resumen con tamaño y hash.

---

## 5. COMPILACIÓN MANUAL PASO A PASO (GRADLE)

Si deseas compilar directamente sin scripts:

1. **Configurar variables de entorno:**
   ```powershell
   $env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"
   $env:ANDROID_HOME = "C:\Users\Quantum\AppData\Local\Android\Sdk"
   $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
   $env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"
   ```

2. **Ir al directorio nativo Android:**
   ```powershell
   cd android
   ```

3. **Ejecutar ensamble Release:**
   ```powershell
   .\gradlew.bat assembleRelease --no-daemon
   ```

4. **Copiar APK a dist:**
   ```powershell
   cd ..
   Copy-Item "android\app\build\outputs\apk\release\app-release.apk" "dist\android\RYSA-Vendedores-v1.0.0-release.apk" -Force
   ```

---

## 6. INSTALACIÓN EN DISPOSITIVOS ANDROID

### Opción A: Instalación directa por cable USB (ADB)
1. Activa la **Depuración por USB** en tu teléfono Android (Ajustes > Opciones de desarrollador > Depuración por USB).
2. Conecta el teléfono por USB a la PC.
3. Ejecuta en terminal:
   ```powershell
   adb install -r dist/android/RYSA-Vendedores-v1.0.0-release.apk
   ```

### Opción B: Copia directa al teléfono (WhatsApp / Drive / USB)
1. Copia el archivo `dist/android/RYSA-Vendedores-v1.0.0-release.apk` a la memoria del teléfono o envíalo por WhatsApp/Google Drive.
2. En el teléfono, abre el archivo `.apk` descargado.
3. Si Android solicita autorización, activa la opción **"Permitir desde esta fuente"**.
4. Pulsa **Instalar** y finaliza.

---

## 7. VERIFICACIÓN DE SEGURIDAD Y CONECTIVIDAD

- **Endpoint de backend:** La aplicación apunta exclusivamente a `https://gruporysa.com/api`.
- **Credenciales y Secretos:** El bundle JS y el APK no contienen claves privadas de base de datos ni tokens fijos; la autenticación se realiza mediante tokens Bearer emitidos dinámicamente en `/api/seller/login` y almacenados de forma segura en `AsyncStorage`.
- **Modo Offline:** Incluye detección automática de conectividad y banners de advertencia cuando no hay conexión a internet o el servidor no responde.
