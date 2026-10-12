import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(body: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  const authorization = request.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const sender = Deno.env.get("REPORT_NOTIFICATION_FROM");
  if (!authorization || !supabaseUrl || !supabaseKey) {
    return respond({ error: "Authentication or Supabase configuration is missing" }, 401);
  }
  if (!resendApiKey || !sender) {
    return respond({ error: "Email notification is not configured" }, 503);
  }

  try {
    const { reportId } = await request.json();
    if (typeof reportId !== "string" || !reportId) {
      return respond({ error: "A report ID is required" }, 400);
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authorization } },
    });
    const accessToken = authorization.replace(/^Bearer\s+/i, "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !user?.email) return respond({ error: "Sign-in is required" }, 401);

    const { data: report, error: reportError } = await supabase
      .from("reports")
      .select("id, title, category, location, latitude, longitude, description, image_url, created_at")
      .eq("id", reportId)
      .eq("user_id", user.id)
      .single();
    if (reportError || !report) return respond({ error: "Report not found" }, 404);

    const coordinates = report.latitude == null || report.longitude == null
      ? "Not provided"
      : `${report.latitude}, ${report.longitude}`;
    const text = [
      "A new community report has been submitted.",
      "",
      `Title: ${report.title}`,
      `Category: ${report.category}`,
      `Location: ${report.location}`,
      `GPS coordinates: ${coordinates}`,
      `Submitted by: ${user.email}`,
      `Submitted at: ${report.created_at}`,
      "",
      "Description:",
      report.description,
      report.image_url ? `\nEvidence: ${report.image_url}` : "",
      `\nReport ID: ${report.id}`,
    ].filter(Boolean).join("\n");

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: sender,
        to: ["bmonari94@gmail.com"],
        reply_to: user.email,
        subject: `New community report: ${report.title}`,
        text,
      }),
    });

    if (!emailResponse.ok) {
      console.error("Email provider rejected the report notification:", await emailResponse.text());
      return respond({ error: "Email provider could not send the notification" }, 502);
    }
    return respond({ message: "Report notification sent" });
  } catch (error) {
    console.error("Report notification failed:", error);
    return respond({ error: "Could not send report notification" }, 500);
  }
});