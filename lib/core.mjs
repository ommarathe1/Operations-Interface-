// Framework-independent D1 service, also exercised against real SQLite in tests.
export class AppError extends Error {
  constructor(status, message, code = "REQUEST_FAILED") { super(message); this.status = status; this.code = code; }
}
export const STATUSES = ["open", "in_progress", "blocked", "awaiting_approval", "resolved"];
export const PRIORITIES = ["critical", "high", "medium", "low"];
export const CATEGORIES = ["Incident", "Engineering", "Customer issue", "Finance", "Compliance", "Operations"];
export const LABELS = {open:"Open",in_progress:"In progress",blocked:"Blocked",awaiting_approval:"Awaiting approval",resolved:"Resolved"};
export const one = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
export const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
export const stmt = (db, sql, ...args) => db.prepare(sql).bind(...args);
const guard = (condition, status, message, code) => { if (!condition) throw new AppError(status, message, code); };
function textField(value, name, min, max) {
  guard(typeof value === "string",400,`${name} must be text.`);
  const text = value.trim(); guard(text.length >= min && text.length <= max,400,`${name} must contain ${min}-${max} characters.`); return text;
}
function enumField(value, values, name) { guard(values.includes(value),400,`Choose a valid ${name}.`); return value; }
function dueDate(value) {
  if (value === null || value === "" || value === undefined) return null;
  guard(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value,400,"Choose a valid due date."); return value;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(k => [k,canonical(value[k])]));
  return value;
}
async function digest(value) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,"0")).join(""); }
async function operation(actor, key, payload) {
  guard(typeof key === "string" && /^[a-zA-Z0-9_-]{12,120}$/.test(key),400,"A valid Idempotency-Key is required.");
  return {id:await digest(`${actor.id}:${key}`),key,fingerprint:await digest(JSON.stringify(canonical(payload)))};
}
async function replay(db,actor,op) {
  const previous = await one(db,"SELECT * FROM requests WHERE actor_id=? AND key=?",actor.id,op.key);
  if (!previous) return null;
  guard(previous.fingerprint === op.fingerprint,409,"This request key was already used for a different action.","KEY_REUSED");
  await getItem(db,actor,previous.item_id);
  return {id:previous.item_id,version:previous.result_version,replayed:true};
}
export async function roleFor(db,actor,teamId,write=false) {
  const m = await one(db,"SELECT role FROM memberships WHERE user_id=? AND team_id=?",actor.id,teamId);
  guard(m,404,"This team or work item is unavailable.","NOT_FOUND");
  if(write) guard(m.role !== "viewer",403,"Your team role allows viewing only.","FORBIDDEN");
  return m.role;
}
export async function getItem(db,actor,id) {
  const item = await one(db,`SELECT i.*,t.name team_name,t.color team_color,u.name assignee_name,u.color assignee_color,c.name creator_name,m.role
    FROM items i JOIN teams t ON t.id=i.team_id JOIN memberships m ON m.team_id=i.team_id AND m.user_id=?
    LEFT JOIN users u ON u.id=i.assignee_id JOIN users c ON c.id=i.created_by WHERE i.id=?`,actor.id,id);
  guard(item,404,"This work item is unavailable.","NOT_FOUND"); return item;
}
function itemFields(input) {
  return {title:textField(input.title,"Title",3,160),description:textField(input.description??"","Description",0,12000),
    category:enumField(input.category,CATEGORIES,"category"),priority:enumField(input.priority,PRIORITIES,"priority"),due:dueDate(input.dueDate),
    approval:input.requiresApproval === true || input.requiresApproval === 1 ? 1 : 0};
}
const writeAccess = `EXISTS(SELECT 1 FROM memberships m WHERE m.team_id=items.team_id AND m.user_id=? AND m.role IN ('manager','member'))`;
const ownerAccess = `EXISTS(SELECT 1 FROM memberships m WHERE m.team_id=items.team_id AND m.user_id=? AND (m.role='manager' OR (m.role='member' AND items.assignee_id=m.user_id)))`;

