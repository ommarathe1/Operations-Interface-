import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { ensureUser } from "@/lib/bootstrap.mjs";
import { AppError,overview,listItems,itemDetail,activityPage,teamDetail,grantMember,createItem,mutateItem,addComment } from "@/lib/core.mjs";

export const dynamic="force-dynamic";
const response=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
async function handle(request:Request) {
  try {
    const identity=await getChatGPTUser();
    if(!identity)throw new AppError(401,"Sign in with ChatGPT to open your workspace.","UNAUTHENTICATED");
    if(!env.DB)throw new AppError(503,"The workspace database is not connected yet.","DATABASE_UNAVAILABLE");
    const db=env.DB,actor=await ensureUser(db,identity),url=new URL(request.url),query=Object.fromEntries(url.searchParams),parts=url.pathname.replace(/^\/api\/ops\/?/,"").split("/").filter(Boolean);
    if(request.method==="GET") {
      if(!parts.length || parts[0]==="bootstrap")return response({actor,...await overview(db,actor)});
      if(parts[0]==="items" && !parts[1])return response(await listItems(db,actor,query));
      if(parts[0]==="items" && parts[1]) {
        let cursor=null;
        if(query.before){try{cursor=JSON.parse(query.before);if(typeof cursor.time!=="string"||typeof cursor.id!=="string")throw Error();}catch{throw new AppError(400,"Invalid history cursor.");}}
        return response(await itemDetail(db,actor,parts[1],cursor));
      }
      if(parts[0]==="activity")return response(await activityPage(db,actor,query));
      if(parts[0]==="teams" && parts[1])return response(await teamDetail(db,actor,parts[1]));
    }
    if(request.method==="POST") {
      const origin=request.headers.get("origin");
      if(origin && origin!==url.origin)throw new AppError(403,"Cross-origin changes are not allowed.","FORBIDDEN");
      if(!request.headers.get("content-type")?.includes("application/json"))throw new AppError(415,"Send JSON request content.");
      const raw=await request.text();if(raw.length>24000)throw new AppError(413,"This request is too large.");
      let input;try{input=JSON.parse(raw);}catch{throw new AppError(400,"This request contains invalid JSON.");}
      if(!input||typeof input!=="object"||Array.isArray(input))throw new AppError(400,"Send a JSON object.");
      const key=request.headers.get("idempotency-key");
      if(parts[0]==="items" && !parts[1])return response(await createItem(db,actor,input,key),201);
      if(parts[0]==="items" && parts[1] && parts[2]==="comments")return response(await addComment(db,actor,parts[1],input,key),201);
      if(parts[0]==="items" && parts[1])return response(await mutateItem(db,actor,parts[1],input,key));
      if(parts[0]==="teams" && parts[1] && parts[2]==="members")return response(await grantMember(db,actor,parts[1],input));
    }
    return response({error:"This endpoint does not exist."},404);
  }catch(error) {
    if(error instanceof AppError)return response({error:error.message,code:error.code},error.status);
    console.error("Operations API failed",error instanceof Error?error.message:"Unknown failure");
    return response({error:"The request could not be completed. Please try again.",code:"SERVER_ERROR"},500);
  }
}
export const GET=handle;
export const POST=handle;
