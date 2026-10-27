// Applies supabase/schema.sql plus every migration to a throwaway local
// Postgres (embedded-postgres binaries, never a real project) and exercises
// apply_match_result(): backfill, grants, idempotency, rate limit, CAS,
// duplicate rooms, the duration clock, and the client-write revokes.
//   npm run check:postgres
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import pg from 'pg';

const root = new URL('..', import.meta.url).pathname;
const read = (rel) => readFileSync(join(root, rel), 'utf8');
let bin;
try { bin = dirname((await import(`@embedded-postgres/${process.platform}-${process.arch}`)).initdb); }
catch { console.log('match-result-postgres-check: skipped (no embedded-postgres binaries for this platform)'); process.exit(0); }
if (!existsSync(join(bin, 'initdb'))) { console.log('match-result-postgres-check: skipped (initdb missing)'); process.exit(0); }

const data = mkdtempSync(join(tmpdir(), 'zillions-pg-'));
const port = 55000 + Math.floor(Math.random() * 2000);
const quiet = { stdio: ['ignore', 'ignore', 'pipe'] };
execFileSync(join(bin, 'initdb'), ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8'], quiet);
execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-o', `-p ${port} -k ${data} -c listen_addresses=''`, '-w', 'start', '-l', join(data, 'log')], quiet);
const client = new pg.Client({ host: data, port, user: 'postgres', database: 'postgres' });
let checks = 0;
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const rejects = async (promise, re, msg) => { await assert.rejects(promise, re, msg); checks++; };
try {
  await client.connect();
  const q = (sql, params) => client.query(sql, params);
  // Minimal stand-ins for what a Supabase project provides.
  await q(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql as 'select null::uuid';
    create schema extensions; create extension if not exists pgcrypto with schema extensions;
    set search_path = public, extensions;
    create publication supabase_realtime;`);
  await q(read('supabase/schema.sql'));
  for (const file of readdirSync(join(root, 'supabase/migrations')).sort()) await q(read(`supabase/migrations/${file}`));

  const uid = '11111111-1111-1111-1111-111111111111';
  await q(`insert into auth.users(id, raw_user_meta_data) values ($1, $2)`, [uid, { campaign: 3, mmo_characters: [{ id: 'mmo_a', level: 12, xp: 40 }] }]);
  await q(`insert into public.game_characters(user_id, client_character_id, name, class_key, race_key) values ($1, 'mmo_a', 'A', 'vanguard', 'human')`, [uid]);
  await q(read('supabase/migrations/20261027000100_server_authoritative_progress.sql'));
  eq((await q('select level, xp::int xp, progress_revision::int progress_revision from game_characters')).rows[0], { level: 12, xp: 40, progress_revision: 1 }, 'legacy level/XP backfilled once');
  eq((await q('select campaign_cleared from player_stats')).rows[0].campaign_cleared, 3, 'legacy campaign progress backfilled');
  await q(read('supabase/migrations/20261027000100_server_authoritative_progress.sql'));
  eq((await q('select progress_revision::int p from game_characters')).rows[0].p, 1, 'backfill does not repeat');
  // Re-running the progress migration recreates the old 6-argument RPC; the
  // ticket migration must remove it again and be safe to re-run itself.
  await q(read('supabase/migrations/20261027000200_match_tickets_and_replays.sql'));
  eq((await q(`select count(*)::int n from pg_proc where proname = 'apply_match_result'`)).rows[0].n, 1, 'only the ticketed apply_match_result remains');

  const issue = (room = null, level = 1, actor = uid) =>
    q(`select public.issue_match_ticket($1, 'mmo_a', $2, 'campaign', 'normal', 7, $3, 3600) t`, [actor, level, room]).then((r) => r.rows[0].t);
  const callWith = (ticketId, rid, result, rev, room = null, replay = {}) =>
    q(`select public.apply_match_result($1, $2, 'mmo_a', $3, $4, $5, $6, $7) r`, [uid, rid, room, rev, result, ticketId, replay]).then((r) => r.rows[0].r);
  // A ticket issued half an hour ago: long enough ago for a 600 s match.
  const aged = async (room = null) => {
    const t = await issue(room);
    await q(`update match_tickets set issued_at = now() - interval '30 minutes' where id = $1`, [t.id]);
    return t;
  };
  const call = async (rid, result, rev, room = null) => callWith((await aged(room)).id, rid, result, rev, room);
  const age = () => q(`update match_reports set created_at = now() - interval '20 minutes';
    update match_tickets set issued_at = now() - interval '30 minutes', expires_at = now() + interval '1 hour' where used_at is null`);
  const result = {
    report: { mode: 'campaign', levelId: 1, difficulty: 'normal', won: true, durationSeconds: 600, kills: 300, threatLevel: 3, built: 20, hero: 'scott' },
    level: 13, xp: 5, xp_gained: 500, levels_gained: [13], alloy: 42, quests_completed: ['l1q1'], relics: ['warlord_crest'],
    items: [
      { legacy_key: 'worn_scope', base_id: 'worn_scope', slot_pool: 'unknown', item_level: 1, rarity: 3, quest_id: null, provenance: { source: 'match_field' } },
      { legacy_key: 'targeting_optic', base_id: 'targeting_optic', slot_pool: 'unknown', item_level: 1, rarity: 3, quest_id: 'l1q1', provenance: {} },
    ],
    stats: { wins: 1, losses: 0, kills: 300, buildingsBuilt: 20, bestDay: 3, bestWave: 0, favoriteHero: 'scott' },
    progress: { campaignCleared: 1, bestSurvival: 0, labyrinthClear: null },
  };
  // Tickets: a report needs one, issued to this player for this mission.
  await rejects(callWith(null, 'req-0000000a', result, 1), /missing_ticket/, 'reports without a ticket are refused');
  const early = await issue();
  await rejects(callWith(early.id, 'req-0000000b', result, 1), /implausible_duration/, 'match length is measured from the ticket issue time');
  await q(`update match_tickets set issued_at = now() - interval '30 minutes'`);
  const otherLevel = await issue(null, 2);
  await q(`update match_tickets set issued_at = now() - interval '30 minutes'`);
  await rejects(callWith(otherLevel.id, 'req-0000000c', result, 1), /ticket_mismatch/, 'a ticket for another mission is refused');
  const expired = await issue();
  await q(`update match_tickets set issued_at = now() - interval '3 hours', expires_at = now() - interval '1 second' where id = $1`, [expired.id]);
  await rejects(callWith(expired.id, 'req-0000000d', result, 1), /ticket_expired/, 'expired tickets are refused');
  await q(`delete from match_tickets where used_at is null`);
  eq((await q('select count(*)::int n from match_reports')).rows[0].n, 0, 'refused reports leave no trace');
  const first = await call('req-00000001', result, 1);
  const spent = (await q(`select ticket_id from match_reports where request_id = 'req-00000001'`)).rows[0].ticket_id;
  eq((await q(`select used_at is not null u, request_id from match_tickets where id = $1`, [spent])).rows[0], { u: true, request_id: 'req-00000001' }, 'ticket spent by the report');
  eq([first.character.level, first.character.progressRevision, first.alloyGained, first.wallet.balance], [13, 2, 42, 42], 'grant applied');
  eq(first.grantedItems.sort(), ['targeting_optic', 'worn_scope'], 'items granted');
  eq((await call('req-00000001', result, 1)).duplicate, true, 'same requestId returns the stored response');
  eq((await q('select count(*)::int n from item_instances')).rows[0].n, 2, 'replay grants nothing');
  await rejects(call('req-00000002', result, 2), /rate_limited/, 'reports are rate limited');
  await age();
  await rejects(callWith(spent, 'req-0000000e', result, 2), /ticket_used/, 'a ticket is single use');
  await rejects(call('req-00000003', result, 1), /stale_progress/, 'stale progress revision rejected');
  const second = await call('req-00000004', result, 2);
  eq(second.questsCompleted, [], 'quests pay once');
  eq(second.skippedItems.map((s) => s.reason).sort(), ['already_owned', 'quest_already_completed'], 'signature items and quest items not duplicated');
  eq(second.wallet.balance, 84, 'Alloy credited each match');
  eq((await q('select wins, campaign_cleared, relics from player_stats')).rows[0], { wins: 2, campaign_cleared: 3, relics: ['warlord_crest'] }, 'stats accumulate; progress never regresses; relics unioned');
  await age();
  await rejects(call('req-00000005', { ...result, report: { ...result.report, durationSeconds: 3600 } }, 3), /implausible_duration/, 'match longer than the wall clock rejected');
  // Co-op rooms: tickets need a seat; invite-code rooms seat players server-side.
  const other = '33333333-3333-3333-3333-333333333333';
  await q(`insert into auth.users(id) values ($1)`, [other]);
  const room = (await q(`select public.create_manual_coop_room($1, 'Host', 'scott', 1, 'campaign', 'normal') r`, [other])).rows[0].r;
  await rejects(issue(room), /not_a_room_participant/, 'room tickets need a seat');
  eq((await q(`select public.seat_manual_coop_player($1, $2, 'Guest', 'scott') s`, [uid, room])).rows[0].s, 2, 'invite-code guest seated');
  eq((await q(`select public.seat_manual_coop_player($1, $2, 'Guest', 'scott') s`, [uid, room])).rows[0].s, 2, 'seating is idempotent');
  const roomTicket = await issue(room);
  eq((await issue(room)).id, roomTicket.id, 'reconnecting to a room reuses its unused ticket');
  await q(`update match_tickets set issued_at = now() - interval '30 minutes' where id = $1`, [roomTicket.id]);
  const coop = await callWith(roomTicket.id, 'req-00000006', result, 3, room, { status: 'verified', reasons: ['personal_best'] });
  eq(coop.replay.status, 'verified', 'replay outcome is returned');
  eq((await q(`select status from rooms where id = $1`, [room])).rows[0].status, 'finished', 'invite-code room closes after a report');
  eq((await q(`select room_id, replay_status, flagged from match_reports where request_id = 'req-00000006'`)).rows[0], { room_id: room, replay_status: 'verified', flagged: false }, 'co-op report credited to the room');
  await age();
  await rejects(callWith(roomTicket.id, 'req-00000007', result, 4, room), /duplicate_room_report/, 'one report per player per co-op room');
  const deferred = await issue();
  await q(`update match_tickets set issued_at = now() - interval '30 minutes' where id = $1`, [deferred.id]);
  await callWith(deferred.id, 'req-00000008', result, 4, null, { status: 'deferred', reasons: ['spot_check'], log: { v: 1, frames: 10, log: [] } });
  eq((await q(`select r.flagged, p.status from match_reports r join match_replays p on p.report_id = r.id where r.request_id = 'req-00000008'`)).rows[0], { flagged: true, status: 'pending' }, 'deferred replays are stored and flagged');
  eq((await q('select count(*)::int n from match_history')).rows[0].n, 4, 'match history written by the server only');
  eq((await q(`select has_function_privilege('authenticated', 'public.issue_match_ticket(uuid,text,integer,text,text,bigint,uuid,integer)', 'EXECUTE') f`)).rows[0].f, false, 'ticket RPC not callable by clients');
  eq((await q(`select has_table_privilege('authenticated', 'public.match_tickets', 'INSERT') i`)).rows[0].i, false, 'clients cannot mint tickets');

  // Even if Supabase's default grants are re-applied, RLS has no write policy.
  const policies = (await q(`select policyname from pg_policies where tablename in ('player_stats','match_history') order by 1`)).rows.map((r) => r.policyname);
  eq(policies.filter((p) => /insert|update/.test(p)), [], 'no client write policies remain');
  eq((await q(`select has_function_privilege('authenticated', 'public.apply_match_result(uuid,text,text,uuid,bigint,jsonb,uuid,jsonb)', 'EXECUTE') f`)).rows[0].f, false, 'RPC not callable by clients');
  eq((await q(`select has_table_privilege('authenticated', 'public.player_stats', 'UPDATE') u`)).rows[0].u, false, 'stats updates revoked');
  eq((await q(`select count(*)::int n from pg_tables where schemaname = 'public' and (tablename like 'world\\_%' or tablename like 'social\\_%')`)).rows[0].n, 0, 'living-world tables dropped');
  eq((await q(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (proname like '%world%' or proname like 'social%')`)).rows[0].n, 0, 'living-world functions dropped');
} finally {
  await client.end().catch(() => {});
  try { execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop'], quiet); } catch { /* already down */ }
  rmSync(data, { recursive: true, force: true });
}
console.log(`match-result-postgres-check: ${checks} checks passed against a throwaway local Postgres`);
