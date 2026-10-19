import { one,stmt } from "./core.mjs";

export async function ensureUser(db,identity) {
  const actor={id:identity.userId,name:identity.displayName,email:identity.email.toLowerCase(),color:"violet"};
  const now=new Date().toISOString();
  await db.batch([
    stmt(db,"INSERT INTO users(id,name,email,color,demo,created_at) VALUES (?,?,?,'violet',0,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email",actor.id,actor.name,actor.email,now),
    stmt(db,"INSERT INTO workspace(id,owner_id,seeded) VALUES ('main',?,0) ON CONFLICT(id) DO NOTHING",actor.id),
  ]);
  const workspace=await one(db,"SELECT * FROM workspace WHERE id='main'");
  if(!workspace.seeded)await seedWorkspace(db,workspace.owner_id);
  // Grants are created by managers, never inferred from sign-in alone.
  await db.batch([
    stmt(db,"INSERT INTO memberships(team_id,user_id,role) SELECT team_id,?,role FROM invitations WHERE email=? ON CONFLICT(team_id,user_id) DO NOTHING",actor.id,actor.email),
  ]);
  return actor;
}

export async function seedWorkspace(db,ownerId) {
  const now=new Date(),iso=now.toISOString(),hours=n=>new Date(now.getTime()-n*3600000).toISOString();
  const day=n=>new Date(now.getTime()+n*86400000).toISOString().slice(0,10);
  const teams=[
    ["engineering","Engineering","Keeping our products reliable, secure, and ready to scale.","violet"],
    ["operations","Operations","Making everyday operations work better for everyone.","blue"],
    ["customer-success","Customer Success","Turning customer needs into thoughtful resolutions.","orange"],
  ];
  const people=[
    ["sample_maya","Maya Rao","maya.rao@example.test","pink"],
    ["sample_arjun","Arjun Mehta","arjun.mehta@example.test","blue"],
    ["sample_priya","Priya Shah","priya.shah@example.test","orange"],
    ["sample_neil","Neil Thomas","neil.thomas@example.test","green"],
  ];
  const statements=[];
  for(const t of teams)statements.push(stmt(db,"INSERT INTO teams(id,name,description,color) VALUES (?,?,?,?) ON CONFLICT(id) DO NOTHING",...t));
  for(const p of people)statements.push(stmt(db,"INSERT INTO users(id,name,email,color,demo,created_at) VALUES (?,?,?,?,1,?) ON CONFLICT(id) DO NOTHING",...p,iso));
  const roles=[...teams.map(t=>[t[0],ownerId,"manager"]),["engineering","sample_maya","manager"],["engineering","sample_arjun","member"],["engineering","sample_neil","viewer"],["operations","sample_priya","manager"],["operations","sample_neil","member"],["customer-success","sample_maya","manager"],["customer-success","sample_priya","member"]];
  for(const r of roles)statements.push(stmt(db,"INSERT INTO memberships(team_id,user_id,role) VALUES (?,?,?) ON CONFLICT(team_id,user_id) DO NOTHING",...r));
  const samples=[
    ["Investigate payment webhook failures","engineering","Incident","critical","in_progress","sample_arjun",0,-1,"Several payment webhooks are returning 502 responses. Reproduce the issue, inspect delivery logs, and confirm that retried payments are processed exactly once.\n\nNext step: compare upstream timeout logs with the recent deployment."],
    ["Review vendor payout reconciliation","operations","Finance","high","awaiting_approval","sample_priya",1,0,"The monthly vendor payout reconciliation is ready for review. Validate the unmatched transactions before releasing the payment batch.\n\nNext step: a manager should review the reconciliation and approve or request changes."],
    ["Resolve enterprise onboarding blocker","customer-success","Customer issue","high","blocked","sample_maya",0,0,"A new enterprise workspace cannot complete account verification. Customer Success has collected the details and is waiting on the identity provider.\n\nNext step: follow up with the identity provider and update the customer."],
    ["Audit production access permissions","engineering","Compliance","high","open",null,1,2,"Review elevated production permissions and identify access that is no longer required. Record evidence and submit the findings for independent approval."],
    ["Update incident response runbook","engineering","Engineering","medium","in_progress",ownerId,0,3,"Refresh the incident response runbook with the new escalation path, ownership rules, and rollback checklist.\n\nNext step: validate the contact list with each team lead."],
    ["Investigate duplicate invoice entries","operations","Finance","high","open",null,0,1,"Finance reported duplicate entries in the latest invoice export. Compare source records and determine whether the issue is in export generation or ingestion."],
    ["Approve customer data export request","customer-success","Compliance","medium","awaiting_approval","sample_priya",1,2,"The requested customer data export has been prepared. Review the scope and verify the requester before approving release."],
    ["Track delayed warehouse shipment","operations","Operations","medium","in_progress","sample_neil",0,2,"Contact the carrier regarding a delayed warehouse shipment. Confirm a revised delivery date and notify the receiving team."],
    ["Reduce API response time spikes","engineering","Engineering","medium","open","sample_arjun",0,5,"Investigate intermittent latency on the reporting endpoint. Capture a baseline and identify queries that need indexing or pagination."],
    ["Follow up on customer renewal","customer-success","Customer issue","low","open",null,0,7,"Confirm outstanding renewal questions and prepare a clear next-step summary for the customer."],
    ["Restore scheduled report delivery","engineering","Incident","high","resolved","sample_maya",0,-2,"Report delivery was restored after a queue configuration correction. Delivery timestamps were verified and the incident was documented."],
    ["Reconcile office equipment inventory","operations","Operations","low","resolved","sample_neil",0,-1,"The quarterly equipment register has been reconciled with department records. All discrepancies have been accounted for."],
  ];
  for(let i=0;i<samples.length;i++) {
    const [title,team,category,priority,status,assignee,approval,due,description]=samples[i];
    const id=`sample_item_${i+1}`,created=hours(48+i*4),updated=hours(0.25+i*0.7),key=`seed_${i+1}`;
    statements.push(stmt(db,`INSERT INTO items(id,team_id,title,description,category,status,priority,assignee_id,created_by,due_date,requires_approval,version,last_operation,creation_key,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?) ON CONFLICT(creation_key) DO NOTHING`,id,team,title,description,category,status,priority,assignee,ownerId,day(due),approval,key,key,created,updated));
    statements.push(stmt(db,"INSERT INTO activity(id,item_id,team_id,actor_id,action,message,detail,created_at) VALUES (?,?,?,?,'created','created this work item','{}',?) ON CONFLICT(id) DO NOTHING",`seed_created_${i}`,id,team,ownerId,created));
    if(status!=="open")statements.push(stmt(db,"INSERT INTO activity(id,item_id,team_id,actor_id,action,message,detail,created_at) VALUES (?,?,?,?,'status',?,'{}',?) ON CONFLICT(id) DO NOTHING",`seed_status_${i}`,id,team,assignee||ownerId,`changed status to ${status.replaceAll('_',' ')}`,updated));
  }
  const body="I have reproduced the issue and collected the latest delivery logs. Checking the upstream timeout configuration next.";
  statements.push(stmt(db,"INSERT INTO comments(id,item_id,actor_id,body,created_at) VALUES ('seed_comment','sample_item_1','sample_arjun',?,?) ON CONFLICT(id) DO NOTHING",body,hours(.1)));
  statements.push(stmt(db,"INSERT INTO activity(id,item_id,team_id,actor_id,action,message,detail,created_at) VALUES ('seed_comment','sample_item_1','engineering','sample_arjun','comment','added a comment',?,?) ON CONFLICT(id) DO NOTHING",JSON.stringify({body}),hours(.1)));
  statements.push(stmt(db,"UPDATE workspace SET seeded=1 WHERE id='main'"));
  await db.batch(statements);
}
