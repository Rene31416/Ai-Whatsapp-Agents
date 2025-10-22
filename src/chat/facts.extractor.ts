// src/chat/facts.extractors.ts
export type DetFacts = {
  profile?: { name?: string };
  contact?: { email?: string | null; phone?: string | null };
};

// Locale-aware regex (ES). Tweak as needed.
const reName =
  /(?:\bme llamo\b|\bsoy\b|\bmi nombre es\b)\s+([A-ZÁÉÍÓÚÑ][\p{L}’'\- ]{1,40})/iu;
const reEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;
const rePhone = /\+?\d[\d\s\-().]{6,}/;

export function extractFactsDeterministic(lastUserMsg: string): DetFacts {
  const out: DetFacts = {};
  const s = String(lastUserMsg || "");

  const name = s.match(reName)?.[1]?.trim();
  if (name) out.profile = { ...(out.profile ?? {}), name: name.slice(0, 120) };

  const email = s.match(reEmail)?.[0]?.trim();
  if (email) out.contact = { ...(out.contact ?? {}), email: email.slice(0, 120) };

  const phone = s.match(rePhone)?.[0]?.trim();
  if (phone) out.contact = { ...(out.contact ?? {}), phone: phone.slice(0, 64) };

  return out;
}

export function seemsLikeIdentityIntent(s: string): boolean {
  const t = s.toLowerCase();
  return (
    t.includes("me llamo") ||
    t.includes("mi nombre") ||
    t.includes("mi correo") ||
    t.includes("email") ||
    t.includes("correo") ||
    t.includes("mi número") ||
    t.includes("telefono") ||
    t.includes("teléfono") ||
    t.includes("mi cel")
  );
}
