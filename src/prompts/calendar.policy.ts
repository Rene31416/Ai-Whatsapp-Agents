export type CalendarPolicyState = {
  doctorKnown: boolean;
  doctorName?: string;
  hasDateTimeInfo: boolean;
  timePhrase?: string;
  clinicHoursOk: boolean;
  availabilityStatus: "free" | "busy" | "unknown";
  missingFields: Array<"nombre" | "telefono" | "correo">;
  needsAvailabilityCheck: boolean;
  needsContactData: boolean;
  needsConfirmation: boolean;
};

const doctorRegexSingle = /\b(?:dr\.?|doctor|doctora)?\s*(ger[ae]r?do|amada)\b/i;
const doctorRegexGlobal = /\b(?:dr\.?|doctor|doctora)?\s*(ger[ae]r?do|amada)\b/gi;
const emailRegex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const phoneRegex = /\b\d{7,}\b/;
const nameRegex = /(mi\s+nombre|nombre\s+completo|soy|me\s+llamo|se\s+llama)/i;
const availabilityFreeRegex = /(est[áa]\s+disponible|est[áa]\s+libre|hay\s+cupo)/i;
const availabilityBusyRegex = /(ya\s+est[áa]\s+ocup|no\s+est[áa]\s+disponible)/i;
const availabilityQuestionRegex = /(revisaste|verificaste|confirmaste)\s+(la\s+)?disponibilidad/i;
const timeRegex12h = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s?(am|pm)\b/gi;
const timeRegex24h = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;

export function analyzeCalendarConversation(input: {
  recentWindow?: string;
  message?: string;
}): CalendarPolicyState {
  const recentWindow = input.recentWindow ?? "";
  const message = input.message ?? "";
  const fullText = `${recentWindow}\n${message}`;

  const doctorName = detectDoctorName(message, recentWindow);

  const messageTimeInfo = extractTimeInfo(message);
  const windowTimeInfo = extractTimeInfo(recentWindow);
  const timeInfo = messageTimeInfo ?? windowTimeInfo;

  const clinicHoursOk = timeInfo?.hour24 != null ? isWithinClinicHours(timeInfo.hour24) : true;

  const hasEmail = emailRegex.test(fullText);
  const hasPhone = phoneRegex.test(fullText);
  const hasName = nameRegex.test(fullText);

  const missingFields: Array<"nombre" | "telefono" | "correo"> = [];
  if (!hasName) missingFields.push("nombre");
  if (!hasPhone) missingFields.push("telefono");
  if (!hasEmail) missingFields.push("correo");

  let availabilityStatus = detectAvailability(fullText);
  const userAskingAvailability = availabilityQuestionRegex.test(message);

  const doctorKnown = !!doctorName;
  const hasDateTimeInfo = !!timeInfo;

  const mentionsNewRequest = !!messageTimeInfo || !!message.match(doctorRegexSingle);
  if (mentionsNewRequest || userAskingAvailability) {
    availabilityStatus = "unknown";
  }

  const needsAvailabilityCheck =
    doctorKnown && hasDateTimeInfo && clinicHoursOk && availabilityStatus === "unknown";

  const needsContactData =
    missingFields.length > 0 && doctorKnown && hasDateTimeInfo && clinicHoursOk;

  const needsConfirmation =
    doctorKnown &&
    hasDateTimeInfo &&
    clinicHoursOk &&
    missingFields.length === 0 &&
    availabilityStatus === "free";

  return {
    doctorKnown,
    doctorName,
    hasDateTimeInfo,
    timePhrase: timeInfo?.phrase,
    clinicHoursOk,
    availabilityStatus,
    missingFields,
    needsAvailabilityCheck,
    needsContactData,
    needsConfirmation,
  };
}

export function buildPolicySummary(state: CalendarPolicyState): string {
  return JSON.stringify(state, null, 2);
}

function detectAvailability(text: string): "free" | "busy" | "unknown" {
  if (availabilityFreeRegex.test(text)) return "free";
  if (availabilityBusyRegex.test(text)) return "busy";
  return "unknown";
}

function detectDoctorName(message: string, recentWindow: string): string | undefined {
  const currentMatch = message.match(doctorRegexSingle);
  if (currentMatch) {
    return normalizeDoctor(currentMatch[1]);
  }
  doctorRegexGlobal.lastIndex = 0;
  const allMatches = Array.from(recentWindow.matchAll(doctorRegexGlobal));
  if (allMatches.length === 0) return undefined;
  const lastMatch = allMatches[allMatches.length - 1];
  return normalizeDoctor(lastMatch[1]);
}

function normalizeDoctor(value: string): string {
  const lower = value.toLowerCase();
  if (lower.includes("ger")) return "Gerardo";
  return "Amada";
}

function extractTimeInfo(text: string): { phrase: string; hour24?: number } | null {
  let match: RegExpExecArray | null = null;
  let lastMatch: RegExpExecArray | null = null;

  while ((match = timeRegex12h.exec(text)) !== null) {
    lastMatch = match;
  }
  if (lastMatch) {
    const hour = parseInt(lastMatch[1], 10);
    const suffix = lastMatch[3].toLowerCase();
    const converted = convertTo24(hour, suffix);
    return { phrase: lastMatch[0], hour24: converted };
  }

  timeRegex24h.lastIndex = 0;
  while ((match = timeRegex24h.exec(text)) !== null) {
    lastMatch = match;
  }
  if (lastMatch) {
    const hour = parseInt(lastMatch[1], 10);
    return { phrase: lastMatch[0], hour24: hour };
  }

  return null;
}

function convertTo24(hour: number, suffix: string): number {
  if (suffix === "pm" && hour < 12) {
    return hour + 12;
  }
  if (suffix === "am" && hour === 12) {
    return 0;
  }
  return hour;
}

function isWithinClinicHours(hour24: number): boolean {
  if (Number.isNaN(hour24)) return true;
  if (hour24 < 9) return false;
  if (hour24 > 17) return false;
  return true;
}
