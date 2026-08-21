import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { earthManifest } from '../src/world-manifest.js';

const root = path.resolve(import.meta.dirname, '..');
const databaseDir = await mkdtemp(path.join(os.tmpdir(), 'zillions-manifest-pg-'));
const postgres = new EmbeddedPostgres({ databaseDir, port: 29000 + Math.floor(Math.random() * 1000), user: 'postgres', password: 'postgres', persistent: false, onLog() {} });
const expectError = async (promise, marker) => assert.rejects(promise, (error) => String(error?.message || error).includes(marker), `expected ${marker}`);
let admin;
try {
  await postgres.initialise(); await postgres.start();
  admin = postgres.getPgClient(); await admin.connect();
  await admin.query(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
    create table public.world_planets(id text primary key);
    insert into public.world_planets(id) values('earth');
  `);
  await admin.query(await readFile(path.join(root, 'supabase/migrations/20260821050000_immutable_world_manifests.sql'), 'utf8'));
  await admin.query(await readFile(path.join(root, 'supabase/migrations/20260821080000_world_projection_manifest.sql'), 'utf8'));
  const manifest = earthManifest();
  const args = [manifest.planetId, manifest.schema, manifest.generatorVersion, manifest.seed, manifest.contentHash, manifest];
  await admin.query("select set_config('request.jwt.claim.role','service_role',false)");
  const first = (await admin.query('select public.create_world_manifest_once($1,$2,$3,$4,$5,$6) result', args)).rows[0].result;
  assert.equal(first.duplicate, false);
  const replay = (await admin.query('select public.create_world_manifest_once($1,$2,$3,$4,$5,$6) result', args)).rows[0].result;
  assert.equal(replay.duplicate, true);
  const conflict = structuredClone(manifest); conflict.name = 'Replacement Earth';
  await expectError(admin.query('select public.create_world_manifest_once($1,$2,$3,$4,$5,$6)', [...args.slice(0, 5), conflict]), 'immutable_world_manifest_conflict');
  await expectError(admin.query("update public.world_manifests set manifest=jsonb_set(manifest,'{name}','\"Mutated\"') where planet_id='earth'"), 'immutable_world_manifest_conflict');
  await expectError(admin.query("delete from public.world_manifests where planet_id='earth'"), 'immutable_world_manifest_delete_forbidden');
  await admin.query("update public.world_manifests set materialization_state='ready',materialized_at=now() where planet_id='earth'");
  await expectError(admin.query("update public.world_manifests set materialization_state='failed' where planet_id='earth'"), 'world_manifest_already_materialized');
  await admin.query('begin');
  await expectError(admin.query("delete from public.world_manifests where planet_id='earth'"), 'immutable_world_manifest_delete_forbidden');
  await admin.query('rollback');
  assert.equal((await admin.query("select count(*) count from public.world_manifests where planet_id='earth'")).rows[0].count, '1');
  const routine = (await admin.query("select prosecdef,proconfig,pg_get_userbyid(proowner) owner from pg_proc where oid='public.create_world_manifest_once(text,text,integer,bigint,text,jsonb)'::regprocedure")).rows[0];
  assert.equal(routine.prosecdef, true);
  assert.ok(routine.proconfig?.includes('search_path=public, pg_temp'));
  assert.equal(routine.owner, 'postgres');
  await admin.query('reset role');
  await admin.query('set role service_role');
  await expectError(admin.query("select * from public.world_manifests"), 'permission denied');
  await expectError(admin.query("update public.world_manifests set materialization_state='failed' where planet_id='earth'"), 'permission denied');
  await expectError(admin.query("delete from public.world_manifests where planet_id='earth'"), 'permission denied');
  await expectError(admin.query('truncate public.world_manifests'), 'permission denied');
  await expectError(admin.query('create table public.world_manifests_replacement(id text)'), 'permission denied');
  await admin.query("select set_config('request.jwt.claim.role','service_role',false)");
  const serviceReplay = (await admin.query('select public.create_world_manifest_once($1,$2,$3,$4,$5,$6) result', args)).rows[0].result;
  assert.equal(serviceReplay.duplicate, true, 'service role must use the fenced function');
  const projection = (await admin.query("select public.living_world_projection_manifest('earth') result")).rows[0].result;
  assert.equal(projection.manifest.planetId, 'earth');
  assert.equal(projection.content_hash, manifest.contentHash);
  assert.ok(projection.manifest.landmasses.length && projection.manifest.regions.length);
  assert.equal(projection.manifest.seed, undefined, 'projection must not expose the generation seed');
  assert.equal(projection.manifest.materialization, undefined, 'projection must not expose materialization internals');
  assert.equal((await admin.query("select has_function_privilege('public','public.living_world_projection_manifest(text)','execute') allowed")).rows[0].allowed, false);
  await admin.query('reset role');
  for (const role of ['anon', 'authenticated']) {
    await admin.query(`set role ${role}`);
    await admin.query("select set_config('request.jwt.claim.role',$1,false)", [role]);
    await expectError(admin.query('select public.create_world_manifest_once($1,$2,$3,$4,$5,$6)', args), 'permission denied');
    await expectError(admin.query("select public.living_world_projection_manifest('earth')"), 'permission denied');
    await admin.query('reset role');
  }
  console.log(`world manifest PostgreSQL integrity checks passed (${manifest.contentHash})`);
} finally {
  if (admin) await admin.end().catch(() => {});
  await postgres.stop().catch(() => {});
  await rm(databaseDir, { recursive: true, force: true });
}
