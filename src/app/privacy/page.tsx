import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  ShieldCheck,
  ArrowLeft,
  Lock,
  Mic,
  Database,
  UserCheck,
  RefreshCw,
  Mail,
  CheckCircle2,
  AlertCircle,
  FileText,
  MapPin,
  Camera,
  Activity
} from "lucide-react";

export const metadata: Metadata = {
  title: "Política de Privacidad | ARCHERY 101010",
  description:
    "Política de Privacidad y Tratamiento de Datos de ARCHERY 101010 · THE APP para tiendas oficiales de aplicaciones móviles y versión Web/PWA."
};

export default function PrivacyPolicyPage() {
  const lastUpdated = "Noviembre de 2026";

  return (
    <div className="min-h-screen bg-[#020305] py-10 px-4 sm:px-6 text-white">
      <div className="max-w-4xl mx-auto flex flex-col gap-8">
        {/* Top Navigation */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-5">
          <Link
            href="/"
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#12151C] border border-white/[0.10] text-white hover:border-cyan-neon/40 transition active:scale-95 text-xs font-bold"
          >
            <ArrowLeft size={16} />
            <span>Volver a ARCHERY 101010</span>
          </Link>

          {/* Official Brand Logo + THE APP */}
          <div className="flex items-center gap-2.5 select-none">
            <img
              src="/images/brand_logo_header.png"
              srcSet="/images/brand_logo_header.png 1x, /images/brand_logo_full.png 2x"
              alt="ARCHERY 101010"
              className="h-[11px] sm:h-3.5 w-auto object-contain shrink-0"
            />
            <span
              className="font-good-times text-white text-[10.5px] sm:text-xs font-black tracking-[0.22em] uppercase pl-2.5 border-l border-white/[0.12]"
              style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
            >
              THE APP
            </span>
          </div>
        </div>

        {/* Hero Header */}
        <div className="flex flex-col gap-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#12151C] border border-white/[0.10] text-cyan-neon text-xs font-black uppercase tracking-wider w-fit">
            <ShieldCheck size={14} />
            <span>Privacidad y Transparencia</span>
          </div>
          <h1 className="text-[31px] sm:text-[38px] font-black text-white tracking-tight">
            Política de Privacidad
          </h1>
          <p className="text-xs sm:text-sm text-white leading-relaxed">
            En <strong>ARCHERY 101010</strong> protegemos la información deportiva y personal de cada arquero y entrenador con estándares estrictos de seguridad. Esta política detalla qué datos y permisos del dispositivo se utilizan, con qué finalidad exclusiva operan y cómo puedes eliminar tu cuenta y registros de forma inmediata conforme a las normativas internacionales de protección de datos (RGPD/GDPR, CCPA, COPPA y políticas de seguridad de las tiendas oficiales de aplicaciones móviles).
          </p>
          <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-white font-sans tabular-nums">
            <span>Fecha de entrada en vigor: {lastUpdated}</span>
            <span>·</span>
            <Link href="/terms" className="text-cyan-neon hover:underline font-bold">
              Ver Términos y Condiciones de Uso (EULA)
            </Link>
          </div>
        </div>

        {/* Main Content Sections */}
        <div className="flex flex-col gap-5 text-sm leading-relaxed">
          {/* SECCIÓN 1: Responsable del Tratamiento */}
          <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-white font-bold text-base">
              <UserCheck size={18} className="text-cyan-neon shrink-0" />
              <h2>1. Responsable del Tratamiento de los Datos</h2>
            </div>
            <p className="text-white text-xs sm:text-sm">
              La plataforma deportiva, aplicación móvil, interfaz para reloj inteligente deportivo y versión web de <strong>ARCHERY 101010 · THE APP</strong> son desarrolladas y operadas por el equipo oficial de ARCHERY 101010. Para consultas de privacidad o solicitudes sobre tus datos personales, escríbenos a:
            </p>
            <div className="bg-[#12151C] border border-white/[0.08] p-3 rounded-2xl flex items-center gap-3 w-fit">
              <Mail size={16} className="text-cyan-neon shrink-0" />
              <a
                href="mailto:info@archery101010.com"
                className="text-cyan-neon font-sans tabular-nums text-xs hover:underline font-bold"
              >
                info@archery101010.com
              </a>
            </div>
          </section>

          {/* SECCIÓN 2: Información que Recopilamos y Datos Antropométricos */}
          <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-4">
            <div className="flex items-center gap-2 text-white font-bold text-base">
              <Database size={18} className="text-yellow-gold shrink-0" />
              <h2>2. Información que Recopilamos y Datos de Perfil</h2>
            </div>
            <p className="text-white text-xs sm:text-sm">
              Recopilamos únicamente los datos necesarios para el registro técnico de tiro con arco, cálculo biomecánico y sincronización opcional con tu entrenador:
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-2">
                <h3 className="font-bold text-white flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-cyan-neon" />
                  <span>Identificación y Edad Mínima (13+)</span>
                </h3>
                <p className="text-white leading-relaxed">
                  Correo electrónico, nombre, apodo opcional (<em>nickname</em>), país, ciudad, género y fecha de nacimiento (<code>birthDate</code>), empleada para verificar la edad mínima obligatoria de <strong>13 años</strong> para atletas y <strong>18 años</strong> para entrenadores.
                </p>
              </div>

              <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-2">
                <h3 className="font-bold text-white flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-yellow-gold" />
                  <span>Datos Antropométricos Opcionales</span>
                </h3>
                <p className="text-white leading-relaxed">
                  Estatura (<code>height</code> en cm), peso corporal (<code>weight</code> en kg), mano y ojo dominante. Estos valores son opcionales y se utilizan exclusivamente para calcular con precisión la longitud de zancada y las calorías activas (<code>kcal</code>) consumidas al tensar el arco y caminar en el campo.
                </p>
              </div>

              <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-2">
                <h3 className="font-bold text-white flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-rival" />
                  <span>Planillas, Equipo y Progreso</span>
                </h3>
                <p className="text-white leading-relaxed">
                  Puntuaciones por tanda, coordenadas de impacto en diana, configuración del arco (tipo, libraje en lbs, distancia de tiro), estrellas 101010 alcanzadas, eventos de agenda y ciclos de entrenamiento.
                </p>
              </div>

              <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-2">
                <h3 className="font-bold text-white flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-green-success" />
                  <span>Diagnóstico de Estabilidad</span>
                </h3>
                <p className="text-white leading-relaxed">
                  Registros técnicos acotados de fallos inesperados en la interfaz (máximo 5 reportes por sesión) para corregir errores de visualización y mantener la confiabilidad en dispositivos móviles.
                </p>
              </div>
            </div>
          </section>

          {/* SECCIÓN 3: Ubicación en Primer Plano y Telemetría Biométrica */}
          <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3.5">
            <div className="flex items-center gap-2 text-white font-bold text-base">
              <MapPin size={18} className="text-cyan-neon shrink-0" />
              <h2>3. Ubicación en Primer Plano y Telemetría de Movimiento</h2>
            </div>
            <div className="bg-[#12151C] border border-white/[0.10] p-3.5 rounded-2xl text-xs text-white font-bold flex items-start gap-2.5">
              <CheckCircle2 size={16} className="text-cyan-neon shrink-0 mt-0.5" />
              <span>
                Cero rastreo en segundo plano: La ubicación solo funciona mientras una sesión de tiro está activa en pantalla y jamás se utiliza para publicidad ni perfilado comercial.
              </span>
            </div>
            <ul className="list-disc pl-5 text-xs sm:text-sm text-white space-y-2">
              <li>
                <strong>Permisos <code>ACCESS_FINE_LOCATION</code> y <code>ACCESS_COARSE_LOCATION</code>:</strong> Se emplean únicamente mientras el arquero mantiene una sesión de entrenamiento o competencia activa en pantalla para calcular mediante geometría geodésica la distancia caminada de ida y vuelta hacia la diana en metros y pies (<code>mts / ft</code>). No recopilamos ubicaciones cuando la aplicación está cerrada ni almacenamos historiales de rutas GPS comerciales.
              </li>
              <li>
                <strong>Podómetro, Pasos y Calorías Activas (<code>kcal</code>):</strong> Integramos el conteo de pasos de la sesión y la telemetría del reloj inteligente deportivo vinculado para estimar distancia caminada bajo techo y gasto energético activo (<code>kcal</code>). Los códigos de vinculación de reloj inteligente de 6 dígitos son efímeros y expiran automáticamente 24 horas después de la última actividad del teléfono.
              </li>
            </ul>
          </section>

          {/* SECCIÓN 4: Micrófono (Cronógrafo Acústico y Voz en Duelos) */}
          <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3.5">
            <div className="flex items-center gap-2 text-white font-bold text-base">
              <Mic size={18} className="text-cyan-neon shrink-0" />
              <h2>4. Permiso de Micrófono (<code>RECORD_AUDIO</code>)</h2>
            </div>
            <p className="text-white text-xs sm:text-sm leading-relaxed">
              El permiso <code>RECORD_AUDIO</code> es estrictamente opcional y solo se activa bajo solicitud directa del arquero en dos herramientas específicas:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-1.5">
                <strong className="text-white flex items-center gap-1.5">
                  <Activity size={14} className="text-yellow-gold shrink-0" />
                  <span>Cronógrafo Acústico Balístico</span>
                </strong>
                <p className="text-white leading-relaxed">
                  Analiza localmente en memoria la señal acústica transitoria del disparo y el impacto en el parapeto para calcular la velocidad estimada de la flecha (FPS / m/s). El flujo de audio se descarta en tiempo real en tu propio teléfono y nunca sale del dispositivo.
                </p>
              </div>
              <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-1.5">
                <strong className="text-white flex items-center gap-1.5">
                  <Mic size={14} className="text-cyan-neon shrink-0" />
                  <span>Voz en Vivo Opcional en Duelos</span>
                </strong>
                <p className="text-white leading-relaxed">
                  Permite comunicación de voz directa punto a punto cuando el usuario pulsa voluntariamente el control de audio durante eliminatorias en línea. Ninguna conversación ni sonido ambiental se graba ni almacena en servidores.
                </p>
              </div>
            </div>
          </section>

          {/* SECCIÓN 5: Fotos Temporales de Verificación en Duelos */}
          <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-white font-bold text-base">
              <Camera size={18} className="text-yellow-gold shrink-0" />
              <h2>5. Fotografías Temporales de Verificación en Duelos</h2>
            </div>
            <p className="text-white text-xs sm:text-sm leading-relaxed">
              Durante un duelo o eliminatoria en línea, los arqueros pueden tomar opcionalmente una fotografía de los impactos en su diana para verificación deportiva ante su oponente. Dichas imágenes se transmiten comprimidas exclusivamente dentro de la sala activa de la partida y <strong>se eliminan al finalizar o cerrarse el duelo</strong>, sin conservarse en galerías públicas ni emplearse para otros fines.
            </p>
          </section>

          {/* SECCIÓN 6: Arquitectura Offline-First y No Venta de Datos */}
          <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-white font-bold text-base">
              <Lock size={18} className="text-red-rival shrink-0" />
              <h2>6. Seguridad, Sincronización Cifrada y No Comercialización</h2>
            </div>
            <ul className="list-disc pl-5 text-xs sm:text-sm text-white space-y-1.5">
              <li>
                <strong>Almacenamiento Local (IndexedDB):</strong> Tus sesiones y configuraciones se guardan de inmediato en tu dispositivo para operar sin conexión a internet (<em>offline-first</em>).
              </li>
              <li>
                <strong>Cifrado en Tránsito y en Reposo:</strong> La sincronización en la nube utiliza canales seguros HTTPS/TLS de 256 bits y autenticación moderna sin almacenar contraseñas en texto plano ni llaves secretas privadas en el cliente.
              </li>
              <li>
                <strong>Cero Venta a Terceros:</strong> Nunca vendemos, alquilamos ni compartimos tus datos personales o biométricos con corredores de datos ni redes publicitarias externas. Si te vinculas mediante código de 6 dígitos con un Entrenador, tus planillas y avances de entrenamiento solo son visibles para ese Entrenador autorizado, y puedes desvincularte en cualquier momento desde tu Perfil.
              </li>
            </ul>
          </section>

          {/* SECCIÓN 7: Protección de Menores */}
          <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-white font-bold text-base">
              <AlertCircle size={18} className="text-cyan-neon shrink-0" />
              <h2>7. Protección de Menores de Edad (Edad Mínima 13 Años)</h2>
            </div>
            <p className="text-xs sm:text-sm text-white leading-relaxed">
              De conformidad con COPPA y GDPR-K, <strong>ARCHERY 101010 bloquea el registro y creación de cuentas a personas menores de 13 años</strong>. Los atletas jóvenes de entre 13 y 17 años deben utilizar la aplicación con el consentimiento y supervisión de su madre, padre, tutor legal o club deportivo autorizado. La activación de cuentas de Entrenador requiere tener al menos <strong>18 años cumplidos</strong>.
            </p>
          </section>

          {/* SECCIÓN 8: Derechos del Usuario y Eliminación Completa de Cuenta */}
          <section
            id="delete-account"
            className="bg-[#07090E] border border-red-rival/30 rounded-3xl p-6 flex flex-col gap-3.5"
          >
            <div className="flex items-center gap-2 text-white font-bold text-base">
              <FileText size={18} className="text-red-rival shrink-0" />
              <h2>8. Tus Derechos y Eliminación Completa de Cuenta y Datos</h2>
            </div>
            <p className="text-white text-xs sm:text-sm leading-relaxed">
              Tienes control permanente sobre tu información y puedes eliminar definitivamente tu cuenta y todos tus datos asociados en cualquier momento mediante cualquiera de estas dos vías:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-1.5">
                <strong className="text-white">1. Eliminación Inmediata desde la App</strong>
                <p className="text-white leading-relaxed">
                  Abre <strong>ARCHERY 101010</strong>, ingresa a <strong>Perfil</strong> y pulsa <strong>&quot;Eliminar mi cuenta y datos&quot;</strong>. Al confirmar, se borran de inmediato tus registros locales y en la nube junto con tu credencial de acceso.
                </p>
              </div>
              <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-1.5">
                <strong className="text-white">2. Solicitud Web por Correo Oficial</strong>
                <p className="text-white leading-relaxed">
                  Si desinstalaste la aplicación, envía un correo desde tu dirección registrada a{" "}
                  <a
                    href="mailto:info@archery101010.com?subject=Eliminar%20mi%20cuenta%20Archery%20101010"
                    className="text-cyan-neon underline font-bold"
                  >
                    info@archery101010.com
                  </a>{" "}
                  con el asunto <em>&quot;Eliminar mi cuenta Archery 101010&quot;</em>.
                </p>
              </div>
            </div>
            <ul className="list-disc pl-5 text-xs text-white space-y-1">
              <li>
                <strong> Alcance total de borrado:</strong> Perfil (<code>users</code>), sesiones y planillas (<code>sessions</code>), insignias e historial de estrellas (<code>athlete_stars</code>, <code>star_history</code>), agenda y ciclos creados (<code>calendar_events</code>, <code>macrocycles</code>), bitácoras y notificaciones (<code>coach_records</code>, <code>coach_notifications</code>), invitaciones a duelos (<code>duel_invitations</code>) y sesiones activas de reloj (<code>watch_sessions</code>). Si eras Entrenador, tus alumnos quedan desvinculados limpiamente sin perder sus propios historiales.
              </li>
              <li>
                <strong>Plazo de ejecución:</strong> Instantáneo (0 días) desde la aplicación y máximo 7 días hábiles para solicitudes recibidas por correo electrónico.
              </li>
            </ul>
          </section>

          {/* SECCIÓN 9: Actualizaciones */}
          <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-white font-bold text-base">
              <RefreshCw size={18} className="text-cyan-neon shrink-0" />
              <h2>9. Actualizaciones de esta Política</h2>
            </div>
            <p className="text-white text-xs sm:text-sm leading-relaxed">
              Podemos actualizar esta Política de Privacidad para reflejar mejoras técnicas o requisitos regulatorios. La fecha de vigencia en el encabezado indicará siempre la revisión oficial aplicable.
            </p>
          </section>
        </div>

        {/* Footer Contact & Legal Links */}
        <div className="border-t border-white/[0.08] pt-6 pb-12 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-white">
          <div className="flex items-center gap-2.5 flex-wrap justify-center sm:justify-start">
            <img
              src="/images/brand_logo_header.png"
              srcSet="/images/brand_logo_header.png 1x, /images/brand_logo_full.png 2x"
              alt="ARCHERY 101010"
              className="h-3 w-auto object-contain shrink-0"
            />
            <span className="font-sans tabular-nums">© 2026 ARCHERY 101010. Todos los derechos reservados.</span>
          </div>

          <div className="flex items-center gap-4">
            <Link
              href="/terms"
              className="text-white hover:text-cyan-neon underline font-bold uppercase tracking-wider text-[12px]"
            >
              Términos de Uso
            </Link>
            <Link
              href="/"
              className="text-cyan-neon hover:underline font-bold uppercase tracking-wider text-[12px]"
            >
              Ir a la Aplicación
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
