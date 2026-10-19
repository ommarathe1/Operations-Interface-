import { env } from "cloudflare:workers";
import { getChatGPTUser } from "./chatgpt-auth";
import { redirect } from "next/navigation";
import { ensureUser } from "@/lib/bootstrap.mjs";
import { overview,listItems } from "@/lib/core.mjs";
import Workspace from "./workspace";

export const dynamic="force-dynamic";
export default async function Home() {
  const identity=await getChatGPTUser();
  if(!identity)redirect("/login");
  try {
    if(!env.DB)throw Error("Workspace database is unavailable.");
    const actor=await ensureUser(env.DB,identity);
    const [summary,items]=await Promise.all([overview(env.DB,actor),listItems(env.DB,actor,{})]);
    return <Workspace initial={{actor,...summary}} initialList={items}/>;
  }catch(error){
    console.error("Workspace initialization failed",error instanceof Error?error.message:"Unknown failure");
    return <main className="startup-error"><span className="brand-mark">n<span/></span><h1>Your workspace is getting connected.</h1><p>We couldn’t load the workspace right now. Refresh to try again.</p><a className="button primary" href="/">Reload workspace</a></main>;
  }
}
