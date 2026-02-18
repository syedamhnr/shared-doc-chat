import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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

  // Verify auth
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
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

  const { question, conversation_id } = await req.json();
  if (!question) {
    return new Response(JSON.stringify({ error: "question is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const adminClient = createClient(supabaseUrl, serviceKey);

  try {
    // 1. Embed the question
    const queryEmbedding = await embed(question, lovableApiKey);

    // 2. Retrieve top-5 matching chunks
    const { data: chunks, error: matchError } = await adminClient.rpc("match_chunks", {
      query_embedding: `[${queryEmbedding.join(",")}]`,
      match_threshold: 0.3,
      match_count: 5,
    });

    if (matchError) throw new Error(matchError.message);

    const hasContext = chunks && chunks.length > 0;

    // 3. Build prompt
    let contextBlock = "";
    if (hasContext) {
      contextBlock = chunks
        .map((c: { id: string; chunk_index: number; content: string }, i: number) =>
          `[${i + 1}] (chunk_id: ${c.id}, chunk_index: ${c.chunk_index})\n${c.content}`
        )
        .join("\n\n");
    }

    const systemPrompt = hasContext
      ? `You are a helpful assistant. Answer questions based on the provided context excerpts.
Always cite sources using [1], [2], etc. corresponding to the context chunk numbers.
If the answer is not in the context, say you don't have that information.`
      : `You are a helpful assistant. No knowledge base has been synced yet, so answer from general knowledge and let the user know no specific context was available.`;

    const userPrompt = hasContext
      ? `Context:\n${contextBlock}\n\nQuestion: ${question}`
      : question;

    // 4. Call LLM
    const llmRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableApiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 1024,
      }),
    });

    if (!llmRes.ok) {
      const errText = await llmRes.text();
      throw new Error(`LLM error: ${errText}`);
    }

    const llmJson = await llmRes.json();
    const answer = llmJson.choices[0].message.content as string;

    // 5. Build citations
    const citations = hasContext
      ? chunks.map((c: { id: string; chunk_index: number; content: string }, i: number) => ({
          chunk_id: c.id,
          chunk_index: c.chunk_index,
          excerpt: c.content.slice(0, 200),
          reference: i + 1,
        }))
      : [];

    return new Response(JSON.stringify({ answer, citations }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
