import type {MetadataRoute} from 'next';
import {allowIndexing} from '@/lib/release';
export const dynamic='force-dynamic';
export default function robots():MetadataRoute.Robots { return {rules:{userAgent:'*',allow:allowIndexing()?'/':undefined,disallow:allowIndexing()?['/app/','/api/','/i/','/login','/signup','/reset-password']: '/'}}; }
