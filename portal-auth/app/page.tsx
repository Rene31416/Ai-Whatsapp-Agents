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

  const loginUrl =
    missingEnv.length === 0 ? buildCognitoLoginUrl() : undefined;

  return (
    <main className="portal">
      <div className="glow glow-top" />
      <div className="glow glow-bottom" />

      <header className="portal__nav">
        <div className="portal__brand">
          <span className="portal__brand-pill">nileDevs</span>
          <span className="portal__brand-name">AI Agents</span>
        </div>
        <div className="portal__nav-actions">
          <a className="button button--ghost" href="mailto:contacto@niledevs.com">
            Contactar soporte
          </a>
          <button
            className="button button--primary"
            disabled={!loginUrl}
            onClick={() => loginUrl && window.location.assign(loginUrl)}
          >
            Ingresar
          </button>
        </div>
      </header>

      <section className="hero">
        <div className="hero__body">
          <h1 className="hero__headline">
            Gestioná integraciones y asistentes para tus tenants sin fricción
          </h1>
          <p>
            Centralizá autenticación, configuraciones y métricas de tus clientes desde un
            único panel. nileDevs AI Agents te guía paso a paso para activar integraciones
            clave como Google Calendar en minutos.
          </p>
          {missingEnv.length > 0 ? (
            <div className="integration-alert integration-alert--error">
              Configurá las variables{" "}
              <code>NEXT_PUBLIC_COGNITO_DOMAIN</code>,{" "}
              <code>NEXT_PUBLIC_COGNITO_CLIENT_ID</code> y{" "}
              <code>NEXT_PUBLIC_COGNITO_REDIRECT_URI</code> para habilitar el login.
            </div>
          ) : null}
          <div className="hero__cta">
            <button
              className="button button--primary"
              disabled={!loginUrl}
              onClick={() => loginUrl && window.location.assign(loginUrl)}
            >
              Ingresar con Cognito
            </button>
            <a className="button button--secondary" href="mailto:contacto@niledevs.com">
              Agenda una demo
            </a>
          </div>
          <div className="hero__stats">
            <div className="hero__stat">
              <strong>12</strong>
              <span>Tenants activos</span>
            </div>
            <div className="hero__stat">
              <strong>31</strong>
              <span>Asistentes configurados</span>
            </div>
            <div className="hero__stat">
              <strong>98%</strong>
              <span>SLA promedio</span>
            </div>
          </div>
        </div>

        <aside className="hero__panel">
          <h2>¿Por qué nileDevs?</h2>
          <p>
            Diseñamos este portal para que tus equipos técnicos y operativos conecten sus
            flujos en minutos, con visibilidad total sobre cada tenant.
          </p>
          <ul>
            <li>Autenticación segura con Cognito y control por tenant.</li>
            <li>Integración guiada de Google Calendar con refresh tokens seguros.</li>
            <li>Panel listo para métricas operativas de tus asistentes.</li>
          </ul>
        </aside>
      </section>

      <section className="section">
        <span className="section__title">Lo que incluye</span>
        <div className="feature-list">
          <article className="feature-card">
            <header>
              <span className="badge badge-ready">Prod ready</span>
              <h3>Autenticación multi-tenant</h3>
            </header>
            <p>
              Centralizá el acceso con Cognito Hosted UI y políticas por tenant. Tus clientes
              ingresan con seguridad gestionada por AWS.
            </p>
          </article>
          <article className="feature-card">
            <header>
              <span className="badge badge-ready">Integraciones</span>
              <h3>Google Calendar en un clic</h3>
            </header>
            <p>
              Ejecutá OAuth 2.0 y almacená refresh tokens en Secrets Manager sin exponer
              credenciales ni procesos manuales.
            </p>
          </article>
          <article className="feature-card">
            <header>
              <span className="badge badge-soon">Próximo</span>
              <h3>Métricas del asistente</h3>
            </header>
            <p>
              Visualizá tiempos de respuesta, engagement y salud del bot. Seguimiento central
              por tenant para tu equipo de operaciones.
            </p>
          </article>
        </div>
      </section>

      <section className="section">
        <span className="section__title">Cómo funciona</span>
        <div className="timeline">
          <div className="timeline__item">
            <span className="timeline__step">1</span>
            <div className="timeline__content">
              <h4>Ingresá con Cognito</h4>
              <p>
                Cada tenant tiene sus usuarios asignados. nileDevs gestiona la autenticación
                y los permisos automáticamente.
              </p>
            </div>
          </div>
          <div className="timeline__item">
            <span className="timeline__step">2</span>
            <div className="timeline__content">
              <h4>Conectá Google Calendar</h4>
              <p>
                El portal construye la URL de OAuth y guarda el refresh token en Secrets
                Manager con prefijos por tenant.
              </p>
            </div>
          </div>
          <div className="timeline__item">
            <span className="timeline__step">3</span>
            <div className="timeline__content">
              <h4>Monitoreá y ajustá</h4>
              <p>
                Revisá métricas, estado de integraciones y próximos pasos desde un dashboard
                limpio y accesible.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="cta-card">
        <div>
          <h2>Tu portal para asistentes inteligentes está listo</h2>
          <p>
            nileDevs AI Agents unifica autenticación, integraciones y métricas para que tus
            equipos se enfoquen en la experiencia del cliente.
          </p>
        </div>
        <div className="cta-actions">
          <button
            className="button button--primary"
            disabled={!loginUrl}
            onClick={() => loginUrl && window.location.assign(loginUrl)}
          >
            Iniciar sesión
          </button>
          <a className="button button--outline" href="mailto:contacto@niledevs.com">
            Hablar con nosotros
          </a>
        </div>
      </section>
    </main>
  );
}
