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

type TenantSuccessResponse = {
  status: "ok";
  tenantId: string;
  tenantName: string;
  calendarTokenSecret: string;
  users: string[];
  calendarConnected: boolean;
  calendarConnectedAt?: string | null;
};

type TenantApiResponse =
  | TenantSuccessResponse
  | { status: "error"; message: string }
  | { status: "not_found"; message: string };

type CalendarAlert = {
  tone: "success" | "error" | "neutral";
  title: string;
  description: string;
};

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
  const [calendarLocalMessage, setCalendarLocalMessage] = useState<CalendarAlert | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const refreshTenant = useCallback(
    async (userEmail: string | undefined) => {
      if (!userEmail) {
        setTenantStatus("idle");
        setTenant(null);
        return;
      }

      if (!API_BASE) {
        setTenantStatus("error");
        setTenantError("Falta configurar NEXT_PUBLIC_API_BASE para consultar el tenant.");
        return;
      }

      setTenantStatus("loading");
      setTenantError(null);

      try {
        const tenantResponse = await fetch(
          `${API_BASE}/tenants/me?email=${encodeURIComponent(userEmail)}`,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
            },
          },
        );

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
        console.error("Failed to fetch tenant metadata", tenantErr);
        setTenantStatus("error");
        setTenantError("No pudimos recuperar la información del tenant.");
      }
    },
    [API_BASE],
  );

  const loadSession = useCallback(async () => {
    setSessionStatus("loading");
    setSessionError(null);

    try {
      const response = await fetch("/api/session", {
        credentials: "include",
      });

      if (!response.ok) {
        setSessionStatus("error");
        setSessionError("No encontramos una sesión activa. Inicia sesión nuevamente.");
        setSession(null);
        setTenantStatus("idle");
        setTenant(null);
        return;
      }

      const payload = (await response.json()) as SessionApiResponse;

      if (payload.status !== "ok") {
        setSessionStatus("error");
        setSessionError("No encontramos una sesión activa. Inicia sesión nuevamente.");
        setSession(null);
        setTenantStatus("idle");
        setTenant(null);
        return;
      }

      setSessionStatus("ok");
      setSession(payload.session);
      await refreshTenant(payload.session.email);
    } catch (sessionErr: any) {
      console.error("Failed to read session from API", sessionErr);
      setSessionStatus("error");
      setSessionError("No pudimos leer la sesión actual.");
      setSession(null);
      setTenantStatus("idle");
      setTenant(null);
    }
  }, [refreshTenant]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  const tenantOk = tenant && tenant.status === "ok" ? tenant : null;
  const tenantUsers = tenantOk?.users ?? [];

  const googleAuthUrl = useMemo(() => {
    if (!tenantOk || tenantOk.calendarConnected) {
      return null;
    }

    if (!GOOGLE_CLIENT_ID || !GOOGLE_REDIRECT_URI) {
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
    setCalendarLocalMessage(null);
    if (!googleAuthUrl) {
      return;
    }
    window.location.assign(googleAuthUrl);
  }, [googleAuthUrl]);

  const handleDisconnectCalendar = useCallback(async () => {
    if (!tenantOk) {
      return;
    }

    setCalendarLocalMessage(null);
    setIsDisconnecting(true);

    try {
      const response = await fetch("/api/google/disconnect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tenantId: tenantOk.tenantId }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setCalendarLocalMessage({
          tone: "error",
          title: "No pudimos desconectar el calendar",
          description:
            payload?.message ??
            "Reintenta otra vez o revisá los permisos de Secrets Manager.",
        });
        return;
      }

      setCalendarLocalMessage({
        tone: "success",
        title: "Calendar desconectado",
        description: "El refresh token fue eliminado. Podés reconectar cuando quieras.",
      });

      const emailToRefresh = session?.email ?? tenantUsers[0];
      await refreshTenant(emailToRefresh);
    } catch (disconnectErr: any) {
      console.error("Failed to disconnect calendar", disconnectErr);
      setCalendarLocalMessage({
        tone: "error",
        title: "No pudimos desconectar el calendar",
        description: "Se produjo un error inesperado. Inténtalo nuevamente.",
      });
    } finally {
      setIsDisconnecting(false);
    }
  }, [refreshTenant, session?.email, tenantOk, tenantUsers]);

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
  }, [error, session, sessionError, sessionStatus]);

  const calendarMessage = useMemo(() => {
    if (calendarLocalMessage) {
      return calendarLocalMessage;
    }
    if (calendarStatus === "ok") {
      return {
        tone: "success" as const,
        title: "Calendar conectado",
        description:
          "Guardamos el refresh token en Secrets Manager. Ya podés usarlo en tu workflow cuando esté habilitado.",
      };
    }
    if (calendarStatus === "disconnected") {
      return {
        tone: "neutral" as const,
        title: "Calendar desconectado",
        description: "El token fue eliminado. Podrás reconectar cuando lo necesites.",
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
  }, [calendarError, calendarLocalMessage, calendarStatus]);

  const tenantDetails = useMemo(() => {
    if (tenantStatus === "loading") {
      return {
        title: "Buscando tu tenant...",
        body: "Estamos consultando la metadata para este usuario.",
        calendarSecret: null as string | null,
        users: [] as string[],
        calendarConnected: false,
        calendarConnectedAt: null as string | null,
      };
    }
    if (tenantStatus === "error") {
      return {
        title: "No pudimos recuperar el tenant",
        body: tenantError ?? "Revisá que el usuario esté asociado a un tenant en Dynamo.",
        calendarSecret: null as string | null,
        users: [] as string[],
        calendarConnected: false,
        calendarConnectedAt: null as string | null,
      };
    }
    if (tenantStatus === "ok" && tenantOk) {
      return {
        title: tenantOk.tenantName,
        body: `Tenant ID: ${tenantOk.tenantId}`,
        calendarSecret: tenantOk.calendarTokenSecret,
        users: tenantOk.users,
        calendarConnected: tenantOk.calendarConnected,
        calendarConnectedAt: tenantOk.calendarConnectedAt ?? null,
      };
    }

    return null;
  }, [tenantError, tenantOk, tenantStatus]);

  const authenticatedUser =
    session?.email ?? session?.sub ?? initialUser ?? (authStatus === "ok" ? "Usuario autenticado" : null);

  const missingGoogleConfig = !GOOGLE_CLIENT_ID || !GOOGLE_REDIRECT_URI;
  const isCalendarConnected = Boolean(tenantOk?.calendarConnected);
  const canConnectCalendar = Boolean(
    !isCalendarConnected && sessionStatus === "ok" && tenantStatus === "ok" && tenantOk && googleAuthUrl,
  );

  const formattedCalendarConnectedAt = useMemo(() => {
    if (!tenantDetails?.calendarConnectedAt) {
      return null;
    }
    const parsed = new Date(tenantDetails.calendarConnectedAt);
    if (Number.isNaN(parsed.getTime())) {
      return tenantDetails.calendarConnectedAt;
    }
    return parsed.toLocaleString();
  }, [tenantDetails?.calendarConnectedAt]);

  return (
    <main className="portal dashboard">
      <div className="glow glow-top" />
      <div className="glow glow-bottom" />

      <header className="dashboard__header">
        <div>
          <span className="dashboard__eyebrow">nileDevs · Integraciones</span>
          <h1>Panel de estado del tenant</h1>
          <p>
            Revisá la sesión activa, el tenant asignado y el estado de Google Calendar para
            continuar con tus automatizaciones.
          </p>
        </div>
        <div className="dashboard__actions">
          {tenantOk ? <span className="dashboard__tag">Tenant: {tenantOk.tenantName}</span> : null}
          <button className="button button--outline" onClick={handleSignOut}>
            Cerrar sesión
          </button>
        </div>
      </header>

      <section className={`alert alert--${statusMessage.tone}`} role="status">
        <div>
          <h2>{statusMessage.title}</h2>
          <p>{statusMessage.description}</p>
          {authenticatedUser && (
            <code className="status-alert__code">usuario={authenticatedUser}</code>
          )}
        </div>
      </section>

      <section className="dashboard__stats">
        <article className="stat-tile">
          <span className="stat-tile__label">Usuario autenticado</span>
          <strong className="stat-tile__value">
            {sessionStatus === "loading"
              ? "..."
              : session?.email ?? session?.sub ?? "Sin sesión"}
          </strong>
          <p className="stat-tile__hint">
            Los usuarios deben estar dados de alta en el User Pool y asociados a un tenant válido.
          </p>
        </article>
        <article className="stat-tile">
          <span className="stat-tile__label">Tenant asignado</span>
          <strong className="stat-tile__value">
            {tenantStatus === "loading"
              ? "..."
              : tenantStatus === "ok" && tenantOk
                ? tenantOk.tenantName
                : "Sin tenant"}
          </strong>
          <p className="stat-tile__hint">
            La metadata proviene de <code>/tenants/me</code> y de DynamoDB.
          </p>
        </article>
        <article className="stat-tile">
          <span className="stat-tile__label">Estado del Calendar</span>
          <strong className="stat-tile__value">
            {isCalendarConnected ? "Conectado" : "Pendiente"}
          </strong>
          <p className="stat-tile__hint">
            Guardamos el refresh token en Secrets Manager con prefijos por tenant.
          </p>
        </article>
      </section>

      {tenantDetails && (
        <section className="surface-card surface-card--strong">
          <h2 className="surface-card__title">{tenantDetails.title}</h2>
          <p className="surface-card__meta">{tenantDetails.body}</p>
          {tenantDetails.calendarSecret && (
            <p className="surface-card__meta">
              Secret previsto: <code>{tenantDetails.calendarSecret}</code>
            </p>
          )}
          {tenantDetails.users && tenantDetails.users.length > 0 && (
            <p className="surface-card__meta">
              Usuarios asociados: <code>{tenantDetails.users.join(", ")}</code>
            </p>
          )}
          <p className="surface-card__meta">
            Estado de Google Calendar:{" "}
            <strong>{tenantDetails.calendarConnected ? "Conectado" : "Sin conectar"}</strong>
            {tenantDetails.calendarConnected && formattedCalendarConnectedAt && (
              <> · desde {formattedCalendarConnectedAt}</>
            )}
          </p>
        </section>
      )}

      <section className="surface-card integration-card">
        <div>
          <h2 className="surface-card__title">Integrar Google Calendar</h2>
          <p className="surface-card__meta">
            Autorizá Google Calendar para que el asistente pueda reservar turnos y sincronizar
            agendas utilizando el refresh token almacenado en Secrets Manager.
          </p>
        </div>
        <div className="integration-card__actions">
          {!isCalendarConnected && (
            <button
              className="button button--primary"
              disabled={!canConnectCalendar}
              onClick={handleConnectCalendar}
            >
              Conectar Google Calendar
            </button>
          )}
          {isCalendarConnected && (
            <button
              className="button button--secondary"
              onClick={handleDisconnectCalendar}
              disabled={isDisconnecting}
            >
              {isDisconnecting ? "Desconectando..." : "Desconectar Google Calendar"}
            </button>
          )}
          {calendarMessage && (
            <div className={`integration-alert integration-alert--${calendarMessage.tone}`}>
              <h4>{calendarMessage.title}</h4>
              <p>{calendarMessage.description}</p>
            </div>
          )}
          {!canConnectCalendar &&
            !isCalendarConnected &&
            tenantStatus === "ok" &&
            sessionStatus === "ok" &&
            missingGoogleConfig && (
              <div className="integration-alert integration-alert--error">
                <h4>Falta configuración de Google</h4>
                <p>
                  Configurá <code>NEXT_PUBLIC_GOOGLE_CLIENT_ID</code> y{" "}
                  <code>NEXT_PUBLIC_GOOGLE_REDIRECT_URI</code> para habilitar el flujo OAuth.
                </p>
              </div>
            )}
        </div>
        <div className="surface-card__meta">
          <strong>Qué haremos a continuación</strong>
          <ul className="integration-card__list">
            <li>Guardar secretos por tenant en AWS Secrets Manager.</li>
            <li>
              Invocar Google OAuth para obtener <code>refresh_token</code>.
            </li>
            <li>Exponer métricas y salud del asistente según cada tenant.</li>
          </ul>
        </div>
      </section>
    </main>
  );
}
