# AI Agents

LLM-powered WhatsApp assistant for clinic appointments, packaged as an AWS CDK TypeScript stack. Messages arrive via a webhook, are routed through a LangGraph workflow, and use an Appointments API backed by DynamoDB to create/reschedule/cancel visits.

## Architecture at a glance
- API Gateway exposes `/webhook` (Meta verification + inbound WhatsApp) and `/appointments/*`.
- Webhook Lambda validates requests, resolves the tenant from Dynamo (`TenantClinicMetadata` + `PhoneNumberIdIndex`), and enqueues text messages to the FIFO `ChatIngressQueue`.
- ChatService Lambda consumes the queue, builds recent windows + memory, runs the dental workflow (LangChain/LangGraph + Gemini/OpenAI), sends WhatsApp replies, and calls appointment tools over HTTP.
- Appointments Lambda provides REST endpoints and writes to the `Appointments` table (GSIs: `UserAppointmentsIndex`, `DoctorScheduleIndex`, `StatusIndex`).
- Supporting data: `Doctors`, `ChatSessions`, `MemorySummaries`, tenant metadata, and Secrets Manager entries for Gemini/OpenAI/WhatsApp (all under the KMS key `ai-agents-data-key`).
- CDK outputs expose API URLs and table names for downstream services (e.g., portal, evaluations).

## APIs
- `GET /webhook` – Meta challenge verification.
- `POST /webhook` – Accepts WhatsApp text messages, validates tenant, enqueues to SQS.
- `POST /appointments` – Create (requires `tenantId`, `userId`, `doctorId`, `startIso` + `endIso | durationMinutes`).
- `PATCH /appointments` or `/appointments/{id}` – Reschedule by ID or by user/doctor/start.
- `DELETE /appointments` or `/appointments/{id}` – Cancel by ID or by user/doctor/start.
- `GET /appointments/availability?tenantId=...&doctorId=...&date=...` – Returns busy blocks for the day.

## Local development
- Install deps: `npm install` (Node 20). Bundles are built with esbuild.
- Build Lambda artifacts: `npm run build` (writes to `dist/`), `npm run watch` for incremental builds.
- Chat REPL: `npm start` runs the chat controller locally via `ts-lambda-api` for quick message/response testing.
- Diagnostics: `npm run dash` / `npm run dash:demo` to tail log calls; `npm run test` for Jest (placeholder today).
- Set env vars from `docs/env-vars.md` (queue URL, table names, secrets, `APPOINTMENTS_API_BASE_URL`, etc.) before running Lambdas locally.

## Deployment
- CDK stack lives in `lib/ai-agents-stack.ts`; Lambda entrypoints are in `src/app/lambda-handlers/*.ts` (bundled from `dist/` via `cdk.json`).
- Typical flow: `npm run build` → `npx cdk synth` → `npx cdk deploy` (after bootstrapping the target AWS account).

## Repository map
- `src/controller` – HTTP controllers reused by Lambda handlers (`/webhook`, `/appointments`).
- `src/app/lambda-handlers` – Lambda entrypoints (webhook, chatService, appointments, aggregator, flush, calendar auth, tenant metadata).
- `src/services` – Business logic for chat pipeline, appointments repo/service, tenant + doctor lookups, WhatsApp integration.
- `src/prompts`, `src/workflow` – Prompt/tooling code and the LangGraph workflow that routes calendar intents.
- `docs/context-2025-11-11.md` – current context and roadmap; `docs/env-vars.md` – required env vars and secrets.
- `ui/` – doctor/user portal (Vite app) generated from Figma; see `ui/README.md` for dev steps.
