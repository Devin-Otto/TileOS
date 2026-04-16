const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const seed = require("./data/seed");

const ROOT = __dirname;
const EMPTY_MEMORY = {
  summary: "",
  facts: [],
  preferences: [],
  goals: []
};

function loadDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  raw.split(/\r?\n/).forEach((line) => {
    let trimmed = String(line || "").trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    if (trimmed.startsWith("export ")) {
      trimmed = trimmed.slice(7).trim();
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex < 0) return;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!key) return;
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = value;
    }
  });
}

loadDotEnvFile(path.join(ROOT, ".env"));
loadDotEnvFile(path.join(ROOT, ".env.local"));
if (process.env.NODE_ENV) {
  loadDotEnvFile(path.join(ROOT, `.env.${process.env.NODE_ENV}.local`));
}

function resolveStorageRoot(rootPath, fallbackPath) {
  const raw = String(rootPath || "").trim();
  if (!raw) return fallbackPath;
  return path.isAbsolute(raw) ? raw : path.resolve(ROOT, raw);
}

const PUBLIC_DIR = path.join(ROOT, "public");
const DEFAULT_DATA_ROOT = path.join(ROOT, "data");
const DATA_ROOT = resolveStorageRoot(process.env.TILEOS_DATA_ROOT, DEFAULT_DATA_ROOT);
const STATE_FILE = path.join(DATA_ROOT, "state.json");
const MANIFEST_FILE = path.join(ROOT, "tileos.project.json");

const PORT = Number(process.env.PORT || 9273);
const HOST = process.env.HOST || "127.0.0.1";
const APP_TITLE = process.env.APP_TITLE || "TileOS";
const IS_PRODUCTION = String(process.env.NODE_ENV || "").toLowerCase() === "production";
const TILEOS_PUBLIC_URL = String(process.env.TILEOS_PUBLIC_URL || "").trim() || `http://${HOST}:${PORT}`;
const DEFAULT_PUBLIC_PATHNAME = (() => {
  try {
    return new URL(TILEOS_PUBLIC_URL).pathname;
  } catch {
    return "";
  }
})();
const ADMIN_COOKIE_NAME = "tileos_admin";
const WORKSPACE_COOKIE_NAME = "tileos_workspace";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const WORKSPACE_TTL_MS = 1000 * 60 * 60 * 24 * 365;
const MAX_PROJECT_FILES = 20;
const MAX_PROJECT_SOURCE_LENGTH = 450000;
const MAX_PROJECT_TEXT_LENGTH = 4000;
const MAX_CHAT_MESSAGE_LENGTH = 4000;
const MAX_TAGS = 12;
const RATE_LIMITS = {
  chat: { windowMs: 60 * 1000, max: 16 },
  login: { windowMs: 5 * 60 * 1000, max: 10 },
  create: { windowMs: 60 * 1000, max: 8 }
};
const rateLimitStore = new Map();
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: data:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://esm.sh https://unpkg.com https://cdn.tailwindcss.com",
  "connect-src 'self' https://esm.sh https://unpkg.com",
  "frame-src 'self' blob:",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests"
].join("; ");

function normalizeBasePath(value) {
  if (value == null) return "";
  let raw = String(value).trim();
  if (!raw || raw === "/") return "";

  try {
    if (/^[a-z]+:\/\//iu.test(raw)) {
      raw = new URL(raw).pathname;
    }
  } catch {
    // ignore malformed URLs and fall back to path normalization
  }

  raw = `/${raw}`.replace(/\/{2,}/g, "/");
  raw = raw.replace(/\/+$/g, "");
  return raw === "/" ? "" : raw;
}

const TILEOS_BASE_PATH = normalizeBasePath(process.env.TILEOS_BASE_PATH || DEFAULT_PUBLIC_PATHNAME);

function getForwardedHost(req) {
  return String(req.headers["x-forwarded-host"] || req.headers.host || "").trim();
}

function getForwardedProto(req) {
  return String(req.headers["x-forwarded-proto"] || "").trim().replace(/:$/u, "") || "http";
}

function getForwardedBasePath(req) {
  return normalizeBasePath(req.headers["x-forwarded-prefix"] || "");
}

function getPublicBasePath(req) {
  return getForwardedBasePath(req) || TILEOS_BASE_PATH;
}

function joinBasePath(basePath, pathname = "/") {
  const normalizedPath = String(pathname || "/").startsWith("/")
    ? String(pathname || "/")
    : `/${String(pathname || "")}`;

  if (!basePath) {
    return normalizedPath === "" ? "/" : normalizedPath;
  }

  if (normalizedPath === "/" || normalizedPath === "") {
    return `${basePath}/`;
  }

  return `${basePath}${normalizedPath}`;
}

function stripConfiguredBasePath(pathname) {
  const normalizedPath = String(pathname || "") || "/";
  if (!TILEOS_BASE_PATH) return normalizedPath;
  if (normalizedPath === TILEOS_BASE_PATH || normalizedPath === `${TILEOS_BASE_PATH}/`) {
    return "/";
  }
  if (normalizedPath.startsWith(`${TILEOS_BASE_PATH}/`)) {
    return normalizedPath.slice(TILEOS_BASE_PATH.length) || "/";
  }
  return normalizedPath;
}

function getAllowedOrigin(req) {
  const forwardedHost = getForwardedHost(req);
  if (forwardedHost) {
    return `${getForwardedProto(req)}://${forwardedHost}`;
  }

  try {
    return new URL(TILEOS_PUBLIC_URL).origin;
  } catch {
    const host = req.headers.host || `${HOST}:${PORT}`;
    return `http://${host}`;
  }
}

function getPublicBaseUrl(req) {
  const forwardedHost = getForwardedHost(req);
  if (forwardedHost) {
    return `${getForwardedProto(req)}://${forwardedHost}${getPublicBasePath(req)}`;
  }
  return TILEOS_PUBLIC_URL;
}

function assertAllowedOrigin(req) {
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return true;

  try {
    const parsed = new URL(origin);
    return parsed.origin === getAllowedOrigin(req);
  } catch {
    return false;
  }
}

function requiredSecret(name, developmentFallback) {
  const value = String(process.env[name] || "").trim();
  if (value) return value;
  if (IS_PRODUCTION) {
    throw new Error(`[TileOS] Missing required environment variable: ${name}`);
  }
  return developmentFallback;
}

const ADMIN_PASSWORD = requiredSecret("ADMIN_PASSWORD", "tileos-dev");
const SESSION_SECRET = requiredSecret("SESSION_SECRET", crypto.randomBytes(32).toString("hex"));
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

function splitEnvList(value) {
  return String(value || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function getGeminiKeyPool() {
  return uniqueStrings([
    ...splitEnvList(process.env.GEMINI_API_KEYS),
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY
  ]);
}

let geminiKeyCursor = 0;

function nextGeminiKey() {
  const keys = getGeminiKeyPool();
  if (!keys.length) return "";
  const key = keys[geminiKeyCursor % keys.length];
  geminiKeyCursor = (geminiKeyCursor + 1) % keys.length;
  return key;
}

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

function ensureDataDir() {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return tags.map((tag) => String(tag).trim()).filter(Boolean);
  }
  if (typeof tags === "string") {
    return tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeProject(project, index = 0) {
  const fallbackCode =
    typeof project.code === "string" && project.code.trim()
      ? project.code
      : `function App() {
  return <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-8">
    <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-8">
      <h1 className="text-3xl font-black">Untitled Tile</h1>
      <p className="mt-3 text-white/60">This tile does not have any code yet.</p>
    </div>
  </div>;
}`;

  const visibility = String(project.visibility || "").toLowerCase() === "draft" ? "draft" : "published";
  const workspaceId = typeof project.workspaceId === "string" ? project.workspaceId.trim() : "";
  const publishedAt =
    visibility === "published"
      ? String(project.publishedAt || project.updatedAt || project.createdAt || nowIso())
      : "";

  return {
    id: project.id || crypto.randomUUID(),
    title: String(project.title || "Untitled Tile").trim(),
    description: String(project.description || "").trim(),
    category: ["web", "mobile", "ai"].includes(project.category) ? project.category : "web",
    tags: normalizeTags(project.tags),
    order: Number.isFinite(Number(project.order)) ? Number(project.order) : index,
    createdAt: project.createdAt || nowIso(),
    updatedAt: project.updatedAt || project.createdAt || nowIso(),
    visibility,
    workspaceId,
    publishedAt,
    code: fallbackCode,
    entry: typeof project.entry === "string" && project.entry.trim() ? project.entry.trim() : "index.html",
    files:
      project.files && typeof project.files === "object" && !Array.isArray(project.files)
        ? Object.fromEntries(
            Object.entries(project.files).map(([name, contents]) => [String(name), String(contents)])
          )
        : undefined
  };
}

function normalizeMemory(memory) {
  return {
    summary: String(memory?.summary || "").trim(),
    facts: Array.isArray(memory?.facts) ? memory.facts.map(String).filter(Boolean).slice(0, 20) : [],
    preferences:
      Array.isArray(memory?.preferences)
        ? memory.preferences.map(String).filter(Boolean).slice(0, 20)
        : [],
    goals: Array.isArray(memory?.goals) ? memory.goals.map(String).filter(Boolean).slice(0, 20) : []
  };
}

function normalizeWorkspaceMemoryMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 500)
      .map(([workspaceId, memory]) => [String(workspaceId), normalizeMemory(memory)])
  );
}

