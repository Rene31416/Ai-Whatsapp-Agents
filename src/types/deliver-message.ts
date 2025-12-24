export interface DeliverMessageEnvelope {
  tenantId: string;
  userId: string;
  phoneNumberId: string;
  /** Text body to deliver to WhatsApp */
  messageBody: string;
  messageId?: string;
  traceId?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}
