-- Add a flag to track if the user has completed or skipped the product tour.
alter table public.profiles
  add column if not exists has_completed_tour boolean not null default false;
