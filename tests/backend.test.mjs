import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync,readdirSync } from "node:fs";
import { ensureUser } from "../lib/bootstrap.mjs";
import { createItem,mutateItem,addComment,getItem,itemDetail,listItems,overview,activityPage,grantMember,teamDetail } from "../lib/core.mjs";

function database() {
  const sqlite=new DatabaseSync(":memory:");sqlite.exec("PRAGMA foreign_keys=ON");
  for(const file of readdirSync(new URL("../drizzle/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../drizzle/${file}`,import.meta.url),"utf8"));
  const db={sqlite,failActivity:false,prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this;},async first(){return sqlite.prepare(sql).get(...this.args)??null;},async all(){return {results:sqlite.prepare(sql).all(...this.args)};}};},async batch(statements){
    sqlite.exec("BEGIN IMMEDIATE");try{const results=statements.map(s=>{if(db.failActivity && s.sql.includes("INSERT INTO activity"))throw Error("Injected audit write failure");const results=sqlite.prepare(s.sql).all(...s.args);return {results};});sqlite.exec("COMMIT");return results;}catch(e){sqlite.exec("ROLLBACK");throw e;}
  }};return db;
}
const key=()=>crypto.randomUUID();
async function fixture() {const db=database();const actor=await ensureUser(db,{userId:"owner",displayName:"Test Owner",email:"owner@example.test"});return {db,actor};}
const input=(extra={})=>({teamId:"engineering",title:"Investigate test incident",description:"Useful investigation details",priority:"high",category:"Incident",requiresApproval:false,...extra});
const rejectCode=(code)=>e=>e.code===code;