function projectSortRank(project) {
  return project.visibility === "published" ? 0 : 1;
}

function normalizeState(rawState) {
  const projects = Array.isArray(rawState?.projects)
    ? rawState.projects.map((project, index) => normalizeProject(project, index))
    : [];

  projects.sort(
    (a, b) =>
      projectSortRank(a) - projectSortRank(b) ||
      a.order - b.order ||
      a.createdAt.localeCompare(b.createdAt)
  );

  return {
    version: 2,
    memory: normalizeMemory(rawState?.memory || seed.memory),
    workspaceMemory: normalizeWorkspaceMemoryMap(rawState?.workspaceMemory),
    projects
  };
}

function readSeedState() {
  return normalizeState(seed);
}

function readStateFile() {
  ensureDataDir();
  if (!fs.existsSync(STATE_FILE)) {
    const initial = readSeedState();
    fs.writeFileSync(STATE_FILE, JSON.stringify(initial, null, 2), "utf8");
    return initial;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return normalizeState(parsed);
  } catch (error) {
    console.error("[TileOS] Failed to read state file, falling back to seed.", error);
    const initial = readSeedState();
    fs.writeFileSync(STATE_FILE, JSON.stringify(initial, null, 2), "utf8");
    return initial;
  }
}

let stateCache = readStateFile();

function saveState(nextState) {
  stateCache = normalizeState(nextState);
  const tempFile = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(stateCache, null, 2), "utf8");
  fs.renameSync(tempFile, STATE_FILE);
}

function getState() {
  return clone(stateCache);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function buildSecurityHeaders(extraHeaders = {}) {
  const headers = {
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Permissions-Policy": "camera=(), geolocation=(), microphone=(self), payment=(), usb=()",
    ...extraHeaders
  };
  if (IS_PRODUCTION) {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }
  return headers;
}

function sendJson(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...buildSecurityHeaders(headers)
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    ...buildSecurityHeaders()
  });
  res.end(text);
}

function base64Url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function signSession(expiryMs) {
  const payload = String(expiryMs);
  const signature = base64Url(crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest());
  return `${payload}.${signature}`;
}

function verifySession(token) {
  if (!token || typeof token !== "string") return false;
  const [expiryRaw, signature] = token.split(".");
  if (!expiryRaw || !signature) return false;
  const expected = base64Url(crypto.createHmac("sha256", SESSION_SECRET).update(expiryRaw).digest());
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length) return false;
  if (!crypto.timingSafeEqual(expectedBuffer, actualBuffer)) return false;
  const expiry = Number(expiryRaw);
  return Number.isFinite(expiry) && Date.now() < expiry;
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
      const eqIndex = part.indexOf("=");
      if (eqIndex < 0) return [part, ""];
      return [decodeURIComponent(part.slice(0, eqIndex)), decodeURIComponent(part.slice(eqIndex + 1))];
    })
  );
}

function appendSetCookie(res, value) {
  const existing = res.getHeader("Set-Cookie");
  if (!existing) {
    res.setHeader("Set-Cookie", value);
    return;
  }
  if (Array.isArray(existing)) {
    res.setHeader("Set-Cookie", [...existing, value]);
    return;
  }
  res.setHeader("Set-Cookie", [existing, value]);
}

function isAdmin(req) {
  const cookies = parseCookies(req);
  return verifySession(cookies[ADMIN_COOKIE_NAME] || "");
}

function sessionCookieValue() {
  return signSession(Date.now() + SESSION_TTL_MS);
}

function cookieAttributes(maxAgeMs) {
  const cookiePath = TILEOS_BASE_PATH || "/";
  const attrs = [
    `HttpOnly`,
    `Path=${cookiePath}`,
    `SameSite=Lax`,
    `Max-Age=${Math.max(1, Math.floor(maxAgeMs / 1000))}`
  ];
  if (IS_PRODUCTION) {
    attrs.push("Secure");
  }
  return attrs.join("; ");
}

function setAdminCookie(res) {
  appendSetCookie(
    res,
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(sessionCookieValue())}; ${cookieAttributes(SESSION_TTL_MS)}`
  );
}

function clearAdminCookie(res) {
  const attrs = ["HttpOnly", `Path=${TILEOS_BASE_PATH || "/"}`, "SameSite=Lax", "Max-Age=0"];
  if (IS_PRODUCTION) {
    attrs.push("Secure");
  }
  appendSetCookie(res, `${ADMIN_COOKIE_NAME}=; ${attrs.join("; ")}`);
}

function isWorkspaceId(value) {
  return /^[a-zA-Z0-9-]{12,128}$/.test(String(value || ""));
}

function getWorkspaceId(req) {
  const cookies = parseCookies(req);
  return isWorkspaceId(cookies[WORKSPACE_COOKIE_NAME]) ? cookies[WORKSPACE_COOKIE_NAME] : "";
}

function setWorkspaceCookie(res, workspaceId) {
  appendSetCookie(
    res,
    `${WORKSPACE_COOKIE_NAME}=${encodeURIComponent(workspaceId)}; ${cookieAttributes(WORKSPACE_TTL_MS)}`
  );
}

function ensureWorkspace(req, res) {
  const existing = getWorkspaceId(req);
  if (existing) return existing;
  const workspaceId = crypto.randomUUID();
  setWorkspaceCookie(res, workspaceId);
  return workspaceId;
}

function contentTypeFor(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function safeJoin(base, requestPath) {
  const decoded = decodeURIComponent(requestPath.split("?")[0]);
  const normalized = path.normalize(decoded).replace(/^([.][.][/\\])+/, "");
  const resolved = path.join(base, normalized);
  const relative = path.relative(base, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
}

function shouldDenyPublicPath(pathname) {
  const decoded = decodeURIComponent(String(pathname || ""));
  const segments = decoded.split("/").filter(Boolean);
  if (!segments.length) return false;

  return segments.some((segment) => {
    const trimmed = String(segment || "").trim().toLowerCase();
    if (!trimmed) return false;
    if (trimmed.startsWith(".")) return true;
    if (/[.](env|bak|backup|pem|key|crt|p12|pfx)$/i.test(trimmed)) return true;
    return false;
  });
}

function clientAddress(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")
    .map((part) => part.trim())
    .find(Boolean);
  return forwarded || req.socket?.remoteAddress || "unknown";
}

function checkRateLimit(req, name, config) {
  const now = Date.now();
  const key = `${name}:${clientAddress(req)}`;
  const current = rateLimitStore.get(key);

  if (!current || current.resetAt <= now) {
    rateLimitStore.set(key, {
      count: 1,
      resetAt: now + config.windowMs
    });
    return { allowed: true, retryAfter: 0 };
  }

  if (current.count >= config.max) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
    };
  }

  current.count += 1;
  return { allowed: true, retryAfter: 0 };
}

function enforceRateLimit(req, res, name, config) {
  const result = checkRateLimit(req, name, config);
  if (result.allowed) return true;
  sendJson(
    res,
    429,
    {
      ok: false,
      message: "Too many requests. Please wait a moment and try again."
    },
    {
      "Retry-After": String(result.retryAfter)
    }
  );
  return false;
}

function tileSearchText(project) {
  return [
    project.title,
    project.description,
    ...(project.tags || []),
    project.category,
    project.code,
    project.entry,
    project.files ? Object.keys(project.files).join(" ") : ""
  ]
    .join(" ")
    .toLowerCase();
}

function titleCase(text) {
  return String(text || "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (part) => part.toUpperCase());
}

function viewerContext(req, res) {
  return {
    isAdmin: isAdmin(req),
    workspaceId: ensureWorkspace(req, res)
  };
}

function isProjectVisibleToViewer(project, viewer) {
  if (viewer.isAdmin) return true;
  if (project.visibility === "published") return true;
  return Boolean(viewer.workspaceId) && project.workspaceId === viewer.workspaceId;
}

function canEditProject(project, viewer) {
  if (viewer.isAdmin) return true;
  return project.visibility === "draft" && project.workspaceId && project.workspaceId === viewer.workspaceId;
}

function serializeProjectForViewer(project, viewer) {
  const serialized = {
    ...clone(project),
    viewerOwned: Boolean(viewer.workspaceId && project.workspaceId === viewer.workspaceId),
    canEdit: canEditProject(project, viewer),
    canDelete: viewer.isAdmin,
    canPublish: viewer.isAdmin && project.visibility === "draft",
    canUnpublish: viewer.isAdmin && project.visibility === "published",
    canReorder: viewer.isAdmin && project.visibility === "published"
  };
  if (!viewer.isAdmin) {
    delete serialized.workspaceId;
  }
  return serialized;
}

function projectsForViewer(projects, viewer) {
  return projects
    .filter((project) => isProjectVisibleToViewer(project, viewer))
    .sort(
      (a, b) =>
        projectSortRank(a) - projectSortRank(b) ||
        a.order - b.order ||
        a.createdAt.localeCompare(b.createdAt)
    )
    .map((project) => serializeProjectForViewer(project, viewer));
}

function memoryForViewer(state, viewer) {
  if (viewer.isAdmin) {
    return normalizeMemory(state.memory);
  }
  return normalizeMemory(state.workspaceMemory[viewer.workspaceId] || EMPTY_MEMORY);
}

function assignMemoryForViewer(state, viewer, memory) {
  if (viewer.isAdmin) {
    state.memory = normalizeMemory(memory);
    return;
  }
  state.workspaceMemory[viewer.workspaceId] = normalizeMemory(memory);
}

function deriveTitle(message, fallback = "New Tile") {
  const quoted = message.match(/["'“”‘’`](.+?)["'“”‘’`]/);
  if (quoted) return titleCase(quoted[1]);
  const afterTo = message.match(/\b(?:to|as|called|named)\s+(.+?)(?:[.!?,]|$)/i);
  if (afterTo) return titleCase(afterTo[1]);
  const cleaned = message
    .replace(/\b(create|build|make|deploy|add|new|tile|project|for|please|a|an|the)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned) return titleCase(cleaned.split(" ").slice(0, 4).join(" "));
  return fallback;
}

