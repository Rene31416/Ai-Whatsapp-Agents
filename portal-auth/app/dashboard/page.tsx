"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

export default function Dashboard() {
  const searchParams = useSearchParams();
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  const statusMessage = useMemo(() => {
    if (error) {
      return {
        tone: "error" as const,
        title: "Hubo un problema al iniciar sesión",
        description: `Detalle: ${error}`,
      };
    }
    if (code) {
      return {
        tone: "success" as const,
        title: "Inicio de sesión exitoso",
        description:
          "El portal recibió el código de Cognito. El siguiente paso será canjearlo por tokens y guardarlos en Secrets Manager.",
      };
    }
    return {
      tone: "neutral" as const,
      title: "Bienvenido al dashboard",
      description:
        "Autentícate con Cognito para habilitar la conexión a Google Calendar y las métricas.",
    };
  }, [code, error]);

  return (
    <main className="portal dashboard">
      <div className="glow glow-top" />
      <div className="glow glow-bottom" />

      <header className="dashboard__header">
        <div>
          <h1>Panel de nileDevs AI Agents</h1>
          <p>
            Aquí verás el estado de tus integraciones y podrás avanzar con la
            sincronización de Google Calendar.
          </p>
        </div>
      </header>

      <section
        className={`status-alert status-alert--${statusMessage.tone}`}
        role="status"
      >
        <div>
          <h2>{statusMessage.title}</h2>
          <p>{statusMessage.description}</p>
          {code && (
            <code className="status-alert__code">code={code}</code>
          )}
        </div>
      </section>

      <section className="stat-grid">
        <article className="stat-card">
          <span className="stat-card__label">Usuarios permitidos</span>
          <strong className="stat-card__value">5</strong>
          <p className="stat-card__hint">
            Crea usuarios desde Cognito para cada tenant. El portal valida la
            sesión antes de mostrar datos sensibles.
          </p>
        </article>
        <article className="stat-card">
          <span className="stat-card__label">Calendarios conectados</span>
          <strong className="stat-card__value">0</strong>
          <p className="stat-card__hint">
            Una vez completes el flujo de OAuth guardaremos el refresh token en
            Secrets Manager.
          </p>
        </article>
        <article className="stat-card">
          <span className="stat-card__label">Asistentes activos</span>
          <strong className="stat-card__value">3</strong>
          <p className="stat-card__hint">
            Integración con bots de WhatsApp en meta. Pronto podrás revisar
            métricas por conversación.
          </p>
        </article>
      </section>

      <section className="integration-panel">
        <div>
          <h2>Integrar Google Calendar</h2>
          <p>
            Este flujo ejecutará el handler `/calendar/callback`, intercambiará
            el código por tokens y almacenará el refresh token del tenant.
          </p>
          <button className="btn btn-primary" disabled>
            Conectar calendar (próximamente)
          </button>
        </div>
        <div className="integration-panel__meta">
          <h3>Qué haremos a continuación</h3>
          <ul>
            <li>Agregar secretos en AWS Secrets Manager.</li>
            <li>
              Invocar Google OAuth para obtener <code>refresh_token</code>.
            </li>
            <li>
              Exponer métricas y salud del asistente según cada tenant.
            </li>
          </ul>
        </div>
      </section>
    </main>
  );
}
