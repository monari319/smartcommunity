BEGIN;

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
