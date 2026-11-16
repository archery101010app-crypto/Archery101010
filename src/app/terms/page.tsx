import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
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
  CheckCircle2
} from "lucide-react";

export const metadata: Metadata = {
  title: "Términos y Condiciones de Uso (EULA) | ARCHERY 101010",
  description:
    "Términos y Condiciones de Uso y Acuerdo de Licencia de Usuario Final (EULA) de ARCHERY 101010 · THE APP."
};

export default function TermsOfUsePage() {
  const effectiveDate = "Noviembre de 2026";

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
            <Scale size={14} />
            <span>Acuerdo de Licencia y Condiciones (EULA)</span>
          </div>
          <h1 className="text-[31px] sm:text-[38px] font-black text-white tracking-tight">
            Términos y Condiciones de Uso
          </h1>
          <p className="text-xs sm:text-sm text-white leading-relaxed">
            Bienvenido a <strong>ARCHERY 101010 · THE APP</strong>. Al crear una cuenta, descargar, instalar o utilizar nuestra aplicación móvil, módulos para reloj inteligente deportivo o plataforma web, aceptas vincularte legalmente por los presentes Términos y Condiciones de Uso y Acuerdo de Licencia de Usuario Final (<em>EULA</em>).
          </p>
          <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-white font-sans tabular-nums">
            <span>Vigencia oficial: {effectiveDate}</span>
            <span>·</span>
            <Link href="/privacy" className="text-cyan-neon hover:underline font-bold">
              Ver Política de Privacidad
            </Link>
          </div>
        </div>

        {/* Main Content Sections */}
        <div className="flex flex-col gap-5 text-sm leading-relaxed">
          {/* SECCIÓN 1: Elegibilidad y Edad */}
          <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-white font-bold text-base">
              <UserCheck size={18} className="text-cyan-neon shrink-0" />
              <h2>1. Elegibilidad y Requisitos de Edad (13+ Atletas / 18+ Entrenadores)</h2>
            </div>
            <ul className="list-disc pl-5 text-xs sm:text-sm text-white space-y-2">
              <li>
                <strong>Atletas (13 años o más):</strong> Para registrarte y utilizar una cuenta de arquero en <strong>ARCHERY 101010</strong> debes tener al menos <strong>13 años de edad cumplidos</strong>. Los atletas menores de edad (entre 13 y 17 años) declaran contar con la autorización de su madre, padre, tutor legal o club deportivo debidamente acreditado.
              </li>
              <li>
                <strong>Entrenadores y Administradores de Club (18 años o más):</strong> La activación del rol de Entrenador, la generación de códigos de invitación de alumnos y la suscripción a planes <code>Coach PRO</code> están reservadas exclusivamente a personas mayores de <strong>18 años</strong> con plena capacidad legal.
              </li>
            </ul>
          </section>

          {/* SECCIÓN 2: Seguridad Física en el Campo de Tiro */}
          <section className="bg-[#07090E] border border-yellow-gold/25 rounded-3xl p-6 flex flex-col gap-3.5">
            <div className="flex items-center gap-2 text-white font-bold text-base">
              <ShieldAlert size={18} className="text-yellow-gold shrink-0" />
              <h2>2. Seguridad Física en el Campo de Tiro (Descargo Deportivo)</h2>
            </div>
            <div className="bg-[#12151C] border border-white/[0.10] p-3.5 rounded-2xl text-xs text-white font-bold flex items-start gap-2.5">
              <CheckCircle2 size={16} className="text-yellow-gold shrink-0 mt-0.5" />
              <span>
                Regla de Oro en Línea de Tiro: Nunca manipules tu teléfono ni tu reloj inteligente mientras tengas una flecha encochada o el arco en tensión.
              </span>
            </div>
            <p className="text-white text-xs sm:text-sm leading-relaxed">
              El tiro con arco es una disciplina deportiva que involucra equipamiento de alta energía mecánica. <strong>ARCHERY 101010</strong> es únicamente un asistente digital de puntuación, telemetría y planificación. El usuario asume la responsabilidad exclusiva de:
            </p>
            <ul className="list-disc pl-5 text-xs sm:text-sm text-white space-y-1.5">
              <li>Respetar en todo momento los reglamentos de seguridad del campo de tiro, las señales acústicas o visuales del Director de Tiro y el despeje total del área antes de disparar o caminar a recoger flechas.</li>
              <li>Inspeccionar el estado físico de su arco, cuerda, reposaflechas y tubos de flecha antes de cada práctica, así como emplear equipo de protección adecuado.</li>
              <li>Reconocer que las estimaciones de velocidad acústica, distancia caminada y gasto energético (<code>kcal</code>) son métricas deportivas orientativas y no constituyen asesoramiento médico ni reemplazan instrumentos de homologación arbitral oficial.</li>
            </ul>
          </section>

          {/* SECCIÓN 3: Cuenta, Clubes y Conducta Deportiva */}
          <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-white font-bold text-base">
              <Award size={18} className="text-cyan-neon shrink-0" />
              <h2>3. Uso de la Cuenta, Vinculación a Clubes y Juego Limpio</h2>
            </div>
            <ul className="list-disc pl-5 text-xs sm:text-sm text-white space-y-2">
              <li>
                <strong>Custodia de Credenciales:</strong> Eres responsable de mantener la confidencialidad de tus credenciales de acceso y de la veracidad de los datos registrados en tu perfil.
              </li>
              <li>
                <strong>Vinculación Voluntaria Alumno–Entrenador:</strong> La vinculación mediante código numérico de 6 dígitos permite que tu Entrenador consulte tus planillas, asigne ciclos de entrenamiento y agregue observaciones técnicas. Tanto el arquero como el Entrenador pueden desvincular esta relación en cualquier momento desde la aplicación.
              </li>
              <li>
                <strong>Conducta en Eliminatorias en Línea:</strong> Durante los duelos en vivo queda estrictamente prohibido el acoso verbal por canal de voz, el envío de imágenes ajenas a la diana de tiro en la verificación fotográfica y la alteración fraudulenta de puntuaciones o tráfico de red. El incumplimiento podrá resultar en la suspensión inmediata de la cuenta.
              </li>
            </ul>
          </section>

          {/* SECCIÓN 4: Suscripciones Coach PRO (EULA Tiendas Oficiales) */}
          <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-white font-bold text-base">
              <CreditCard size={18} className="text-cyan-neon shrink-0" />
              <h2>4. Planes <code>Coach PRO</code>, Cancelación y Restauración de Compras</h2>
            </div>
            <p className="text-white text-xs sm:text-sm leading-relaxed">
              Las funciones esenciales para atletas son gratuitas (plan <code>FREE</code>). Las herramientas avanzadas de gestión de equipo, monitoreo en tiempo real y planificación de macrociclos se ofrecen bajo la modalidad <code>Coach PRO</code> (periodos mensuales de 30 días o anuales de 365 días):
            </p>
            <ul className="list-disc pl-5 text-xs sm:text-sm text-white space-y-1.5">
              <li>
                <strong>Promociones de Lanzamiento y Facturación:</strong> Durante fases promocionales bonificadas al 100%, la activación otorga acceso sin cargo por el periodo indicado (30 o 365 días). En suscripciones comerciales adquiridas a través de tiendas oficiales de aplicaciones móviles (iOS / Android), el cargo se procesa en la cuenta de la tienda correspondiente tras confirmar la compra.
              </li>
              <li>
                <strong>Cancelación Sin Penalidad:</strong> Puedes gestionar o cancelar la renovación automática de cualquier suscripción comercial en cualquier momento desde los ajustes de suscripciones de tu tienda de aplicaciones al menos 24 horas antes del vencimiento del ciclo vigente. Al finalizar el periodo activo, la cuenta regresa automáticamente al plan <code>FREE</code> conservando intactos tus datos e historial.
              </li>
              <li>
                <strong>Restauración de Acceso:</strong> Si cambias de teléfono o reinstalas la aplicación, puedes utilizar el botón integrado <strong>&quot;Restaurar Compras&quot;</strong> dentro del Portal de Entrenador para sincronizar y reactivar sin costo adicional cualquier periodo <code>Coach PRO</code> vigente asociado a tu cuenta.
              </li>
            </ul>
          </section>

          {/* SECCIÓN 5: Propiedad Intelectual */}
          <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-white font-bold text-base">
              <Copyright size={18} className="text-yellow-gold shrink-0" />
              <h2>5. Licencia de Uso y Propiedad Intelectual</h2>
            </div>
            <p className="text-white text-xs sm:text-sm leading-relaxed">
              Se te concede una licencia personal, limitada, no exclusiva, intransferible y revocable para utilizar <strong>ARCHERY 101010 · THE APP</strong> con fines deportivos personales o de entrenamiento de tu club. Todos los derechos sobre la marca <strong>ARCHERY 101010</strong>, su identidad gráfica y numérica curva, código fuente, interfaz en negro OLED, motores balísticos y diseño visual son propiedad exclusiva de sus titulares. Queda prohibida la ingeniería inversa, copia no autorizada o explotación comercial del software sin autorización escrita. Tú conservas en todo momento la titularidad sobre tus propios registros de entrenamiento.
            </p>
          </section>

          {/* SECCIÓN 6: Eliminación de Cuenta y Limitación de Responsabilidad */}
          <section className="bg-[#07090E] border border-white/[0.08] rounded-3xl p-6 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-white font-bold text-base">
              <Trash2 size={18} className="text-red-rival shrink-0" />
              <h2>6. Baja Voluntaria, Eliminación de Datos y Garantías</h2>
            </div>
            <p className="text-white text-xs sm:text-sm leading-relaxed">
              Puedes dar por terminado este acuerdo en cualquier momento eliminando tu cuenta y la totalidad de tus datos en un solo flujo desde <strong>Perfil → Eliminar mi cuenta y datos</strong> o solicitándolo a través de los canales indicados en nuestra{" "}
              <Link href="/privacy#delete-account" className="text-cyan-neon underline font-bold">
                Política de Privacidad
              </Link>
              . La plataforma se proporciona <em>&quot;tal cual&quot;</em> y según disponibilidad; aunque aplicamos respaldo local <em>offline-first</em> y sincronización en la nube para máxima resiliencia, en la medida permitida por la ley aplicable no seremos responsables por daños indirectos derivados de interrupciones de conectividad o mal uso físico del equipo de arquería.
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

        {/* Footer */}
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
              href="/privacy"
              className="text-white hover:text-cyan-neon underline font-bold uppercase tracking-wider text-[12px]"
            >
              Política de Privacidad
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
