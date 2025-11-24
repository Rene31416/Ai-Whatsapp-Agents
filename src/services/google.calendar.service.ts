import { inject, injectable } from "inversify";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { google, calendar_v3 } from "googleapis";
import { Logger } from "@aws-lambda-powertools/logger";
import { randomBytes } from "node:crypto";
import { TenantRepository } from "./tenant.repository";

type OAuthSecret = {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
};

type CalendarTokenPayload = {
  provider?: string;
  refresh_token?: string;
  scope?: string;
  receivedAt?: string;
};

export type AvailabilityParams = {
  tenantId: string;
  startIso: string;
  endIso: string;
  calendarId?: string;
};

export type CreateAppointmentParams = {
  tenantId: string;
  summary: string;
  description?: string;
  startIso: string;
  endIso: string;
  attendees?: Array<{ email: string; displayName?: string }>;
  calendarId?: string;
  doctor: string;
  
};

export type CancelAppointmentParams = {
  tenantId: string;
  eventId: string;
  calendarId?: string;
};


export type RescheduleAppointmentParams = {
  tenantId: string;
  eventId: string;
  startIso: string;
  endIso: string;
  calendarId?: string;
};


const DEFAULT_CALENDAR_ID = "primary";

export class CalendarEventConflictError extends Error {
  constructor(message = "Calendar event already exists for that doctor and horario") {
    super(message);
    this.name = "CalendarEventConflictError";
  }
}

@injectable()
export class GoogleCalendarService {
  private readonly secretsClient = new SecretsManagerClient({});

  constructor(
    @inject(Logger) private readonly log: Logger,
    @inject(TenantRepository) private readonly tenants: TenantRepository
  ) {}

