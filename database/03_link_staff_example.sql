-- Run only after creating an email/password user in Supabase Authentication.
-- Replace the email below with that user's actual email.
-- Existing staff_id 1 = Aigerim (manager); staff_id 3 = Madina (staff).
-- Passwords belong to Supabase Auth. Do not paste them into this file.
DO $$
DECLARE
  v_email text := 'REPLACE_WITH_YOUR_EMAIL';
  v_staff_id integer := 1;
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(v_email);
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Create the Auth user first and replace v_email with the correct email.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.staff_users WHERE staff_id = v_staff_id AND is_active) THEN
    RAISE EXCEPTION 'Select an existing active staff_id.';
  END IF;
  INSERT INTO public.cafe_staff_accounts(auth_user_id, staff_id) VALUES (v_user_id, v_staff_id)
  ON CONFLICT (auth_user_id) DO UPDATE SET staff_id = excluded.staff_id;
END;
$$;
