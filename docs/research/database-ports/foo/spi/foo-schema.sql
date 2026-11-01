create table foo (id uuid primary key, name text not null);
create unique index foo_name_unique on foo (name);
create table foo_tag (
  foo_id uuid not null references foo (id),
  tag text not null check (length(tag) <= 20),
  primary key (foo_id, tag)
);
