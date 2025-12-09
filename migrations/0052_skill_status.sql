alter table skills
  add column if not exists status text not null default 'active';

update skills set status = 'active' where status is null;
