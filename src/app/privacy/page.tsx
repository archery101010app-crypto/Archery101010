import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { 
  ShieldCheck, ArrowLeft, Lock, Mic, Database, 
  UserCheck, RefreshCw, Mail, CheckCircle2, AlertCircle, FileText
} from "lucide-react";

export const metadata: Metadata = {
  title: "Política de Privacidad | Archery 101010",
  description: "Política de Privacidad y Tratamiento de Datos de Archery 101010 para Google Play Store, Apple App Store y versión Web/PWA.",
};

export default function PrivacyPolicyPage() {
  const lastUpdated = "25 de Octubre de 2026";

  return (
    <div className="min-h-screen py-10 px-4 sm:px-6 max-w-4xl mx-auto flex flex-col gap-8 text-neutral-200">
      {/* Top Navigation */}
      <div className="flex items-center justify-between border-b border-white/10 pb-5">
        <Link
          href="/"
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-neutral-900 border border-white/10 text-gray-dim hover:text-white transition active:scale-95 text-xs font-bold"
        >
          <ArrowLeft size={16} />
          <span>Volver a Archery 101010</span>
        </Link>

        {/* Brand Logo */}
        <div className="flex items-baseline gap-1 select-none">
          <div 
            className="flex text-lg tracking-tighter font-extrabold brand-logo-101010" 
            style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
          >
            <span className="text-cyan-neon">10</span>
            <span className="text-red-rival">10</span>
            <span className="text-yellow-gold">10</span>
          </div>
          <span className="text-white/40 text-[9px] font-black tracking-[0.25em] uppercase pl-1.5 border-l border-white/10">
            PRIVACY
          </span>
        </div>
      </div>

      {/* Hero Header */}
      <div className="flex flex-col gap-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-neon/10 border border-cyan-neon/30 text-cyan-neon text-xs font-black uppercase tracking-wider w-fit">
          <ShieldCheck size={14} />
          <span>Transparencia y Seguridad</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
          Política de Privacidad
        </h1>
        <p className="text-xs sm:text-sm text-gray-dim leading-relaxed">
          En <strong>Archery 101010</strong> nos tomamos la privacidad de los arqueros y entrenadores con máxima seriedad. Esta política explica cómo recopilamos, usamos, protegemos y gestionamos tu información de acuerdo con las normativas internacionales de protección de datos (incluyendo RGPD/GDPR, CCPA y los requerimientos oficiales de <strong>Google Play Store</strong> y <strong>Apple App Store</strong>).
        </p>
        <span className="text-[11px] text-white/40 font-mono">
          Última actualización: {lastUpdated} · Versión oficial aplicable
        </span>
      </div>

      {/* Main Content Sections */}
      <div className="flex flex-col gap-6 text-sm leading-relaxed">
        {/* SECCIÓN 1: Responsable del Tratamiento */}
        <div className="bg-neutral-950 border border-white/10 rounded-3xl p-6 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-white font-bold text-base">
            <UserCheck size={18} className="text-cyan-neon" />
            <h2>1. Responsable del Tratamiento de los Datos</h2>
          </div>
          <p className="text-neutral-300 text-xs sm:text-sm">
            La plataforma, aplicación móvil y servicios web de <strong>Archery 101010</strong> son desarrollados y operados por el equipo oficial de Archery 101010. Para cualquier consulta, solicitud o ejercicio de tus derechos de privacidad, puedes contactarnos directamente al correo electrónico oficial:
          </p>
          <div className="bg-neutral-900/80 border border-white/5 p-3 rounded-2xl flex items-center gap-3">
            <Mail size={16} className="text-cyan-neon shrink-0" />
            <a 
              href="mailto:info@archery101010.com" 
              className="text-cyan-neon font-mono text-xs hover:underline font-bold"
            >
              info@archery101010.com
            </a>
          </div>
        </div>

        {/* SECCIÓN 2: Información que Recopilamos */}
        <div className="bg-neutral-950 border border-white/10 rounded-3xl p-6 flex flex-col gap-4">
          <div className="flex items-center gap-2 text-white font-bold text-base">
            <Database size={18} className="text-yellow-gold" />
            <h2>2. Información que Recopilamos y Finalidad</h2>
          </div>
          <p className="text-neutral-300 text-xs sm:text-sm">
            Recopilamos únicamente la información necesaria para brindarte la mejor experiencia de entrenamiento de tiro con arco y seguimiento de estadísticas:
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="bg-neutral-900/60 p-4 rounded-2xl border border-white/5 flex flex-col gap-2">
              <h3 className="font-bold text-white flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-cyan-neon" />
                <span>Datos de Identificación y Cuenta</span>
              </h3>
              <p className="text-neutral-400 leading-relaxed">
                Dirección de correo electrónico, nombre o apodo público (*nickname*), foto de perfil opcional y tipo de usuario (Arquero, Coach o Administrador de Club).
              </p>
            </div>

            <div className="bg-neutral-900/60 p-4 rounded-2xl border border-white/5 flex flex-col gap-2">
              <h3 className="font-bold text-white flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-yellow-gold" />
                <span>Datos Deportivos y Balísticos</span>
              </h3>
              <p className="text-neutral-400 leading-relaxed">
                Puntuaciones y planillas oficiales (WA 300, WA 600, WA 720, rondas libres), tipo de arco (Recurvo, Compuesto, Raso/Barebow), libraje, peso de flecha en grains, longitud y distancias de tiro.
              </p>
            </div>

            <div className="bg-neutral-900/60 p-4 rounded-2xl border border-white/5 flex flex-col gap-2">
              <h3 className="font-bold text-white flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-rival" />
                <span>Datos de Progreso y Retos</span>
              </h3>
              <p className="text-neutral-400 leading-relaxed">
                Estrellas 101010 desbloqueadas, volumen de flechas lanzadas, rachas de entrenamiento y notas técnicas por ronda registradas por ti o tu entrenador.
              </p>
            </div>

            <div className="bg-neutral-900/60 p-4 rounded-2xl border border-white/5 flex flex-col gap-2">
              <h3 className="font-bold text-white flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-400" />
                <span>Datos de Diagnóstico y Dispositivo</span>
              </h3>
              <p className="text-neutral-400 leading-relaxed">
                Información técnica anónima sobre el navegador o dispositivo para garantizar la compatibilidad del motor balístico y optimizar el rendimiento.
              </p>
            </div>
          </div>
        </div>

        {/* SECCIÓN 3: Permiso de Micrófono y Cronógrafo Acústico */}
        <div className="bg-neutral-950 border border-cyan-neon/30 rounded-3xl p-6 flex flex-col gap-3 shadow-[0_0_30px_rgba(0,229,255,0.05)]">
          <div className="flex items-center gap-2 text-white font-bold text-base">
            <Mic size={18} className="text-cyan-neon" />
            <h2>3. Uso Exclusivo del Micrófono (Cronógrafo Balístico 101010)</h2>
          </div>
          <div className="bg-cyan-neon/10 border border-cyan-neon/30 p-3.5 rounded-2xl text-xs text-cyan-neon font-bold flex items-start gap-2">
            <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
            <span>
              Garantía de Privacidad en Audio: Ninguna conversación, voz o sonido ambiental es grabado, almacenado ni transmitido a servidores remotos.
            </span>
          </div>
          <p className="text-neutral-300 text-xs sm:text-sm leading-relaxed">
            Nuestra herramienta <strong>101010 Chronograph</strong> requiere acceso temporal al micrófono de tu dispositivo única y exclusivamente para medir la velocidad de tu flecha a 18 metros:
          </p>
          <ul className="list-disc pl-5 text-xs text-neutral-400 space-y-1.5">
            <li>El procesamiento de la señal de audio se realiza **100% de forma local en tiempo real** en el procesador de tu teléfono a través de la Web Audio API.</li>
            <li>El algoritmo únicamente detecta los dos picos de decibeles de impacto acústico: el chasquido de la suelta de la cuerda y el impacto en el parapeto de tiro.</li>
            <li>Inmediatamente después de calcular los milisegundos de vuelo, el flujo de audio se destruye en memoria sin guardar ningún archivo de voz ni sonido.</li>
          </ul>
        </div>

        {/* SECCIÓN 4: Almacenamiento Local (Offline-First) y Nube */}
        <div className="bg-neutral-950 border border-white/10 rounded-3xl p-6 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-white font-bold text-base">
            <Lock size={18} className="text-red-rival" />
            <h2>4. Arquitectura Offline-First y Seguridad en la Nube</h2>
          </div>
          <p className="text-neutral-300 text-xs sm:text-sm leading-relaxed">
            Archery 101010 está diseñada con una arquitectura de resiliencia total:
          </p>
          <ul className="list-disc pl-5 text-xs text-neutral-400 space-y-1.5">
            <li>
              <strong className="text-white">Almacenamiento Local (IndexedDB):</strong> Tus sesiones de tiro y preferencias se guardan de inmediato en la base de datos interna de tu dispositivo, permitiendo operar sin conexión a internet (*offline*).
            </li>
            <li>
              <strong className="text-white">Sincronización Cifrada:</strong> Cuando hay conexión disponible, los datos se sincronizan con <strong>Google Firebase / Cloud Firestore</strong> mediante canales seguros y cifrados con protocolo TLS/HTTPS de 256 bits tanto en tránsito como en reposo.
            </li>
            <li>
              <strong className="text-white">Protección de Contraseñas y Acceso:</strong> La autenticación de usuarios es gestionada mediante estándares de grado bancario (OAuth 2.0 y Firebase Authentication). Nunca almacenamos contraseñas en texto plano.
            </li>
          </ul>
        </div>

        {/* SECCIÓN 5: Compartición de Datos y Terceros */}
        <div className="bg-neutral-950 border border-white/10 rounded-3xl p-6 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-white font-bold text-base">
            <ShieldCheck size={18} className="text-yellow-gold" />
            <h2>5. Compartición de Datos y No Venta a Terceros</h2>
          </div>
          <p className="text-neutral-300 text-xs sm:text-sm leading-relaxed">
            En Archery 101010 mantenemos una política estricta de cero comercialización:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs mt-1">
            <div className="bg-neutral-900/50 p-3.5 rounded-2xl border border-white/5">
              <strong className="text-white block mb-1">❌ No vendemos tus datos</strong>
              <p className="text-neutral-400">
                Nunca vendemos, alquilamos ni comercializamos tu información personal ni tus estadísticas de tiro con corredores de datos ni redes publicitarias.
              </p>
            </div>
            <div className="bg-neutral-900/50 p-3.5 rounded-2xl border border-white/5">
              <strong className="text-white block mb-1">🎯 Privacidad entre Alumno y Coach</strong>
              <p className="text-neutral-400">
                Si estás vinculado a un club o entrenador suscrito, tus resultados de puntuación y ciclos de entrenamiento son compartidos únicamente con tu entrenador designado.
              </p>
            </div>
          </div>
        </div>

        {/* SECCIÓN 6: Protección de Menores de Edad */}
        <div className="bg-neutral-950 border border-white/10 rounded-3xl p-6 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-white font-bold text-base">
            <AlertCircle size={18} className="text-cyan-neon" />
            <h2>6. Protección de Menores de Edad (COPPA / GDPR-K)</h2>
          </div>
          <p className="text-neutral-300 text-xs sm:text-sm leading-relaxed">
            El tiro con arco es un deporte practicado por atletas jóvenes y categorías infantiles. Archery 101010 fomenta un entorno seguro:
          </p>
          <p className="text-xs text-neutral-400 leading-relaxed">
            No recopilamos deliberadamente información personal de niños menores de 13 años (o la edad mínima legal en su jurisdicción) sin el consentimiento y supervisión de sus padres, tutores o de su club deportivo autorizado. La aplicación no contiene publicidad invasiva, contenido inapropiado ni enlaces a compras no autorizadas.
          </p>
        </div>

        {/* SECCIÓN 7: Derechos del Usuario y Eliminación de Cuenta */}
        <div id="delete-account" className="bg-neutral-950 border border-red-rival/30 rounded-3xl p-6 flex flex-col gap-3.5">
          <div className="flex items-center gap-2 text-white font-bold text-base">
            <FileText size={18} className="text-red-rival" />
            <h2>7. Tus Derechos y Eliminación Completa de Cuenta y Datos</h2>
          </div>
          <p className="text-neutral-300 text-xs sm:text-sm leading-relaxed">
            De conformidad con las políticas de seguridad de datos de <strong>Google Play Store</strong> y <strong>Apple App Store</strong>, tienes control total sobre tu información y puedes eliminar tu cuenta en cualquier momento por dos vías:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="bg-neutral-900/60 p-4 rounded-2xl border border-white/5 flex flex-col gap-1.5">
              <strong className="text-white">1. Eliminación Inmediata desde la App</strong>
              <p className="text-neutral-400 leading-relaxed">
                Abre <strong>Archery 10 10 10</strong>, dirígete a la pestaña <strong>Perfil</strong> y pulsa el botón <strong>&quot;Eliminar mi cuenta y datos&quot;</strong> al final de la pantalla. Al confirmar, tu perfil, configuraciones de arco, sesiones de tiro, historial de duelos y récords se eliminan de inmediato del dispositivo y de Google Cloud Firestore.
              </p>
            </div>
            <div className="bg-neutral-900/60 p-4 rounded-2xl border border-white/5 flex flex-col gap-1.5">
              <strong className="text-white">2. Solicitud Web (Sin abrir la App)</strong>
              <p className="text-neutral-400 leading-relaxed">
                Si ya desinstalaste la aplicación, puedes solicitar la baja total enviando un correo directo a{" "}
                <a
                  href="mailto:info@archery101010.com?subject=Eliminar%20mi%20cuenta%20Archery%20101010"
                  className="text-cyan-neon underline font-bold"
                >
                  info@archery101010.com
                </a>{" "}
                con el asunto <em>&quot;Eliminar mi cuenta Archery 101010&quot;</em> desde tu correo registrado.
              </p>
            </div>
          </div>
          <ul className="list-disc pl-5 text-xs text-neutral-400 space-y-1">
            <li><strong className="text-white">Datos que se eliminan:</strong> Perfil de usuario (<code className="text-neutral-300">users</code>), planillas e impactos (<code className="text-neutral-300">sessions</code>), insignias/estrellas (<code className="text-neutral-300">athlete_stars</code>) y vinculación a clubes.</li>
            <li><strong className="text-white">Plazo de retención tras la baja:</strong> 0 días para eliminaciones desde la app y máximo 7 días hábiles para solicitudes por correo electrónico, sin conservar copias personales posteriores.</li>
          </ul>
        </div>

        {/* SECCIÓN 8: Cambios a esta Política */}
        <div className="bg-neutral-950 border border-white/10 rounded-3xl p-6 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-white font-bold text-base">
            <RefreshCw size={18} className="text-cyan-neon" />
            <h2>8. Actualizaciones y Modificaciones</h2>
          </div>
          <p className="text-neutral-300 text-xs sm:text-sm leading-relaxed">
            Podemos actualizar periódicamente esta Política de Privacidad para reflejar nuevas funciones de la aplicación, avances tecnológicos o requerimientos normativos de las tiendas de aplicaciones. Cualquier cambio sustancial será notificado dentro de la aplicación o a través de la fecha de última modificación visible en este documento.
          </p>
        </div>
      </div>

      {/* Footer Contact & Legal Disclaimer */}
      <div className="border-t border-white/10 pt-6 pb-12 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-dim">
        <div className="flex items-center gap-2">
          <div 
            className="flex text-sm tracking-tighter font-extrabold brand-logo-101010" 
            style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
          >
            <span className="text-cyan-neon">10</span>
            <span className="text-red-rival">10</span>
            <span className="text-yellow-gold">10</span>
          </div>
          <span>© 2026 Archery 101010. Todos los derechos reservados.</span>
        </div>

        <Link
          href="/"
          className="text-cyan-neon hover:underline font-bold uppercase tracking-wider text-[11px]"
        >
          Ir a la Aplicación
        </Link>
      </div>
    </div>
  );
}