function inferCategory(message) {
  const text = String(message || "").toLowerCase();
  if (/\b(mobile|phone|ios|android|app)\b/.test(text)) return "mobile";
  if (/\b(ai|chat|assistant|model|agent|llm)\b/.test(text)) return "ai";
  return "web";
}

function helloWorldTemplate(title) {
  return `function App() {
  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-8">
      <div className="w-full max-w-2xl rounded-[32px] border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl p-8">
        <div className="text-[11px] uppercase tracking-[0.4em] text-white/40">${title}</div>
        <h1 className="mt-4 text-5xl font-black tracking-tight">Hello world.</h1>
        <p className="mt-4 text-white/60 leading-relaxed">
          This tile was generated by TileOS and can be edited live from the glass window.
        </p>
      </div>
    </div>
  );
}`;
}

function expandingHelloWorldTemplate(title) {
  return `function App() {
  const [clicks, setClicks] = useState(0);
  const size = Math.min(240 + clicks * 44, 620);
  const scale = 1 + clicks * 0.02;

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-8">
      <button
        onClick={() => setClicks((value) => Math.min(value + 1, 10))}
        className="relative overflow-hidden rounded-[32px] border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl transition-all duration-500 ease-out text-left"
        style={{
          width: size,
          height: size,
          transform: "scale(" + scale + ")"
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-white/15 via-transparent to-sky-500/10"></div>
        <div className="relative flex h-full w-full flex-col items-center justify-center p-8 text-center">
          <div className="text-[11px] uppercase tracking-[0.4em] text-white/35">${title}</div>
          <h1 className="mt-4 text-4xl font-black tracking-tight">Hello world.</h1>
          <p className="mt-4 max-w-sm text-white/60 leading-relaxed">
            Click me and I grow. Every click expands the tile a little more.
          </p>
          <div className="mt-6 rounded-full border border-white/10 bg-black/25 px-4 py-2 text-xs text-white/70">
            Clicks: {clicks} • Size: {size}px
          </div>
        </div>
      </button>
    </div>
  );
}`;
}

function counterTemplate(title) {
  return `function App() {
  const [count, setCount] = useState(0);

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-8">
      <div className="w-full max-w-xl rounded-[30px] border border-white/10 bg-white/5 backdrop-blur-2xl shadow-2xl p-8">
        <div className="text-[11px] uppercase tracking-[0.4em] text-white/40">${title}</div>
        <div className="mt-4 text-4xl font-black">Counter Studio</div>
        <div className="mt-6 text-7xl font-black text-sky-300">{count}</div>
        <button
          onClick={() => setCount((value) => value + 1)}
          className="mt-8 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition-transform hover:scale-[1.02]"
        >
          Increment
        </button>
      </div>
    </div>
  );
}`;
}

function dashboardTemplate(title) {
  return `function App() {
  const stats = [
    { label: "Projects", value: "12" },
    { label: "Deploys", value: "48" },
    { label: "Uptime", value: "99.98%" }
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-white p-8">
      <div className="mx-auto max-w-5xl rounded-[36px] border border-white/10 bg-white/5 backdrop-blur-2xl shadow-2xl p-8">
        <div className="text-[11px] uppercase tracking-[0.4em] text-white/40">${title}</div>
        <h1 className="mt-4 text-5xl font-black tracking-tight">Glass metrics board</h1>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-3xl border border-white/10 bg-black/25 p-5">
              <div className="text-[10px] uppercase tracking-[0.3em] text-white/35">{stat.label}</div>
              <div className="mt-3 text-3xl font-black text-sky-300">{stat.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}`;
}

function notesTemplate(title) {
  return `function App() {
  const [notes, setNotes] = useState([
    "Ship the portfolio OS.",
    "Keep secrets on the server.",
    "Make every tile feel alive."
  ]);
  const [draft, setDraft] = useState("");

  const addNote = () => {
    const next = draft.trim();
    if (!next) return;
    setNotes((items) => [next, ...items].slice(0, 6));
    setDraft("");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-8 flex items-center justify-center">
      <div className="w-full max-w-lg rounded-[30px] border border-white/10 bg-white/5 backdrop-blur-2xl shadow-2xl p-6">
        <div className="text-[11px] uppercase tracking-[0.4em] text-white/35">${title}</div>
        <h2 className="mt-3 text-3xl font-black tracking-tight">Notes board</h2>
        <div className="mt-5 flex gap-3">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addNote();
            }}
            placeholder="Add a thought..."
            className="flex-1 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none placeholder:text-white/25"
          />
          <button
            onClick={addNote}
            className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-950 transition-transform hover:scale-[1.02]"
          >
            Add
          </button>
        </div>
        <div className="mt-6 space-y-3">
          {notes.map((note, index) => (
            <div key={note + index} className="rounded-2xl border border-white/10 bg-black/25 p-4 text-sm text-white/80">
              {note}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}`;
}

function glassHeroTemplate(title) {
  return `function App() {
  return (
    <div className="min-h-screen bg-slate-950 p-8 text-white">
      <div className="mx-auto flex min-h-[80vh] max-w-5xl items-center">
        <div className="w-full overflow-hidden rounded-[36px] border border-white/10 bg-gradient-to-br from-white/10 via-white/5 to-transparent p-10 shadow-2xl">
          <div className="text-[11px] uppercase tracking-[0.4em] text-white/35">${title}</div>
          <h1 className="mt-4 max-w-2xl text-5xl font-black tracking-tight md:text-6xl">
            A portfolio that behaves like a private operating system.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-white/60">
            Tiles are live, editable, searchable, and controlled from a glass-side chat workspace.
          </p>
        </div>
      </div>
    </div>
  );
}`;
}

function youtubeLauncherTemplate(title) {
  return `function App() {
  const launchYoutube = () => {
    const url = "https://www.youtube.com";
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      window.location.href = url;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-8 flex items-center justify-center">
      <div className="w-full max-w-2xl rounded-[36px] border border-white/10 bg-white/5 backdrop-blur-2xl shadow-2xl p-8">
        <div className="text-[11px] uppercase tracking-[0.4em] text-white/35">${title}</div>
        <h1 className="mt-4 text-5xl font-black tracking-tight">Launch YouTube.</h1>
        <p className="mt-5 max-w-xl text-base leading-7 text-white/60">
          Press the button to open YouTube in a new tab. The tile stays here as your launch pad.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <button
            onClick={launchYoutube}
            className="rounded-2xl bg-red-500 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-red-500/25 transition-transform hover:scale-[1.02]"
          >
            Open YouTube
          </button>
          <a
            href="https://www.youtube.com"
            target="_blank"
            rel="noreferrer"
            className="rounded-2xl border border-white/10 bg-black/25 px-5 py-3 text-sm font-semibold text-white/80 transition-transform hover:scale-[1.02]"
          >
            Open in new tab
          </a>
        </div>
      </div>
    </div>
  );
}`;
}

