# Report email notifications

After a report is saved, the app invokes the `report-notification` Supabase Edge Function. The function verifies that the signed-in user owns the report, then emails its details to `bmonari94@gmail.com`. Replies go to the report submitter.

To enable delivery:

1. Create a Resend account and verify the domain/address used as the sender.
2. In the Supabase project's Edge Function secrets, set `RESEND_API_KEY` and `REPORT_NOTIFICATION_FROM` (for example, `Smart Community <reports@your-verified-domain.com>`).
3. From the project directory, link the Supabase CLI to this project and deploy with `supabase functions deploy report-notification`.

The Supabase Edge Function runtime provides `SUPABASE_URL` and `SUPABASE_ANON_KEY`. The report remains saved if email delivery is unavailable; the app reports that the notification failed so it can be retried operationally.