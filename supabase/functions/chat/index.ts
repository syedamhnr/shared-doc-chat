import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey     = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const lovableKey  = Deno.env.get("LOVABLE_API_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { question } = await req.json();
  if (!question) {
    return new Response(JSON.stringify({ error: "question is required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const adminClient = createClient(supabaseUrl, serviceKey);

  try {
    // 1. Full-text keyword search: extract meaningful words from the question
    //    and search against chunk content using ilike for each keyword
    const keywords = question
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w: string) => w.length > 2 && !["the","and","for","are","was","that","with","this","have","from","not","what","how","who","when","where","which"].includes(w));

    // Fetch chunks matching any keyword (union approach), limit to 6
    type RagChunk = { id: string; chunk_index: number; content: string; metadata: Record<string, unknown> };
    let chunks: RagChunk[] = [];

    if (keywords.length > 0) {
      // Build OR filter: content ilike any keyword
      const filter = keywords.slice(0, 5).map((k: string) => `content.ilike.%${k}%`).join(",");
      const { data, error } = await adminClient
        .from("rag_chunks")
        .select("id, chunk_index, content, metadata")
        .eq("doc_id", "csv-kb")
        .or(filter)
        .limit(12);

      if (error) throw new Error(error.message);

      // Score by how many keywords match, take top 6
      const scored = (data ?? []).map((c) => {
        const lower = c.content.toLowerCase();
        const score = keywords.filter((k: string) => lower.includes(k)).length;
        return { ...c, score };
      });
      scored.sort((a, b) => b.score - a.score);
      chunks = scored.slice(0, 6);
    }

    // Fallback: if no keyword matches, return first 6 chunks as context
    if (chunks.length === 0) {
      const { data } = await adminClient
        .from("rag_chunks")
        .select("id, chunk_index, content, metadata")
        .eq("doc_id", "csv-kb")
        .limit(6);
      chunks = data ?? [];
    }

    const hasContext = chunks.length > 0;

    // 2. Build context block with row numbers
    let contextBlock = "";
    if (hasContext) {
      contextBlock = chunks
        .map((c) => {
          const rowNum = (c.metadata?.row_number as number | undefined) ?? c.chunk_index + 2;
          return `[Row ${rowNum}]\n${c.content}`;
        })
        .join("\n\n");
    }

    // 3. Prompt
    const systemPrompt = hasContext
      ? `You are a precise data assistant. Answer the user's question using ONLY the data rows provided below.
- Cite every row you use in the format [Row N] — e.g. "The value is X [Row 5]."
- If multiple rows are relevant, cite all of them.
- If the answer cannot be found in the provided rows, say: "I don't have that information in the current knowledge base."
- Never make up information.`
      : `You are a helpful assistant. No knowledge base has been synced yet. Let the user know they should ask the admin to upload a CSV first.`;

    const userPrompt = hasContext
      ? `Data rows:\n${contextBlock}\n\nQuestion: ${question}`
      : question;

    // 4. LLM call
    const llmRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovableKey}` },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 1024,
      }),
    });

    if (!llmRes.ok) {
      const status = llmRes.status;
      if (status === 429) throw new Error("Rate limit exceeded. Please try again in a moment.");
      if (status === 402) throw new Error("AI usage limit reached. Please add credits.");
      throw new Error(`LLM error (${status}): ${await llmRes.text()}`);
    }

    const llmJson = await llmRes.json();
    const answer = llmJson.choices[0].message.content as string;

    // 5. Build citation objects
    const citations = hasContext
      ? chunks.map((c, i) => ({
          chunk_id: c.id,
          chunk_index: c.chunk_index,
          excerpt: c.content.slice(0, 250),
          row_number: (c.metadata?.row_number as number | undefined) ?? c.chunk_index + 2,
          reference: i + 1,
        }))
      : [];

    return new Response(JSON.stringify({ answer, citations }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
