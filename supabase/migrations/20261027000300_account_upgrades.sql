-- ============================================================================
-- Server-owned account upgrade tree, one-time import of local progress, and a
-- paid Lattice rewire for signed-in players.
--
-- REVIEW BEFORE APPLYING. Apply by hand in Supabase AFTER 20261027000100 and
-- 20261027000200, and after deploying the client and api/account-upgrades.js.
-- Older clients never call these functions; nothing they do changes.
--
-- What it does:
--   1. account_upgrade_catalog: the node ids, prerequisites and Alloy costs.
--      It mirrors META_NODES in src/meta.js (scripts/account-upgrades-check.mjs
--      fails CI if the two drift). Costs are read from here, never from a
--      request.
--   2. account_upgrades: one row per owned node per account. Read-own RLS, no
--      client writes.
--   3. account_upgrade_imports: one row per account that has imported its
--      local (browser) tree. The import is free, once, prerequisite-closed and
--      capped at c_import_allowance Alloy of node value. Local Alloy is never
--      imported.
--   4. account_upgrade_mutate(): service_role only. Actions:
--        buy             debit player_wallets.salvage_alloy by the catalog cost
--        import_local    the one-time import above
--        rewire_lattice  debit 45 Alloy per allocated Lattice point (the
--                        REWIRE_COST in src/skilltree.js) and clear that
--                        character's Lattice in auth user metadata, atomically
--      Requests are idempotent through economy_requests and audited in
--      economy_audit_events, like economy_mutate().
-- ============================================================================

begin;

create table if not exists public.account_upgrade_catalog (
  node_id text primary key check (node_id ~ '^[a-z_]{1,48}$'),
  branch text not null,
  tier integer not null check (tier between 1 and 9),
  cost integer not null check (cost > 0),
  requires text[] not null default '{}'
);

insert into public.account_upgrade_catalog(node_id, branch, tier, cost, requires) values
  ('supply_cache',     'supply',  1, 120, '{}'),
  ('supply_depot',     'supply',  2, 260, '{supply_cache}'),
  ('supply_tithe',     'supply',  2, 320, '{supply_cache}'),
  ('supply_convoy',    'supply',  3, 640, '{supply_depot,supply_tithe}'),
  ('warband_vigor',    'warband', 1, 140, '{}'),
  ('warband_edge',     'warband', 2, 300, '{warband_vigor}'),
  ('warband_stride',   'warband', 2, 260, '{warband_vigor}'),
  ('warband_focus',    'warband', 3, 620, '{warband_edge,warband_stride}'),
  ('command_slot',     'command', 1, 180, '{}'),
  ('command_scanner',  'command', 2, 340, '{command_slot}'),
  ('command_ledger',   'command', 2, 460, '{command_slot}'),
  ('command_harness',  'command', 3, 720, '{command_scanner,command_ledger}')
on conflict (node_id) do update set branch = excluded.branch, tier = excluded.tier,
  cost = excluded.cost, requires = excluded.requires;

create table if not exists public.account_upgrades (
  user_id uuid not null references auth.users(id) on delete cascade,
  node_id text not null references public.account_upgrade_catalog(node_id),
  cost_paid integer not null check (cost_paid >= 0),
  source text not null check (source in ('purchase', 'import')),
  request_id text not null,
  acquired_at timestamptz not null default now(),
  primary key (user_id, node_id)
);

create table if not exists public.account_upgrade_imports (
  user_id uuid primary key references auth.users(id) on delete cascade,
  request_id text not null,
  claimed_nodes text[] not null default '{}',
  granted_nodes text[] not null default '{}',
  allowance integer not null,
  imported_at timestamptz not null default now()
);

alter table public.account_upgrade_catalog enable row level security;
alter table public.account_upgrades enable row level security;
alter table public.account_upgrade_imports enable row level security;
drop policy if exists account_upgrade_catalog_read on public.account_upgrade_catalog;
create policy account_upgrade_catalog_read on public.account_upgrade_catalog
  for select to anon, authenticated using (true);