test("only the first authenticated user bootstraps as manager; later users need grants",async()=>{
  const {db,actor}=await fixture();const second=await ensureUser(db,{userId:"second",displayName:"Second User",email:"second@example.test"});
  assert.equal((await overview(db,actor)).teams.length,3);assert.equal((await overview(db,second)).teams.length,0);
  await grantMember(db,actor,"engineering",{email:second.email,role:"viewer"});
  assert.equal((await overview(db,second)).teams[0].role,"viewer");
});
test("two simultaneous claims have one winner and one audit event",async()=>{
  const {db,actor}=await fixture();const created=await createItem(db,actor,input(),key());const other={id:"sample_arjun"};
  const outcomes=await Promise.allSettled([mutateItem(db,actor,created.id,{action:"claim",version:1},key()),mutateItem(db,other,created.id,{action:"claim",version:1},key())]);
  assert.equal(outcomes.filter(r=>r.status==="fulfilled").length,1);assert.equal(outcomes.filter(r=>r.status==="rejected"&&r.reason.status===409).length,1);
  assert.equal((await getItem(db,actor,created.id)).version,2);
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM activity WHERE item_id=? AND action='claim'").get(created.id).n,1);
});
test("stale edits cannot overwrite an already saved change",async()=>{
  const {db,actor}=await fixture();const {id}=await createItem(db,actor,input({assigneeId:actor.id}),key());
  await mutateItem(db,actor,id,{...input(),action:"edit",version:1,title:"The latest title"},key());
  await assert.rejects(mutateItem(db,actor,id,{...input(),action:"edit",version:1,title:"An outdated title"},key()),rejectCode("VERSION_CONFLICT"));
  assert.equal((await getItem(db,actor,id)).title,"The latest title");
});
test("concurrent creation retries create one item and one creation event",async()=>{
  const {db,actor}=await fixture(),requestKey=key();const results=await Promise.all([createItem(db,actor,input(),requestKey),createItem(db,actor,input(),requestKey)]);
  assert.equal(results[0].id,results[1].id);assert.equal(db.sqlite.prepare("SELECT count(*) n FROM items WHERE id=?").get(results[0].id).n,1);
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM activity WHERE item_id=?").get(results[0].id).n,1);
});
test("comment retries create one comment and do not invalidate an item edit",async()=>{
  const {db,actor}=await fixture(),{id}=await createItem(db,actor,input(),key()),requestKey=key();
  await Promise.all([addComment(db,actor,id,{body:"Investigating now"},requestKey),addComment(db,actor,id,{body:"Investigating now"},requestKey)]);
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM comments WHERE item_id=?").get(id).n,1);assert.equal((await getItem(db,actor,id)).version,1);
});
test("request key reuse with different content is rejected",async()=>{
  const {db,actor}=await fixture(),requestKey=key();await createItem(db,actor,input(),requestKey);
  await assert.rejects(createItem(db,actor,input({title:"Different content"}),requestKey),rejectCode("KEY_REUSED"));
});
test("concurrent cross-resource reuse of a request key cannot mutate both items",async()=>{
  const {db,actor}=await fixture(),a=await createItem(db,actor,input(),key()),b=await createItem(db,actor,input(),key()),requestKey=key();
  const outcomes=await Promise.allSettled([mutateItem(db,actor,a.id,{action:"claim",version:1},requestKey),mutateItem(db,actor,b.id,{action:"claim",version:1},requestKey)]);
  assert.equal(outcomes.filter(r=>r.status==="fulfilled").length,1);assert.equal(outcomes.filter(r=>r.status==="rejected"&&r.reason.code==="KEY_REUSED").length,1);
  assert.equal(db.sqlite.prepare("SELECT sum(version-1) n FROM items WHERE id IN (?,?)").get(a.id,b.id).n,1);
});
test("unrelated team members cannot read, edit, or comment through the service",async()=>{
  const {db,actor}=await fixture(),{id}=await createItem(db,actor,input(),key()),outsider={id:"sample_priya"};
  await assert.rejects(getItem(db,outsider,id),rejectCode("NOT_FOUND"));
  await assert.rejects(mutateItem(db,outsider,id,{action:"claim",version:1},key()),rejectCode("NOT_FOUND"));
  await assert.rejects(addComment(db,outsider,id,{body:"Unauthorized"},key()),rejectCode("NOT_FOUND"));
  assert.equal((await listItems(db,outsider,{team:"engineering"})).total,0);
});
test("viewers can read but cannot create, claim, comment, or change members",async()=>{
  const {db,actor}=await fixture(),{id}=await createItem(db,actor,input(),key()),viewer={id:"sample_neil"};
  assert.ok(await getItem(db,viewer,id));
  await assert.rejects(createItem(db,viewer,input(),key()),rejectCode("FORBIDDEN"));
  await assert.rejects(mutateItem(db,viewer,id,{action:"claim",version:1},key()),rejectCode("FORBIDDEN"));
  await assert.rejects(addComment(db,viewer,id,{body:"Unauthorized"},key()),rejectCode("FORBIDDEN"));
  await assert.rejects(grantMember(db,viewer,"engineering",{email:"new@example.test",role:"manager"}),rejectCode("FORBIDDEN"));
});
test("members may edit their own work but cannot reassign work",async()=>{
  const {db,actor}=await fixture(),{id}=await createItem(db,actor,input({assigneeId:"sample_arjun"}),key()),member={id:"sample_arjun"};
  await mutateItem(db,member,id,{...input(),action:"edit",version:1,title:"Member updated title"},key());
  await assert.rejects(mutateItem(db,member,id,{action:"assign",assigneeId:actor.id,version:2},key()),rejectCode("FORBIDDEN"));
});
test("approval-gated work cannot be resolved directly; another manager can approve",async()=>{
  const {db,actor}=await fixture(),{id}=await createItem(db,actor,input({assigneeId:actor.id,requiresApproval:true}),key());
  await mutateItem(db,actor,id,{action:"status",status:"in_progress",version:1},key());
  await assert.rejects(mutateItem(db,actor,id,{action:"status",status:"resolved",version:2},key()),rejectCode("APPROVAL_REQUIRED"));
  await mutateItem(db,actor,id,{action:"status",status:"awaiting_approval",version:2},key());
  await assert.rejects(mutateItem(db,actor,id,{action:"approve",version:3},key()),rejectCode("SELF_APPROVAL"));
  await mutateItem(db,{id:"sample_maya"},id,{action:"approve",version:3},key());
  const item=await getItem(db,actor,id);assert.equal(item.status,"resolved");assert.equal(item.approved_by,"sample_maya");
});
test("invalid workflow jumps and owners from another team are rejected",async()=>{
  const {db,actor}=await fixture(),{id}=await createItem(db,actor,input(),key());
  await assert.rejects(mutateItem(db,actor,id,{action:"status",status:"resolved",version:1},key()),rejectCode("INVALID_TRANSITION"));
  await assert.rejects(mutateItem(db,actor,id,{action:"assign",assigneeId:"sample_priya",version:1},key()),e=>e.status===400);
});
test("an audit failure rolls back the work update and request record",async()=>{
  const {db,actor}=await fixture(),{id}=await createItem(db,actor,input(),key());db.failActivity=true;
  await assert.rejects(mutateItem(db,actor,id,{action:"claim",version:1},key()),/Injected audit write failure/);
  const item=await getItem(db,actor,id);assert.equal(item.version,1);assert.equal(item.assignee_id,null);
});
test("search escapes SQL wildcards and returns bounded pages",async()=>{
  const {db,actor}=await fixture();await createItem(db,actor,input({title:"100% reliable_export"}),key());
  assert.equal((await listItems(db,actor,{q:"%"})).total,1);assert.equal((await listItems(db,actor,{q:"_export"})).total,1);
  const items=await listItems(db,actor,{});assert.ok(items.items.length<=15);
});
test("history pagination and overview return only authorized records",async()=>{
  const {db,actor}=await fixture(),{id}=await createItem(db,actor,input(),key());
  for(let i=0;i<33;i++)await addComment(db,actor,id,{body:`Comment ${i}`},key());
  const first=await itemDetail(db,actor,id);assert.equal(first.timeline.length,30);assert.ok(first.historyCursor);
  const second=await itemDetail(db,actor,id,first.historyCursor);assert.equal(second.timeline.length,4);
  assert.equal(new Set([...first.timeline,...second.timeline].map(e=>e.id)).size,34);
  const history=await activityPage(db,{id:"sample_priya"},{});assert.ok(history.entries.every(e=>e.team_id!=="engineering"));
});
test("pending grants become real memberships after sign-in",async()=>{
  const {db,actor}=await fixture();await grantMember(db,actor,"operations",{email:"new@example.test",role:"member"});
  assert.equal((await teamDetail(db,actor,"operations")).pending.length,1);
  const next=await ensureUser(db,{userId:"new",displayName:"New Member",email:"new@example.test"});
  assert.equal((await overview(db,next)).teams[0].role,"member");assert.equal((await teamDetail(db,actor,"operations")).pending.length,0);
});