function sphereTemplate(title) {
  return `function App() {
  const [rotation, setRotation] = useState(0);
  const [glow, setGlow] = useState(true);

  useEffect(() => {
    const id = setInterval(() => {
      setRotation((value) => (value + 0.8) % 360);
    }, 33);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 p-8 text-white overflow-hidden">
      <div className="relative mx-auto flex min-h-[80vh] max-w-6xl items-center">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(56,189,248,0.18),transparent_28%),radial-gradient(circle_at_18%_20%,rgba(168,85,247,0.12),transparent_18%),radial-gradient(circle_at_82%_25%,rgba(34,197,94,0.10),transparent_18%)]"></div>
        <div className="relative grid w-full gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-[36px] border border-white/10 bg-white/5 backdrop-blur-2xl shadow-2xl p-10">
            <div className="text-[11px] uppercase tracking-[0.4em] text-white/35">${title}</div>
            <h1 className="mt-4 max-w-2xl text-5xl font-black tracking-tight md:text-6xl">
              A tile that centers a sphere.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-white/60">
              The generic hero fallback has been replaced with a dedicated sphere scene.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                onClick={() => setGlow((value) => !value)}
                className="rounded-2xl border border-white/10 bg-black/25 px-5 py-3 text-sm font-semibold text-white/80 transition-transform hover:scale-[1.02]"
              >
                {glow ? "Dim glow" : "Brighten"}
              </button>
              <span className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white/70">
                Sphere mode
              </span>
            </div>
          </div>
          <button
            onClick={() => setGlow((value) => !value)}
            className="relative aspect-square w-full rounded-[40px] border border-white/10 bg-black/25 backdrop-blur-2xl shadow-2xl overflow-hidden"
            type="button"
            title="Toggle sphere glow"
          >
            <div className="absolute inset-0 bg-gradient-to-b from-white/8 via-transparent to-black/15"></div>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative flex items-center justify-center">
                <div
                  className={"absolute h-80 w-80 rounded-full blur-3xl transition-opacity duration-300 " + (glow ? "opacity-100 bg-cyan-400/20" : "opacity-40 bg-white/10")}
                ></div>
                <div className="absolute h-72 w-72 rounded-full border border-white/10"></div>
                <div className="absolute h-60 w-60 rounded-full border border-cyan-300/12"></div>
                <div
                  className="relative h-64 w-64 rounded-full border border-white/15 shadow-[0_40px_120px_rgba(0,0,0,0.55)]"
                  style={{ transform: "rotate(" + rotation + "deg)" }}
                >
                  <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_28%,rgba(255,255,255,0.98),rgba(255,255,255,0.24)_18%,rgba(56,189,248,0.55)_38%,rgba(14,165,233,0.16)_58%,rgba(2,6,23,1)_82%)]"></div>
                  <div className="absolute inset-0 rounded-full shadow-[inset_-26px_-26px_60px_rgba(0,0,0,0.42),inset_18px_18px_36px_rgba(255,255,255,0.08)]"></div>
                  <div className="absolute inset-8 rounded-full border border-white/12 opacity-60"></div>
                  <div className="absolute left-[16%] top-[18%] h-20 w-20 rounded-full bg-white/90 blur-2xl opacity-75"></div>
                  <div className="absolute left-[26%] top-[25%] h-12 w-12 rounded-full bg-white/80 blur-md opacity-80"></div>
                </div>
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}`;
}

function createTileCodeFromPrompt(message, title) {
  const text = String(message || "").toLowerCase();
  if (text.includes("youtube") || /\byt\b/.test(text)) return youtubeLauncherTemplate(title);
  if (/\b(sphere|orb|globe|planet|ball|spherical)\b/.test(text)) return sphereTemplate(title);
  const wantsExpansion = /\b(expand|growing|grow|scale|bigger|larger|enlarge|stretch)\b/.test(text);
  if (text.includes("hello world") && wantsExpansion) return expandingHelloWorldTemplate(title);
  if (text.includes("hello world")) return helloWorldTemplate(title);
  if (text.includes("counter")) return counterTemplate(title);
  if (text.includes("notes") || text.includes("journal")) return notesTemplate(title);
  if (text.includes("dashboard") || text.includes("metrics") || text.includes("analytics")) {
    return dashboardTemplate(title);
  }
  return glassHeroTemplate(title);
}

function parseGeneratedBundleText(text) {
  const source = String(text || "");
  const files = {};
  const sections = source.split(/^===\s*(.+?)\s*===\s*$/m);
  if (sections.length < 3) return {};

  for (let index = 1; index < sections.length; index += 2) {
    const name = sanitizeGeneratedEntry(sections[index].trim(), "");
    const contents = sections[index + 1] || "";
    if (name) {
      files[name] = contents.replace(/^\n/, "");
    }
  }

  return files;
}

function sanitizeGeneratedEntry(entry, fallback = "index.html") {
  const raw = String(entry || fallback || "")
    .trim()
    .replace(/^\.\/+/g, "")
    .replace(/^\/+/g, "");
  const normalized = raw
    .split("/")
    .filter(Boolean)
    .join("/");
  return normalized || fallback;
}

function normalizeGeneratedFiles(files) {
  if (!files || typeof files !== "object" || Array.isArray(files)) return null;
  const output = {};
  Object.entries(files)
    .slice(0, 20)
    .forEach(([name, contents]) => {
      const entry = sanitizeGeneratedEntry(name, "");
      if (!entry) return;
      output[entry] = String(contents ?? "");
    });
  return Object.keys(output).length ? output : null;
}

function clampText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function sanitizeProjectPayload(body) {
  const raw = body && typeof body === "object" ? body : {};
  const payload = {
    title: clampText(raw.title || "Untitled Tile", 120) || "Untitled Tile",
    description: clampText(raw.description || "", 500),
    category: ["web", "mobile", "ai"].includes(String(raw.category || "").toLowerCase())
      ? String(raw.category).toLowerCase()
      : "web",
    tags: normalizeTags(raw.tags).slice(0, MAX_TAGS).map((tag) => tag.slice(0, 32)),
    entry: sanitizeGeneratedEntry(raw.entry || "index.html", "index.html")
  };

  if (typeof raw.code === "string") {
    payload.code = raw.code.slice(0, MAX_PROJECT_SOURCE_LENGTH);
  }

  if (raw.files && typeof raw.files === "object" && !Array.isArray(raw.files)) {
    const files = {};
    let totalLength = 0;
    for (const [name, contents] of Object.entries(raw.files).slice(0, MAX_PROJECT_FILES)) {
      const entry = sanitizeGeneratedEntry(name, "");
      if (!entry) continue;
      const text = String(contents || "").slice(0, MAX_PROJECT_SOURCE_LENGTH);
      totalLength += entry.length + text.length;
      if (totalLength > MAX_PROJECT_SOURCE_LENGTH) break;
      files[entry] = text;
    }
    if (Object.keys(files).length) {
      payload.files = files;
    }
  }

  return payload;
}

function sanitizeImagePayload(image) {
  if (!image || typeof image !== "object") return null;
  const dataUrl = String(image.dataUrl || "");
  if (!dataUrl || dataUrl.length > 1_500_000) return null;
  return {
    dataUrl,
    mime: clampText(image.mime || "image/png", 120) || "image/png",
    name: clampText(image.name || "attachment", 160) || "attachment"
  };
}

function sanitizeChatPayload(body) {
  const raw = body && typeof body === "object" ? body : {};
  return {
    message: clampText(raw.message || "", MAX_CHAT_MESSAGE_LENGTH),
    activeProjectId: clampText(raw.activeProjectId || "", 120),
    targetTitle: clampText(raw.targetTitle || "", 120),
    tone: clampText(raw.tone || "", 40),
    voiceGender: clampText(raw.voiceGender || "", 20),
    voicePitchSemis: Number.isFinite(Number(raw.voicePitchSemis)) ? Number(raw.voicePitchSemis) : 0,
    image: sanitizeImagePayload(raw.image)
  };
}

function readProjectManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8"));
  } catch (error) {
    return {
      slug: "tileos",
      title: APP_TITLE,
      summary: "A glassmorphic portfolio OS for live project demos and chat-driven app generation.",
      category: "Platform / Portfolio OS",
      visibility: "public",
      liveUrl: TILEOS_PUBLIC_URL,
      healthPath: joinBasePath(TILEOS_BASE_PATH, "/healthz")
    };
  }
}

function serializeGeneratedBundleText(files, entry = "index.html") {
  const keys = Object.keys(files || {});
  if (!keys.length) return "";
  const ordered = [
    sanitizeGeneratedEntry(entry, "index.html"),
    ...keys.filter((name) => name !== entry).sort((a, b) => a.localeCompare(b))
  ].filter((name, index, array) => array.indexOf(name) === index && files[name] != null);

  return ordered
    .map((name) => `=== ${name} ===\n${String(files[name]).replace(/\n$/, "")}\n`)
    .join("\n")
    .trimEnd();
}

