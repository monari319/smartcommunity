# Report email notifications

After a report is saved, the app invokes the `report-notification` Supabase Edge Function. The function verifies that the signed-in user owns the report, then emails its details to `bmonari94@gmail.com`. Replies go to the report submitter.

To enable delivery:

1. Create a Resend account and verify the domain/address used as the sender.
2. In the Supabase project's Edge Function secrets, set `RESEND_API_KEY` and `REPORT_NOTIFICATION_FROM` (for example, `Smart Community <reports@your-verified-domain.com>`).
3. From the project directory, link the Supabase CLI to this project and deploy with `supabase functions deploy report-notification`.

The Supabase Edge Function runtime provides `SUPABASE_URL` and `SUPABASE_ANON_KEY`. The report remains saved if email delivery is unavailable; the app reports that the notification failed so it can be retried operationally.

## Community AI assistant

The resident portal's AI chat uses the `community-assistant` Edge Function. It requires a signed-in Supabase user and sends questions to OpenAI from the Edge Function, so the OpenAI key is never exposed in browser code.

1. In the Supabase Dashboard for this project, add `OPENAI_API_KEY` under **Edge Functions → Secrets**. Optionally set `OPENAI_MODEL`; the default is `gpt-4o-mini`.
2. From the repository root, sign in to the Supabase CLI if needed, then deploy the function:

   ```powershell
   supabase functions deploy community-assistant --project-ref ombmscbaavdsmulbxmxg
   ```

3. Confirm the function is deployed and test the chat while signed in to the portal.

The function checks the user's Supabase access token, validates conversation input, and keeps the provider key server-side. Do not put `OPENAI_API_KEY` in `script.js` or any other client-side file.

## Resident account confirmation

Resident signup sends a Supabase confirmation email when email confirmations are enabled in the project's Auth settings. The confirmation link redirects to the current portal page. Configure **Authentication → URL Configuration → Site URL** and the allowed redirect URLs to include the deployed HTTPS portal URL. The user must confirm the email before signing in; if no email arrives, check spam and the Supabase Auth email/rate-limit settings.

## Incident GPS location

When a resident selects or captures photo/video evidence, the portal requests the device's current GPS location and fills the report coordinates if permission is granted. Residents can also use **Use current GPS location** to retry or refresh the reading, or enter coordinates manually. GPS access requires the portal to be served over HTTPS or localhost and the browser/device location permission to be enabled. Coordinates are saved with the report's latitude and longitude.

# Single administrator account

The application only exposes administrator functionality to the account `bmonari94@gmail.com`, and that account must also have the `admin` role in its Supabase profile or trusted app metadata. Public registration continues to assign the `resident` role.

Choose **Administration** to create an account for `bmonari94@gmail.com` with a password. Supabase sends an email confirmation link; after confirming, log in with that email and password. Administrator registration is restricted to this address, and public resident registration continues to assign the `resident` role.

```html
<p>Confirm your email and open the Community Portal:</p>
<p><a href="{{ .ConfirmationURL }}">Confirm email</a></p>
```

Use this content in **Authentication → Email Templates → Confirm signup**. The app passes its current hosted page as `emailRedirectTo`. Set **Authentication → URL Configuration → Site URL** to the hosted portal URL and add that exact URL (including its path, if any) to the allowed redirect URLs. This repository deploys to GitHub Pages; use its HTTPS page URL. A local `file://` page cannot receive a confirmation-link redirect.

If Supabase returns `email rate limit exceeded`, stop requesting emails and wait for the project's email rate limit to reset. Review **Authentication → Rate Limits** and configure custom SMTP under **Project Settings → Authentication → SMTP Settings** if the default email service's limits are too restrictive.

After creating and confirming the account, run `configure-single-admin.sql` in the Supabase SQL Editor to promote that profile, demote any other profile currently marked as an administrator, and allow the designated email to update report statuses. This step is required: `handle_new_user()` deliberately creates every new profile as `resident`. Then sign out, sign back in with the administrator email and password, and refresh the dashboard. Keep Supabase Row Level Security enabled and ensure database policies independently restrict administrative report/profile operations to the designated administrator; client-side checks are not a substitute for database authorization.

To allow the designated administrator to update report statuses, run `allow-admin-report-status-updates.sql` in the Supabase SQL Editor. It grants update permission only for the `status` column and adds an RLS policy limited to the designated administrator email. Keep the existing report read policies in place; the admin dashboard also needs permission to select reports.