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

      <section className="hero">
        <div className="hero__content">
          <span className="hero__eyebrow">nileDevs · AI Agents</span>
          <h1>Automatizá tus flujos con asistentes listos para producción</h1>
          <p>
            Gestioná tus bots de WhatsApp, integra calendarios y monitoreá
            métricas clave desde un portal seguro diseñado para tus tenants.
          </p>
          <div className="hero__actions">
            <button
              className="btn btn-primary"
              disabled={!loginUrl}
              onClick={() => loginUrl && window.location.assign(loginUrl)}
            >
              Ingresar con Cognito
            </button>
            <a className="btn btn-ghost" href="mailto:contacto@niledevs.com">
              Contactar soporte
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
          <h2>Panel de acceso</h2>
          <p>
            Luego del login verás el dashboard de tu tenant y el botón para
            conectar Google Calendar.
          </p>
          <dl>
            <div>
              <dt>Tenants activos</dt>
              <dd>12</dd>
            </div>
            <div>
              <dt>Asistentes configurados</dt>
              <dd>31</dd>
            </div>
            <div>
              <dt>SLA promedio</dt>
              <dd>98%</dd>
            </div>
          </dl>
        </aside>
      </section>

      <section className="feature-grid">
        <article className="feature-card">
          <header>
            <span className="badge badge-ready">Prod ready</span>
            <h3>Autenticación multi-tenant</h3>
          </header>
          <p>
            Administrá el acceso a tu portal con Cognito Hosted UI, login
            federado y políticas flexibles de seguridad.
          </p>
        </article>

        <article className="feature-card">
          <header>
            <span className="badge badge-soon">Próximo</span>
            <h3>Sincronización con Google Calendar</h3>
          </header>
          <p>
            Guardá el refresh token en Secrets Manager y confirmá
            disponibilidad real antes de reservar turnos.
          </p>
        </article>

        <article className="feature-card">
          <header>
            <span className="badge badge-soon">Próximo</span>
            <h3>Métricas del asistente</h3>
          </header>
          <p>
            Reportes de engagement, tiempos de respuesta y salud del bot para
            cada tenant.
          </p>
        </article>
      </section>

      <section className="status-board">
        <h2>Cómo funciona</h2>
        <ol className="steps">
          <li className="step">
            <span className="step__icon">1</span>
            <div>
              <h4>Ingresá con Cognito</h4>
              <p>
                Autenticación segura y administrada. Cada tenant recibe su
                usuario y rol.
              </p>
            </div>
          </li>
          <li className="step">
            <span className="step__icon">2</span>
            <div>
              <h4>Conectá Google Calendar</h4>
              <p>
                En el dashboard podrás autorizar tu calendar vía OAuth 2.0 y
                guardar el refresh token de forma segura.
              </p>
            </div>
          </li>
          <li className="step">
            <span className="step__icon">3</span>
            <div>
              <h4>Monitoreá y ajustá</h4>
              <p>
                Controlá citas, métricas y configuración de tu asistente
                virtual desde un mismo panel.
              </p>
            </div>
          </li>
        </ol>
      </section>

      <section className="cta-section">
        <div className="cta-card">
          <div>
            <h2>Tu portal de asistentes inteligentes</h2>
            <p>
              nileDevs AI Agents centraliza autenticación, integraciones y
              métricas para que tus bots estén siempre listos.
            </p>
          </div>
          <div className="cta-actions">
            <button
              className="btn btn-primary"
              disabled={!loginUrl}
              onClick={() => loginUrl && window.location.assign(loginUrl)}
            >
              Iniciar sesión
            </button>
            <a className="btn btn-outline" href="mailto:contacto@niledevs.com">
              Hablar con nosotros
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
