import compression from "compression";
import express from "express";
import helmet from "helmet";
import pg from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 10000);
const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, "dist");
const databaseUrl = process.env.DATABASE_URL?.trim();

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "img-src": ["'self'", "data:", "blob:"],
      "media-src": ["'self'", "blob:"],
      "connect-src": ["'self'"],
      "font-src": ["'self'", "data:"],
      "object-src": ["'none'"],
      "base-uri": ["'self'"],
      "frame-ancestors": ["'none'"],
      "form-action": ["'self'"],
      "upgrade-insecure-requests": [],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use(express.json({ limit: "4kb" }));

const pool = databaseUrl ? new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false },
  max: 4,
  idleTimeoutMillis: 30_000,
}) : null;

let schemaReady;
function ensureSchema() {
  if (!pool) return Promise.resolve(false);
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS visits (
        session_id VARCHAR(80) PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_visits_created_at ON visits(created_at);
    `).then(() => true).catch((error) => {
      schemaReady = undefined;
      console.error("Visitor schema error:", error.message);
      return false;
    });
  }
  return schemaReady;
}

app.get("/health", (_request, response) => {
  response.json({ ok: true, database: Boolean(pool), time: new Date().toISOString() });
});

app.post("/api/visit", async (request, response) => {
  const sessionId = String(request.body?.sessionId || "").trim();
  if (!/^[a-zA-Z0-9_-]{12,80}$/.test(sessionId)) {
    return response.status(400).json({ recorded: false, error: "invalid session" });
  }
  if (!pool || !(await ensureSchema())) {
    return response.status(202).json({ recorded: false, database: false });
  }
  try {
    await pool.query("INSERT INTO visits (session_id) VALUES ($1) ON CONFLICT (session_id) DO NOTHING", [sessionId]);
    return response.json({ recorded: true });
  } catch (error) {
    console.error("Visitor insert error:", error.message);
    return response.status(503).json({ recorded: false });
  }
});

app.get("/api/visit", async (_request, response) => {
  if (!pool || !(await ensureSchema())) {
    return response.json({ today: 0, month: 0, year: 0, total: 0, configured: false, updatedAt: new Date().toISOString() });
  }
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE created_at >= date_trunc('day', NOW()))::int AS today,
        COUNT(*) FILTER (WHERE created_at >= date_trunc('month', NOW()))::int AS month,
        COUNT(*) FILTER (WHERE created_at >= date_trunc('year', NOW()))::int AS year
      FROM visits
    `);
    return response.json({ ...result.rows[0], configured: true, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("Visitor stats error:", error.message);
    return response.status(503).json({ error: "stats unavailable" });
  }
});

app.use(express.static(dist, {
  index: false,
  maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
  setHeaders(response, filePath) {
    if (filePath.endsWith("index.html")) response.setHeader("Cache-Control", "no-store");
  },
}));

app.get("/insights-v7q2", (_request, response) => response.sendFile(path.join(dist, "insights.html")));
app.get("/", (_request, response) => response.sendFile(path.join(dist, "index.html")));
app.get("*", (_request, response) => response.status(404).sendFile(path.join(dist, "404.html")));

app.listen(port, "0.0.0.0", async () => {
  await ensureSchema();
  console.log(`TAMM listening on port ${port}`);
});

process.on("SIGTERM", async () => {
  await pool?.end();
  process.exit(0);
});
