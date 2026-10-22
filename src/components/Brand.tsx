import Link from 'next/link';
import {existsSync} from 'node:fs';
import path from 'node:path';
export function Brand() {
 const logo=existsSync(path.join(process.cwd(),'public','retch-visionai-icon.png'));
 return <Link href="/" className="brand" aria-label="BusinessHub VisionAI home">{logo && <img src="/retch-visionai-icon.png" width="40" height="40" alt="" />}<span className="brand-name">BusinessHub <span>VisionAI</span></span></Link>;
}
