# Archery 101010 - Guía del Agente

## 📌 Reglas de Desarrollo y Despliegue

1.  **Repositorio de GitHub Automático:** Cada aplicación o proyecto creado o gestionado por un agente debe contar con su correspondiente repositorio en GitHub (`https://github.com/joyod2/<NombreApp>`) configurado y sincronizado automáticamente desde su creación para facilitar el desarrollo continuo y pruebas rápidas en dispositivos móviles mediante Netlify/Vercel.
2.  **Sincronización y Resiliencia (Offline-First):** Guardar cambios localmente en IndexedDB al instante (cero latencia) y sincronizar secuencialmente en segundo plano con reintentos automáticos y soporte de snapshots.
3.  **Frontend SaaS Premium 2025:** Estructura moderna con Next.js, TypeScript, Tailwind CSS, Framer Motion, shadcn/ui y modo oscuro OLED por defecto.

## 🛠️ Comandos de Utilidad

*   **Servidor de desarrollo:** `npm run dev`
*   **Compilación local:** `npm run build`
*   **Verificación de estilos/errores:** `npm run lint`
