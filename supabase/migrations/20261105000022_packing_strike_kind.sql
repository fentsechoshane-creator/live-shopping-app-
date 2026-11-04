-- A new kind of trust event for packing strikes. Its own migration: Postgres can't use a new enum value
-- in the same transaction that adds it (0023 does).
alter type trust_event_kind add value if not exists 'packing_strike';
