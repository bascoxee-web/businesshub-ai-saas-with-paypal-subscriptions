import {rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Only generated build outputs. Avoid stale/empty Next manifests during adapter packaging.
for(const directory of ['.next','.open-next'])rmSync(path.join(root,directory),{recursive:true,force:true});