  async checkAvailability(params: AvailabilityParams) {
    const client = await this.getAuthorizedClient(params.tenantId);
    const calendar = google.calendar({ version: "v3", auth: client });
    const calendarId = params.calendarId ?? DEFAULT_CALENDAR_ID;

    this.log.info("calendar.checkAvailability.start", {
      tenantId: params.tenantId,
      calendarId,
      startIso: params.startIso,
      endIso: params.endIso,
    });

    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: params.startIso,
        timeMax: params.endIso,
        items: [{ id: calendarId }],
      },
    });

    const busy =
      response.data.calendars?.[calendarId]?.busy?.map((slot) => ({
        start: slot.start,
        end: slot.end,
      })) ?? [];

    console.log("[GoogleCalendarService] Free/busy lookup complete", {
      tenantId: params.tenantId,
      calendarId,
      startIso: params.startIso,
      endIso: params.endIso,
      busyCount: busy.length,
    });

    return {
      busy,
      isFree: busy.length === 0,
    };
  }

  async createAppointment(params: CreateAppointmentParams): Promise<calendar_v3.Schema$Event> {
    const client = await this.getAuthorizedClient(params.tenantId);
    const calendar = google.calendar({ version: "v3", auth: client });
    const calendarId = params.calendarId ?? DEFAULT_CALENDAR_ID;

    const eventId = this.buildDeterministicEventId(params.doctor, params.startIso, params.tenantId);

    this.log.info("calendar.createAppointment", {
      tenantId: params.tenantId,
      calendarId,
      startIso: params.startIso,
      endIso: params.endIso,
      eventId,
    });

    try {
      const event = await calendar.events.insert({
        calendarId,
        requestBody: {
          id: eventId,
          summary: params.summary,
          description: params.description,
          start: {
            dateTime: params.startIso,
          },
          end: {
            dateTime: params.endIso,
          },
          attendees: params.attendees,
        },
      });

      return event.data;
    } catch (err: any) {
      const reason = err?.errors?.[0]?.reason ?? err?.code ?? err?.status; // google style
      if (reason === "duplicate" || err?.code === 409 || err?.response?.status === 409) {
        throw new CalendarEventConflictError();
      }
      throw err;
    }
  }

  async cancelAppointment(params: CancelAppointmentParams): Promise<void> {
    const client = await this.getAuthorizedClient(params.tenantId);
    const calendar = google.calendar({ version: "v3", auth: client });
    const calendarId = params.calendarId ?? DEFAULT_CALENDAR_ID;

    this.log.info("calendar.cancelAppointment", {
      tenantId: params.tenantId,
      calendarId,
      eventId: params.eventId,
    });

    await calendar.events.delete({
      calendarId,
      eventId: params.eventId,
    });
  }

  async rescheduleAppointment(params: RescheduleAppointmentParams): Promise<calendar_v3.Schema$Event> {
    const client = await this.getAuthorizedClient(params.tenantId);
    const calendar = google.calendar({ version: "v3", auth: client });
    const calendarId = params.calendarId ?? DEFAULT_CALENDAR_ID;

    this.log.info("calendar.rescheduleAppointment", {
      tenantId: params.tenantId,
      calendarId,
      eventId: params.eventId,
      startIso: params.startIso,
      endIso: params.endIso,
    });

    const event = await calendar.events.patch({
      calendarId,
      eventId: params.eventId,
      requestBody: {
        start: { dateTime: params.startIso },
        end: { dateTime: params.endIso },
      },
    });

    return event.data;
  }

  private buildDeterministicEventId(doctorRaw: string, startIso: string, tenantId: string): string {
    const doctorSlug = this.slugifyAlphaNum(doctorRaw, "doctor");
    const isoPart = this.normalizeIsoForId(startIso);
    const tenantSlug = this.slugifyAlphaNum(tenantId, "tenant");

    const base = `evt${tenantSlug}${doctorSlug}${isoPart}`
      .replace(/\s+/g, "")
      .toLowerCase();
    const trimmed = base.slice(0, 1024);
    if (trimmed.length >= 5 && /^[a-z0-9]+$/.test(trimmed)) {
      return trimmed;
    }
    return `evt${randomBytes(5).toString("hex")}`;
  }

  private slugifyAlphaNum(input: string | undefined, fallback: string): string {
    return (input || fallback || "")
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  private normalizeIsoForId(iso: string): string {
    const match = iso?.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
    if (match) {
      const [, y, m, d, hh, mm] = match;
      return `${y}${m}${d}${hh}${mm}`;
    }
    const date = new Date(iso ?? Date.now());
    if (Number.isNaN(date.getTime())) {
      return randomBytes(4).toString("hex");
    }
    const y = date.getUTCFullYear().toString().padStart(4, "0");
    const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
    const d = date.getUTCDate().toString().padStart(2, "0");
    const hh = date.getUTCHours().toString().padStart(2, "0");
    const mm = date.getUTCMinutes().toString().padStart(2, "0");
    return `${y}${m}${d}${hh}${mm}`;
  }

  private async getAuthorizedClient(tenantId: string) {
    const refreshToken = await this.getRefreshToken(tenantId);
    const oauthConfig = await this.getOAuthConfig();

    const client = new google.auth.OAuth2({
      clientId: oauthConfig.clientId,
      clientSecret: oauthConfig.clientSecret,
      redirectUri: oauthConfig.redirectUri,
    });

    client.setCredentials({ refresh_token: refreshToken });
    return client;
  }

  private async getRefreshToken(tenantId: string): Promise<string> {
    if (process.env.LOCAL_DRY_RUN === "true") {
      const local = process.env.LOCAL_GOOGLE_REFRESH_TOKEN;
      if (!local) {
        throw new Error("LOCAL_GOOGLE_REFRESH_TOKEN env is required in local dry-run mode");
      }
      this.log.info("calendar.secret.local", { tenantId });
      return local;
    }

    const prefix = process.env.CALENDAR_TOKEN_SECRET_PREFIX;
    const tenant = await this.tenants.getById(tenantId);
    if (!tenant?.calendarSecretName) {
      throw new Error(`Tenant ${tenantId} missing calendarSecretName`);
    }

    const secretId = this.resolveSecretId(tenant.calendarSecretName, prefix);
    const response = await this.secretsClient.send(
      new GetSecretValueCommand({ SecretId: secretId })
    );

    if (!response.SecretString) {
      throw new Error(`Secret ${secretId} is empty`);
    }

    const payload = JSON.parse(response.SecretString) as CalendarTokenPayload;
    if (!payload.refresh_token) {
      throw new Error(`Secret ${secretId} missing refresh_token`);
    }

    return payload.refresh_token;
  }

  private async getOAuthConfig(): Promise<Required<OAuthSecret>> {
    if (process.env.LOCAL_DRY_RUN === "true") {
      const clientId = process.env.LOCAL_GOOGLE_OAUTH_CLIENT_ID;
      const clientSecret = process.env.LOCAL_GOOGLE_OAUTH_CLIENT_SECRET;
      const redirectUri = process.env.LOCAL_GOOGLE_OAUTH_REDIRECT_URI;
      if (!clientId || !clientSecret || !redirectUri) {
        throw new Error("LOCAL Google OAuth env vars are required in dry-run mode");
      }
      return { clientId, clientSecret, redirectUri };
    }

    const secretArn = process.env.GOOGLE_OAUTH_SECRET_ARN;
    if (!secretArn) {
      throw new Error("GOOGLE_OAUTH_SECRET_ARN env is required");
    }

    const res = await this.secretsClient.send(
      new GetSecretValueCommand({ SecretId: secretArn })
    );

    if (!res.SecretString) {
      throw new Error("Google OAuth secret value is empty");
    }

    const parsed = JSON.parse(res.SecretString) as OAuthSecret;
    if (!parsed.clientId || !parsed.clientSecret || !parsed.redirectUri) {
      throw new Error("Google OAuth secret missing required fields");
    }

    return {
      clientId: parsed.clientId,
      clientSecret: parsed.clientSecret,
      redirectUri: parsed.redirectUri,
    }; 
  }

  private resolveSecretId(secretName: string, prefix?: string): string {
    if (secretName.startsWith("arn:aws:secretsmanager")) {
      return secretName;
    }
    if (!prefix) {
      return secretName;
    }
    const normalizedPrefix = prefix.endsWith(":secret:")
      ? prefix
      : prefix.replace(/[^:]+$/, "");
    return `${normalizedPrefix}${secretName}`;
  }
}
