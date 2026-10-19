import {spawnSync} from "node:child_process";
import {existsSync} from "node:fs";
if(!existsSync("dist/server/wrangler.json"))throw Error("Build first: pnpm build");
// Wrangler tracks migration names in d1_migrations; rerunning this is safe.
const result=spawnSync(process.execPath,["--import","./scripts/sites-env.mjs","./node_modules/wrangler/bin/wrangler.js","d1","migrations","apply","DB","--local","--config","dist/server/wrangler.json","--persist-to",".wrangler/state"],{stdio:"inherit"});
if(result.error)throw result.error;
process.exit(result.status??1);
