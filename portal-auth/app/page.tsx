"use client";

import { useMemo } from "react";

const requiredEnv = [
  "NEXT_PUBLIC_COGNITO_DOMAIN",
  "NEXT_PUBLIC_COGNITO_CLIENT_ID",
  "NEXT_PUBLIC_COGNITO_REDIRECT_URI",
];

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
  const missingEnv = useMemo(
    () => requiredEnv.filter((key) => !process.env[key]),
    []
  );

  const loginUrl =
    missingEnv.length === 0 ? buildCognitoLoginUrl() : undefined;

  return (
    <main className="container">
      {missingEnv.length > 0 && (
        <aside className="notice">
          <strong>Configuración pendiente:</strong> completá las variables{" "}
          <code>NEXT_PUBLIC_COGNITO_DOMAIN</code>,{" "}
          <code>NEXT_PUBLIC_COGNITO_CLIENT_ID</code> y{" "}
          <code>NEXT_PUBLIC_COGNITO_REDIRECT_URI</code> para habilitar el inicio
          de sesión.
        </aside>
      )}
      <header className="hero">
        <h1>Portal de Integraciones Opal Dental</h1>
        <p>
          Conecta tu calendario, revisa métricas y administra a tu asistente
          virtual desde un solo lugar.
        </p>
      </header>

      <section className="card">
        <h2>Ingreso</h2>
        <p>
          Usamos Amazon Cognito para autenticar a los administradores del
          bot. Configurá las variables y hacé clic en el siguiente botón.
        </p>
        <button
          className="primary"
          disabled={!loginUrl}
          onClick={() => loginUrl && window.location.assign(loginUrl)}
        >
          Ingresar con Cognito
        </button>
        {missingEnv.length > 0 && (
          <p className="hint">
            Variables faltantes: {missingEnv.join(", ")}.
          </p>
        )}
      </section>

      <section className="grid">
        <article className="card">
          <h3>Integrar Google Calendar</h3>
          <p>
            Próximamente: una vez que completes el flujo OAuth, podrás
            confirmar disponibilidad y crear eventos automáticamente desde
            aquí.
          </p>
          <button className="secondary" disabled>
            Conectar Calendar (próximamente)
          </button>
        </article>
        <article className="card">
          <h3>Métricas del bot</h3>
          <p>
            Sección reservada para reportes de conversaciones, intents y
            SLA. Podrás verla cuando activemos el pipeline de métricas.
          </p>
          <button className="secondary" disabled>
            Ver métricas (próximamente)
          </button>
        </article>
      </section>
    </main>
  );
}
