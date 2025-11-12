# Environment Variables Summary

## Webhook Lambda (`src/controller/chat.controller.ts`)
- `CHAT_BUFFER_TABLE_NAME`: legacy buffer table (not used directly but still injected).
- `GEMINI_SECRET_ARN`: optional LLM secret for the webhook.
- `CHAT_INGRESS_QUEUE_URL`: FIFO SQS URL where incoming messages are enqueued.
- `TENANT_TABLE_NAME`: DynamoDB table holding tenant metadata (e.g., `AiAgentsStack-TenantClinicMetadata...`).
- `TENANT_GSI_PHONE`: name of the global secondary index that maps Meta `phone_number_id` → tenant (default `PhoneNumberIdIndex`).

## ChatService Lambda (`src/services/chat.service.ts`)
- `CHAT_BUFFER_TABLE_NAME`: used by `clearBuffer`.
- `CHAT_SESSIONS_TABLE_NAME`: user/agent chat history table.
- `MEMORY_TABLE_NAME`: memory summaries table.
- `TENANT_TABLE_NAME`, `TENANT_GSI_PHONE`: needed by `TenantRepository` for WhatsApp/Calendar lookups.
- `GEMINI_SECRET_ARN`, `OPENAI_SECRET_ARN`, `GOOGLE_OAUTH_SECRET_ARN`: LLM/OAuth secrets.
- `CALENDAR_TOKEN_SECRET_PREFIX`: legacy fallback prefix for Google refresh tokens (still present until we rely solely on `calendarSecretName`).
- `APPOINTMENTS_API_BASE_URL`: base URL for calling the Appointments API (e.g., `https://.../prod/appointments`).

## Appointments Lambda (`src/controller/appointments.controller.ts`)
- `APPOINTMENTS_TABLE_NAME`: Dynamo table for appointments (PK `PK`, SK `APPT#id`).
- `APPOINTMENTS_GSI_USER`: name of the GSI that powers user-based lookups.
- `APPOINTMENTS_GSI_DOCTOR`: name of the GSI for per-doctor schedules.
- `APPOINTMENTS_GSI_STATUS`: name of the GSI used for dashboard/day views.
- (Optional) add other env vars later if the service needs tenant metadata or secrets.

## Aggregator / Flush Lambdas
- Still receive `CHAT_BUFFER_TABLE_NAME`, `CHAT_INGRESS_QUEUE_URL`, `FLUSH_TICKET_QUEUE_URL`, etc. (even though the path is disabled). Updates postponed.

## Local Dev REPL (`src/devtools/local.ts`)
- `LOCAL_PHONE_NUMBER_ID`: Meta `phone_number_id` to look up the tenant via Dynamo. Required unless `LOCAL_TENANT_ID` is set.
- `LOCAL_TENANT_ID`: optional override to skip the Dynamo lookup.
- `LOCAL_USER_ID`: simulated user id (defaults to `local-user` if unset).
- `LOCAL_DRY_RUN`, `LOCAL_WHATSAPP_*`, `LOCAL_GOOGLE_*`: same knobs as before for dry-run mode.
- Dynamo table names (must point to real tables for local tests):
  - `MEMORY_TABLE_NAME`
  - `CHAT_SESSIONS_TABLE_NAME`
  - `CHAT_BUFFER_TABLE_NAME`
  - `TENANT_TABLE_NAME`
  - `TENANT_GSI_PHONE`

## Secrets naming convention
- Tenant metadata now stores `whatsappSecretName` and `calendarSecretName` (without hardcoded phone-based suffixes). Services look up the tenant first, then build the full ARN using env prefixes or use the full ARN if provided.
