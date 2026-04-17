interface Env {
  GITHUB_TOKEN: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
}

const GH_REPO = "msnpeer/X-X";
const TG_API = "https://api.telegram.org";

async function sendTelegramMessage(token: string, chatId: string, text: string) {
  await fetch(`${TG_API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
}

async function triggerWorkflow(nodeName: string) {
  const timestamp = new Date().toISOString();

  // Create Issue to trigger the join.yml workflow
  const issueRes = await fetch(`https://api.github.com/repos/${GH_REPO}/issues`, {
    method: "POST",
    headers: {
      "Authorization": `token ${await importSecrets().then(s => s.GITHUB_TOKEN)}`,
      "Content-Type": "application/json",
      "Accept": "application/vnd.github+json",
      "User-Agent": "X-X-Worker/1.0",
    },
    body: JSON.stringify({
      title: `[JOIN] ${nodeName}`,
      body: `## 入网登记\n\n- **节点名称**：${nodeName}\n- **信仰印记**：X_belief=1，全域互联\n- **入网时间**：${timestamp}\n- **来源**：Cloudflare Worker\n\n---\n*自动入网系统创建*`,
    }),
  });

  if (!issueRes.ok) {
    const err = await issueRes.text();
    throw new Error(`GitHub Issue creation failed: ${err}`);
  }

  return await issueRes.json();
}

// Cache secrets in memory for the lifetime of the worker
let _secrets: Env | null = null;
async function importSecrets(): Promise<Env> {
  if (_secrets) return _secrets;

  // Read from globalThis bindings set via `wrangler secret put`
  // Cloudflare Workers injects these via env in the fetch handler
  // For import.meta.env, we use a workaround via global fetch to CF API
  // Instead: use WRangler secrets which are injected as env vars

  // Since env is passed to fetch(), we access it via a workaround
  // Actually we can access it directly since Env interface is defined
  // But we need the actual runtime env values — this is handled by
  // Cloudflare's runtime injection at the fetch level
  throw new Error("Secrets not available via import — use env parameter");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed. Use POST." }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let body: { node_name?: string; belief?: string };
    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { node_name, belief } = body;

    if (!node_name) {
      return new Response(
        JSON.stringify({ error: "node_name is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify belief
    if (belief !== "X_belief=1，全域互联") {
      return new Response(
        JSON.stringify({ error: "Invalid belief phrase" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC";

    // Send Telegram notification
    let tgOk = false;
    try {
      if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
        const tgMsg = `🔮 *X-X 入网信号*\n\n` +
          `• 节点名称：\`${node_name}\`\n` +
          `• 信仰印记：X_belief=1，全域互联\n` +
          `• 入网时间：${now}\n` +
          `• 来源：Worker`;

        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, tgMsg);
        tgOk = true;
      }
    } catch (e) {
      console.error("Telegram error:", e);
    }

    // Create GitHub Issue → triggers join.yml workflow → updates nodes.json
    let issueUrl = "";
    try {
      const issue = await triggerWorkflowWithToken(node_name, now, env.GITHUB_TOKEN);
      issueUrl = issue.html_url || `https://github.com/${GH_REPO}/issues`;
    } catch (e) {
      console.error("GitHub error:", e);
      // Don't fail the whole request if GitHub fails — TG notification already sent
    }

    return new Response(
      JSON.stringify({
        success: true,
        node_name,
        belief: "X_belief=1，全域互联",
        joined_at: now,
        telegram_notified: tgOk,
        issue_url: issueUrl,
        message: "你已成为 X-X 网络节点。信仰印记已永久写入。",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  },
};

// Separate function that receives the token explicitly (token comes from env, not inline)
async function triggerWorkflowWithToken(
  nodeName: string,
  timestamp: string,
  token: string
): Promise<{ html_url: string; number: number }> {
  const res = await fetch(`https://api.github.com/repos/${GH_REPO}/issues`, {
    method: "POST",
    headers: {
      "Authorization": `token ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/vnd.github+json",
      "User-Agent": "X-X-Worker/1.0",
    },
    body: JSON.stringify({
      title: `[JOIN] ${nodeName}`,
      body: `## 入网登记\n\n- **节点名称**：${nodeName}\n- **信仰印记**：X_belief=1，全域互联\n- **入网时间**：${timestamp}\n- **来源**：Cloudflare Worker\n\n---\n*自动入网系统创建*`,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub Issue failed: ${err}`);
  }

  return await res.json();
}
