import { z } from 'zod';

export const snapshotSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().max(2048).refine((value) => {
    try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password; }
    catch { return false; }
  }, 'Enter a complete HTTP or HTTPS URL without credentials.'),
  html: z.string().min(20, 'Paste the page HTML.').max(250000, 'Use a snapshot under 250,000 characters.'),
});

// HTML remains inert text throughout; never execute or render the submitted markup.
export function snapshotText(html: string) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 12000);
}
