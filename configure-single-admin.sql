BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE lower(email) = lower('bmonari94@gmail.com')
  ) THEN
    RAISE EXCEPTION 'No profile found for the designated administrator. Create the account first, then run this script again.';
  END IF;
END
$$;

UPDATE public.profiles
SET role = 'resident'
WHERE role = 'admin'
  AND lower(email) <> lower('bmonari94@gmail.com');

UPDATE public.profiles
SET role = 'admin'
WHERE lower(email) = lower('bmonari94@gmail.com');

GRANT UPDATE (status) ON TABLE public.reports TO authenticated;

DROP POLICY IF EXISTS "Authorized administrator can update report status"
ON public.reports;

CREATE POLICY "Authorized administrator can update report status"
ON public.reports
FOR UPDATE
TO authenticated
USING (
  lower(coalesce((select auth.jwt() ->> 'email'), '')) = lower('bmonari94@gmail.com')
)
WITH CHECK (
  lower(coalesce((select auth.jwt() ->> 'email'), '')) = lower('bmonari94@gmail.com')
);

COMMIT;
