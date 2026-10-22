import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const systemInstructions = [
  "You are the Smart Community Portal AI assistant.",
  "Answer the user's question directly and helpfully, including questions unrelated to the portal.",
  "When asked about portal features, provide accurate practical guidance.",
  "Be clear when you are uncertain or cannot verify current information.",
  "Never claim access to private resident or report data unless it is explicitly included in the conversation.",
].join(" ");

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);

  const authorization = request.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY");
  const openAiApiKey = Deno.env.get("OPENAI_API_KEY");
  if (!authorization || !supabaseUrl || !supabaseKey) {
    return respond({ error: "Sign in to use the AI assistant." }, 401);
  }
  if (!openAiApiKey) {
    return respond({ error: "The AI assistant is not configured yet. Please contact the portal administrator." }, 503);
  }

  try {
    const accessToken = authorization.replace(/^Bearer\s+/i, "");
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data: { user }, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !user) return respond({ error: "Your session has expired. Please sign in again." }, 401);

    const body = await request.json();
    if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 12) {
      return respond({ error: "Send a question to the AI assistant." }, 400);
    }

    let totalCharacters = 0;
    const messages: { role: "user" | "assistant"; content: string }[] = [];
    for (const message of body.messages) {
      if (
        !message ||
        !["user", "assistant"].includes(message.role) ||
        typeof message.content !== "string" ||
        !message.content.trim()
      ) {
        return respond({ error: "The conversation contains an invalid message." }, 400);
      }
      totalCharacters += message.content.length;
      if (message.content.length > 4000 || totalCharacters > 16000) {
        return respond({ error: "The conversation is too long. Please start a new chat." }, 413);
      }
      messages.push({ role: message.role, content: message.content.trim() });
    }
    if (messages[messages.length - 1].role !== "user") {
      return respond({ error: "Send a question to the AI assistant." }, 400);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);
    let aiResponse: Response;
    try {
      aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openAiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini",
          messages: [
            { role: "system", content: systemInstructions },
            ...messages,
          ],
          max_tokens: 600,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const result = await aiResponse.json();
    if (!aiResponse.ok) {
      const providerError = result.error;
      console.error("AI provider request failed:", {
        status: aiResponse.status,
        type: typeof providerError?.type === "string" ? providerError.type : undefined,
        code: typeof providerError?.code === "string" ? providerError.code : undefined,
      });

      if (aiResponse.status === 401 || aiResponse.status === 403) {
        return respond({ error: "OpenAI rejected the API key. Check that OPENAI_API_KEY is correct and active in Supabase Secrets." }, 502);
      }
      if (aiResponse.status === 429) {
        return respond({ error: "OpenAI is rate-limited or the API account has no available quota. Check your OpenAI billing and usage limits." }, 502);
      }
      if (aiResponse.status === 400) {
        return respond({ error: "OpenAI rejected the request. Check the configured model and its availability for your API account." }, 502);
      }
      return respond({ error: "OpenAI is temporarily unavailable. Please try again later." }, 502);
    }

    const reply = result.choices?.[0]?.message?.content;
    if (typeof reply !== "string" || !reply.trim()) {
      console.error("AI provider response did not contain a message.");
      return respond({ error: "The AI provider returned an empty answer. Please try again." }, 502);
    }

    return respond({ reply: reply.trim() });
  } catch (error) {
    console.error("Community assistant failed:", error);
    if (error instanceof DOMException && error.name === "AbortError") {
      return respond({ error: "The OpenAI request timed out. Please try again." }, 504);
    }
    return respond({ error: "The AI assistant encountered an error. Please try again." }, 500);
  }
});
