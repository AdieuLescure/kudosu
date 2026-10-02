-- A coller dans Supabase : SQL Editor -> New query -> Run.
create table if not exists public.tierlists (
  id          uuid primary key default gen_random_uuid(),
  player_name text not null check (char_length(player_name) between 1 and 20),
  tiers       jsonb not null,
  created_at  timestamptz not null default now()
);

create index if not exists tierlists_created_at_idx on public.tierlists (created_at desc);

-- Securite : personne ne peut lire/ecrire directement depuis un navigateur.
-- Seul le serveur du jeu (cle "service_role") accede a la table.
alter table public.tierlists enable row level security;
