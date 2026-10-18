import { z } from "zod";
import { dollarsToCents } from "./money";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const uuid = z.uuid();

export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), "Not a real date");

const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(dateString.optional());

export const clientStatus = z.enum(["lead", "active", "inactive"]);
export const projectStatus = z.enum(["planned", "active", "done"]);
export const taskStatus = z.enum(["todo", "doing", "done"]);

export const clientSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: optionalText(200).refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "That email doesn't look right"),
  phone: optionalText(50),
  company: optionalText(120),
  status: clientStatus.default("lead"),
});

export const noteSchema = z.object({
  body: z.string().trim().min(1, "Write something first").max(2000),
});

export const projectSchema = z.object({
  name: z.string().trim().min(1, "Project name is required").max(120),
  client_id: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined))
    .pipe(uuid.optional()),
  due_date: optionalDate,
});

export const taskSchema = z.object({
  title: z.string().trim().min(1, "Task title is required").max(200),
  due_date: optionalDate,
});

/** One invoice line as entered in the form (strings) or proposed by the assistant. */
export const invoiceQuantity = z.coerce.number().positive("Quantity must be more than 0").max(100000)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-7, "Use at most two decimal places for quantity");

export const invoiceItemInput = z.object({
  description: z.string().trim().min(1, "Each line needs a description").max(200),
  quantity: invoiceQuantity,
  unitPrice: z
    .union([z.string(), z.number()])
    .transform((v, ctx) => {
      const cents = dollarsToCents(v);
      if (cents === null) {
        ctx.addIssue({ code: "custom", message: "Enter the price as an amount like 125.00" });
        return z.NEVER;
      }
      return cents;
    }),
});

export const invoiceSchema = z.object({
  client_id: uuid,
  due_date: optionalDate,
  notes: optionalText(1000),
  items: z.array(invoiceItemInput).min(1, "Add at least one line").max(50),
});

export type InvoiceInput = z.output<typeof invoiceSchema>;

/** Turns a zod error into one readable sentence for the UI. */
export function firstError(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Please check the form";
}