function mutationRecords(db,actor,op,itemId,action,message,detail,now) {
  return [
    stmt(db,`INSERT INTO activity(id,item_id,team_id,actor_id,action,message,detail,created_at)
      SELECT ?,id,team_id,?,?,?,?,? FROM items WHERE id=? AND last_operation=? ON CONFLICT(id) DO NOTHING`,op.id,actor.id,action,message,JSON.stringify(detail),now,itemId,op.id),
    stmt(db,`INSERT INTO requests(actor_id,key,fingerprint,item_id,result_version,created_at)
      SELECT ?,?,?,id,version,? FROM items WHERE id=? AND last_operation=? ON CONFLICT(actor_id,key) DO NOTHING`,actor.id,op.key,op.fingerprint,now,itemId,op.id),
  ];
}
function gated(db,actor,op,sql,...args) {
  // Recheck request-key ownership inside the same transaction as the actual write.
  const guardSQL=" AND NOT EXISTS(SELECT 1 FROM requests WHERE actor_id=? AND key=?)";
  const conflict=sql.indexOf("ON CONFLICT");
  const query=conflict<0?sql+guardSQL:sql.slice(0,conflict)+guardSQL+" "+sql.slice(conflict);
  return stmt(db,query,...args,actor.id,op.key);
}
async function finish(db,actor,op,id) {
  const result = await replay(db,actor,op);
  if(result) return {...result,replayed:false};
  await getItem(db,actor,id);
  throw new AppError(409,"This item changed while you were working. Refresh it and review the latest version.","VERSION_CONFLICT");
}
export async function createItem(db,actor,input,key) {
  const op=await operation(actor,key,{action:"create",input});
  const cached=await replay(db,actor,op); if(cached)return cached;
  const teamId=textField(input.teamId,"Team",1,100); const role=await roleFor(db,actor,teamId,true); const f=itemFields(input);
  const assignee=input.assigneeId || null;
  if(assignee) {
    guard(role==="manager" || assignee===actor.id,403,"Only team managers can assign work to another person.","FORBIDDEN");
    guard(await one(db,"SELECT role FROM memberships WHERE team_id=? AND user_id=? AND role!='viewer'",teamId,assignee),400,"The assignee must be a working member of this team.");
  }
  const id=`wi_${op.id.slice(0,32)}`,now=new Date().toISOString();
  await db.batch([
    gated(db,actor,op,`INSERT INTO items(id,team_id,title,description,category,status,priority,assignee_id,created_by,due_date,requires_approval,version,last_operation,creation_key,created_at,updated_at)
      SELECT ?,?,?,?,?, 'open',?,?,?,?,?,1,?,?,?,? WHERE EXISTS(SELECT 1 FROM memberships WHERE team_id=? AND user_id=? AND (role='manager' OR (role='member' AND (? IS NULL OR ?=user_id))))
      AND (? IS NULL OR EXISTS(SELECT 1 FROM memberships WHERE team_id=? AND user_id=? AND role IN ('manager','member')))
      ON CONFLICT(creation_key) DO NOTHING`,id,teamId,f.title,f.description,f.category,f.priority,assignee,actor.id,f.due,f.approval,op.id,op.id,now,now,teamId,actor.id,assignee,assignee,assignee,teamId,assignee),
    ...mutationRecords(db,actor,op,id,"created","created this work item",{title:f.title},now),
  ]);
  return finish(db,actor,op,id);
}
export async function mutateItem(db,actor,id,input,key) {
  const op=await operation(actor,key,{id,input});
  const cached=await replay(db,actor,op); if(cached)return cached;
  const item=await getItem(db,actor,id); const role=await roleFor(db,actor,item.team_id,true);
  const version=input.version,now=new Date().toISOString();
  guard(Number.isInteger(version) && version>0,400,"A current item version is required.");
  guard(item.version===version,409,"This item has a newer version. Refresh it before saving.","VERSION_CONFLICT");
  let update,action=input.action,message,detail={};
  if(action==="claim") {
    guard(!item.assignee_id,409,"Someone already owns this work item.","ALREADY_CLAIMED");
    guard(item.status!=="resolved",422,"Reopen this item before claiming it.");
    update=gated(db,actor,op,`UPDATE items SET assignee_id=?,version=version+1,last_operation=?,updated_at=? WHERE id=? AND version=? AND assignee_id IS NULL AND status!='resolved' AND ${writeAccess}`,actor.id,op.id,now,id,version,actor.id);
    message="took ownership";
  } else if(action==="assign") {
    guard(role==="manager",403,"Only team managers can reassign work.","FORBIDDEN");
    const assignee=input.assigneeId || null;
    if(assignee) guard(await one(db,"SELECT 1 FROM memberships WHERE team_id=? AND user_id=? AND role!='viewer'",item.team_id,assignee),400,"Choose a working member of this team.");
    const name=assignee?(await one(db,"SELECT name FROM users WHERE id=?",assignee)).name:"Unassigned";
    guard(!["awaiting_approval","resolved"].includes(item.status),422,"Return this item to progress before reassigning it.");
    update=gated(db,actor,op,`UPDATE items SET assignee_id=?,approved_by=NULL,version=version+1,last_operation=?,updated_at=? WHERE id=? AND version=?
      AND EXISTS(SELECT 1 FROM memberships WHERE team_id=items.team_id AND user_id=? AND role='manager')
      AND (? IS NULL OR EXISTS(SELECT 1 FROM memberships WHERE team_id=items.team_id AND user_id=? AND role!='viewer'))`,assignee,op.id,now,id,version,actor.id,assignee,assignee);
    message=`assigned this item to ${name}`;detail={from:item.assignee_id,to:assignee};
  } else if(action==="edit") {
    guard(role==="manager" || item.assignee_id===actor.id,403,"Only the owner or a team manager can edit this item.","FORBIDDEN");
    const f=itemFields(input);
    guard(!["resolved","awaiting_approval"].includes(item.status),422,"Return this item to progress before changing its details.");
    update=gated(db,actor,op,`UPDATE items SET title=?,description=?,category=?,priority=?,due_date=?,requires_approval=?,approved_by=NULL,version=version+1,last_operation=?,updated_at=? WHERE id=? AND version=? AND ${ownerAccess}`,f.title,f.description,f.category,f.priority,f.due,f.approval,op.id,now,id,version,actor.id);
    message="updated the work item";detail={before:{title:item.title,description:item.description,category:item.category,priority:item.priority,dueDate:item.due_date,requiresApproval:!!item.requires_approval},after:{title:f.title,description:f.description,category:f.category,priority:f.priority,dueDate:f.due,requiresApproval:!!f.approval}};
  } else if(action==="status") {
    guard(role==="manager" || item.assignee_id===actor.id,403,"Only the owner or a team manager can change status.","FORBIDDEN");
    const target=enumField(input.status,STATUSES,"status");
    const allowed={open:["in_progress","blocked"],in_progress:["open","blocked","awaiting_approval","resolved"],blocked:["open","in_progress"],awaiting_approval:["in_progress"],resolved:["open"]};
    guard(allowed[item.status].includes(target),422,"This workflow transition is not allowed.","INVALID_TRANSITION");
    if(item.status==="resolved")guard(role==="manager",403,"Only a team manager can reopen resolved work.","FORBIDDEN");
    if(target!=="open")guard(item.assignee_id,422,"Assign an owner before progressing this item.");
    if(target==="resolved")guard(!item.requires_approval,422,"Submit this item for approval before resolving it.","APPROVAL_REQUIRED");
    if(target==="awaiting_approval")guard(item.requires_approval,422,"This item does not require approval. It can be resolved directly.");
    update=gated(db,actor,op,`UPDATE items SET status=?,approved_by=NULL,version=version+1,last_operation=?,updated_at=? WHERE id=? AND version=? AND ${ownerAccess}`,target,op.id,now,id,version,actor.id);
    message=`changed status from ${LABELS[item.status]} to ${LABELS[target]}`;detail={from:item.status,to:target};
  } else if(action==="approve" || action==="reject") {
    guard(role==="manager",403,"Only a team manager can review approvals.","FORBIDDEN");
    guard(item.status==="awaiting_approval" && item.requires_approval,422,"This item is not awaiting approval.","INVALID_TRANSITION");
    guard(item.assignee_id!==actor.id,403,"A different team manager must review your own work.","SELF_APPROVAL");
    const reason=action==="reject"?textField(input.reason,"Review reason",3,1000):"";
    update=gated(db,actor,op,`UPDATE items SET status=?,approved_by=?,version=version+1,last_operation=?,updated_at=? WHERE id=? AND version=? AND status='awaiting_approval' AND assignee_id!=? AND EXISTS(SELECT 1 FROM memberships WHERE team_id=items.team_id AND user_id=? AND role='manager')`,action==="approve"?"resolved":"in_progress",action==="approve"?actor.id:null,op.id,now,id,version,actor.id,actor.id);
    message=action==="approve"?"approved and resolved this item":`requested changes: ${reason}`;detail={reason};
  } else throw new AppError(400,"Choose a supported action.");
  await db.batch([update,...mutationRecords(db,actor,op,id,action,message,detail,now)]);
  return finish(db,actor,op,id);
}
export async function addComment(db,actor,id,input,key) {
  const op=await operation(actor,key,{id,action:"comment",input});const cached=await replay(db,actor,op);if(cached)return cached;
  const item=await getItem(db,actor,id);await roleFor(db,actor,item.team_id,true);
  const body=textField(input.body,"Comment",1,4000),now=new Date().toISOString();
  // Comments merge independently; duplicate request keys still create one comment.
  await db.batch([
    gated(db,actor,op,`INSERT INTO comments(id,item_id,actor_id,body,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM memberships WHERE team_id=? AND user_id=? AND role!='viewer') ON CONFLICT(id) DO NOTHING`,op.id,id,actor.id,body,now,item.team_id,actor.id),
    stmt(db,`INSERT INTO activity(id,item_id,team_id,actor_id,action,message,detail,created_at) SELECT ?,?,team_id,?,'comment','added a comment',?,? FROM items WHERE id=? AND EXISTS(SELECT 1 FROM comments WHERE id=?) ON CONFLICT(id) DO NOTHING`,op.id,id,actor.id,JSON.stringify({body}),now,id,op.id),
    stmt(db,`INSERT INTO requests(actor_id,key,fingerprint,item_id,result_version,created_at) SELECT ?,?,?,id,version,? FROM items WHERE id=? AND EXISTS(SELECT 1 FROM comments WHERE id=?) ON CONFLICT(actor_id,key) DO NOTHING`,actor.id,op.key,op.fingerprint,now,id,op.id),
  ]);return finish(db,actor,op,id);
}

