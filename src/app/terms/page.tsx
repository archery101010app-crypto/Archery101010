"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import {
  ArrowLeft,
  Scale,
  ShieldAlert,
  UserCheck,
  Award,
  CreditCard,
  Copyright,
  Trash2,
  Mail,
  CheckCircle2,
  Globe2
} from "lucide-react";

export default function TermsOfUsePage() {
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
          ? "Términos y Condiciones de Uso (EULA) | ARCHERY 101010"
          : "Terms of Use & EULA | ARCHERY 101010";
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
              <span>{isEs ? "Idioma del Acuerdo Legal" : "Legal Agreement Language"}</span>
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
            <Scale size={14} />
            <span>
              {isEs
                ? "Acuerdo de Licencia y Condiciones (EULA)"
                : "Terms of Use & End-User License Agreement (EULA)"}
            </span>
          </div>
          <h1 className="text-[30px] sm:text-[38px] font-black text-white tracking-tight leading-tight">
            {isEs ? "Términos y Condiciones de Uso" : "Terms & Conditions of Use"}
          </h1>
          <p className="text-xs sm:text-sm text-white leading-relaxed">
            {isEs ? (
              <>
                Bienvenido a <strong>ARCHERY 101010 · THE APP</strong>. Al crear una cuenta, descargar, instalar o utilizar nuestra aplicación móvil, módulos para Smartwatch Deportivo o plataforma web, aceptas vincularte legalmente por los presentes Términos y Condiciones de Uso y Acuerdo de Licencia de Usuario Final (<em>EULA</em>), redactados en conformidad con los estándares internacionales de protección al consumidor y privacidad (<strong>EU &amp; UK GDPR</strong>, <strong>LGPD de Brasil</strong>, <strong>CCPA/CPRA de California</strong>, <strong>PIPA de Corea del Sur</strong> y <strong>COPPA de EE. UU.</strong>).
              </>
            ) : (
              <>
                Welcome to <strong>ARCHERY 101010 · THE APP</strong>. By creating an account, downloading, installing, or using our mobile application, Sports Smartwatch modules, or web platform, you agree to be legally bound by these Terms &amp; Conditions of Use and End-User License Agreement (<em>EULA</em>), structured in accordance with international consumer and data protection laws (<strong>EU &amp; UK GDPR</strong>, <strong>Brazil LGPD</strong>, <strong>California CCPA/CPRA</strong>, <strong>South Korea PIPA</strong>, and <strong>US COPPA</strong>).
              </>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-white font-sans tabular-nums">
            <span>
              {isEs ? "Vigencia oficial: Noviembre de 2026" : "Effective Date: November 2026"}
            </span>
            <span>·</span>
            <Link href="/privacy" className="text-cyan-neon hover:underline font-bold">
              {isEs ? "Ver Política de Privacidad" : "View Privacy Policy"}
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
                <h2>1. Elegibilidad y Edad Mínima Regional (13+ / 14–16+ GDPR-PIPA / 18+ Coaches)</h2>
              </div>
              <ul className="list-disc pl-5 text-xs sm:text-sm text-white space-y-2 tabular-nums">
                <li>
                  <strong>Atletas (13+ General y 14–16+ según Ley Nacional):</strong> Para registrarte como arquero en <strong>ARCHERY 101010</strong> debes tener al menos <strong>13 años cumplidos</strong> (bloqueo estricto bajo US COPPA). En países cuya legislación exige una edad mayor de consentimiento digital autónomo (como <strong>14+</strong> en Corea del Sur bajo PIPA, España, Italia o Austria, y <strong>15–16+</strong> en Estados miembros aplicables bajo EU GDPR Art. 8), los atletas jóvenes por debajo de dicho umbral declaran contar con el consentimiento y supervisión expresa de su madre, padre, tutor legal o club deportivo acreditado.
                </li>
                <li>
                  <strong>Entrenadores y Administradores de Club (18+ Obligatorio):</strong> La activación del rol de Entrenador, la emisión de códigos de invitación de 6 dígitos para alumnos y la contratación de planes <strong>Coach PRO</strong> están reservadas exclusivamente a personas mayores de <strong>18 años</strong> con plena capacidad legal.
                </li>
              </ul>
            </section>

            {/* SECCIÓN 2 */}
            <section className="bg-[#07090E] border border-yellow-gold/25 rounded-3xl p-6 flex flex-col gap-3.5">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <ShieldAlert size={18} className="text-yellow-gold shrink-0" />
                <h2>2. Seguridad Física en el Campo de Tiro (Descargo Deportivo)</h2>
              </div>
              <div className="bg-[#12151C] border border-white/[0.10] p-3.5 rounded-2xl text-xs text-white font-bold flex items-start gap-2.5">
                <CheckCircle2 size={16} className="text-yellow-gold shrink-0 mt-0.5" />
                <span>
                  Regla de Oro en Línea de Tiro: Nunca manipules tu teléfono móvil ni tu Smartwatch Deportivo mientras tengas una flecha encochada o el arco en tensión.
                </span>
              </div>
              <p className="text-white text-xs sm:text-sm leading-relaxed">
                El tiro con arco involucra equipamiento deportivo de alta energía mecánica. <strong>ARCHERY 101010</strong> opera únicamente como un asistente digital de puntuación, telemetría y planificación. El usuario asume la responsabilidad exclusiva de:
              </p>
              <ul className="list-disc pl-5 text-xs sm:text-sm text-white space-y-1.5">
                <li>Respetar en todo momento los reglamentos oficiales del campo de tiro, las señales acústicas y visuales del Director de Tiro y el despeje total del área antes de disparar o avanzar a recoger flechas.</li>
                <li>Inspeccionar el estado físico de su arco, cuerda, reposaflechas y tubos de flecha antes de cada sesión, utilizando siempre implementos de protección adecuados.</li>
                <li>Reconocer que las estimaciones de velocidad acústica, distancia caminada y calorías activas (kcal) son métricas deportivas orientativas y no constituyen consejo médico ni sustituyen instrumentos de arbitraje homologado.</li>
              </ul>
            </section>

            {/* SECCIÓN 3 */}
            <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <Award size={18} className="text-cyan-neon shrink-0" />
                <h2>3. Cuenta, Vinculación Voluntaria a Clubes y Juego Limpio</h2>
              </div>
              <ul className="list-disc pl-5 text-xs sm:text-sm text-white space-y-2">
                <li>
                  <strong>Custodia de Credenciales:</strong> Eres responsable de resguardar tus credenciales de acceso y de mantener datos veraces en tu perfil deportivo.
                </li>
                <li>
                  <strong>Vinculación Alumno–Entrenador:</strong> El enlace mediante código numérico de 6 dígitos autoriza a tu Entrenador a consultar tus planillas, asignar planes en tu calendario y registrar notas técnicas. Tanto el atleta como el Entrenador pueden desvincular esta relación en cualquier instante desde la aplicación.
                </li>
                <li>
                  <strong>Conducta en Eliminatorias en Línea:</strong> Durante los duelos en vivo queda estrictamente prohibido el abuso verbal por canal de voz, el envío de fotografías ajenas a la diana de tiro y la manipulación fraudulenta de puntajes o tráfico de red. El incumplimiento conllevará la suspensión inmediata de la cuenta.
                </li>
              </ul>
            </section>

            {/* SECCIÓN 4 */}
            <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <CreditCard size={18} className="text-cyan-neon shrink-0" />
                <h2>4. Planes Coach PRO, Cancelación y Restauración de Compras</h2>
              </div>
              <p className="text-white text-xs sm:text-sm leading-relaxed tabular-nums">
                Las herramientas esenciales para atletas son gratuitas (plan <strong>FREE</strong>). Las funciones avanzadas de dirección de equipo, monitoreo en tiempo real y planificación de macrociclos se ofrecen mediante <strong>Coach PRO</strong> (periodos mensuales de 30 días o anuales de 365 días):
              </p>
              <ul className="list-disc pl-5 text-xs sm:text-sm text-white space-y-1.5 tabular-nums">
                <li>
                  <strong>Promociones de Lanzamiento y Facturación Oficial:</strong> Durante fases promocionales bonificadas al 100%, la activación otorga acceso sin costo por el plazo indicado (30 o 365 días). En suscripciones comerciales adquiridas mediante las Tiendas Oficiales de Aplicaciones Móviles, el cargo se procesa directamente en tu cuenta de la tienda correspondiente al confirmar la compra.
                </li>
                <li>
                  <strong>Cancelación Sin Penalidad:</strong> Puedes administrar o cancelar la renovación automática en cualquier momento desde la sección de suscripciones de tu Tienda Oficial de Aplicaciones Móviles al menos 24 horas antes del cierre del periodo vigente. Al concluir el ciclo pagado, tu cuenta regresa al plan <strong>FREE</strong> conservando íntegros tus datos e historial.
                </li>
                <li>
                  <strong>Restauración de Compras:</strong> Si cambias de dispositivo o reinstalas la aplicación, utiliza el botón <strong>«Restaurar Compras»</strong> en el Portal de Entrenador para sincronizar y reactivar sin cargo adicional cualquier suscripción <strong>Coach PRO</strong> activa.
                </li>
              </ul>
            </section>

            {/* SECCIÓN 5 */}
            <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <Copyright size={18} className="text-yellow-gold shrink-0" />
                <h2>5. Licencia de Usuario Final (EULA) y Propiedad Intelectual</h2>
              </div>
              <p className="text-white text-xs sm:text-sm leading-relaxed">
                Se te otorga una licencia personal, limitada, no exclusiva, intransferible y revocable para utilizar <strong>ARCHERY 101010 · THE APP</strong> con fines deportivos personales o de entrenamiento en tu club. Todos los derechos sobre la marca <strong>ARCHERY 101010</strong>, su identidad geométrica oficial, código fuente, interfaz en negro OLED, motores balísticos y diseño visual pertenecen exclusivamente a sus titulares. Queda prohibida la ingeniería inversa, descompilación o explotación comercial no autorizada. Tú conservas en todo momento la propiedad intelectual y portabilidad sobre tus propios registros de tiro.
              </p>
            </section>

            {/* SECCIÓN 6 */}
            <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <Trash2 size={18} className="text-red-rival shrink-0" />
                <h2>6. Baja Voluntaria Instantánea, Marco Legal Global y Garantías</h2>
              </div>
              <p className="text-white text-xs sm:text-sm leading-relaxed">
                Puedes rescindir este acuerdo en cualquier momento ejecutando el borrado inmediato en autoservicio de tu cuenta y datos en la nube desde <strong>Perfil → Eliminar Cuenta / Eliminar mi cuenta y datos</strong>, o mediante los canales descritos en nuestra{" "}
                <Link href="/privacy#delete-account" className="text-cyan-neon underline font-bold">
                  Política de Privacidad
                </Link>
                . Nada en estos Términos limita los derechos irrenunciables reconocidos a los usuarios bajo <strong>EU &amp; UK GDPR</strong>, <strong>LGPD de Brasil</strong>, <strong>CCPA/CPRA de California</strong>, <strong>PIPA de Corea del Sur</strong>, <strong>COPPA de EE. UU.</strong> ni la normativa imperativa de protección al consumidor de tu país de residencia. En la medida máxima permitida por la ley aplicable, la plataforma se ofrece «tal cual» y no asumimos responsabilidad por daños indirectos derivados de cortes externos de red o uso físico inadecuado del equipo de arquería.
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
          </div>
        ) : (
          /* ================= ENGLISH VERSION ================= */
          <div className="flex flex-col gap-5 text-sm leading-relaxed">
            {/* SECTION 1 */}
            <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <UserCheck size={18} className="text-cyan-neon shrink-0" />
                <h2>1. Eligibility &amp; Regional Minimum Age (13+ / 14–16+ GDPR-PIPA / 18+ Coaches)</h2>
              </div>
              <ul className="list-disc pl-5 text-xs sm:text-sm text-white space-y-2 tabular-nums">
                <li>
                  <strong>Athletes (13+ Global Baseline &amp; 14–16+ National Thresholds):</strong> You must be at least <strong>13 years of age</strong> to register an athlete account on <strong>ARCHERY 101010</strong> (strictly enforced under US COPPA). Where national data protection laws require a higher minimum age for independent digital consent (such as <strong>14+</strong> in South Korea under PIPA, Spain, Italy, or Austria, and <strong>15–16+</strong> in applicable EU Member States under GDPR Art. 8), youth archers below that threshold represent that they use the app with the verifiable consent and supervision of their parent, legal guardian, or accredited archery club.
                </li>
                <li>
                  <strong>Coaches &amp; Club Administrators (18+ Mandatory):</strong> Activating a Coach role, generating 6-digit student invitation codes, and subscribing to <strong>Coach PRO</strong> plans are strictly restricted to individuals aged <strong>18 years or older</strong> with full legal capacity.
                </li>
              </ul>
            </section>

            {/* SECTION 2 */}
            <section className="bg-[#07090E] border border-yellow-gold/25 rounded-3xl p-6 flex flex-col gap-3.5">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <ShieldAlert size={18} className="text-yellow-gold shrink-0" />
                <h2>2. Physical Shooting Range Safety &amp; Sports Telemetry Disclaimer</h2>
              </div>
              <div className="bg-[#12151C] border border-white/[0.10] p-3.5 rounded-2xl text-xs text-white font-bold flex items-start gap-2.5">
                <CheckCircle2 size={16} className="text-yellow-gold shrink-0 mt-0.5" />
                <span>
                  Golden Rule on the Shooting Line: Never handle your mobile phone or Sports Smartwatch while an arrow is nocked or your bow is drawn.
                </span>
              </div>
              <p className="text-white text-xs sm:text-sm leading-relaxed">
                Archery involves high mechanical energy sporting equipment. <strong>ARCHERY 101010</strong> serves strictly as a digital scoring, telemetry, and training planning assistant. You assume sole responsibility for:
              </p>
              <ul className="list-disc pl-5 text-xs sm:text-sm text-white space-y-1.5">
                <li>Complying at all times with shooting range safety rules, acoustic and visual commands from the Director of Shooting, and confirming a clear range before shooting or walking forward to retrieve arrows.</li>
                <li>Inspecting the physical integrity of your bow, string, arrow rest, and arrow shafts prior to every session, and wearing appropriate protective gear.</li>
                <li>Acknowledging that acoustic arrow speed estimates, walked distance, and active calorie expenditure (kcal) are informational athletic estimates that do not constitute medical advice or replace certified officiating chronographs.</li>
              </ul>
            </section>

            {/* SECTION 3 */}
            <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <Award size={18} className="text-cyan-neon shrink-0" />
                <h2>3. Account Security, Voluntary Club Linking &amp; Fair Play</h2>
              </div>
              <ul className="list-disc pl-5 text-xs sm:text-sm text-white space-y-2">
                <li>
                  <strong>Credential Custody:</strong> You are responsible for maintaining the confidentiality of your login credentials and the accuracy of your profile information.
                </li>
                <li>
                  <strong>Voluntary Athlete–Coach Linking:</strong> Linking via a 6-digit numerical code authorizes your Coach to view your scorecards, publish training plans to your calendar, and add technical feedback. Either the archer or the Coach may unlink this relationship at any time inside the app.
                </li>
                <li>
                  <strong>Online Elimination Conduct:</strong> Verbal harassment over live voice, uploading non-target images in photo verification, or tampering with scores or network traffic during live duels is strictly prohibited and may result in immediate account suspension.
                </li>
              </ul>
            </section>

            {/* SECTION 4 */}
            <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <CreditCard size={18} className="text-cyan-neon shrink-0" />
                <h2>4. Coach PRO Subscriptions, Cancellation &amp; Restore Purchases</h2>
              </div>
              <p className="text-white text-xs sm:text-sm leading-relaxed tabular-nums">
                Core scoring and training features for athletes are free (<strong>FREE</strong> plan). Advanced team management, live range monitoring, and macrocycle planning tools are offered under <strong>Coach PRO</strong> (30-day Monthly or 365-day Annual periods):
              </p>
              <ul className="list-disc pl-5 text-xs sm:text-sm text-white space-y-1.5 tabular-nums">
                <li>
                  <strong>Launch Promotions &amp; Official App Store Billing:</strong> During 100%-waived launch promotional periods, activation grants complimentary access for the stated term (30 or 365 days). For commercial subscriptions purchased through Official Mobile App Stores, payment is charged to your corresponding store account upon purchase confirmation.
                </li>
                <li>
                  <strong>Penalty-Free Cancellation:</strong> You may manage or cancel auto-renewal at any time through your Official Mobile App Store subscription settings at least 24 hours prior to the end of the current billing cycle. When the active period ends, your account automatically reverts to the <strong>FREE</strong> tier with all historical records preserved intact.
                </li>
                <li>
                  <strong>Restore Purchases:</strong> When switching phones or reinstalling the app, use the built-in <strong>&ldquo;Restore Purchases&rdquo;</strong> button inside the Coach Portal to synchronize and reactivate any valid <strong>Coach PRO</strong> entitlement at no extra cost.
                </li>
              </ul>
            </section>

            {/* SECTION 5 */}
            <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <Copyright size={18} className="text-yellow-gold shrink-0" />
                <h2>5. End-User License (EULA) &amp; Intellectual Property</h2>
              </div>
              <p className="text-white text-xs sm:text-sm leading-relaxed">
                We grant you a personal, limited, non-exclusive, non-transferable, revocable license to use <strong>ARCHERY 101010 · THE APP</strong> for personal athletic training or coaching within your club. All rights, title, and interest in the <strong>ARCHERY 101010</strong> trademark, official curved geometric numeral mark, source code, OLED black visual system, and ballistic engines remain the exclusive property of their respective owners. Reverse engineering, decompilation, or unauthorized commercial exploitation is prohibited. You retain full ownership and portability of your personal shooting records at all times.
              </p>
            </section>

            {/* SECTION 6 */}
            <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <Trash2 size={18} className="text-red-rival shrink-0" />
                <h2>6. Instant Self-Service Account Deletion, Global Consumer Rights &amp; Liability</h2>
              </div>
              <p className="text-white text-xs sm:text-sm leading-relaxed">
                You may terminate this agreement at any time with immediate effect using the built-in self-service deletion flow under <strong>Profile → Delete Account / Delete my account and data</strong> (<em>Eliminar Cuenta</em>), or through the channels detailed in our{" "}
                <Link href="/privacy#delete-account" className="text-cyan-neon underline font-bold">
                  Privacy Policy
                </Link>
                . Nothing in these Terms waives or restricts mandatory statutory rights granted to users under <strong>EU &amp; UK GDPR</strong>, <strong>Brazil LGPD</strong>, <strong>California CCPA/CPRA</strong>, <strong>South Korea PIPA</strong>, <strong>US COPPA</strong>, or mandatory local consumer protection laws in your country of residence. To the maximum extent permitted by applicable law, the platform is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without liability for indirect damages arising from external network outages or improper physical handling of archery equipment.
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
          </div>
        )}

        {/* Footer */}
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
              href="/privacy"
              className="text-white hover:text-cyan-neon underline font-bold uppercase tracking-wider text-[12px]"
            >
              {isEs ? "Política de Privacidad" : "Privacy Policy"}
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
