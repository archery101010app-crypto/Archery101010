"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useLanguage } from "@/lib/contexts/LanguageContext";
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
  Activity,
  Globe2
} from "lucide-react";

export default function PrivacyPolicyPage() {
  const { language } = useLanguage();
  const [docLang, setDocLang] = useState<"es" | "en">(() =>
    language === "es" ? "es" : "en"
  );
  const [manualOverride, setManualOverride] = useState(false);

  useEffect(() => {
    if (!manualOverride) {
      setDocLang(language === "es" ? "es" : "en");
    }
  }, [language, manualOverride]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.title =
        docLang === "es"
          ? "Política de Privacidad | ARCHERY 101010"
          : "Privacy Policy | ARCHERY 101010";
    }
  }, [docLang]);

  const isEs = docLang === "es";

  const handleSelectLang = (target: "es" | "en") => {
    setManualOverride(true);
    setDocLang(target);
  };

  return (
    <div className="min-h-screen bg-[#020305] py-8 sm:py-10 px-4 sm:px-6 text-white font-sans">
      <div className="max-w-4xl mx-auto flex flex-col gap-7 sm:gap-8">
        {/* Top Navigation + Bilingual Switch */}
        <div className="flex flex-col gap-3 border-b border-white/[0.08] pb-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link
              href="/"
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#12151C] border border-white/[0.10] text-white hover:border-cyan-neon/40 transition active:scale-95 text-xs font-bold"
            >
              <ArrowLeft size={16} />
              <span>{isEs ? "Volver a ARCHERY 101010" : "Back to ARCHERY 101010"}</span>
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

          {/* 1-Tap Language Pill Switch */}
          <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
            <span className="text-[11px] text-white/75 font-bold uppercase tracking-wider flex items-center gap-1.5">
              <Globe2 size={13} className="text-cyan-neon shrink-0" />
              <span>{isEs ? "Idioma del Documento Legal" : "Legal Document Language"}</span>
            </span>

            <div
              role="group"
              aria-label="Language selector"
              className="inline-flex items-center bg-[#12151C] border border-white/[0.12] rounded-xl p-1 gap-1"
            >
              <button
                type="button"
                onClick={() => handleSelectLang("es")}
                aria-pressed={isEs}
                className={`px-3 py-1.5 rounded-lg text-xs font-black tracking-wide transition cursor-pointer ${
                  isEs
                    ? "bg-cyan-neon text-black"
                    : "text-white hover:bg-white/[0.06]"
                }`}
              >
                ES · Español
              </button>
              <button
                type="button"
                onClick={() => handleSelectLang("en")}
                aria-pressed={!isEs}
                className={`px-3 py-1.5 rounded-lg text-xs font-black tracking-wide transition cursor-pointer ${
                  !isEs
                    ? "bg-cyan-neon text-black"
                    : "text-white hover:bg-white/[0.06]"
                }`}
              >
                EN · English
              </button>
            </div>
          </div>
        </div>

        {/* Hero Header */}
        <div className="flex flex-col gap-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#12151C] border border-white/[0.10] text-cyan-neon text-xs font-black uppercase tracking-wider w-fit">
            <ShieldCheck size={14} />
            <span>{isEs ? "Privacidad y Transparencia Global" : "Global Privacy & Transparency"}</span>
          </div>
          <h1 className="text-[30px] sm:text-[38px] font-black text-white tracking-tight leading-tight">
            {isEs ? "Política de Privacidad" : "Privacy Policy"}
          </h1>
          <p className="text-xs sm:text-sm text-white leading-relaxed">
            {isEs ? (
              <>
                En <strong>ARCHERY 101010</strong> protegemos la información deportiva y personal de cada arquero y entrenador bajo estrictos estándares internacionales de seguridad. Esta política detalla qué datos y permisos del dispositivo se utilizan, con qué finalidad exclusiva operan y cómo puedes ejercer tus derechos o eliminar tu cuenta de forma inmediata conforme a <strong>EU y UK GDPR</strong>, <strong>LGPD de Brasil</strong>, <strong>CCPA/CPRA de California</strong>, <strong>PIPA de Corea del Sur</strong>, <strong>COPPA de EE. UU.</strong> y las políticas de las Tiendas Oficiales de Aplicaciones Móviles.
              </>
            ) : (
              <>
                At <strong>ARCHERY 101010</strong>, we safeguard every archer&apos;s and coach&apos;s athletic and personal data under strict international security standards. This policy explains what device permissions and data are processed, their exclusive sporting purposes, and how you can exercise your privacy rights or delete your account instantaneously in full compliance with <strong>EU &amp; UK GDPR</strong>, <strong>Brazil LGPD</strong>, <strong>California CCPA/CPRA</strong>, <strong>South Korea PIPA</strong>, <strong>US COPPA</strong>, and Official Mobile App Store policies.
              </>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-white font-sans tabular-nums">
            <span>
              {isEs ? "Fecha de entrada en vigor: Noviembre de 2026" : "Effective Date: November 2026"}
            </span>
            <span>·</span>
            <Link href="/terms" className="text-cyan-neon hover:underline font-bold">
              {isEs
                ? "Ver Términos y Condiciones de Uso (EULA)"
                : "View Terms of Use & End-User License Agreement (EULA)"}
            </Link>
          </div>
        </div>

        {/* Main Content Sections */}
        {isEs ? (
          <div className="flex flex-col gap-5 text-sm leading-relaxed">
            {/* SECCIÓN 1 */}
            <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <UserCheck size={18} className="text-cyan-neon shrink-0" />
                <h2>1. Responsable del Tratamiento de los Datos</h2>
              </div>
              <p className="text-white text-xs sm:text-sm">
                La plataforma deportiva, aplicación móvil, interfaz para Smartwatch Deportivo y versión web de <strong>ARCHERY 101010 · THE APP</strong> son desarrolladas y operadas por el equipo oficial de ARCHERY 101010 como Responsable del Tratamiento (<em>Data Controller</em>). Para consultas de privacidad, ejercicio de derechos ARCO/GDPR/LGPD/CCPA/PIPA o soporte oficial, contáctanos en:
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

            {/* SECCIÓN 2 */}
            <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-4">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <Database size={18} className="text-yellow-gold shrink-0" />
                <h2>2. Información que Recopilamos y Finalidad Deportiva</h2>
              </div>
              <p className="text-white text-xs sm:text-sm">
                Aplicamos el principio de minimización de datos: recopilamos únicamente la información indispensable para el registro técnico de tiro con arco, cálculo biomecánico y sincronización voluntaria con tu entrenador:
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-2">
                  <h3 className="font-bold text-white flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-cyan-neon" />
                    <span>Identificación y Verificación de Edad Regional</span>
                  </h3>
                  <p className="text-white leading-relaxed tabular-nums">
                    Correo electrónico, nombre, apodo opcional, país, ciudad, género y fecha de nacimiento, empleada exclusivamente para validar la edad mínima legal de consentimiento digital (<strong>13+ general</strong>, <strong>14–16+</strong> donde lo exija la ley nacional GDPR/PIPA salvo autorización de madre, padre o tutor, y <strong>18+ obligatorio</strong> para Entrenadores y Administradores de Club).
                  </p>
                </div>

                <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-2">
                  <h3 className="font-bold text-white flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-yellow-gold" />
                    <span>Datos Antropométricos Opcionales</span>
                  </h3>
                  <p className="text-white leading-relaxed tabular-nums">
                    Estatura (cm / ft-in), peso corporal (kg / lbs), mano y ojo dominante. Estos valores son estrictamente opcionales y se utilizan únicamente para calcular la longitud de zancada y el gasto energético activo (kcal) al tensar el arco y caminar hacia la diana.
                  </p>
                </div>

                <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-2">
                  <h3 className="font-bold text-white flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-red-rival" />
                    <span>Planillas, Equipamiento y Ciclos</span>
                  </h3>
                  <p className="text-white leading-relaxed tabular-nums">
                    Puntuaciones por tanda, impactos en diana, configuración del arco (modalidad, potencia en lbs, distancia en metros o yardas), estrellas 101010 alcanzadas, eventos de calendario y planes de entrenamiento.
                  </p>
                </div>

                <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-2">
                  <h3 className="font-bold text-white flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-green-success" />
                    <span>Diagnóstico Técnico Acotado</span>
                  </h3>
                  <p className="text-white leading-relaxed tabular-nums">
                    Registros técnicos limitados ante fallos inesperados de interfaz (máximo 5 reportes por sesión) sin contenido privado, destinados exclusivamente a garantizar estabilidad en teléfonos móviles.
                  </p>
                </div>
              </div>
            </section>

            {/* SECCIÓN 3 */}
            <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3.5">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <MapPin size={18} className="text-cyan-neon shrink-0" />
                <h2>3. Ubicación en Primer Plano y Telemetría de Smartwatch Deportivo</h2>
              </div>
              <div className="bg-[#12151C] border border-white/[0.10] p-3.5 rounded-2xl text-xs text-white font-bold flex items-start gap-2.5">
                <CheckCircle2 size={16} className="text-cyan-neon shrink-0 mt-0.5" />
                <span>
                  Cero rastreo en segundo plano: La ubicación solo opera mientras una sesión de tiro está activa en pantalla y jamás se utiliza para publicidad ni perfilado comercial.
                </span>
              </div>
              <ul className="list-disc pl-5 text-xs sm:text-sm text-white space-y-2 tabular-nums">
                <li>
                  <strong>Ubicación Precisa y Aproximada en Primer Plano:</strong> Se emplea únicamente mientras el arquero mantiene una sesión activa en pantalla para calcular por geometría geodésica la distancia caminada de ida y vuelta hacia la diana (m / km / ft / mi). No recopilamos ubicaciones con la aplicación cerrada ni almacenamos rutas GPS comerciales.
                </li>
                <li>
                  <strong>Podómetro, Pasos y Reloj Inteligente Deportivo:</strong> Integramos el conteo de pasos de la sesión y la telemetría del Smartwatch Deportivo vinculado para estimar distancia bajo techo y calorías activas (kcal). Los códigos de vinculación de 6 dígitos para reloj inteligente son efímeros y expiran automáticamente 24 horas después de la última actividad del teléfono.
                </li>
              </ul>
            </section>

            {/* SECCIÓN 4 */}
            <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3.5">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <Mic size={18} className="text-cyan-neon shrink-0" />
                <h2>4. Permiso Opcional de Micrófono (Audio Local y Voz en Duelos)</h2>
              </div>
              <p className="text-white text-xs sm:text-sm leading-relaxed">
                El acceso al micrófono del dispositivo es estrictamente opcional y solo se activa por acción expresa del usuario en tres herramientas puntuales:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-1.5">
                  <strong className="text-white flex items-center gap-1.5">
                    <Activity size={14} className="text-yellow-gold shrink-0" />
                    <span>Cronógrafo Acústico Balístico</span>
                  </strong>
                  <p className="text-white leading-relaxed">
                    Analiza localmente en memoria la onda acústica del disparo y el impacto en el parapeto para estimar la velocidad de la flecha (FPS / m/s). El audio se descarta en tiempo real en tu teléfono y nunca se sube a ningún servidor.
                  </p>
                </div>
                <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-1.5">
                  <strong className="text-white flex items-center gap-1.5">
                    <Activity size={14} className="text-cyan-neon shrink-0" />
                    <span>Conteo Doble Llave en Reloj Inteligente</span>
                  </strong>
                  <p className="text-white leading-relaxed">
                    En relojes inteligentes compatibles con micrófono, cuando el usuario activa opcionalmente el auto-conteo, detecta en memoria volátil el chasquido agudo de la cuerda sincronizado con el acelerómetro. Jamás se graba, almacena ni transmite audio.
                  </p>
                </div>
                <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-1.5">
                  <strong className="text-white flex items-center gap-1.5">
                    <Mic size={14} className="text-cyan-neon shrink-0" />
                    <span>Voz en Vivo Opcional en Eliminatorias</span>
                  </strong>
                  <p className="text-white leading-relaxed">
                    Permite comunicación de voz directa punto a punto cuando el arquero activa voluntariamente el control de voz durante un duelo en línea. Ninguna conversación se graba ni almacena en la nube.
                  </p>
                </div>
              </div>
            </section>

            {/* SECCIÓN 5 */}
            <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <Camera size={18} className="text-yellow-gold shrink-0" />
                <h2>5. Fotografías Efímeras de Verificación en Duelos</h2>
              </div>
              <p className="text-white text-xs sm:text-sm leading-relaxed">
                Durante una eliminatoria en línea, los arqueros pueden capturar opcionalmente una fotografía de los impactos en su diana para verificación deportiva ante su oponente. Estas imágenes se transmiten comprimidas únicamente dentro de la sala activa del encuentro y <strong>se eliminan de forma automática al finalizar o cerrarse el duelo</strong>, sin conservarse en galerías públicas ni emplearse para entrenamiento de algoritmos externos.
              </p>
            </section>

            {/* SECCIÓN 6 */}
            <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <Lock size={18} className="text-red-rival shrink-0" />
                <h2>6. Seguridad Offline-First, Cifrado y No Venta de Datos</h2>
              </div>
              <ul className="list-disc pl-5 text-xs sm:text-sm text-white space-y-1.5">
                <li>
                  <strong>Arquitectura Local Resiliente (Offline-First):</strong> Tus sesiones y ajustes se guardan al instante en el almacenamiento local de tu dispositivo para operar incluso sin conexión a internet.
                </li>
                <li>
                  <strong>Cifrado en Tránsito y en Reposo:</strong> Toda sincronización en la nube utiliza canales cifrados HTTPS/TLS de 256 bits y reglas estrictas de control de acceso por propietario y club.
                </li>
                <li>
                  <strong>Cero Venta o Cesión Comercial:</strong> Jamás vendemos, alquilamos ni compartimos tus datos personales, antropométricos o deportivos con corredores de datos ni redes de publicidad comportamental. Si te vinculas mediante código de 6 dígitos con un Entrenador, tus planillas solo son visibles para ese Entrenador autorizado, pudiendo desvincularte en cualquier instante desde tu Perfil.
                </li>
              </ul>
            </section>

            {/* SECCIÓN 7: Normativas Internacionales */}
            <section className="bg-[#07090E] border border-cyan-neon/25 rounded-3xl p-6 flex flex-col gap-4">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <Globe2 size={18} className="text-cyan-neon shrink-0" />
                <h2>7. Cumplimiento Internacional y Derechos Regionales de Privacidad</h2>
              </div>
              <p className="text-xs sm:text-sm text-white leading-relaxed">
                Garantizamos el pleno ejercicio de tus derechos de protección de datos conforme a la legislación aplicable en tu país o estado de residencia:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-1.5">
                  <strong className="text-cyan-neon">Unión Europea y Reino Unido (EU &amp; UK GDPR)</strong>
                  <p className="text-white leading-relaxed">
                    El tratamiento se fundamenta en la ejecución del servicio solicitado (Art. 6.1.b) y tu consentimiento explícito revocable (Art. 6.1.a). Tienes derecho de acceso, rectificación, supresión («derecho al olvido»), limitación, portabilidad en formato estructurado (CSV/JSON), oposición y reclamación ante tu autoridad nacional de control. Las transferencias internacionales se protegen mediante cláusulas contractuales tipo vigentes.
                  </p>
                </div>

                <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-1.5">
                  <strong className="text-cyan-neon">Brasil (LGPD · Lei Geral de Proteção de Dados)</strong>
                  <p className="text-white leading-relaxed">
                    Conforme a la Ley N.º 13.709/2018 (Art. 14 y Art. 18), los usuarios en Brasil cuentan con confirmación de tratamiento, acceso, corrección de datos incompletos o inexactos, anonimización o eliminación inmediata, portabilidad e información clara sobre la revocación del consentimiento y protección prioritaria de adolescentes.
                  </p>
                </div>

                <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-1.5">
                  <strong className="text-yellow-gold">California, EE. UU. (CCPA / CPRA)</strong>
                  <p className="text-white leading-relaxed">
                    Los residentes de California poseen el Derecho a Saber (<em>Right to Know</em>), Derecho a Eliminar (<em>Right to Delete</em>), Derecho a Corregir (<em>Right to Correct</em>) y Derecho a la No Discriminación. Declaramos expresamente que <strong>no vendemos ni compartimos información personal ni biométrica</strong> (<em>Do Not Sell or Share My Personal Information</em>).
                  </p>
                </div>

                <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-1.5">
                  <strong className="text-yellow-gold">Corea del Sur (PIPA) y EE. UU. (COPPA)</strong>
                  <p className="text-white leading-relaxed tabular-nums">
                    Bajo <strong>PIPA</strong> (Corea del Sur), recolectamos el mínimo estricto de datos, exigimos autorización de representante legal para menores de <strong>14 años</strong> y destruimos de forma irreversible los registros al cancelar la cuenta. Bajo <strong>US COPPA</strong>, bloqueamos técnicamente todo registro de menores de <strong>13 años</strong>.
                  </p>
                </div>
              </div>
            </section>

            {/* SECCIÓN 8: Edad Mínima Regional */}
            <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <AlertCircle size={18} className="text-cyan-neon shrink-0" />
                <h2>8. Protección de Menores y Edad Mínima de Consentimiento Digital</h2>
              </div>
              <ul className="list-disc pl-5 text-xs sm:text-sm text-white space-y-2 tabular-nums">
                <li>
                  <strong>Bloqueo Estricto Menores de 13 Años (13+ General):</strong> Ninguna persona menor de <strong>13 años</strong> puede crear una cuenta en <strong>ARCHERY 101010</strong> (cumplimiento estricto COPPA y estándar global).
                </li>
                <li>
                  <strong>Umbrales Nacionales de 14 a 16 Años (GDPR Art. 8 / PIPA):</strong> En jurisdicciones cuya ley nacional establece una edad superior para el consentimiento digital autónomo (<strong>14+</strong> en Corea del Sur bajo PIPA, España, Italia o Perú; <strong>15–16+</strong> en Estados miembros aplicables de la UE), el registro de atletas menores de dicho umbral requiere la autorización y supervisión verificable de su madre, padre, tutor legal o club deportivo acreditado.
                </li>
                <li>
                  <strong>Entrenadores y Administradores de Club (18+ Obligatorio):</strong> La activación de cuentas de Entrenador, emisión de códigos de club y suscripción a planes profesionales exige tener al menos <strong>18 años cumplidos</strong>.
                </li>
              </ul>
            </section>

            {/* SECCIÓN 9: Eliminación Instantánea */}
            <section
              id="delete-account"
              className="bg-[#07090E] border border-red-rival/30 rounded-3xl p-6 flex flex-col gap-3.5"
            >
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <FileText size={18} className="text-red-rival shrink-0" />
                <h2>9. Eliminación Instantánea de Cuenta y Datos en la Nube (Autoservicio)</h2>
              </div>
              <p className="text-white text-xs sm:text-sm leading-relaxed">
                Tienes control total y permanente sobre tu cuenta. Puedes borrar definitivamente tu perfil y todos tus datos locales y en la nube en cualquier momento por cualquiera de estas dos vías:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-1.5">
                  <strong className="text-white">1. Botón de Autoservicio Inmediato en la App</strong>
                  <p className="text-white leading-relaxed">
                    Abre <strong>ARCHERY 101010</strong>, ve a <strong>Perfil</strong> y pulsa <strong>«Eliminar Cuenta / Eliminar mi cuenta y datos»</strong>. Al confirmar, tu credencial y todos tus documentos en la nube y en el dispositivo se destruyen al instante (latencia de 0 días).
                  </p>
                </div>
                <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-1.5">
                  <strong className="text-white">2. Solicitud Web por Correo Oficial</strong>
                  <p className="text-white leading-relaxed">
                    Si ya desinstalaste la aplicación, envía un mensaje desde tu correo registrado a{" "}
                    <a
                      href="mailto:info@archery101010.com?subject=Eliminar%20Cuenta%20Archery%20101010"
                      className="text-cyan-neon underline font-bold"
                    >
                      info@archery101010.com
                    </a>{" "}
                    con el asunto <em>«Eliminar Cuenta Archery 101010»</em> (ejecución máxima en 7 días hábiles).
                  </p>
                </div>
              </div>
              <ul className="list-disc pl-5 text-xs text-white space-y-1 tabular-nums">
                <li>
                  <strong>Alcance completo de destrucción:</strong> Perfil de usuario, planillas y sesiones de tiro, insignias e historial de estrellas 101010, eventos de agenda y ciclos creados, bitácoras y avisos de entrenador, invitaciones a duelos y vinculaciones activas de Smartwatch Deportivo. Si eras Entrenador, tus alumnos quedan desvinculados limpiamente conservando sus propios historiales deportivos.
                </li>
              </ul>
            </section>

            {/* SECCIÓN 10 */}
            <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <RefreshCw size={18} className="text-cyan-neon shrink-0" />
                <h2>10. Actualizaciones de esta Política</h2>
              </div>
              <p className="text-white text-xs sm:text-sm leading-relaxed">
                Podemos actualizar esta Política de Privacidad para reflejar mejoras técnicas o nuevos requerimientos regulatorios internacionales. La fecha de entrada en vigor en el encabezado indicará siempre la versión oficial vigente.
              </p>
            </section>
          </div>
        ) : (
          /* ================= ENGLISH VERSION ================= */
          <div className="flex flex-col gap-5 text-sm leading-relaxed">
            {/* SECTION 1 */}
            <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <UserCheck size={18} className="text-cyan-neon shrink-0" />
                <h2>1. Data Controller &amp; Privacy Contact</h2>
              </div>
              <p className="text-white text-xs sm:text-sm">
                The sports performance platform, mobile application, Sports Smartwatch companion interface, and web application of <strong>ARCHERY 101010 · THE APP</strong> are developed and operated by the official ARCHERY 101010 team as the Data Controller. For privacy inquiries, data subject requests (GDPR, LGPD, CCPA/CPRA, PIPA, COPPA), or support, contact us directly at:
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

            {/* SECTION 2 */}
            <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-4">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <Database size={18} className="text-yellow-gold shrink-0" />
                <h2>2. Information We Collect &amp; Sporting Purpose</h2>
              </div>
              <p className="text-white text-xs sm:text-sm">
                We strictly apply data minimization: we collect only the data required for technical archery scoring, biomechanical telemetry, and optional synchronization with your authorized coach:
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-2">
                  <h3 className="font-bold text-white flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-cyan-neon" />
                    <span>Identity &amp; Regional Age Verification</span>
                  </h3>
                  <p className="text-white leading-relaxed tabular-nums">
                    Email address, full name, optional nickname, country, city, gender, and date of birth, processed strictly to enforce regional minimum digital consent ages (<strong>13+ general minimum</strong>, <strong>14–16+</strong> where mandated by national GDPR/PIPA law unless authorized by a parent or legal guardian, and <strong>18+ mandatory</strong> for Coaches and Club Administrators).
                  </p>
                </div>

                <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-2">
                  <h3 className="font-bold text-white flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-yellow-gold" />
                    <span>Optional Anthropometric Metrics</span>
                  </h3>
                  <p className="text-white leading-relaxed tabular-nums">
                    Height (cm / ft-in), body weight (kg / lbs), dominant hand, and dominant eye. Providing these values is completely optional and used exclusively to compute stride length and active energy expenditure (kcal) while drawing the bow and walking to the target.
                  </p>
                </div>

                <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-2">
                  <h3 className="font-bold text-white flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-red-rival" />
                    <span>Scorecards, Bow Setup &amp; Training Plans</span>
                  </h3>
                  <p className="text-white leading-relaxed tabular-nums">
                    End-by-end arrow scores, target impact coordinates, bow configuration (division, draw weight in lbs, shooting distance in meters or yards), unlocked 101010 Stars, calendar events, and training cycles.
                  </p>
                </div>

                <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-2">
                  <h3 className="font-bold text-white flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-green-success" />
                    <span>Bounded Stability Diagnostics</span>
                  </h3>
                  <p className="text-white leading-relaxed tabular-nums">
                    Strictly capped crash logs for unexpected UI errors (maximum 5 reports per session) containing zero private content, used solely to maintain mobile reliability.
                  </p>
                </div>
              </div>
            </section>

            {/* SECTION 3 */}
            <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3.5">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <MapPin size={18} className="text-cyan-neon shrink-0" />
                <h2>3. Foreground Location &amp; Sports Smartwatch Telemetry</h2>
              </div>
              <div className="bg-[#12151C] border border-white/[0.10] p-3.5 rounded-2xl text-xs text-white font-bold flex items-start gap-2.5">
                <CheckCircle2 size={16} className="text-cyan-neon shrink-0 mt-0.5" />
                <span>
                  Zero background tracking: Location is accessed exclusively while an active shooting session is open on screen and is never used for advertising or commercial profiling.
                </span>
              </div>
              <ul className="list-disc pl-5 text-xs sm:text-sm text-white space-y-2 tabular-nums">
                <li>
                  <strong>Foreground Fine &amp; Coarse Location:</strong> Used solely while an archer keeps a live practice or tournament session active on screen to calculate round-trip walked distance to the target (m / km / ft / mi) via geodesic geometry. We never collect location data when the app is closed, nor do we store commercial GPS route histories.
                </li>
                <li>
                  <strong>Pedometer, Step Count &amp; Sports Smartwatch Sync:</strong> Session step counts and paired Sports Smartwatch telemetry are processed to estimate indoor walked distance and active calories burned (kcal). Six-digit smartwatch pairing codes are ephemeral and automatically expire 24 hours after the phone&apos;s last activity.
                </li>
              </ul>
            </section>

            {/* SECTION 4 */}
            <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3.5">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <Mic size={18} className="text-cyan-neon shrink-0" />
                <h2>4. Optional Microphone Permission (On-Device Audio &amp; Live Duels)</h2>
              </div>
              <p className="text-white text-xs sm:text-sm leading-relaxed">
                Microphone access is strictly optional and only activates upon explicit user action inside three dedicated features:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-1.5">
                  <strong className="text-white flex items-center gap-1.5">
                    <Activity size={14} className="text-yellow-gold shrink-0" />
                    <span>Acoustic Ballistic Chronograph</span>
                  </strong>
                  <p className="text-white leading-relaxed">
                    Analyzes transient shot release and target impact sound waves locally in volatile memory to estimate arrow speed (FPS / m/s). Raw audio is discarded in real time on your device and is never uploaded to any server.
                  </p>
                </div>
                <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-1.5">
                  <strong className="text-white flex items-center gap-1.5">
                    <Activity size={14} className="text-cyan-neon shrink-0" />
                    <span>Dual-Key Smartwatch Shot Detection</span>
                  </strong>
                  <p className="text-white leading-relaxed">
                    On compatible smartwatches with a microphone, when optional auto-counting is enabled, analyzes transient bowstring release peaks locally in volatile memory alongside wrist motion. Audio is never recorded, saved, or transmitted.
                  </p>
                </div>
                <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-1.5">
                  <strong className="text-white flex items-center gap-1.5">
                    <Mic size={14} className="text-cyan-neon shrink-0" />
                    <span>Optional Live Voice in Online Duels</span>
                  </strong>
                  <p className="text-white leading-relaxed">
                    Enables peer-to-peer voice communication only when the archer voluntarily toggles live audio during an online elimination match. No voice stream or ambient audio is ever recorded or stored on servers.
                  </p>
                </div>
              </div>
            </section>

            {/* SECTION 5 */}
            <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <Camera size={18} className="text-yellow-gold shrink-0" />
                <h2>5. Ephemeral Target Verification Photos in Online Duels</h2>
              </div>
              <p className="text-white text-xs sm:text-sm leading-relaxed">
                During a live online match, archers may optionally photograph arrow impacts on their target face for sporting verification with their opponent. Verification images are transmitted in compressed form solely within the active match room and are <strong>automatically deleted as soon as the duel concludes or closes</strong>; they are never retained in public galleries or used to train external models.
              </p>
            </section>

            {/* SECTION 6 */}
            <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <Lock size={18} className="text-red-rival shrink-0" />
                <h2>6. Offline-First Security, Encryption &amp; Zero Sale of Data</h2>
              </div>
              <ul className="list-disc pl-5 text-xs sm:text-sm text-white space-y-1.5">
                <li>
                  <strong>Offline-First Local Resilience:</strong> Your sessions and preferences are saved immediately in on-device storage so you can score seamlessly without internet connectivity.
                </li>
                <li>
                  <strong>Encryption in Transit &amp; at Rest:</strong> Cloud synchronization uses 256-bit HTTPS/TLS encrypted channels with strict owner- and club-scoped access controls, without storing plaintext passwords or private secret keys on the client.
                </li>
                <li>
                  <strong>Strict Zero-Sale Commitment:</strong> We never sell, rent, or trade your personal, anthropometric, or athletic data to data brokers or third-party ad networks. When you voluntarily link with a Coach via a 6-digit invite code, your scorecards are visible only to that authorized Coach, and you may unlink at any moment from your Profile.
                </li>
              </ul>
            </section>

            {/* SECTION 7: Global Privacy Frameworks */}
            <section className="bg-[#07090E] border border-cyan-neon/25 rounded-3xl p-6 flex flex-col gap-4">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <Globe2 size={18} className="text-cyan-neon shrink-0" />
                <h2>7. International Compliance &amp; Regional Privacy Rights</h2>
              </div>
              <p className="text-xs sm:text-sm text-white leading-relaxed">
                We uphold comprehensive statutory privacy protections across global jurisdictions:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-1.5">
                  <strong className="text-cyan-neon">European Union &amp; United Kingdom (EU &amp; UK GDPR)</strong>
                  <p className="text-white leading-relaxed">
                    Data processing is grounded in performance of the requested service (Art. 6(1)(b)) and revocable explicit consent (Art. 6(1)(a)). EEA and UK users hold full rights of access, rectification, erasure (&ldquo;right to be forgotten&rdquo;), restriction, structured data portability (CSV/JSON), objection, and lodging a complaint with their supervisory authority. Cross-border cloud transfers rely on approved Standard Contractual Clauses (SCCs).
                  </p>
                </div>

                <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-1.5">
                  <strong className="text-cyan-neon">Brazil (LGPD · Lei Geral de Proteção de Dados)</strong>
                  <p className="text-white leading-relaxed">
                    Under Brazilian Law No. 13.709/2018 (Arts. 14 &amp; 18), users in Brazil have the right to confirmation of processing, access, correction of incomplete or inaccurate data, anonymization or immediate deletion, data portability, revocation of consent, and best-interest safeguards for adolescent athletes.
                  </p>
                </div>

                <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-1.5">
                  <strong className="text-yellow-gold">California, USA (CCPA / CPRA)</strong>
                  <p className="text-white leading-relaxed">
                    California residents hold the Right to Know, Right to Delete, Right to Correct, and Right to Non-Discrimination. We explicitly affirm that <strong>we do not sell or share personal or biometric information</strong> for cross-context behavioral advertising (<em>Do Not Sell or Share My Personal Information</em>).
                  </p>
                </div>

                <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-1.5">
                  <strong className="text-yellow-gold">South Korea (PIPA) &amp; United States (COPPA)</strong>
                  <p className="text-white leading-relaxed tabular-nums">
                    Under South Korea&apos;s <strong>PIPA</strong>, we enforce strict purpose limitation, minimum data collection, verifiable legal representative consent for users under <strong>14 years old</strong>, and immediate irreversible destruction of personal records upon account deletion. Under <strong>US COPPA</strong>, registration by children under <strong>13 years old</strong> is strictly blocked.
                  </p>
                </div>
              </div>
            </section>

            {/* SECTION 8: Regional Minimum Age */}
            <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <AlertCircle size={18} className="text-cyan-neon shrink-0" />
                <h2>8. Protection of Minors &amp; Regional Digital Consent Age</h2>
              </div>
              <ul className="list-disc pl-5 text-xs sm:text-sm text-white space-y-2 tabular-nums">
                <li>
                  <strong>Strict Block Under Age 13 (13+ Global Baseline):</strong> No individual under <strong>13 years of age</strong> may register or create an account on <strong>ARCHERY 101010</strong> (in strict compliance with US COPPA and global child safety standards).
                </li>
                <li>
                  <strong>14–16+ National Thresholds (GDPR Art. 8 / PIPA):</strong> Where national law establishes a higher digital consent age (such as <strong>14+</strong> in South Korea under PIPA, Spain, Italy, or Austria, and <strong>15–16+</strong> in applicable EU Member States), youth athletes below that national threshold may only use the platform with verifiable authorization and supervision from a parent, legal guardian, or accredited sports club.
                </li>
                <li>
                  <strong>Coaches &amp; Club Administrators (18+ Mandatory):</strong> Activating a Coach account, generating 6-digit student invite codes, or subscribing to professional coaching tiers requires being at least <strong>18 years of age</strong>.
                </li>
              </ul>
            </section>

            {/* SECTION 9: Self-Service Account Deletion */}
            <section
              id="delete-account"
              className="bg-[#07090E] border border-red-rival/30 rounded-3xl p-6 flex flex-col gap-3.5"
            >
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <FileText size={18} className="text-red-rival shrink-0" />
                <h2>9. Instant Self-Service Account &amp; Cloud Data Deletion</h2>
              </div>
              <p className="text-white text-xs sm:text-sm leading-relaxed">
                You retain full control over your data at all times and can permanently delete your account and all associated cloud and local records through either of two channels:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-1.5">
                  <strong className="text-white">1. Instant In-App Self-Service Deletion</strong>
                  <p className="text-white leading-relaxed">
                    Open <strong>ARCHERY 101010</strong>, go to <strong>Profile</strong>, and tap <strong>&ldquo;Delete Account / Delete my account and data&rdquo;</strong> (<em>Eliminar Cuenta</em>). Upon confirmation, your authentication credential and all local and cloud records are permanently erased immediately (0-day latency).
                  </p>
                </div>
                <div className="bg-[#12151C] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-1.5">
                  <strong className="text-white">2. Official Email Deletion Request</strong>
                  <p className="text-white leading-relaxed">
                    If you have already uninstalled the app, email{" "}
                    <a
                      href="mailto:info@archery101010.com?subject=Delete%20Account%20Archery%20101010"
                      className="text-cyan-neon underline font-bold"
                    >
                      info@archery101010.com
                    </a>{" "}
                    from your registered email address with the subject line <em>&ldquo;Delete Account Archery 101010&rdquo;</em> (processed within 7 business days maximum).
                  </p>
                </div>
              </div>
              <ul className="list-disc pl-5 text-xs text-white space-y-1 tabular-nums">
                <li>
                  <strong>Complete Deletion Scope:</strong> User profile, shooting sessions and scorecards, unlocked 101010 Stars and star history, calendar events and macrocycles, coach records and notifications, duel invitations, and active Sports Smartwatch sessions. If you were a Coach, linked students are cleanly unlinked while keeping their own personal training histories intact.
                </li>
              </ul>
            </section>

            {/* SECTION 10 */}
            <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <RefreshCw size={18} className="text-cyan-neon shrink-0" />
                <h2>10. Updates to This Privacy Policy</h2>
              </div>
              <p className="text-white text-xs sm:text-sm leading-relaxed">
                We may update this Privacy Policy to reflect technical enhancements or evolving international regulatory requirements. The effective date at the top of this page always indicates the active official revision.
              </p>
            </section>
          </div>
        )}

        {/* Footer Contact & Legal Links */}
        <div className="border-t border-white/[0.08] pt-6 pb-12 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-white">
          <div className="flex items-center gap-2.5 flex-wrap justify-center sm:justify-start">
            <img
              src="/images/brand_logo_header.png"
              srcSet="/images/brand_logo_header.png 1x, /images/brand_logo_full.png 2x"
              alt="ARCHERY 101010"
              className="h-3 w-auto object-contain shrink-0"
            />
            <span className="font-sans tabular-nums">
              {isEs
                ? "© 2026 ARCHERY 101010. Todos los derechos reservados."
                : "© 2026 ARCHERY 101010. All rights reserved."}
            </span>
          </div>

          <div className="flex items-center gap-4">
            <Link
              href="/terms"
              className="text-white hover:text-cyan-neon underline font-bold uppercase tracking-wider text-[12px]"
            >
              {isEs ? "Términos de Uso" : "Terms of Use"}
            </Link>
            <Link
              href="/"
              className="text-cyan-neon hover:underline font-bold uppercase tracking-wider text-[12px]"
            >
              {isEs ? "Ir a la Aplicación" : "Open App"}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
