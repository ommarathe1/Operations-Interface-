import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
import Module from "node:module";
import ts from "typescript";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";

// This is a server-render smoke check, not a browser-interaction substitute.
const filename=fileURLToPath(new URL("../app/workspace.tsx",import.meta.url));
const output=ts.transpileModule(readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const compiled=new Module(filename);compiled.filename=filename;compiled.paths=Module._nodeModulePaths(path.dirname(filename));compiled._compile(output,filename);
const Workspace=compiled.exports.default;
const actor={id:"owner",name:"Test Owner",email:"owner@example.test",color:"violet"};
const team={id:"engineering",name:"Engineering",description:"Engineering work",color:"violet",role:"manager",active_count:1,member_count:1};
const item={id:"test-item",number:1,title:'<img src=x onerror="alert(1)">',description:"Context",team_id:team.id,team_name:team.name,team_color:team.color,status:"open",priority:"high",category:"Engineering",assignee_id:null,assignee_name:null,assignee_color:null,due_date:null,requires_approval:0,version:1,role:"manager",created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
test("workspace server-renders its initial queue and escapes user-provided text",()=>{
  const html=renderToStaticMarkup(React.createElement(Workspace,{initial:{actor,teams:[team],stats:{total:1,active:1,unassigned:1},recent:[]},initialList:{items:[item],total:1,page:1,pageSize:15}}));
  assert.match(html,/Operations overview/);assert.match(html,/OPS-1001/);assert.match(html,/&lt;img/);assert.ok(!html.includes('<img src=x'));
});
test("a signed-in person without team membership receives an access explanation",()=>{
  const html=renderToStaticMarkup(React.createElement(Workspace,{initial:{actor,teams:[],stats:{},recent:[]},initialList:{items:[],total:0,page:1,pageSize:15}}));
  assert.match(html,/Sign-in alone does not provide access/);assert.ok(!html.includes('OPS-1001'));
});
