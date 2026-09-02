import { runAgent } from "./agent";
import { env } from "./config";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

const STATIC_FILES = new Set(["/index.html", "/styles.css", "/app.js"]);

async function serveStatic(pathname: string): Promise<Response | null> {
  const file =
    pathname === "/" ? "/index.html" : STATIC_FILES.has(pathname) ? pathname : null;
  if (!file) return null;
  const ext = file.slice(file.lastIndexOf("."));
  return new Response(Bun.file(`public${file}`), {
    headers: {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    },
  });
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface Session {
  messages: ChatMessage[];
  lastSeen: number;
}

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_SESSION_MESSAGES = 16;
const MAX_SESSIONS = 200;
const sessions = new Map<string, Session>();

function getSession(id: string): Session {
  const now = Date.now();
  for (const [key, session] of sessions) {
    if (now - session.lastSeen > SESSION_TTL_MS) sessions.delete(key);
  }
  let session = sessions.get(id);
  if (!session) {
    session = { messages: [], lastSeen: now };
    sessions.set(id, session);
  }
  session.lastSeen = now;
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
  return session;
}

const server = Bun.serve({
  port: env.port,
  async fetch(req) {
    const url = new URL(req.url);
    const staticRes = await serveStatic(url.pathname);
    if (staticRes) return staticRes;

    if (url.pathname === "/health" && req.method === "GET") {
      return Response.json({ ok: true, model: env.model });
    }
    if (url.pathname === "/chat" && req.method === "POST") {
      try {
        const body = (await req.json()) as {
          message?: string;
          session_id?: string;
          scope_enterprise_ids?: number[];
        };
        if (!body.message || typeof body.message !== "string") {
          return Response.json({ error: "message requerido" }, { status: 400 });
        }
        const scope = env.defaultEnterpriseId
          ? new Set([env.defaultEnterpriseId])
          : body.scope_enterprise_ids?.length
            ? new Set(body.scope_enterprise_ids.map(Number))
            : null;
        const session =
          body.session_id && typeof body.session_id === "string"
            ? getSession(body.session_id)
            : null;
        const history: Array<{
          role: "user" | "assistant" | "tool";
          content: string | null;
          [key: string]: unknown;
        }> = session
          ? session.messages.map((m) => ({ role: m.role, content: m.content }))
          : [];
        history.push({ role: "user", content: body.message });
        const { reply, dashboard } = await runAgent(history, scope);
        if (session) {
          session.messages = history
            .filter(
              (m) =>
                m.role === "user" ||
                (m.role === "assistant" && !m.tool_calls && (m.content ?? "").length > 0)
            )
            .map((m) => ({ role: m.role as "user" | "assistant", content: m.content ?? "" }))
            .slice(-MAX_SESSION_MESSAGES);
        }
        return Response.json({ reply, dashboard });
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 });
      }
    }
    return Response.json({ error: "No encontrado" }, { status: 404 });
  },
});

console.log(`Servidor corriendo en http://localhost:${server.port}`);
