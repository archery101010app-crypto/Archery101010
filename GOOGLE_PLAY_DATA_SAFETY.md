# Guía de Respuestas: Formulario de Seguridad de los Datos (Data Safety) en Google Play Console

Esta guía contiene las respuestas exactas que debes seleccionar en la consola de Google Play (**Play Console > Contenido de la app > Seguridad de los datos**) para **Archery 101010**.

---

## 1. Recopilación y seguridad generales

| Pregunta | Respuesta recomendada | Justificación |
| :--- | :--- | :--- |
| **¿Tu aplicación recopila o comparte alguno de los tipos de datos de usuario obligatorios?** | **Sí** | Se recopilan credenciales de inicio de sesión básicas (correo/nombre) y configuración de arquero para guardar sus puntuaciones. |
| **¿Todos los datos de usuario que recopila tu aplicación se cifran en tránsito?** | **Sí** | Todo el tráfico con Firebase / Cloud Firestore se cifra obligatoriamente con HTTPS / TLS 1.3. |
| **¿Proporcionas a los usuarios una forma de solicitar que se eliminen sus datos?** | **Sí** | Los usuarios pueden borrar sus sesiones de tiro en cualquier momento desde el Historial o solicitar la eliminación total de su cuenta desde el Perfil. |

---

## 2. Tipos de datos declarados

### A. Información personal (Personal Info)
* **Nombre:**
  - Recopilado: Sí
  - Compartido: No
  - Procesado efímeramente: No
  - Obligatorio u opcional: Opcional (apodo / nombre de arquero)
  - Finalidad: **Funcionalidad de la app** (identificar la planilla de tiro y retos 1v1).
* **Dirección de correo electrónico:**
  - Recopilado: Sí (si inicia sesión con Google o correo)
  - Compartido: No
  - Finalidad: **Funcionalidad de la app / Gestión de cuentas** (autenticación segura).

### B. Audio y Micrófono (`RECORD_AUDIO`) — ¡Muy Importante!
* **Grabaciones de voz o sonido:**
  - ¿Se recopilan datos de audio?: **NO**.
  - ¿Se comparten datos de audio?: **NO**.
  - **Explicación técnica de Google Play:** La app procesa el micrófono **únicamente en tiempo real de forma efímera en la memoria RAM del dispositivo** para la función de *Cronógrafo Acústico* (detectar el pico acústico de la suelta y el impacto en la diana). El audio **NUNCA se almacena, NUNCA se graba voz y NUNCA se envía a ningún servidor**.
  - En la política de permisos de Google Play esto califica como: **"Procesamiento exclusivamente local / efímero (Ephemeral Processing)"**.

### C. Almacenamiento e Historial de Tiro
* **Puntuaciones e Impactos de Diana:**
  - Se guardan localmente en IndexedDB (cero latencia) y se sincronizan con la cuenta privada del arquero en Cloud Firestore.
  - No se comparten con anunciantes ni terceros.

---

## 3. Enlace a la Política de Privacidad

En la sección **Contenido de la app > Política de privacidad**, debes ingresar la URL oficial de la app:
```
https://archery101010-c0bb4.web.app/privacy
```
*(Esta página ya está completamente desplegada y cumple con los estándares de Google Play, Apple App Store y RGPD/GDPR).*
