import {z} from 'zod';
export const recoveryEmail = z.string().trim().toLowerCase().pipe(z.email());
export const newPassword = z.object({password:z.string().min(8).max(200),confirm:z.string()}).refine(v=>v.password===v.confirm,'Passwords must match.');
