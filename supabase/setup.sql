-- Overhead: database setup.
-- Paste all of this into your Supabase project's SQL Editor and press Run.
-- It's safe to run again later (for example after an update).

-- Lessons: one row per lesson. The PDF itself lives in Storage (below).
create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default 'Untitled lesson',
  layout text not null default 'slides' check (layout in ('slides', 'scroll')),
  doc jsonb,
  pages jsonb not null default '[]'::jsonb,
  pods jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  thumb text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lessons_owner_updated on public.lessons (owner, updated_at desc);

-- Ink: one row per page that has writing on it.
create table if not exists public.ink (
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  page_id text not null,
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  strokes jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (lesson_id, page_id)
);

-- Row level security: you can only ever see and change your own things.
alter table public.lessons enable row level security;
alter table public.ink enable row level security;

drop policy if exists "own lessons" on public.lessons;
create policy "own lessons" on public.lessons
  for all to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

drop policy if exists "own ink" on public.ink;
create policy "own ink" on public.ink
  for all to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

-- Files (PDFs, previews, pictures in pods): a private bucket with one folder
-- per person, named after their user id.
insert into storage.buckets (id, name, public, file_size_limit)
values ('lessons', 'lessons', false, 52428800)
on conflict (id) do update set public = false;

drop policy if exists "overhead read own files" on storage.objects;
create policy "overhead read own files" on storage.objects
  for select to authenticated
  using (bucket_id = 'lessons' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "overhead add own files" on storage.objects;
create policy "overhead add own files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'lessons' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "overhead change own files" on storage.objects;
create policy "overhead change own files" on storage.objects
  for update to authenticated
  using (bucket_id = 'lessons' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'lessons' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "overhead remove own files" on storage.objects;
create policy "overhead remove own files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'lessons' and (storage.foldername(name))[1] = (select auth.uid())::text);
