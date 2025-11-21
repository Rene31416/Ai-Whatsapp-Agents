export type CalendarPolicyState = {
  doctorKnown: boolean;
  doctorId?: string;
  doctorName?: string;
  hasDateTimeInfo: boolean;
  timePhrase?: string;
  clinicHoursOk: boolean;
  availabilityStatus: "free" | "busy" | "unknown";
  missingFields: Array<"nombre" | "telefono" | "correo">;
  needsAvailabilityCheck: boolean;
  needsContactData: boolean;
  needsConfirmation: boolean;
  needsDaySelection: boolean;
};

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
  doctors?: Array<{ doctorId: string; displayName: string }>;
}): CalendarPolicyState {
  const recentWindow = input.recentWindow ?? "";
  const message = input.message ?? "";
  const doctors = input.doctors ?? [];
  const userWindow = extractUserLines(recentWindow);
  const fullText = `${userWindow}\n${message}`;

  const doctorMatch = detectDoctorFromCatalog(message, userWindow, doctors);
  const doctorName = doctorMatch?.doctorName;
  const doctorId = doctorMatch?.doctorId;

  const messageTimeInfo = extractTimeInfo(message);
  const windowTimeInfo = extractTimeInfo(userWindow);
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
  const availabilityInquiry = /disponible|disponibilidad|horarios?/i.test(message);

  const doctorKnown = !!doctorName;
  const hasDateTimeInfo = !!timeInfo;

  const mentionsNewRequest = !!messageTimeInfo || !!doctorMatch;
  if (mentionsNewRequest || userAskingAvailability) {
    availabilityStatus = "unknown";
  }

  const needsAvailabilityCheck =
    doctorKnown && hasDateTimeInfo && clinicHoursOk && availabilityStatus === "unknown";

  const needsDaySelection =
    doctorKnown && !hasDateTimeInfo && availabilityInquiry;

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
    doctorId,
    doctorName,
    hasDateTimeInfo,
    timePhrase: timeInfo?.phrase,
    clinicHoursOk,
    availabilityStatus,
    missingFields,
    needsAvailabilityCheck,
    needsContactData,
    needsConfirmation,
    needsDaySelection,
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

function extractUserLines(windowText: string): string {
  if (!windowText) return "";
  const lines = windowText.split(/\r?\n/);
  const userLines = lines
    .map((line) => line.trim())
    .filter((line) => /^U:?/i.test(line) || /^User:/i.test(line))
    .map((line) => line.replace(/^U:\s*/i, "").replace(/^User:\s*/i, "").trim());
  return userLines.join("\n");
}

function detectDoctorFromCatalog(
  message: string,
  recentWindow: string,
  doctors: Array<{ doctorId: string; displayName: string }>
): { doctorId: string; doctorName: string } | undefined {
  const text = `${recentWindow}\n${message}`.toLowerCase();
  const slug = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

  for (const doctor of doctors) {
    const nameSlug = slug(doctor.displayName);
    const idSlug = slug(doctor.doctorId);
    if (!nameSlug && !idSlug) continue;

    if (nameSlug && text.includes(nameSlug)) {
      return { doctorId: doctor.doctorId, doctorName: doctor.displayName };
    }
    if (idSlug && text.includes(idSlug)) {
      return { doctorId: doctor.doctorId, doctorName: doctor.displayName };
    }

    const parts = nameSlug.split(/\s+/).filter(Boolean);
    if (parts.some((p) => p.length >= 3 && text.includes(p))) {
      return { doctorId: doctor.doctorId, doctorName: doctor.displayName };
    }
  }

  return undefined;
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
