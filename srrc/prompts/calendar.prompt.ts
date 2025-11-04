// srrc/calendar/calendar.prompt.service.ts
import { injectable } from "inversify";
import { PromptTemplate } from "@langchain/core/prompts";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";
import { getLLM } from "../services/llm.services";

/**
 * Mantiene el mismo “shape” conceptual que decideAndAnswerLite:
 * - función pública: calendarAndAnswerLite(input) -> { a, c }
 * - usa getLLM (mismo factory), respeta “tone”, validaciones y logs.
 */

export type CalendarLiteInput = {
  message: string; // mensaje actual del usuario
  recent_window: string; // últimos 10 mensajes (oldest → newest)
  now_iso: string; // ISO timestamp
  tz: string; // IANA TZ (ej. "America/El_Salvador")
  // campos opcionales para logging/telemetría si querés forwardear:
  tenantId?: string;
  userId?: string;
};

export type CalendarLiteOutput = {
  a: string; // respuesta breve para WhatsApp
  c: number; // confianza 0..1
};

const CalendarLiteSchema = z.object({
  a: z.string().default(""),
  c: z.number().min(0).max(1).default(0.7),
});

const parser = new JsonOutputParser<CalendarLiteOutput>();

// -------------------- helpers (idéntico patrón robusto) --------------------
function stripJsonFences(s: string): string {
  const fenced = s.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();
  return s.trim();
}
function rescueJsonSlice(s: string): string | null {
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) return s.slice(first, last + 1);
  return null;
}
function extractAnyText(msg: any): string {
  if (!msg) return "";
  if (typeof msg?.content === "string") return msg.content;
  if (Array.isArray(msg?.content)) {
    const t = msg.content
      .map((p: any) => p?.text || p?.content || "")
      .filter(Boolean)
      .join("\n");
    if (t.trim()) return t;
  }
  const gen = msg?.generations?.[0]?.[0];
  const gText = gen?.text ?? gen?.message?.content;
  if (typeof gText === "string" && gText.trim()) return gText;
  const parts =
    msg?.response?.candidates?.[0]?.content?.parts ??
    msg?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const t = parts
      .map((p: any) => p?.text || "")
      .filter(Boolean)
      .join("\n");
    if (t.trim()) return t;
  }
  try {
    return JSON.stringify(msg);
  } catch {
    return String(msg ?? "");
  }
}
function ms(from: bigint, to: bigint) {
  return Number(to - from) / 1e6;
}

