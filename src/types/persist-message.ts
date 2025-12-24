export enum PersistMessageRole {
  USER = "USER",
  AGENT = "AGENT",
}

export interface PersistMessageEnvelope {
  tenantId: string;
  userId: string;
  role: PersistMessageRole;
  /** Raw text to persist; already trimmed upstream */
  messageBody: string;
  messageId?: string;
  source?: string;
  whatsappMeta?: {
    timestamp?: string;
    type?: string;
    profileName?: string;
    phoneNumberId?: string;
  };
}
