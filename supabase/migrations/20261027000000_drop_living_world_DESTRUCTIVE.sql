-- ============================================================================
-- DESTRUCTIVE: remove the living-world / MMO layer.
--
-- REVIEW BEFORE APPLYING. This migration permanently drops every world_* and
-- social_* table (and all rows in them) plus every function those migrations
-- created. The game is now a siege-only game; nothing in the client or API
-- reads these objects any more.
--
-- Apply manually in the Supabase SQL editor (or `supabase db push`) only after:
--   1. taking a backup / PITR snapshot of the project,
--   2. confirming no external job still calls living_world_* RPCs
--      (the Vercel crons that drove them were removed from vercel.json),
--   3. reading the table and function lists below.
--
-- Historical migrations 20260820173000 .. 20260822052000 are intentionally left
-- untouched so the migration history stays replayable.
--
-- Not touched: profiles, player_stats, match_history, rooms, room_players,
-- game_saves, game_characters, player_wallets, item_instances, economy_*,
-- crafting_*, component_instances.
-- ============================================================================

begin;

drop table if exists public.social_parties cascade;
drop table if exists public.social_party_invites cascade;
drop table if exists public.social_party_members cascade;
drop table if exists public.social_party_requests cascade;
drop table if exists public.world_api_rate_buckets cascade;
drop table if exists public.world_armies cascade;
drop table if exists public.world_battle_assignments cascade;
drop table if exists public.world_battle_orders cascade;
drop table if exists public.world_battle_results cascade;
drop table if exists public.world_battle_rounds cascade;
drop table if exists public.world_caravan_plans cascade;
drop table if exists public.world_cargo cascade;
drop table if exists public.world_commands cascade;
drop table if exists public.world_companies cascade;
drop table if exists public.world_company_commands cascade;
drop table if exists public.world_company_members cascade;
drop table if exists public.world_encounter_decisions cascade;
drop table if exists public.world_encounters cascade;
drop table if exists public.world_engagements cascade;
drop table if exists public.world_events cascade;
drop table if exists public.world_faction_region_states cascade;
drop table if exists public.world_faction_reputation cascade;
drop table if exists public.world_factions cascade;
drop table if exists public.world_governance_audit cascade;
drop table if exists public.world_governance_commands cascade;
drop table if exists public.world_holding_permissions cascade;
drop table if exists public.world_holdings cascade;
drop table if exists public.world_locations cascade;
drop table if exists public.world_logistics_ticks cascade;
drop table if exists public.world_manifests cascade;
drop table if exists public.world_markets cascade;
drop table if exists public.world_movement_orders cascade;
drop table if exists public.world_parties cascade;
drop table if exists public.world_planets cascade;
drop table if exists public.world_population_observations cascade;
drop table if exists public.world_population_targets cascade;
drop table if exists public.world_prisoners cascade;
drop table if exists public.world_provinces cascade;
drop table if exists public.world_pursuits cascade;
drop table if exists public.world_raid_orders cascade;
drop table if exists public.world_recruitment_offers cascade;
drop table if exists public.world_region_control_history cascade;
drop table if exists public.world_region_handoffs cascade;
drop table if exists public.world_region_runtime_health cascade;
drop table if exists public.world_region_runtime_ticks cascade;
drop table if exists public.world_region_states cascade;
drop table if exists public.world_region_worker_leases cascade;
drop table if exists public.world_routes cascade;
drop table if exists public.world_scouting_reports cascade;
drop table if exists public.world_shards cascade;
drop table if exists public.world_siege_advances cascade;
drop table if exists public.world_siege_resolutions cascade;
drop table if exists public.world_sieges cascade;
drop table if exists public.world_star_systems cascade;
drop table if exists public.world_supplies cascade;
drop table if exists public.world_supply_offers cascade;
drop table if exists public.world_town_services cascade;
drop table if exists public.world_trade_requests cascade;
drop table if exists public.world_tutorial_progress cascade;
drop table if exists public.world_unit_stacks cascade;
drop table if exists public.world_universes cascade;
drop table if exists public.world_worker_leases cascade;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array[
      'activate_group_movement_order',
      'advance_world_siege',
      'apply_company_battle_consequences',
      'bootstrap_player_company',
      'bootstrap_player_world_knowledge',
      'claim_world_region_lease',
      'complete_world_region_handoff',
      'complete_world_tutorial_from_campaign',
      'consume_world_api_rate_limit',
      'create_world_manifest_once',
      'create_world_raid',
      'create_world_region_encounters',
      'enforce_world_faction_region_state_scope',
      'enter_living_world',
      'fence_materialized_world_location',
      'fence_materialized_world_province',
      'fence_materialized_world_route',
      'fence_world_battle_assignment',
      'guard_issued_battle_force',
      'is_social_party_member',
      'living_world_command',
      'living_world_commit_battle',
      'living_world_company_command',
      'living_world_get_battle_assignment',
      'living_world_governance_command',
      'living_world_issue_battle',
      'living_world_open_engagement',
      'living_world_process_region',
      'living_world_process_shard',
      'living_world_projection_manifest',
      'living_world_region_runtime_batch',
      'living_world_trade_market',
      'materialize_world_manifest',
      'mutate_world_region_control',
      'prevent_world_manifest_delete',
      'prevent_world_manifest_mutation',
      'process_world_phase2_actions',
      'process_world_region_logistics',
      'process_world_region_runtime',
      'reconcile_world_planet_population',
      'reconcile_world_region_population',
      'record_world_region_control_history',
      'record_world_region_runtime_health',
      'record_world_tutorial_step',
      'request_world_region_handoff',
      'resolve_world_siege',
      'seed_ai_encounter_decision',
      'seed_ai_world_force',
      'seed_world_location_player_services',
      'social_party_command',
      'social_party_manage_member',
      'social_party_snapshot',
      'submit_world_encounter_decision',
      'sync_recruit_to_world_force',
      'validate_world_control_faction_planet',
      'world_company_effective_speed',
      'world_manifest_population_ready',
      'world_materialized_topology_fingerprint'
    ])
  loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;
end
$$;

commit;
