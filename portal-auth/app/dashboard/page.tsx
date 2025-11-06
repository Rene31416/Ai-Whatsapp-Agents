"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type PortalSession = {
  email?: string;
  sub?: string;
  issuedAt: number;
  expiresAt: number;
};

type SessionApiResponse =
  | { status: "ok"; session: PortalSession }
  | { status: "unauthenticated" };

type TenantApiResponse =
  | {
      status: "ok";
      tenantId: string;
      tenantName: string;
      calendarTokenSecret: string;
      users: string[];
    }
  | { status: "error"; message: string }
  | { status: "not_found"; message: string };

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const GOOGLE_REDIRECT_URI = process.env.NEXT_PUBLIC_GOOGLE_REDIRECT_URI ?? "";
const GOOGLE_AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";

export const dynamic = "force-dynamic";

export default function Dashboard() {
  return (
    <Suspense
      fallback={
        <main className="portal dashboard">
          <div className="glow glow-top" />
          <div className="glow glow-bottom" />
          <p style={{ color: "#cbd5f5" }}>Cargando dashboard...</p>
        </main>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const searchParams = useSearchParams();
  const authStatus = searchParams.get("authStatus");
  const error = searchParams.get("error");
  const calendarStatus = searchParams.get("calendarStatus");
  const calendarError = searchParams.get("calendarError");
  const initialUser = searchParams.get("user");

  const [sessionStatus, setSessionStatus] = useState<"loading" | "ok" | "error">("loading");
  const [session, setSession] = useState<PortalSession | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [tenantStatus, setTenantStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [tenantError, setTenantError] = useState<string | null>(null);
  const [tenant, setTenant] = useState<TenantApiResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controllers: AbortController[] = [];

    const loadSession = async () => {
      setSessionStatus("loading");
      setSessionError(null);
      const controller = new AbortController();
      controllers.push(controller);

      try {
        const response = await fetch("/api/session", {
          credentials: "include",
          signal: controller.signal,
        });

        if (cancelled) {
          return;
        }

        if (!response.ok) {
          setSessionStatus("error");
          setSessionError("No encontramos una sesión activa. Inicia sesión nuevamente.");
          setSession(null);
          return;
        }

        const payload = (await response.json()) as SessionApiResponse;

        if (payload.status !== "ok") {
          setSessionStatus("error");
          setSessionError("No encontramos una sesión activa. Inicia sesión nuevamente.");
          setSession(null);
          return;
        }

        setSessionStatus("ok");
        setSession(payload.session);

        const userEmail = payload.session.email;
        if (userEmail && API_BASE) {
          setTenantStatus("loading");
          setTenantError(null);
          const tenantController = new AbortController();
          controllers.push(tenantController);

          try {
            const tenantResponse = await fetch(
              `${API_BASE}/tenants/me?email=${encodeURIComponent(userEmail)}`,
              {
                method: "GET",
                headers: {
                  Accept: "application/json",
                },
                signal: tenantController.signal,
              },
            );

            if (cancelled) {
              return;
            }

            const tenantPayload = (await tenantResponse.json()) as TenantApiResponse;

            if (!tenantResponse.ok || tenantPayload.status !== "ok") {
              setTenantStatus("error");
              setTenantError(
                tenantPayload.status === "not_found"
                  ? "No encontramos un tenant con este correo."
                  : tenantPayload.status === "error"
                    ? tenantPayload.message
                    : "Hubo un problema al recuperar el tenant.",
              );
              setTenant(tenantPayload);
              return;
            }

            setTenantStatus("ok");
            setTenant(tenantPayload);
          } catch (tenantErr: any) {
            if (cancelled) {
              return;
            }
            console.error("Failed to fetch tenant metadata", tenantErr);
            setTenantStatus("error");
            setTenantError("No pudimos recuperar la información del tenant.");
          }
        } else if (!API_BASE) {
          setTenantStatus("error");
          setTenantError("Falta configurar NEXT_PUBLIC_API_BASE para consultar el tenant.");
        } else {
          setTenantStatus("idle");
        }
      } catch (sessionErr: any) {
        if (cancelled) {
          return;
        }
        console.error("Failed to read session from API", sessionErr);
        setSessionStatus("error");
        setSessionError("No pudimos leer la sesión actual.");
        setSession(null);
      }
    };

    loadSession();

    return () => {
      cancelled = true;
      controllers.forEach((controller) => controller.abort());
    };
  }, []);

  const tenantOk = tenant && tenant.status === "ok" ? tenant : null;

  const googleAuthUrl = useMemo(() => {
    if (!tenantOk || !GOOGLE_CLIENT_ID || !GOOGLE_REDIRECT_URI) {
      return null;
    }

    const scopes = [
      "openid",
      "email",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar",
    ];

    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: "code",
      scope: scopes.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state: tenantOk.tenantId,
    });

    return `${GOOGLE_AUTH_BASE}?${params.toString()}`;
  }, [tenantOk]);

  const handleConnectCalendar = useCallback(() => {
    if (!googleAuthUrl) {
      return;
    }
    window.location.assign(googleAuthUrl);
  }, [googleAuthUrl]);

  const handleSignOut = useCallback(() => {
    window.location.assign("/api/auth/signout");
  }, []);

  const statusMessage = useMemo(() => {
    if (error) {
      return {
        tone: "error" as const,
        title: "Hubo un problema al iniciar sesión",
        description: `Detalle: ${error}`,
      };
    }

    if (sessionStatus === "loading") {
      return {
        tone: "neutral" as const,
        title: "Verificando la sesión...",
        description: "Esperá un momento mientras confirmamos tus credenciales.",
      };
    }

    if (sessionStatus === "error") {
      return {
        tone: "error" as const,
        title: "Sesión no encontrada",
        description: sessionError ?? "Inicia sesión desde la landing para continuar.",
      };
    }

    if (sessionStatus === "ok" && session) {
      const identifier = session.email ?? session.sub ?? "Usuario autenticado";
      return {
        tone: "success" as const,
        title: "Sesión verificada",
        description: `Estás autenticado como ${identifier}.`,
      };
    }

    return {
      tone: "neutral" as const,
      title: "Bienvenido al dashboard",
      description:
        "Autentícate con Cognito para habilitar la conexión a Google Calendar y las métricas.",
    };
  }, [authStatus, error, session, sessionError, sessionStatus]);

  const calendarMessage = useMemo(() => {
    if (calendarStatus === "ok") {
      return {
        tone: "success" as const,
        title: "Calendar conectado",
        description:
          "Guardamos el refresh token en Secrets Manager. Ya podés usarlo en tu workflow cuando esté habilitado.",
      };
    }
    if (calendarStatus === "error") {
      return {
        tone: "error" as const,
        title: "No pudimos conectar el calendar",
        description: calendarError ?? "Reintentá el flujo o revisá la configuración.",
      };
    }
    return null;
  }, [calendarStatus, calendarError]);

  const tenantDetails = useMemo(() => {
    if (tenantStatus === "loading") {
      return {
        title: "Buscando tu tenant...",
        body: "Estamos consultando la metadata para este usuario.",
      };
    }
    if (tenantStatus === "error") {
      return {
        title: "No pudimos recuperar el tenant",
        body: tenantError ?? "Revisá que el usuario esté asociado a un tenant en Dynamo.",
      };
    }
    if (tenantStatus === "ok" && tenantOk) {
      return {
        title: tenantOk.tenantName,
        body: `Tenant ID: ${tenantOk.tenantId}`,
        calendarSecret: tenantOk.calendarTokenSecret,
        users: tenantOk.users,
      };
    }

    return null;
  }, [tenantError, tenantOk, tenantStatus]);

  const authenticatedUser =
    session?.email ?? session?.sub ?? initialUser ?? (authStatus === "ok" ? "Usuario autenticado" : null);

  const missingGoogleConfig = !GOOGLE_CLIENT_ID || !GOOGLE_REDIRECT_URI;

  const canConnectCalendar = Boolean(
    sessionStatus === "ok" && tenantStatus === "ok" && tenantOk && googleAuthUrl,
  );

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
        <div className="dashboard__header-actions">
          <button className="btn btn-outline" onClick={handleSignOut}>
            Cerrar sesión
          </button>
        </div>
      </header>

      <section
        className={`status-alert status-alert--${statusMessage.tone}`}
        role="status"
      >
        <div>
          <h2>{statusMessage.title}</h2>
          <p>{statusMessage.description}</p>
          {authenticatedUser && (
            <code className="status-alert__code">usuario={authenticatedUser}</code>
          )}
        </div>
      </section>

      <section className="stat-grid">
        <article className="stat-card">
          <span className="stat-card__label">Usuario autenticado</span>
          <strong className="stat-card__value">
            {sessionStatus === "loading"
              ? "..."
              : session?.email ?? session?.sub ?? "Sin sesión"}
          </strong>
          <p className="stat-card__hint">
            Los usuarios permitidos deben añadirse al User Pool de Cognito y asociarse con un tenant.
          </p>
        </article>
        <article className="stat-card">
          <span className="stat-card__label">Tenant asignado</span>
          <strong className="stat-card__value">
            {tenantStatus === "loading"
              ? "..."
              : tenantStatus === "ok" && tenant && tenant.status === "ok"
                ? tenant.tenantName
                : "Sin tenant"}
          </strong>
          <p className="stat-card__hint">
            El endpoint <code>/tenants/me</code> devuelve la metadata asociada a tu correo.
          </p>
        </article>
        <article className="stat-card">
          <span className="stat-card__label">Estado del calendar</span>
          <strong className="stat-card__value">
            {tenantDetails?.calendarSecret ? "Configurable" : "Pendiente"}
          </strong>
          <p className="stat-card__hint">
            Una vez completes el flujo OAuth guardaremos el refresh token del tenant en Secrets Manager.
          </p>
        </article>
      </section>

      {tenantDetails && (
        <section className="integration-summary">
          <h2>{tenantDetails.title}</h2>
          <p>{tenantDetails.body}</p>
          {tenantDetails.calendarSecret && (
            <p>
              Secret previsto: <code>{tenantDetails.calendarSecret}</code>
            </p>
          )}
          {tenantDetails.users && tenantDetails.users.length > 0 && (
            <p>
              Usuarios asociados:{" "}
              <code>{tenantDetails.users.join(", ")}</code>
            </p>
          )}
        </section>
      )}

      <section className="integration-panel">
        <div>
          <h2>Integrar Google Calendar</h2>
        <p>
          Este flujo ejecutará el handler `/calendar/callback` en tu API,
          intercambiará el código por tokens y almacenará el refresh token del
          tenant.
        </p>
        <button className="btn btn-primary" disabled={!canConnectCalendar} onClick={handleConnectCalendar}>
          Conectar Google Calendar
        </button>
        {calendarMessage && (
          <div className={`integration-alert integration-alert--${calendarMessage.tone}`}>
            <h4>{calendarMessage.title}</h4>
            <p>{calendarMessage.description}</p>
          </div>
        )}
        {!canConnectCalendar && tenantStatus === "ok" && sessionStatus === "ok" && missingGoogleConfig && (
          <div className="integration-alert integration-alert--error">
            <h4>Falta configuración de Google</h4>
            <p>
              Configurá <code>NEXT_PUBLIC_GOOGLE_CLIENT_ID</code> y{" "}
              <code>NEXT_PUBLIC_GOOGLE_REDIRECT_URI</code> para habilitar el flujo OAuth.
            </p>
          </div>
        )}
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
