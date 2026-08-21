import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const root=path.resolve(import.meta.dirname,'..'),databaseDir=await mkdtemp(path.join(os.tmpdir(),'zillions-activation-pg-'));
const postgres=new EmbeddedPostgres({databaseDir,port:28000+Math.floor(Math.random()*1000),user:'postgres',password:'postgres',persistent:false,onLog(){}});let admin;
try{
  await postgres.initialise();await postgres.start();admin=postgres.getPgClient();await admin.connect();
  await admin.query(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create table public.rooms(id uuid primary key default gen_random_uuid(),max_players integer not null default 2 check(max_players between 1 and 2));create table public.room_players(room_id uuid not null references public.rooms(id),user_id uuid not null references auth.users(id),seat integer not null check(seat between 1 and 2),primary key(room_id,user_id));create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;`);
  const names=(await readdir(path.join(root,'supabase/migrations'))).filter(name=>name.endsWith('.sql')).sort(),finalName='20260820233000_region_runtime_unification.sql';
  for(const name of names.filter(name=>name!==finalName))await admin.query(await readFile(path.join(root,'supabase/migrations',name),'utf8'));
  const finalSql=await readFile(path.join(root,'supabase/migrations',finalName),'utf8'),transactional=finalSql.replace(/^\s*begin;\s*/i,'').replace(/\s*commit;\s*$/i,'');
  await admin.query('begin');await admin.query(transactional);
  assert.equal((await admin.query("select to_regclass('public.world_region_runtime_ticks') name")).rows[0].name,'world_region_runtime_ticks');
  await admin.query('rollback');
  assert.equal((await admin.query("select to_regclass('public.world_region_runtime_ticks') name")).rows[0].name,null,'rollback must restore the pre-activation schema');
  assert.equal(Number((await admin.query("select count(*) count from information_schema.columns where table_schema='public' and table_name='world_battle_assignments' and column_name='region_lease_epoch'")).rows[0].count),0);
  await admin.query(finalSql);await admin.query("select set_config('request.jwt.claim.role','service_role',false)");
  assert.equal((await admin.query("select to_regclass('public.world_region_runtime_ticks') name")).rows[0].name,'world_region_runtime_ticks');
  console.log('living world activation rollback rehearsal passed');
}finally{if(admin)await admin.end().catch(()=>{});await postgres.stop().catch(()=>{});await rm(databaseDir,{recursive:true,force:true});}
