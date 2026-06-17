# Archery 101010 - Guía del Agente Gemini

## 📌 Reglas de Desarrollo y Despliegue

1.  **Repositorio de GitHub Automático:** Cada aplicación o proyecto creado o gestionado por un agente debe contar con su correspondiente repositorio en GitHub (`https://github.com/joyod2/<NombreApp>`) configurado y sincronizado automáticamente desde su creación para facilitar el desarrollo continuo y pruebas rápidas en dispositivos móviles mediante Netlify/Vercel.
2.  **Sincronización y Resiliencia (Offline-First):** Guardar cambios localmente en IndexedDB al instante (cero latencia) y sincronizar secuencialmente en segundo plano con reintentos automáticos y soporte de snapshots.
3.  **Frontend SaaS Premium 2025:** Estructura moderna con Next.js, TypeScript, Tailwind CSS, Framer Motion, shadcn/ui y modo oscuro OLED por defecto.
4.  **Control de Versión de Publicación:** Cada vez que se realicen cambios y se publiquen commits en el repositorio, se debe incrementar el número de versión de la aplicación sumando +0.1 a la versión actual mediante el script de auto-incremento.
5.  **Control Centralizado:** La versión de la aplicación se almacena de forma centralizada en `src/lib/version.ts` y se actualiza mediante `npm run bump-version`.
