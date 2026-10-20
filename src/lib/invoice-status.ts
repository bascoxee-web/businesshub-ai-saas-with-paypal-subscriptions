export type InvoiceStatus = "draft" | "sent" | "paid" | "void";

const TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ["sent", "void"],
  sent: ["paid", "void"],
  paid: ["sent"],
  void: ["draft"],
};

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextActions(status: InvoiceStatus): InvoiceStatus[] {
  return TRANSITIONS[status] ?? [];
}

/** An invoice is overdue when it has been sent, is unpaid, and its due date has passed. */
export function isOverdue(status: string, dueDate: string | null | undefined, today: string): boolean {
  return status === "sent" && !!dueDate && dueDate < today;
}

export function todayISO(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
