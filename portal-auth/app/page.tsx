"use client";

import { useMemo } from "react";

function buildCognitoLoginUrl() {
  const domain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN!;
  const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!;
  const redirectUri = process.env.NEXT_PUBLIC_COGNITO_REDIRECT_URI!;
  const base = `${domain}/login`;
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: "openid email profile",
    redirect_uri: redirectUri,
  });
  return `${base}?${params.toString()}`;
}

export default function Home() {
  const config = useMemo(
    () => ({
      domain: process.env.NEXT_PUBLIC_COGNITO_DOMAIN,
      clientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID,
      redirectUri: process.env.NEXT_PUBLIC_COGNITO_REDIRECT_URI,
    }),
    []
  );
  const missingEnv = useMemo(() => {
    const missing: string[] = [];
    if (!config.domain) missing.push("NEXT_PUBLIC_COGNITO_DOMAIN");
    if (!config.clientId) missing.push("NEXT_PUBLIC_COGNITO_CLIENT_ID");
    if (!config.redirectUri) missing.push("NEXT_PUBLIC_COGNITO_REDIRECT_URI");
    return missing;
  }, [config]);
  const loginUrl = missingEnv.length === 0 ? buildCognitoLoginUrl() : undefined;

  return (
    <main className="portal">
      <div className="glow glow-top" />
      <div className="glow glow-bottom" />

      <section className="hero">
        <div className="hero__content">
          <span className="hero__eyebrow">Opal Dental · Portal de integraciones</span>
          <h1>Gestioná tu asistente virtual con una sola plataforma</h1>
          <p>
            Conectá calendarios, revisá métricas y administrá la experiencia de tus pacientes
            desde un panel centralizado pensado para clínicas modernas.
          </p>
          <div className="hero__actions">
            <button
              className="btn btn-primary"
              disabled={!loginUrl}
              onClick={() => loginUrl && window.location.assign(loginUrl)}
            >
              Ingresar al portal
            </button>
            <a
              className="btn btn-ghost"
              href="https://docs.google.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              Ver documentación
            </a>
          </div>
          {missingEnv.length > 0 && (
            <p className="hero__hint">
              Ajustá las variables:{" "}
              <code>NEXT_PUBLIC_COGNITO_DOMAIN</code>,{" "}
              <code>NEXT_PUBLIC_COGNITO_CLIENT_ID</code>,{" "}
              <code>NEXT_PUBLIC_COGNITO_REDIRECT_URI</code>.
            </p>
          )}
        </div>

        <aside className="hero__panel">
          <h2>Resumen de hoy</h2>
          <dl>
            <div>
              <dt>Citas confirmadas</dt>
              <dd>24</dd>
            </div>
            <div>
              <dt>Respuestas perfectas</dt>
              <dd>92%</dd>
            </div>
            <div>
              <dt>Pacientes activos</dt>
              <dd>58</dd>
            </div>
          </dl>
          <p>Los datos reales aparecerán cuando conectemos métricas en producción.</p>
        </aside>
      </section>

      <section className="feature-grid">
        <article className="feature-card">
          <header>
            <span className="badge badge-ready">Disponible</span>
            <h3>Autenticación segura con Cognito</h3>
          </header>
          <p>
            Administración de usuarios con login federado, Hosted UI y
            detección de configuración faltante para entornos locales.
          </p>
          <ul>
            <li>Inicio de sesión con Authorization Code Grant</li>
            <li>Gestión de sesiones y cierre controlado</li>
            <li>Configuración multi-tenant por environment</li>
          </ul>
        </article>

        <article className="feature-card">
          <header>
            <span className="badge badge-soon">En progreso</span>
            <h3>Integración con Google Calendar</h3>
          </header>
          <p>
            Guardaremos el refresh token de cada tenant y confirmaremos horarios reales antes
            de comprometer citas con pacientes.
          </p>
          <button className="btn btn-muted" disabled>
            Conectar calendario (próximamente)
          </button>
        </article>

        <article className="feature-card">
          <header>
            <span className="badge badge-soon">En progreso</span>
            <h3>Métricas y health del bot</h3>
          </header>
          <p>
            Reportes de satisfacción, tiempos de respuesta y volumen de conversaciones para
            que puedas medir rendimiento y oportunidades.
          </p>
          <button className="btn btn-muted" disabled>
            Ver tablero (próximamente)
          </button>
        </article>
      </section>

      <section className="status-board">
        <h2>Onboarding guiado</h2>
        <ol className="steps">
          <li className="step">
            <span className="step__icon">1</span>
            <div>
              <h4>Conectá tu cuenta</h4>
              <p>
                Configurá Cognito con el dominio generado para tu tenant e inicia sesión con
                tu usuario administrador.
              </p>
            </div>
          </li>
          <li className="step">
            <span className="step__icon">2</span>
            <div>
              <h4>Autoriza Google Calendar</h4>
              <p>
                Seguiremos el flujo OAuth para guardar el refresh token de tu calendar y así
                poder confirmar disponibilidad al instante.
              </p>
            </div>
          </li>
          <li className="step">
            <span className="step__icon">3</span>
            <div>
              <h4>Activa métricas y alertas</h4>
              <p>
                Visualizá reportes, niveles de satisfacción y health checks para asegurar que
                tu asistente siempre esté disponible.
              </p>
            </div>
          </li>
        </ol>
      </section>

      <section className="cta-section">
        <div className="cta-card">
          <div>
            <h2>Siguiente paso: conectar tu calendar en vivo</h2>
            <p>
              Ya tenés autenticación y UI. Agregá tus credenciales de Google en Secrets Manager
              para habilitar la reserva real de citas.
            </p>
          </div>
          <div className="cta-actions">
            <button
              className="btn btn-primary"
              disabled={!loginUrl}
              onClick={() => loginUrl && window.location.assign(loginUrl)}
            >
              Entrar al portal
            </button>
            <a
              className="btn btn-outline"
              href="mailto:soporte@opaldental.com"
            >
              Hablar con soporte
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