function hasRenderableTileComponent(code) {
  const text = String(code || "");
  return [
    /\bfunction\s+App\s*\(/,
    /\bconst\s+App\s*=/,
    /\blet\s+App\s*=/,
    /\bvar\s+App\s*=/,
    /\bclass\s+App\s+extends\b/,
    /\bfunction\s+Main\s*\(/,
    /\bconst\s+Main\s*=/,
    /\bclass\s+Main\s+extends\b/,
    /\bfunction\s+Dashboard\s*\(/,
    /\bconst\s+Dashboard\s*=/,
    /\bclass\s+Dashboard\s+extends\b/,
    /\bfunction\s+Tile\s*\(/,
    /\bconst\s+Tile\s*=/,
    /\bclass\s+Tile\s+extends\b/
  ].some((pattern) => pattern.test(text));
}

function forcePrimaryComponentName(code) {
  const text = String(code || "");
  if (hasRenderableTileComponent(text)) return text;

  const functionPattern = /(^|\n)(\s*(?:export\s+default\s+)?function\s+)([A-Z]\w*)(\s*\()/m;
  if (functionPattern.test(text)) {
    return text.replace(functionPattern, "$1$2App$4");
  }

  const constPattern = /(^|\n)(\s*(?:export\s+default\s+)?(?:const|let|var)\s+)([A-Z]\w*)(\s*=)/m;
  if (constPattern.test(text)) {
    return text.replace(constPattern, "$1$2App$4");
  }

  const classPattern = /(^|\n)(\s*(?:export\s+default\s+)?class\s+)([A-Z]\w*)(\s+extends\b)/m;
  if (classPattern.test(text)) {
    return text.replace(classPattern, "$1$2App$4");
  }

  return text;
}

function normalizeGeneratedTileArtifact(parsed, context) {
  if (!parsed || typeof parsed !== "object") return null;

  const message = String(context?.message || "").trim();
  const selectedProject = context?.selectedProject || null;
  const title = titleCase(
    String(parsed.title || context?.fallbackTitle || deriveTitle(message) || "New Tile")
  );
  const description = String(parsed.description || message || "").trim();
  const category = ["web", "mobile", "ai"].includes(String(parsed.category || "").toLowerCase())
    ? String(parsed.category).toLowerCase()
    : inferCategory(message);
  const tags = normalizeTags(parsed.tags).slice(0, 8);
  const requestedMode = String(parsed.mode || "").toLowerCase();
  const existingMode = context?.existingMode || (selectedProject?.files ? "bundle" : "single");
  const entry = sanitizeGeneratedEntry(
    parsed.entry || selectedProject?.entry || "index.html",
    "index.html"
  );
  const rawCode = typeof parsed.code === "string" ? parsed.code.trim() : "";
  const rawFiles = normalizeGeneratedFiles(parsed.files);
  const isBundle =
    requestedMode === "bundle" ||
    existingMode === "bundle" ||
    Boolean(rawFiles && Object.keys(rawFiles).length > 1) ||
    /^===\s*.+?\s*===/m.test(rawCode);

  if (isBundle) {
    let files = rawFiles;
    if (!files && rawCode && /^===\s*.+?\s*===/m.test(rawCode)) {
      files = parseGeneratedBundleText(rawCode);
    }
    if (!files && rawCode && /<!doctype\s+html|<html[\s>]/i.test(rawCode)) {
      files = { [entry]: rawCode };
    }
    if (files && Object.keys(files).length) {
      const resolvedEntry = files[entry]
        ? entry
        : files["index.html"]
          ? "index.html"
          : Object.keys(files)[0];
      return {
        title,
        description,
        category,
        tags,
        entry: resolvedEntry,
        code: serializeGeneratedBundleText(files, resolvedEntry),
        files
      };
    }
  }

  let code = forcePrimaryComponentName(rawCode);
  if (!code && rawFiles && Object.keys(rawFiles).length) {
    const resolvedEntry = rawFiles[entry]
      ? entry
      : rawFiles["index.html"]
        ? "index.html"
        : Object.keys(rawFiles)[0];
    const selectedCode = rawFiles[resolvedEntry] || "";
    if (resolvedEntry !== "index.html" || /^<!doctype\s+html|<html[\s>]/i.test(selectedCode)) {
      return {
        title,
        description,
        category,
        tags,
        entry: resolvedEntry,
        code: serializeGeneratedBundleText(rawFiles, resolvedEntry),
        files: rawFiles
      };
    }
    code = selectedCode;
  }

  if (!code) return null;

  if (/^===\s*.+?\s*===/m.test(code)) {
    const files = parseGeneratedBundleText(code);
    if (files && Object.keys(files).length) {
      const resolvedEntry = files[entry]
        ? entry
        : files["index.html"]
          ? "index.html"
          : Object.keys(files)[0];
      return {
        title,
        description,
        category,
        tags,
        entry: resolvedEntry,
        code: serializeGeneratedBundleText(files, resolvedEntry),
        files
      };
    }
  }

  return {
    title,
    description,
    category,
    tags,
    entry: "index.html",
    code
  };
}

function fallbackGeneratedTileCode(title, message) {
  const safeTitle = JSON.stringify(titleCase(title || "New Tile"));
  const safeMessage = JSON.stringify(
    String(message || "").trim() || "Ask Gemini to turn your idea into a live tile."
  );

  return `function App() {
  const [clicks, setClicks] = useState(0);

  return (
    <div className="min-h-screen bg-slate-950 p-8 text-white">
      <div className="mx-auto flex min-h-[80vh] max-w-5xl items-center">
        <div className="w-full overflow-hidden rounded-[36px] border border-white/10 bg-gradient-to-br from-white/10 via-white/5 to-transparent p-10 shadow-2xl">
          <div className="text-[11px] uppercase tracking-[0.4em] text-white/35">${safeTitle}</div>
          <h1 className="mt-4 max-w-2xl text-5xl font-black tracking-tight md:text-6xl">
            New Tile.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-white/60">
            {${safeMessage}}
          </p>
          <button
            onClick={() => setClicks((value) => value + 1)}
            className="mt-8 rounded-2xl border border-white/10 bg-black/25 px-5 py-3 text-sm font-semibold text-white/80 transition-transform hover:scale-[1.02]"
          >
            Clicked {clicks} times
          </button>
        </div>
      </div>
    </div>
  );
}`;
}

async function callGeminiJson(systemPrompt, parts, options = {}) {
  const keys = getGeminiKeyPool();
  if (!keys.length) return null;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    GEMINI_MODEL
  )}:generateContent`;
  const temperature = Number.isFinite(options.temperature) ? options.temperature : 0.35;
  const maxOutputTokens = Number.isFinite(options.maxOutputTokens) ? options.maxOutputTokens : 512;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 5000;
  const maxAttempts = Number.isFinite(options.maxAttempts)
    ? Math.max(1, Math.floor(options.maxAttempts))
    : Math.min(keys.length, 2);
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const key = nextGeminiKey();
    if (!key) break;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": key
        },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: {
            responseMimeType: "application/json",
            temperature,
            maxOutputTokens
          }
        })
      });
      clearTimeout(timeout);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        lastError = new Error(
          `Gemini ${response.status}: ${data?.error?.message || response.statusText || "request failed"}`
        );
        continue;
      }
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        lastError = new Error("Gemini returned an empty response.");
        continue;
      }
      return safeParseAssistantJson(text);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error("Gemini request failed.");
}

async function generateTileArtifactWithGemini(state, body, selectedProject, fallbackTitle, requestKind, viewer) {
  const keys = getGeminiKeyPool();
  if (!keys.length) return null;

  try {
    const message = String(body.message || "").trim();
    const image = body.image && typeof body.image === "object" ? body.image : null;
    const context = {
      appTitle: APP_TITLE,
      requestKind,
      message,
      fallbackTitle,
      selectedProject: summarizeProjectForPrompt(selectedProject),
      memory: clone(viewer ? memoryForViewer(state, viewer) : state.memory),
      existingFiles: selectedProject?.files ? Object.keys(selectedProject.files) : [],
      existingMode: selectedProject?.files ? "bundle" : "single"
    };

    const systemPrompt = `You are the TileOS app generator.

Your job is to turn a user's idea into a runnable tile project.

Hard rules:
- Return JSON only. No markdown, no code fences, no commentary.
- Build an actual app that matches the user's idea.
- Do not default to a generic portfolio hero or placeholder card unless the user explicitly asked for that.
- If the user asks for a sphere, orb, planet, globe, ball, or similar visual subject, the resulting tile must visibly feature that subject.
- If the user asks for a launcher, editor, dashboard, calculator, notes app, or any other app, build that app directly.
- Prefer a polished glass-style interface with clear interactions.
- If a single file is enough, use single mode and define a React component named App.
- If the idea naturally needs multiple files, use bundle mode and return a files object with an entry file.
- When editing an existing project, preserve its intent unless the user explicitly asks for a full redesign.
- Keep dependencies minimal. Do not use imports in single-file mode.
- The TileOS runtime can render React single-file tiles and HTML/CSS/JS folder bundles.

Return this exact JSON shape:
{
  "title": "string",
  "description": "string",
  "category": "web | mobile | ai",
  "tags": ["string"],
  "mode": "single | bundle",
  "entry": "index.html",
  "code": "string",
  "files": { "index.html": "...", "styles.css": "...", "script.js": "..." }
}`;

    const parts = [{ text: JSON.stringify(context, null, 2) }];
    if (image && image.dataUrl) {
      const clean = String(image.dataUrl).includes(",")
        ? String(image.dataUrl).split(",")[1]
        : String(image.dataUrl);
      if (clean) {
        parts.push({
          inlineData: {
            mimeType: image.mime || "image/png",
            data: clean
          }
        });
      }
    }

    const parsed = await callGeminiJson(systemPrompt, parts, {
      temperature: 0.78,
      maxOutputTokens: 1800,
      timeoutMs: 12000
    });
    let normalized = normalizeGeneratedTileArtifact(parsed, context);
    if (normalized) return normalized;

    const repairPrompt = `You are repairing a TileOS project generation response.

The previous attempt failed to produce a valid tile artifact.
Fix the output so it matches the required JSON shape and produces a runnable tile.
Preserve the user's idea and make the app actually work.

Return JSON only.`;

    const repairContext = {
      ...context,
      previousOutput: parsed
    };
    const repaired = await callGeminiJson(
      repairPrompt,
      [{ text: JSON.stringify(repairContext, null, 2) }],
      {
        temperature: 0.55,
        maxOutputTokens: 1800,
        timeoutMs: 12000
      }
    );
    normalized = normalizeGeneratedTileArtifact(repaired, context);
    return normalized || null;
  } catch (error) {
    return null;
  }
}

function updateMemoryFromMessage(memory, message, reply) {
  const next = normalizeMemory(memory);
  const text = String(message || "").trim();
  if (!text) return next;

  const lower = text.toLowerCase();
  if (/always|prefer|like|want/i.test(text) && text.length < 180) {
    next.preferences.unshift(text);
  } else if (/goal|build|ship|focus|trying/i.test(lower) && text.length < 180) {
    next.goals.unshift(text);
  } else if (/my name is|call me|i am|i'm/i.test(lower) && text.length < 180) {
    next.facts.unshift(text);
  }

  next.summary = [next.summary, `User: ${text}`, `Assistant: ${reply}`]
    .filter(Boolean)
    .join("\n\n")
    .slice(-2500);

  next.facts = Array.from(new Set(next.facts)).slice(0, 20);
  next.preferences = Array.from(new Set(next.preferences)).slice(0, 20);
  next.goals = Array.from(new Set(next.goals)).slice(0, 20);
  return next;
}

function findProjectById(projects, id) {
  return projects.find((project) => project.id === id) || null;
}

function findProjectByTitle(projects, title) {
  const target = String(title || "").toLowerCase().trim();
  if (!target) return null;
  return (
    projects.find((project) => project.title.toLowerCase() === target) ||
    projects.find((project) => project.title.toLowerCase().includes(target)) ||
    null
  );
}

function findVisibleProjectForViewer(projects, viewer, selector) {
  const visible = projects.filter((project) => isProjectVisibleToViewer(project, viewer));
  const byId = selector?.id ? findProjectById(visible, selector.id) : null;
  if (byId) return byId;
  if (selector?.title) {
    return findProjectByTitle(visible, selector.title);
  }
  return null;
}

const VOICE_TONES = new Set([
  "Sassy",
  "Angry",
  "Nerdy",
  "Cute",
  "Comedian",
  "Overly Optimistic",
  "Dog",
  "Cat",
  "Alien"
]);

function normalizeVoiceTone(value) {
  const tone = String(value || "").trim();
  return VOICE_TONES.has(tone) ? tone : "Comedian";
}

function voiceToneLabel(tone) {
  switch (normalizeVoiceTone(tone)) {
    case "Sassy":
      return "sassy";
    case "Angry":
      return "angry";
    case "Nerdy":
      return "nerdy";
    case "Cute":
      return "cute";
    case "Comedian":
      return "comedic";
    case "Overly Optimistic":
      return "overly optimistic";
    case "Dog":
      return "woof woof";
    case "Cat":
      return "meow meow";
    case "Alien":
      return "⟡⟡⟡";
    default:
      return "helpful and concise";
  }
}

async function buildLocalChatResponse(state, body, viewer) {
  const message = String(body.message || "").trim();
  const model = "gemini";
  const activeProjectId = body.activeProjectId || null;
  const selectedProject = findVisibleProjectForViewer(state.projects, viewer, {
    id: activeProjectId,
    title: typeof body.targetTitle === "string" ? body.targetTitle : ""
  });
  const lower = message.toLowerCase();

  let reply = "";
  let action = "none";
  let project = null;
  let focusProjectId = null;
  let persist = true;

  const tone = normalizeVoiceTone(body.tone);
  const toneLabel = voiceToneLabel(tone);
  const editableSelectedProject = selectedProject ? canEditProject(selectedProject, viewer) : false;

  const createIntent = /\b(create|build|make|deploy|new tile|add tile)\b/.test(lower);
  const updateIntent = /\b(edit|update|revise|refactor|modify|change)\b/.test(lower);
  const renameIntent = /\b(rename|retitle|call it|name it)\b/.test(lower);
  const openIntent = /\b(open|show|preview|focus|view)\b/.test(lower);
  const deleteIntent = /\b(delete|remove|trash)\b/.test(lower);
  const reorderTopIntent = /\b(first|top|front)\b/.test(lower) && /\b(move|put|send|bring)\b/.test(lower);

  if (renameIntent && selectedProject) {
    if (!editableSelectedProject) {
      reply = "I can rename drafts that belong to this workspace, or any tile once you’re in admin mode.";
    } else {
    const nextTitle = deriveTitle(message, selectedProject.title);
    project = {
      ...selectedProject,
      title: nextTitle,
      updatedAt: nowIso()
    };
    reply = `Renamed "${selectedProject.title}" to "${nextTitle}".`;
    action = "update";
    focusProjectId = selectedProject.id;
    }
  } else if (deleteIntent && selectedProject && viewer.isAdmin) {
    state.projects = state.projects.filter((projectItem) => projectItem.id !== selectedProject.id);
    state.projects = state.projects.map((projectItem, index) => ({
      ...projectItem,
      order: index
    }));
    reply = `Removed "${selectedProject.title}" from the library.`;
    action = "delete";
  } else if (deleteIntent && selectedProject) {
    reply = "Delete is reserved for admin mode.";
  } else if (reorderTopIntent && selectedProject && viewer.isAdmin && selectedProject.visibility === "published") {
    const ordered = [selectedProject, ...state.projects.filter((item) => item.id !== selectedProject.id)];
    state.projects = ordered.map((projectItem, index) => ({
      ...projectItem,
      order: index,
      updatedAt: projectItem.id === selectedProject.id ? nowIso() : projectItem.updatedAt
    }));
    reply = `"${selectedProject.title}" has been moved to the front.`;
    action = "reorder";
    focusProjectId = selectedProject.id;
  } else if (reorderTopIntent && selectedProject) {
    reply = "Only published showcase tiles can be reordered, and that is an admin-only action.";
  } else if (createIntent) {
    const nextTitle = deriveTitle(message);
    const generatedProject =
      (await generateTileArtifactWithGemini(state, body, null, nextTitle, "create", viewer)) ||
      {
        title: nextTitle,
        description: message.length > 140 ? `${message.slice(0, 137)}...` : message,
        category: inferCategory(message),
        tags: [model, "generated"],
        entry: "index.html",
        code: fallbackGeneratedTileCode(nextTitle, message)
      };
    const nextProject = normalizeProject(
      {
        id: crypto.randomUUID(),
        ...generatedProject,
        visibility: viewer.isAdmin ? "published" : "draft",
        workspaceId: viewer.workspaceId,
        publishedAt: viewer.isAdmin ? nowIso() : "",
        order: state.projects.length,
        createdAt: nowIso(),
        updatedAt: nowIso()
      },
      state.projects.length
    );
    state.projects = [...state.projects, nextProject];
    reply = viewer.isAdmin
      ? `Built "${nextProject.title}" and added it to the showcase library.`
      : `Built "${nextProject.title}" as a draft in your workspace. Admin can publish it to the shared showcase when it’s ready.`;
    action = "deploy";
    project = nextProject;
    focusProjectId = nextProject.id;
  } else if (updateIntent && selectedProject) {
    if (!editableSelectedProject) {
      reply = "I can edit drafts that belong to this workspace. Published showcase tiles need admin mode for changes.";
    } else {
    const nextTitle = selectedProject.title;
    const generatedProject =
      (await generateTileArtifactWithGemini(state, body, selectedProject, nextTitle, "update", viewer)) ||
      {
        title: nextTitle,
        description: message.length > 140 ? `${message.slice(0, 137)}...` : message,
        category: inferCategory(message) || selectedProject.category,
        tags: Array.isArray(selectedProject.tags) ? selectedProject.tags : [model, "generated"],
        entry: selectedProject.entry || "index.html",
        code: fallbackGeneratedTileCode(nextTitle, message)
      };
    const nextProject = {
      ...selectedProject,
      ...generatedProject,
      title: selectedProject.title,
      visibility: selectedProject.visibility,
      workspaceId: selectedProject.workspaceId,
      publishedAt: selectedProject.publishedAt || "",
      updatedAt: nowIso()
    };
    project = nextProject;
    reply = `Updated "${nextProject.title}" with a fresh edit.`;
    action = "update";
    focusProjectId = selectedProject.id;
    }
  } else if (openIntent && selectedProject) {
    reply = `Opening "${selectedProject.title}" in the glass window.`;
    action = "open";
    focusProjectId = selectedProject.id;
  } else if (message) {
    if (/\bhello\b/.test(lower) || /\bhi\b/.test(lower)) {
      reply =
        tone === "Dog"
          ? "woof woof"
          : tone === "Cat"
            ? "meow meow"
          : tone === "Alien"
              ? "⟡⟡⟡⟡⟡"
              : `TileOS online. I’m ready in ${toneLabel} mode.`;
    } else if (selectedProject) {
      reply = editableSelectedProject
        ? `I can help edit "${selectedProject.title}". Try a rename, a visual refresh, or a fresh generated version.`
        : `I can preview "${selectedProject.title}" here. To change it, work inside one of your drafts or use admin mode for published showcase tiles.`;
    } else {
      reply = `I’m ready to create new tiles and edit drafts in your workspace. Ask me to build something, or select one of your drafts first if you want an edit.`;
    }
  } else {
    reply = "Send a command to create, edit, open, or rename a tile.";
    persist = false;
  }

  const nextMemory = updateMemoryFromMessage(memoryForViewer(state, viewer), message, reply);
  assignMemoryForViewer(state, viewer, nextMemory);

  if (project) {
    const index = state.projects.findIndex((item) => item.id === project.id);
    if (index >= 0) {
      state.projects[index] = normalizeProject(
        {
          ...project,
          order: index
        },
        index
      );
    } else {
      state.projects.push(normalizeProject(project, state.projects.length));
    }
    state.projects.sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
    state.projects = state.projects.map((item, index) => ({ ...item, order: index }));
    project = state.projects.find((item) => item.id === project.id) || project;
  }

  return {
    reply,
    action,
    project: project ? serializeProjectForViewer(project, viewer) : null,
    focusProjectId,
    memory: nextMemory,
    projects: projectsForViewer(state.projects, viewer),
    session: { isAdmin: viewer.isAdmin },
    persist
  };
}

function mergeMemoryPatch(memory, patch) {
  const next = normalizeMemory(memory);
  const source = patch && typeof patch === "object" ? patch : {};

  if (typeof source.summary === "string" && source.summary.trim()) {
    next.summary = source.summary.trim().slice(-2500);
  }

  const removals = {
    facts: Array.isArray(source.factsToRemove) ? source.factsToRemove.map(String).filter(Boolean) : [],
    preferences: Array.isArray(source.preferencesToRemove)
      ? source.preferencesToRemove.map(String).filter(Boolean)
      : [],
    goals: Array.isArray(source.goalsToRemove) ? source.goalsToRemove.map(String).filter(Boolean) : []
  };

  next.facts = next.facts.filter((item) => !removals.facts.includes(item));
  next.preferences = next.preferences.filter((item) => !removals.preferences.includes(item));
  next.goals = next.goals.filter((item) => !removals.goals.includes(item));

  const additions = {
    facts: Array.isArray(source.factsToAdd) ? source.factsToAdd.map(String).filter(Boolean) : [],
    preferences: Array.isArray(source.preferencesToAdd)
      ? source.preferencesToAdd.map(String).filter(Boolean)
      : [],
    goals: Array.isArray(source.goalsToAdd) ? source.goalsToAdd.map(String).filter(Boolean) : []
  };

  next.facts = Array.from(new Set([...additions.facts, ...next.facts])).slice(0, 20);
  next.preferences = Array.from(new Set([...additions.preferences, ...next.preferences])).slice(0, 20);
  next.goals = Array.from(new Set([...additions.goals, ...next.goals])).slice(0, 20);

  return next;
}

function stripJsonFences(text) {
  const raw = String(text || "").trim();
  if (!raw) return raw;
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : raw;
}

function safeParseAssistantJson(text) {
  const cleaned = stripJsonFences(text);
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }
    throw error;
  }
}

function summarizeProjectForPrompt(project) {
  if (!project) return null;
  return {
    id: project.id,
    title: project.title,
    description: project.description,
    category: project.category,
    tags: Array.isArray(project.tags) ? project.tags : [],
    entry: project.entry || "index.html",
    files: project.files ? Object.keys(project.files) : [],
    codePreview:
      typeof project.code === "string" && project.code.trim()
        ? project.code.slice(0, 800)
        : ""
  };
}

async function generateGeminiChatEnhancement(state, body, localResponse, viewer) {
  const keys = getGeminiKeyPool();
  if (!keys.length) return null;

  const message = String(body.message || "").trim();
  const tone = normalizeVoiceTone(body.tone);
  const activeProjectId = body.activeProjectId || null;
  const selectedProject = findVisibleProjectForViewer(state.projects, viewer, {
    id: activeProjectId,
    title: typeof body.targetTitle === "string" ? body.targetTitle : ""
  });
  const image = body.image && typeof body.image === "object" ? body.image : null;
  const promptContext = {
    appTitle: APP_TITLE,
    writable: viewer.isAdmin,
    message,
    action: localResponse.action,
    reply: localResponse.reply,
    focusProjectId: localResponse.focusProjectId || null,
    tone,
    selectedProject: summarizeProjectForPrompt(selectedProject),
    projects: state.projects.map((project) => ({
      id: project.id,
      title: project.title,
      category: project.category,
      tags: Array.isArray(project.tags) ? project.tags : [],
      visibility: project.visibility
    })),
    memory: clone(memoryForViewer(state, viewer))
  };

  const systemPrompt = `You are the TileOS Gemini reply composer.

Your only job is to rewrite the assistant reply using the provided context.

Rules:
- Return JSON only.
- Keep the existing action and meaning intact.
- Keep replies concise, polished, and helpful.
- Respect the selected tone when rewriting the reply.
- If the tone is Dog, Cat, or Alien, preserve that special style and do not rewrite it into normal prose.
- If writable is false, do not imply edits happened.
- Never mention alternative providers.
- Update memory only with stable facts, preferences, and goals.

Return this JSON shape:
{
  "reply": "string",
  "memory": {
    "summary": "string",
    "factsToAdd": ["string"],
    "factsToRemove": ["string"],
    "preferencesToAdd": ["string"],
    "preferencesToRemove": ["string"],
    "goalsToAdd": ["string"],
    "goalsToRemove": ["string"]
  }
}`;

  const parts = [{ text: JSON.stringify(promptContext, null, 2) }];
  if (image && image.dataUrl) {
    const clean = String(image.dataUrl).includes(",")
      ? String(image.dataUrl).split(",")[1]
      : String(image.dataUrl);
    if (clean) {
      parts.push({
        inlineData: {
          mimeType: image.mime || "image/png",
          data: clean
        }
      });
    }
  }

  const parsed = await callGeminiJson(systemPrompt, parts, {
    temperature: 0.35,
    maxOutputTokens: 512,
    timeoutMs: 10000
  });

  return {
    reply: typeof parsed?.reply === "string" ? parsed.reply.trim() : "",
    memory: parsed?.memory && typeof parsed.memory === "object" ? parsed.memory : null
  };
}

async function buildChatResponse(state, body, viewer) {
  const localResponse = await buildLocalChatResponse(state, body, viewer);

  if (!getGeminiKeyPool().length) {
    return localResponse;
  }

  if (localResponse.action !== "none") {
    return localResponse;
  }

  try {
    const enhanced = await generateGeminiChatEnhancement(
      state,
      body,
      localResponse,
      viewer
    );
    if (enhanced?.reply) {
      localResponse.reply = enhanced.reply;
    }
    if (enhanced?.memory) {
      const mergedMemory = mergeMemoryPatch(memoryForViewer(state, viewer), enhanced.memory);
      assignMemoryForViewer(state, viewer, mergedMemory);
      localResponse.memory = mergedMemory;
    }
    return localResponse;
  } catch (error) {
    console.warn("[TileOS] Gemini enhancement failed:", error);
    return localResponse;
  }
}

function reorderProjects(state, orderedIds) {
  const published = state.projects.filter((project) => project.visibility === "published");
  const drafts = state.projects.filter((project) => project.visibility !== "published");
  const idSet = new Set(orderedIds);
  const orderedPublished = orderedIds
    .map((id) => findProjectById(published, id))
    .filter(Boolean);
  const remainingPublished = published.filter((project) => !idSet.has(project.id));
  const nextPublished = [...orderedPublished, ...remainingPublished].map((project, index) => ({
    ...project,
    order: index,
    updatedAt: nowIso()
  }));

  state.projects = [...nextPublished, ...drafts];
}

function serveStaticFile(req, res, pathname) {
  if (shouldDenyPublicPath(pathname)) {
    return false;
  }

  const safePath = safeJoin(PUBLIC_DIR, pathname === "/" ? "/index.html" : pathname);
  if (!safePath) return false;

  if (!fs.existsSync(safePath) || fs.statSync(safePath).isDirectory()) {
    const fallback = path.join(PUBLIC_DIR, "index.html");
    if (!fs.existsSync(fallback)) {
      return false;
    }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      ...buildSecurityHeaders()
    });
    res.end(fs.readFileSync(fallback));
    return true;
  }

  res.writeHead(200, {
    "Content-Type": contentTypeFor(safePath),
    "Cache-Control": "no-store",
    ...buildSecurityHeaders()
  });
  res.end(fs.readFileSync(safePath));
  return true;
}

function publicBootstrap(req, res) {
  const viewer = viewerContext(req, res);
  const viewerProjects = projectsForViewer(stateCache.projects, viewer);
  const publishedCount = stateCache.projects.filter((project) => project.visibility === "published").length;
  const draftCount = viewerProjects.filter((project) => project.visibility === "draft").length;

  return {
    appTitle: APP_TITLE,
    publicUrl: getPublicBaseUrl(req),
    basePath: getPublicBasePath(req),
    session: { isAdmin: viewer.isAdmin },
    memory: memoryForViewer(stateCache, viewer),
    projects: viewerProjects,
    models: [
      { id: "gemini", label: "Gemini", available: getGeminiKeyPool().length > 0 }
    ],
    manifest: {
      slug: "tileos",
      liveUrl: getPublicBaseUrl(req),
      healthPath: joinBasePath(getPublicBasePath(req), "/healthz")
    },
    stats: {
      publishedCount,
      draftCount
    },
    features: {
      folderBundles: true,
      secretSafe: true,
      chatControlPlane: true,
      publicDraftWorkspaces: true,
      adminPublishFlow: true
    }
  };
}

async function handleApi(req, res, url, pathname) {
  if (req.method === "GET" && pathname === "/healthz") {
    sendJson(res, 200, {
      ok: true,
      app: APP_TITLE,
      publicUrl: getPublicBaseUrl(req)
    });
    return true;
  }

  if (req.method === "GET" && pathname === "/tileos.project.json") {
    const manifest = {
      ...readProjectManifest(),
      liveUrl: getPublicBaseUrl(req),
      healthPath: joinBasePath(getPublicBasePath(req), "/healthz"),
      basePath: getPublicBasePath(req)
    };
    sendJson(res, 200, manifest, { "Cache-Control": "public, max-age=300" });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/bootstrap") {
    sendJson(res, 200, publicBootstrap(req, res));
    return true;
  }

  if (req.method === "GET" && pathname === "/api/session") {
    const viewer = viewerContext(req, res);
    sendJson(res, 200, { isAdmin: viewer.isAdmin });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/auth/login") {
    if (!assertAllowedOrigin(req)) {
      sendJson(res, 403, { ok: false, message: "Forbidden." });
      return true;
    }
    if (!enforceRateLimit(req, res, "login", RATE_LIMITS.login)) {
      return true;
    }
    const body = await readBody(req);
    const password = String(body.password || "");
    if (password !== ADMIN_PASSWORD) {
      sendJson(res, 401, { ok: false, message: "Invalid password." });
      return true;
    }
    setAdminCookie(res);
    sendJson(res, 200, { ok: true, isAdmin: true });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/auth/logout") {
    if (!assertAllowedOrigin(req)) {
      sendJson(res, 403, { ok: false, message: "Forbidden." });
      return true;
    }
    clearAdminCookie(res);
    sendJson(res, 200, { ok: true, isAdmin: false });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/projects") {
    const viewer = viewerContext(req, res);
    sendJson(res, 200, {
      projects: projectsForViewer(stateCache.projects, viewer),
      memory: memoryForViewer(stateCache, viewer)
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/projects") {
    const viewer = viewerContext(req, res);
    if (!viewer.isAdmin && !enforceRateLimit(req, res, "create", RATE_LIMITS.create)) {
      return true;
    }
    const payload = sanitizeProjectPayload(await readBody(req));
    const visibility = viewer.isAdmin
      ? (String(payload.visibility || "").toLowerCase() === "draft" ? "draft" : "published")
      : "draft";
    const nextProject = normalizeProject(
      {
        ...payload,
        visibility,
        workspaceId: viewer.workspaceId,
        publishedAt: visibility === "published" ? nowIso() : "",
        createdAt: nowIso(),
        updatedAt: nowIso()
      },
      stateCache.projects.length
    );
    stateCache.projects.push(nextProject);
    stateCache.projects = stateCache.projects
      .sort((a, b) => projectSortRank(a) - projectSortRank(b) || a.order - b.order || a.createdAt.localeCompare(b.createdAt))
      .map((project, index) => ({ ...project, order: index }));
    saveState(stateCache);
    sendJson(res, 200, {
      ok: true,
      project: serializeProjectForViewer(nextProject, viewer),
      projects: projectsForViewer(stateCache.projects, viewer)
    });
    return true;
  }

  if (req.method === "PUT" && pathname.startsWith("/api/projects/")) {
    const viewer = viewerContext(req, res);
    const id = pathname.split("/").pop();
    const index = stateCache.projects.findIndex((project) => project.id === id);
    if (index < 0) {
      sendJson(res, 404, { ok: false, message: "Project not found." });
      return true;
    }
    const current = stateCache.projects[index];
    if (!canEditProject(current, viewer)) {
      sendJson(res, 403, { ok: false, message: "You can only edit drafts that belong to your workspace." });
      return true;
    }
    const body = sanitizeProjectPayload(await readBody(req));
    const updated = normalizeProject(
      {
        ...current,
        ...body,
        id: current.id,
        createdAt: current.createdAt,
        workspaceId: current.workspaceId,
        visibility: current.visibility,
        publishedAt: current.publishedAt,
        updatedAt: nowIso()
      },
      current.order
    );
    stateCache.projects[index] = updated;
    saveState(stateCache);
    sendJson(res, 200, {
      ok: true,
      project: serializeProjectForViewer(updated, viewer),
      projects: projectsForViewer(stateCache.projects, viewer)
    });
    return true;
  }

  if (req.method === "POST" && pathname.match(/^\/api\/projects\/[^/]+\/publish$/)) {
    if (!assertAllowedOrigin(req)) {
      sendJson(res, 403, { ok: false, message: "Forbidden." });
      return true;
    }
    if (!isAdmin(req)) {
      sendJson(res, 403, { ok: false, message: "Admin access required." });
      return true;
    }
    const id = pathname.split("/")[3];
    const index = stateCache.projects.findIndex((project) => project.id === id);
    if (index < 0) {
      sendJson(res, 404, { ok: false, message: "Project not found." });
      return true;
    }
    const current = stateCache.projects[index];
    const updated = normalizeProject(
      {
        ...current,
        visibility: "published",
        publishedAt: nowIso(),
        updatedAt: nowIso()
      },
      current.order
    );
    stateCache.projects[index] = updated;
    saveState(stateCache);
    const viewer = viewerContext(req, res);
    sendJson(res, 200, {
      ok: true,
      project: serializeProjectForViewer(updated, viewer),
      projects: projectsForViewer(stateCache.projects, viewer)
    });
    return true;
  }

  if (req.method === "POST" && pathname.match(/^\/api\/projects\/[^/]+\/unpublish$/)) {
    if (!assertAllowedOrigin(req)) {
      sendJson(res, 403, { ok: false, message: "Forbidden." });
      return true;
    }
    if (!isAdmin(req)) {
      sendJson(res, 403, { ok: false, message: "Admin access required." });
      return true;
    }
    const id = pathname.split("/")[3];
    const index = stateCache.projects.findIndex((project) => project.id === id);
    if (index < 0) {
      sendJson(res, 404, { ok: false, message: "Project not found." });
      return true;
    }
    const current = stateCache.projects[index];
    const updated = normalizeProject(
      {
        ...current,
        visibility: "draft",
        publishedAt: "",
        updatedAt: nowIso()
      },
      current.order
    );
    stateCache.projects[index] = updated;
    saveState(stateCache);
    const viewer = viewerContext(req, res);
    sendJson(res, 200, {
      ok: true,
      project: serializeProjectForViewer(updated, viewer),
      projects: projectsForViewer(stateCache.projects, viewer)
    });
    return true;
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/projects/")) {
    if (!assertAllowedOrigin(req)) {
      sendJson(res, 403, { ok: false, message: "Forbidden." });
      return true;
    }
    if (!isAdmin(req)) {
      sendJson(res, 403, { ok: false, message: "Admin access required." });
      return true;
    }
    const id = pathname.split("/").pop();
    const index = stateCache.projects.findIndex((project) => project.id === id);
    if (index < 0) {
      sendJson(res, 404, { ok: false, message: "Project not found." });
      return true;
    }
    stateCache.projects.splice(index, 1);
    stateCache.projects = stateCache.projects.map((project, index) => ({ ...project, order: index }));
    saveState(stateCache);
    const viewer = viewerContext(req, res);
    sendJson(res, 200, { ok: true, projects: projectsForViewer(stateCache.projects, viewer) });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/projects/reorder") {
    if (!assertAllowedOrigin(req)) {
      sendJson(res, 403, { ok: false, message: "Forbidden." });
      return true;
    }
    if (!isAdmin(req)) {
      sendJson(res, 403, { ok: false, message: "Admin access required." });
      return true;
    }
    const body = await readBody(req);
    const orderedIds = Array.isArray(body.orderedIds) ? body.orderedIds.map(String) : [];
    reorderProjects(stateCache, orderedIds);
    saveState(stateCache);
    const viewer = viewerContext(req, res);
    sendJson(res, 200, { ok: true, projects: projectsForViewer(stateCache.projects, viewer) });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/chat") {
    const viewer = viewerContext(req, res);
    if (!viewer.isAdmin && !enforceRateLimit(req, res, "chat", RATE_LIMITS.chat)) {
      return true;
    }
    const body = sanitizeChatPayload(await readBody(req));
    const response = await buildChatResponse(stateCache, body, viewer);
    if (response.persist || body.message) {
      saveState(stateCache);
    }
    sendJson(res, 200, {
      ok: true,
      ...response,
      projects: projectsForViewer(stateCache.projects, viewer),
      memory: memoryForViewer(stateCache, viewer)
    });
    return true;
  }

  return false;
}

function startupWarnings() {
  if (!process.env.ADMIN_PASSWORD && !IS_PRODUCTION) {
    console.warn("[TileOS] ADMIN_PASSWORD is not set. Using the local development password.");
  }
  if (!process.env.SESSION_SECRET && !IS_PRODUCTION) {
    console.warn("[TileOS] SESSION_SECRET is not set. Using a generated local session secret.");
  }
}

async function main() {
  ensureDataDir();
  startupWarnings();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const requestPathname = stripConfiguredBasePath(url.pathname);

      if (await handleApi(req, res, url, requestPathname)) {
        return;
      }

      if (req.method === "GET") {
        const served = serveStaticFile(req, res, requestPathname);
        if (served) return;
      }

      sendText(res, 404, "Not Found");
    } catch (error) {
      console.error("[TileOS] Server error:", error);
      sendJson(res, 500, {
        ok: false,
        message: IS_PRODUCTION
          ? "Server error"
          : error instanceof Error
            ? error.message
            : "Server error"
      });
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`[TileOS] ${APP_TITLE} running on http://${HOST}:${PORT}`);
  });
}

main().catch((error) => {
  console.error("[TileOS] Failed to start:", error);
  process.exit(1);
});