drop policy if exists account_upgrades_read_self on public.account_upgrades;
create policy account_upgrades_read_self on public.account_upgrades
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists account_upgrade_imports_read_self on public.account_upgrade_imports;
create policy account_upgrade_imports_read_self on public.account_upgrade_imports
  for select to authenticated using (auth.uid() = user_id);
revoke insert, update, delete, truncate on public.account_upgrade_catalog from anon, authenticated;
revoke insert, update, delete, truncate on public.account_upgrades from anon, authenticated;
revoke insert, update, delete, truncate on public.account_upgrade_imports from anon, authenticated;

create or replace function public.account_upgrade_mutate(
  p_actor uuid,
  p_request_id text,
  p_action text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_import_allowance constant integer := 600;
  c_rewire_cost constant integer := 45;
  v_existing public.economy_requests%rowtype;
  v_node public.account_upgrade_catalog%rowtype;
  v_wallet public.player_wallets%rowtype;
  v_owned text[];
  v_claimed text[];
  v_granted text[] := '{}';
  v_value integer := 0;
  v_meta jsonb;
  v_chars jsonb;
  v_index integer;
  v_spent integer;
  v_cost integer;
  v_character_id uuid;
  v_response jsonb;
begin
  if p_actor is null or p_request_id is null or length(p_request_id) not between 8 and 64 then
    raise exception 'invalid_request';
  end if;
  if p_action not in ('buy', 'import_local', 'rewire_lattice') then raise exception 'invalid_action'; end if;
  p_payload := coalesce(p_payload, '{}'::jsonb);

  perform pg_advisory_xact_lock(hashtextextended('account_upgrades:' || p_actor::text, 0));
  select * into v_existing from public.economy_requests where actor_user_id = p_actor and request_id = p_request_id;
  if found then
    if v_existing.action <> 'upgrade_' || p_action or v_existing.request_payload <> p_payload then
      raise exception 'idempotency_conflict';
    end if;
    if v_existing.response_payload is null then raise exception 'request_in_progress'; end if;
    return v_existing.response_payload || jsonb_build_object('duplicate', true);
  end if;
  insert into public.economy_requests(actor_user_id, request_id, action, request_payload)
  values (p_actor, p_request_id, 'upgrade_' || p_action, p_payload);
  insert into public.player_wallets(user_id) values (p_actor) on conflict (user_id) do nothing;
  select coalesce(array_agg(node_id order by node_id), '{}') into v_owned from public.account_upgrades where user_id = p_actor;

  if p_action = 'buy' then
    select * into v_node from public.account_upgrade_catalog where node_id = p_payload->>'node_id';
    if not found then raise exception 'unknown_upgrade'; end if;
    if v_node.node_id = any(v_owned) then raise exception 'already_owned'; end if;
    if not (v_node.requires <@ v_owned) then raise exception 'upgrade_locked'; end if;
    update public.player_wallets set salvage_alloy = salvage_alloy - v_node.cost, revision = revision + 1, updated_at = now()
      where user_id = p_actor and salvage_alloy >= v_node.cost returning * into v_wallet;
    if not found then raise exception 'insufficient_funds'; end if;
    insert into public.account_upgrades(user_id, node_id, cost_paid, source, request_id)
    values (p_actor, v_node.node_id, v_node.cost, 'purchase', p_request_id);
    v_owned := v_owned || v_node.node_id;
    v_response := jsonb_build_object('ok', true, 'action', p_action, 'nodeId', v_node.node_id, 'cost', v_node.cost);

  elsif p_action = 'import_local' then
    if exists (select 1 from public.account_upgrade_imports where user_id = p_actor) then
      raise exception 'already_imported';
    end if;
    if jsonb_typeof(p_payload->'nodes') is distinct from 'array' or jsonb_array_length(p_payload->'nodes') > 64 then
      raise exception 'invalid_import';
    end if;
    select coalesce(array_agg(distinct value), '{}') into v_claimed
      from jsonb_array_elements_text(p_payload->'nodes') value;
    -- Cheapest-first within tier order, so prerequisites come before what
    -- needs them; a node is granted only if every prerequisite is owned or
    -- granted in this same pass and it still fits the allowance.
    for v_node in select * from public.account_upgrade_catalog order by tier, cost, node_id loop
      continue when not (v_node.node_id = any(v_claimed)) or v_node.node_id = any(v_owned);
      continue when not (v_node.requires <@ (v_owned || v_granted));
      continue when v_value + v_node.cost > c_import_allowance;
      v_granted := v_granted || v_node.node_id;
      v_value := v_value + v_node.cost;
      insert into public.account_upgrades(user_id, node_id, cost_paid, source, request_id)
      values (p_actor, v_node.node_id, 0, 'import', p_request_id);
    end loop;
    insert into public.account_upgrade_imports(user_id, request_id, claimed_nodes, granted_nodes, allowance)
    values (p_actor, p_request_id, v_claimed, v_granted, c_import_allowance);
    v_owned := v_owned || v_granted;
    select * into v_wallet from public.player_wallets where user_id = p_actor;
    v_response := jsonb_build_object('ok', true, 'action', p_action, 'granted', to_jsonb(v_granted),
      'grantedValue', v_value, 'allowance', c_import_allowance);

  else -- rewire_lattice
    select id into v_character_id from public.game_characters
      where user_id = p_actor and client_character_id = p_payload->>'client_character_id';
    if not found then raise exception 'character_not_found'; end if;
    select raw_user_meta_data into v_meta from auth.users where id = p_actor for update;
    v_chars := case when jsonb_typeof(v_meta->'mmo_characters') = 'array' then v_meta->'mmo_characters' else '[]'::jsonb end;
    select ord - 1 into v_index from jsonb_array_elements(v_chars) with ordinality e(c, ord)
      where c->>'id' = p_payload->>'client_character_id' limit 1;
    if v_index is null then raise exception 'character_not_found'; end if;
    v_spent := case when jsonb_typeof(v_chars->v_index->'lattice') = 'array'
                    then jsonb_array_length(v_chars->v_index->'lattice') else 0 end;
    if v_spent = 0 then raise exception 'nothing_to_rewire'; end if;
    v_cost := v_spent * c_rewire_cost;
    update public.player_wallets set salvage_alloy = salvage_alloy - v_cost, revision = revision + 1, updated_at = now()
      where user_id = p_actor and salvage_alloy >= v_cost returning * into v_wallet;
    if not found then raise exception 'insufficient_funds'; end if;
    v_chars := jsonb_set(v_chars, array[v_index::text, 'lattice'], '[]'::jsonb);
    v_chars := jsonb_set(v_chars, array[v_index::text, 'latticeSets'], '{}'::jsonb);
    update auth.users set raw_user_meta_data = coalesce(v_meta, '{}'::jsonb) || jsonb_build_object('mmo_characters', v_chars)
      where id = p_actor;
    v_response := jsonb_build_object('ok', true, 'action', p_action, 'characterId', p_payload->>'client_character_id',
      'returned', v_spent, 'cost', v_cost);
  end if;

  v_response := v_response || jsonb_build_object('owned', to_jsonb(v_owned),
    'wallet', jsonb_build_object('balance', v_wallet.salvage_alloy, 'revision', v_wallet.revision));
  insert into public.economy_audit_events(actor_user_id, character_id, request_id, action, inputs, outputs)
  values (p_actor, v_character_id, p_request_id, 'upgrade_' || p_action, p_payload, v_response);
  update public.economy_requests set response_payload = v_response, completed_at = now()
    where actor_user_id = p_actor and request_id = p_request_id;
  return v_response;
end;
$$;

revoke all on function public.account_upgrade_mutate(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.account_upgrade_mutate(uuid, text, text, jsonb) to service_role;

commit;
