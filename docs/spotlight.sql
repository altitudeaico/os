-- Spotlight: featured content on the Family OS home screen.
-- Different from a home card: a card opens a section, a spotlight opens a
-- specific THING inside it via `action`, and always shows a visible CTA.

create table if not exists public.spotlight (
  id          bigserial primary key,
  eyebrow     text,                 -- small label above the title, e.g. "Emma's World"
  title       text not null,        -- e.g. "Five Today"
  meta        text,                 -- e.g. "Emma's 5th birthday film · 3:30"
  thumb       text,                 -- 16:9 image url
  cta         text default 'Open',  -- button text, e.g. "Watch Now"
  dest        text not null,        -- which World to open: 'emma' | 'elsie' | ...
  action      text,                 -- deep action inside it: 'film' | null
  active      boolean default true,
  sort_order  int default 0,
  created_at  timestamptz default now()
);

alter table public.spotlight enable row level security;

drop policy if exists "spotlight read" on public.spotlight;
create policy "spotlight read"  on public.spotlight for select using (true);
drop policy if exists "spotlight write" on public.spotlight;
create policy "spotlight write" on public.spotlight for all using (true) with check (true);

insert into public.spotlight (eyebrow, title, meta, thumb, cta, dest, action, sort_order)
values (
  'Emma''s World',
  'Five Today',
  'Emma''s 5th birthday film · 3:30',
  'https://olatoyefamily.com/emma5/assets/poster.jpg',
  'Watch Now',
  'emma',
  'film',
  1
)
on conflict do nothing;