// -------------------- Prompt (sin fences, JSON estricto) --------------------
// ---------- CALENDAR PROMPT ----------
const template = `
Eres un agente de CALENDARIO. Respondé en español, estilo WhatsApp, breve y natural (máx 2 frases, 1–2 emojis).
No menciones herramientas ni procesos internos.

⚠️ INSTRUCCIÓN CRÍTICA:
- Tu salida DEBE ser un único objeto JSON con las claves indicadas más abajo. Si devolvés texto fuera del JSON, se descarta.

COMPORTAMIENTO GENERAL:
- Si el primer mensaje trae saludo + intención, priorizá la intención de agenda.
- Si el usuario se está despidiendo (“gracias, eso sería todo”, “adiós”, “hasta luego”), cerrá amable SIN “¿algo más?”.
- “Gracias” aislado NO es despedida: podés ofrecer seguir con el proceso.
- Si VENTANA está vacía y el mensaje actual trae un saludo, podés presentarte brevemente. Variá el saludo (“¡Hola! Soy…”, “¡Buenas! Te escribe…”, “Hey, soy…”).
- Si VENTANA NO está vacía, no repitas saludo ni te presentes de nuevo aunque el usuario diga “hola” otra vez. En ese caso respondé directo al punto. Respuestas que empiecen con “Hola”, “Buenas”, “Soy…” en esta situación se consideran INCORRECTAS.
- Ejemplo sin saludo (VENTANA con historial): Usuario: “¿Puedo agendar una cita?” → Respuesta: “Claro que sí, te ayudo con eso.”
- Ejemplo incorrecto a evitar (VENTANA con historial): 🚫 “¡Hola! Soy el asistente…” (rechazado).
- Ejemplo correcto (VENTANA con historial, intención de agenda): Usuario: “Otra cosa, ¿sabés agendar citas?” → Respuesta: “Claro, te ayudo a coordinarla. Necesito nombre completo, número de contacto, correo electrónico y doctor preferido (Gerardo o Amada).”

OBJETIVO:
- Guiar al usuario para agendar/gestionar citas y RECOLECTAR los datos mínimos cuando falten.
- Usá EXCLUSIVAMENTE VENTANA y el MSG ACTUAL para detectar si ya dio datos (no repitas).
- Por ahora NO confirmes disponibilidad real ni prometas cupos; orientá y reuní datos.

REQUISITOS MÍNIMOS PARA AGENDAR (por ahora):
- Nombre completo
- Número de contacto
- Correo electrónico
- Doctor preferido: "Gerardo" o "Amada" (¡ojo: es Amada, no Amanda!)

ROBUSTEZ DE EXTRACCIÓN:
- Tratá como email válido cualquier patrón tipo palabra@dominio.tld, ignorando palabras de relleno (“mi correo es”, “el”, “:”).
- Normalizá email con trim y minúsculas.
- Si hay varios, usá el más reciente del MSG; si no, el más reciente de VENTANA.
- Para el número: aceptá dígitos con o sin separadores; si hay varios, usá el más reciente.
- Si detectás al menos UN dato de la lista, asumí que estamos en flujo de agenda.

POLÍTICA DE RECOLECCIÓN:
- Si el usuario pregunta “¿qué se necesita?”, respondé con la lista de requisitos y ofrecé continuar.
- Si faltan datos, pedí SOLO los que faltan en UN mensaje amable y estructurado (1–2 frases) usando una lista breve con viñetas o guiones.
- Ejemplo sugerido cuando faltan varios campos: “Para continuar, ¿me compartís?\n• Nombre completo\n• Número de contacto\n• Correo electrónico\n• Doctor preferido (Gerardo o Amada) 😊”
- Usá VENTANA para no volver a pedir lo que ya entregó.
- Si el usuario simplemente pregunta si podemos agendar (“¿puedes agendar citas?”, “¿sabes coordinar citas?”), respondé directo con la lista de requisitos sin saludo adicional.

CONFIRMACIÓN EN DOS PASOS:
1) Cuando ya estén TODOS los datos (nombre, contacto, correo, doctor):
   - Confirmá TODO en una sola respuesta breve (1–2 frases).
   - Ejemplo sugerido: “Perfecto, tengo: {{nombre}}, {{tel}}, {{email}}, con {{doctor}}. ¿Está correcto?”
   - Si aclara que algo debe cambiar, indicá lo que falta o corregís y volvé a confirmar.
2) Sólo si el usuario confirma (“sí”, “ok”, “confirmo”):
   - Enviá el mock final: “¡Listo! Tu cita quedó agendada. 🗓️”
   - Si responde que no, ajustá el dato y repetí la confirmación del paso 1 sin cerrar todavía.

TONO / MICROCOPY:
- Breve, claro, útil. 1–2 frases, 1–2 emojis máximo.
- Agradecé cuando aporte datos (“¡Gracias! 😊 Lo anoto.”) y pedí solo lo faltante.
- Para elegir doctor, ofrecé explícitamente: “Gerardo” o “Amada”.
- Para despedidas (cuando ya confirmaste la cita o aclaraste que no falta nada), cierra con una sola frase amable, sin ofrecer más ayuda, variando el tono (“Listo, quedo pendiente 😊”, “Perfecto, te aviso en cuanto tenga novedades 😊”) para que no suene repetitivo.

SALIDA ESTRICTA (solo UN JSON válido, sin texto extra ni backticks):
- Devuelve un único objeto JSON con estas claves (sustituí los valores con tu respuesta):
  {{"a":"...","c":0.8}}
- Cualquier otro formato (texto plano, markdown, varios objetos) se descarta.

VENTANA:
{recent_window}

MSG (actual):
{message}

TIEMPO:
{now_iso} ({tz})
`.trim();



