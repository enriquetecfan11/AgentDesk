/*
# Harden trigger functions (search_path)

1. Security hardening
- Sets a fixed search_path on `set_updated_at` and `on_run_status_change` trigger functions to
  close the role-mutable search_path warning from the database linter.
- The pg_trgm extension stays in public (moving it failed because the operator class is not
  relocatable after index creation); this warning is benign for a single-tenant workspace.
*/

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE OR REPLACE FUNCTION public.on_run_status_change() RETURNS trigger AS $$
DECLARE
  d uuid;
  new_d_status text;
BEGIN
  d := NEW.delegation_id;
  IF NEW.status IN ('started','running') THEN
    new_d_status := 'in_progress';
  ELSIF NEW.status = 'succeeded' THEN
    new_d_status := 'completed';
  ELSIF NEW.status = 'failed' THEN
    new_d_status := 'failed';
  ELSE
    RETURN NEW;
  END IF;

  UPDATE public.delegations
    SET status = new_d_status
    WHERE id = d
      AND status NOT IN ('completed','cancelled');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