export async function itemDetail(db,actor,id,before=null) {
  const item=await getItem(db,actor,id);
  const timeline=await all(db,`SELECT a.*,u.name actor_name,u.color actor_color FROM activity a JOIN users u ON u.id=a.actor_id
    WHERE a.item_id=? ${before?"AND (a.created_at < ? OR (a.created_at=? AND a.id<?))":""} ORDER BY a.created_at DESC,a.id DESC LIMIT 31`,id,...(before?[before.time,before.time,before.id]:[]));
  const hasMore=timeline.length>30,entries=timeline.slice(0,30),last=entries.at(-1);
  const members=await all(db,"SELECT u.id,u.name,u.color,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.team_id=? ORDER BY u.name",item.team_id);
  return {item,timeline:entries,members,historyCursor:hasMore&&last?{time:last.created_at,id:last.id}:null};
}
export async function listItems(db,actor,query={}) {
  const where=["m.user_id=?"],args=[actor.id];
  if(query.team) {where.push("i.team_id=?");args.push(query.team);}
  if(query.status) {enumField(query.status,STATUSES,"status");where.push("i.status=?");args.push(query.status);}
  if(query.priority) {enumField(query.priority,PRIORITIES,"priority");where.push("i.priority=?");args.push(query.priority);}
  if(query.view==="active")where.push("i.status!='resolved'");
  if(query.view==="mine") {where.push("i.assignee_id=?");args.push(actor.id);}
  if(query.view==="unassigned")where.push("i.assignee_id IS NULL AND i.status!='resolved'");
  if(query.view==="approvals")where.push("i.status='awaiting_approval'");
  if(query.view==="attention")where.push("i.status!='resolved' AND (i.priority='critical' OR i.status='blocked' OR i.status='awaiting_approval' OR (i.due_date IS NOT NULL AND i.due_date < date('now')))");
  if(query.q) {const search=textField(query.q,"Search",1,160).replace(/[\\%_]/g,"\\$&");where.push("(i.title LIKE ? ESCAPE '\\' OR i.description LIKE ? ESCAPE '\\' OR ('OPS-' || (i.number+1000)) LIKE ? ESCAPE '\\')");args.push(`%${search}%`,`%${search}%`,`%${search}%`);}
  const page=Math.max(1,Math.min(10000,Number.parseInt(query.page,10)||1)),limit=15;
  const sort=query.sort==="oldest"?"i.created_at ASC,i.number ASC":query.sort==="priority"?"CASE i.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,i.updated_at DESC,i.number DESC":"i.updated_at DESC,i.number DESC";
  const from="FROM items i JOIN teams t ON t.id=i.team_id JOIN memberships m ON m.team_id=i.team_id LEFT JOIN users u ON u.id=i.assignee_id";
  const [items,count]=await Promise.all([
    all(db,`SELECT i.*,t.name team_name,t.color team_color,u.name assignee_name,u.color assignee_color,m.role ${from} WHERE ${where.join(" AND ")} ORDER BY ${sort} LIMIT ? OFFSET ?`,...args,limit,(page-1)*limit),
    one(db,`SELECT count(*) total ${from} WHERE ${where.join(" AND ")}`,...args),
  ]);return {items,total:count.total,page,pageSize:limit};
}
export async function overview(db,actor) {
  const base="FROM items i JOIN memberships m ON m.team_id=i.team_id WHERE m.user_id=?";
  const [stats,teams,recent]=await Promise.all([
    one(db,`SELECT count(*) total,sum(CASE WHEN status!='resolved' THEN 1 ELSE 0 END) active,
      sum(CASE WHEN status!='resolved' AND (priority='critical' OR status='blocked' OR status='awaiting_approval' OR (due_date IS NOT NULL AND due_date<date('now'))) THEN 1 ELSE 0 END) attention,
      sum(CASE WHEN status='awaiting_approval' THEN 1 ELSE 0 END) approvals,
      sum(CASE WHEN status='resolved' THEN 1 ELSE 0 END) resolved,
      sum(CASE WHEN status!='resolved' AND assignee_id=? THEN 1 ELSE 0 END) mine,
      sum(CASE WHEN status!='resolved' AND assignee_id IS NULL THEN 1 ELSE 0 END) unassigned ${base}`,actor.id,actor.id),
    all(db,`SELECT t.*,m.role,(SELECT count(*) FROM items i WHERE i.team_id=t.id AND i.status!='resolved') active_count,
      (SELECT count(*) FROM memberships ms WHERE ms.team_id=t.id) member_count FROM teams t JOIN memberships m ON m.team_id=t.id WHERE m.user_id=? ORDER BY t.name`,actor.id),
    all(db,`SELECT a.*,u.name actor_name,u.color actor_color,i.title item_title,i.number item_number FROM activity a JOIN memberships m ON m.team_id=a.team_id AND m.user_id=? JOIN users u ON u.id=a.actor_id LEFT JOIN items i ON i.id=a.item_id ORDER BY a.created_at DESC,a.id DESC LIMIT 8`,actor.id),
  ]);return {stats,teams,recent};
}
export async function activityPage(db,actor,query={}) {
  const page=Math.max(1,Math.min(10000,Number.parseInt(query.page,10)||1)),args=[actor.id],filter=query.team?" AND a.team_id=?":"";if(query.team)args.push(query.team);
  const from=`FROM activity a JOIN memberships m ON m.team_id=a.team_id AND m.user_id=? JOIN users u ON u.id=a.actor_id LEFT JOIN items i ON i.id=a.item_id WHERE 1=1${filter}`;
  const [entries,total]=await Promise.all([all(db,`SELECT a.*,u.name actor_name,u.color actor_color,i.title item_title,i.number item_number ${from} ORDER BY a.created_at DESC,a.id DESC LIMIT 20 OFFSET ?`,...args,(page-1)*20),one(db,`SELECT count(*) total ${from}`,...args)]);
  return {entries,total:total.total,page,pageSize:20};
}
export async function teamDetail(db,actor,id) {
  const role=await roleFor(db,actor,id);
  const members=await all(db,"SELECT u.id,u.name,u.email,u.color,u.demo,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.team_id=? ORDER BY m.role,u.name",id);
  const pending=role==="manager"?await all(db,"SELECT email,role,created_at FROM invitations WHERE team_id=? AND NOT EXISTS(SELECT 1 FROM users WHERE users.email=invitations.email) ORDER BY created_at DESC LIMIT 100",id):[];
  return {members,pending,role};
}
export async function grantMember(db,actor,teamId,input) {
  guard(await roleFor(db,actor,teamId)==="manager",403,"Only team managers can manage membership.","FORBIDDEN");
  const email=textField(input.email,"Email",3,254).toLowerCase();guard(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),400,"Enter a valid email address.");
  const role=enumField(input.role,["manager","member","viewer"],"role"),now=new Date().toISOString();
  const target=await one(db,"SELECT id FROM users WHERE email=?",email);
  guard(!target || target.id!==actor.id,422,"Ask another manager to change your own team role.");
  await db.batch([
    stmt(db,`INSERT INTO invitations(team_id,email,role,created_by,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM memberships WHERE team_id=? AND user_id=? AND role='manager') ON CONFLICT(team_id,email) DO UPDATE SET role=excluded.role,created_by=excluded.created_by,created_at=excluded.created_at`,teamId,email,role,actor.id,now,teamId,actor.id),
    stmt(db,`INSERT INTO memberships(team_id,user_id,role) SELECT ?,id,? FROM users WHERE email=? AND EXISTS(SELECT 1 FROM memberships WHERE team_id=? AND user_id=? AND role='manager') ON CONFLICT(team_id,user_id) DO UPDATE SET role=excluded.role`,teamId,role,email,teamId,actor.id),
    stmt(db,`INSERT INTO activity(id,item_id,team_id,actor_id,action,message,detail,created_at) SELECT ?,NULL,?,?,'membership',?,'{}',? WHERE EXISTS(SELECT 1 FROM memberships WHERE team_id=? AND user_id=? AND role='manager')`,crypto.randomUUID(),teamId,actor.id,`granted ${role} access to ${email}`,now,teamId,actor.id),
  ]);return {ok:true};
}