@injectable()
export class CalendarPromptService {
  private readonly prompt = new PromptTemplate({
    inputVariables: ["message", "recent_window", "now_iso", "tz"],
    template,
  });

  async calendarAndAnswerLite(
    input: CalendarLiteInput
  ): Promise<CalendarLiteOutput> {
    const { message, recent_window, now_iso, tz, tenantId, userId } = input;

    // LOG: entrada
    console.log(
      "[calendar.decide][in]",
      JSON.stringify({
        tenantId,
        userId,
        msg_len: (message || "").length,
        win_len: (recent_window || "").length,
        tz,
      })
    );

    console.log("//////////////////////// CALENDAR WINDOW ////////////////");
    console.info(`[calendar.input/MSG] ${message ?? ""}`);
    console.info(`[calendar.input/VENTANA] ${recent_window ?? ""}`);

    // LLM factory (await para evitar pipe de Promises) + tuning (JSON mime)
    const base = await getLLM();
    const tuned =
      (base as any).bind?.({
        temperature: 0.25,
        top_p: 0.9,
        maxOutputTokens: 300,
        responseMimeType: "application/json",
      }) ?? base;

    // Render explícito (mismo patrón que Dental)
    const t0 = process.hrtime.bigint();
    const rendered = await this.prompt.format({
      message: message ?? "",
      recent_window: recent_window ?? "",
      now_iso: now_iso ?? new Date().toISOString(),
      tz: tz ?? "America/El_Salvador",
    });
    const tRender = process.hrtime.bigint();

    // Invoke directo con el string renderizado
    const tInvokeStart = process.hrtime.bigint();
    const llmOut: any = await tuned.invoke(rendered);
    const tInvokeEnd = process.hrtime.bigint();

    // Timings
    console.log(
      "[llm.timing]",
      JSON.stringify({
        render_ms: ms(t0, tRender).toFixed(1),
        invoke_ms: ms(tInvokeStart, tInvokeEnd).toFixed(1),
        total_ms: ms(t0, tInvokeEnd).toFixed(1),
      })
    );

    // Extraer texto, limpiar fences si el proveedor los agrega
    const raw0 = extractAnyText(llmOut) ?? "";
    const raw = stripJsonFences(raw0);
    console.log("[llm.output] preview", raw.slice(0, 200));

    // Parse + validación (con rescate si viene ruido)
    let out: CalendarLiteOutput;
    try {
      const parsed = await parser.parse(raw);
      const safe = CalendarLiteSchema.safeParse(parsed);
      out = safe.success
        ? safe.data
        : {
            a: (parsed as any)?.a || "",
            c: typeof (parsed as any)?.c === "number" ? (parsed as any).c : 0.7,
          };
    } catch (err: any) {
      const rescued = rescueJsonSlice(raw0);
      if (rescued) {
        try {
          const parsed = await parser.parse(rescued);
          const safe = CalendarLiteSchema.parse(parsed);
          console.log("[calendar.decide][rescued]", {
            a_len: safe.a.length,
            c: safe.c,
          });
          out = safe;
        } catch {
          console.warn("[calendar.fallback.trigger] Gemini no devolvió JSON puro; se pide repetición.");
          out = {
            a: "Perdón, no entendí lo último. ¿Podés repetirlo, por favor? 😊",
            c: 0.5,
          };
        }
      } else {
        console.warn("[calendar.fallback.trigger] Gemini no devolvió JSON puro; se pide repetición.");
        out = {
          a: "Disculpá, no alcancé a entender. ¿Lo podrías repetir, por favor? 😊",
          c: 0.5,
        };
      }
    }

    // LOG: salida
    console.log(
      "[calendar.decide][out]",
      JSON.stringify({
        a_len: (out.a || "").length,
        c: out.c,
      })
    );

    return out;
  }
}
