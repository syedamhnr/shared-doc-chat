import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ~500 token chunks (~2000 chars) with 200-char overlap
function chunkText(text: string, chunkSize = 2000, overlap = 200): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end).trim());
    if (end === text.length) break;
    start += chunkSize - overlap;
  }
  return chunks.filter((c) => c.length > 0);
}

async function embed(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Embedding failed: ${err}`);
  }
  const { data } = await res.json();
  return data[0].embedding as number[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  // Verify auth
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Check admin role
  const adminClient = createClient(supabaseUrl, serviceKey);
  const { data: roleData } = await adminClient
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();

  if (!roleData) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.json();
  const content: string = body?.content;
  if (!content || typeof content !== "string") {
    return new Response(JSON.stringify({ error: "content is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Ensure a sync_status row exists and mark syncing
  const { data: existingStatus } = await adminClient
    .from("sync_status")
    .select("id")
    .maybeSingle();

  let statusId: string;
  if (existingStatus) {
    statusId = existingStatus.id;
    await adminClient
      .from("sync_status")
      .update({ status: "syncing", error_message: null })
      .eq("id", statusId);
  } else {
    const { data: newStatus } = await adminClient
      .from("sync_status")
      .insert({ status: "syncing", error_message: null })
      .select("id")
      .single();
    statusId = newStatus!.id;
  }

  try {
    const DOC_ID = "manual-kb";

    // Delete old chunks for this doc
    await adminClient.from("rag_chunks").delete().eq("doc_id", DOC_ID);

    const chunks = chunkText(content);

    for (let i = 0; i < chunks.length; i++) {
      const embedding = await embed(chunks[i], lovableApiKey);
      const { error } = await adminClient.from("rag_chunks").insert({
        doc_id: DOC_ID,
        chunk_index: i,
        content: chunks[i],
        embedding: `[${embedding.join(",")}]`,
        token_count: Math.ceil(chunks[i].length / 4),
        metadata: { source: "manual-kb", chunk_index: i },
      });
      if (error) throw new Error(error.message);
    }

    // Mark done
    await adminClient
      .from("sync_status")
      .update({
        status: "done",
        chunk_count: chunks.length,
        last_synced_at: new Date().toISOString(),
        doc_title: "Knowledge Base",
        error_message: null,
      })
      .eq("id", statusId);

    return new Response(JSON.stringify({ chunk_count: chunks.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await adminClient
      .from("sync_status")
      .update({ status: "error", error_message: msg })
      .eq("id", statusId);

    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
