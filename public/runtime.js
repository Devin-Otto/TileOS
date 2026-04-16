const DEFAULT_TONE = {
  gemini: "helpful and concise"
};

export const MODEL_THEMES = {
  gemini: {
    label: "Gemini",
    accentName: "emerald"
  }
};

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function titleCase(value) {
  return String(value || "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function truncate(value, length = 120) {
  const text = String(value || "");
  if (text.length <= length) return text;
  return `${text.slice(0, Math.max(0, length - 1)).trimEnd()}…`;
}

export function formatDate(value) {
  if (!value) return "Just now";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function formatRelativeDate(value) {
  if (!value) return "just now";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  const diff = Date.now() - date.getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function escapeScriptText(value) {
  return String(value || "").replace(/<\/script>/gi, "<\\/script>");
}

export function normalizeTagsInput(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function projectSearchText(project) {
  return [
    project.title,
    project.description,
    project.category,
    Array.isArray(project.tags) ? project.tags.join(" ") : "",
    project.code,
    project.entry,
    project.files ? Object.keys(project.files).join(" ") : ""
  ]
    .join(" ")
    .toLowerCase();
}

export function createEmptyProjectDraft() {
  return {
    id: "",
    title: "Untitled Tile",
    description: "",
    category: "web",
    tags: "",
    mode: "single",
    entry: "index.html",
    code: defaultSingleFileCode("Untitled Tile")
  };
}

export function defaultSingleFileCode(title = "Untitled Tile") {
  return `function App() {
  const [count, setCount] = useState(0);

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-8">
      <div className="w-full max-w-xl rounded-[30px] border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl p-8">
        <div className="text-[11px] uppercase tracking-[0.4em] text-white/40">${escapeHtml(title)}</div>
        <h1 className="mt-4 text-4xl font-black tracking-tight">New Tile</h1>
        <p className="mt-4 text-white/60 leading-relaxed">
          Paste a React component here. JSX is supported. Imports are stripped automatically.
        </p>
        <button
          onClick={() => setCount((value) => value + 1)}
          className="mt-8 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition-transform hover:scale-[1.02]"
        >
          Clicked {count} times
        </button>
      </div>
    </div>
  );
}`;
}

export function defaultBundleText(title = "Untitled Tile") {
  return `=== index.html ===
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <main class="frame">
      <h1>${escapeHtml(title)}</h1>
      <p>This is a folder-aware tile bundle. Edit the HTML, CSS, and JS sections separately.</p>
      <button id="boost">Boost</button>
    </main>
    <script src="./script.js"></script>
  </body>
</html>

=== styles.css ===
html, body {
  margin: 0;
  min-height: 100%;
  background: #050814;
  color: white;
  font-family: Inter, system-ui, sans-serif;
}

.frame {
  min-height: 100vh;
  display: grid;
  place-items: center;
  gap: 16px;
  padding: 32px;
  text-align: center;
}

.frame h1 {
  font-size: clamp(2.5rem, 7vw, 5rem);
  margin: 0;
}

.frame p {
  margin: 0;
  max-width: 44rem;
  color: rgba(255, 255, 255, 0.62);
}

.frame button {
  border: 0;
  border-radius: 999px;
  padding: 14px 22px;
  background: linear-gradient(135deg, #6ee7ff, #86efac);
  color: #03111d;
  font-weight: 800;
  cursor: pointer;
}

=== script.js ===
const button = document.getElementById("boost");
if (button) {
  let count = 0;
  button.addEventListener("click", () => {
    count += 1;
    button.textContent = "Boosted " + count + "x";
  });
}
`;
}

export function parseBundleText(text) {
  const source = String(text || "");
  const files = {};
  const sections = source.split(/^===\s*(.+?)\s*===\s*$/m);

  if (sections.length < 3) {
    return {};
  }

  for (let index = 1; index < sections.length; index += 2) {
    const name = sections[index].trim();
    const contents = sections[index + 1] || "";
    if (name) {
      files[name] = contents.replace(/^\n/, "");
    }
  }

  return files;
}

export function serializeBundleText(files, entry = "index.html") {
  const keys = Object.keys(files || {});
  if (!keys.length) return defaultBundleText(entry);
  const ordered = [
    entry,
    ...keys.filter((name) => name !== entry).sort((a, b) => a.localeCompare(b))
  ].filter((name, index, array) => array.indexOf(name) === index && files[name] != null);
  return ordered
    .map((name) => `=== ${name} ===\n${String(files[name]).replace(/\n$/, "")}\n`)
    .join("\n")
    .trimEnd();
}

export function stripModuleSyntax(code) {
  return String(code || "")
    .replace(/^\s*import\s+[\s\S]*?from\s+['"].*?['"];?\s*$/gm, "")
    .replace(/^\s*import\s+['"].*?['"];?\s*$/gm, "")
    .replace(/^\s*export\s+default\s+function\s+/gm, "function ")
    .replace(/^\s*export\s+default\s+/gm, "")
    .replace(/^\s*export\s+(const|let|var|function|class)\s+/gm, "$1 ")
    .replace(/^\s*export\s+\{[\s\S]*?\};?\s*$/gm, "");
}

export function buildRunnerBridge(tileId, title = "TileOS tile") {
  return `
<script>
(function() {
  const TILE_ID = ${JSON.stringify(tileId)};
  const ORIGINAL = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
  };

  const send = (level, msg, meta) => {
    try {
      parent.postMessage({
        type: "TILEOS_LOG",
        tileId: TILE_ID,
        level,
        msg,
        meta,
        ts: Date.now()
      }, "*");
    } catch (error) {}
  };

  const stringify = (value) => {
    try {
      if (value instanceof Error) return value.stack || value.message || String(value);
      if (typeof value === "string") return value;
      if (typeof value === "number" || typeof value === "boolean") return String(value);
      if (value && typeof value === "object") return JSON.stringify(value);
      return String(value);
    } catch (error) {
      return String(value);
    }
  };

  console.log = (...args) => {
    ORIGINAL.log(...args);
    send("log", args.map(stringify).join(" "));
  };
  console.warn = (...args) => {
    ORIGINAL.warn(...args);
    send("warn", args.map(stringify).join(" "));
  };
  console.error = (...args) => {
    ORIGINAL.error(...args);
    send("error", args.map(stringify).join(" "));
  };

  window.addEventListener("error", (event) => {
    const err = event.error;
    send("error", err && err.stack ? err.stack : [event.message, event.filename, event.lineno, event.colno].filter(Boolean).join(" | "));
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    send("error", reason && reason.stack ? reason.stack : stringify(reason));
  });

  send("log", "[BOOT] ${escapeScriptText(title)}");
})();
</script>`;
}

function fallbackIcon(name) {
  return (props = {}) => {
    const size = Number(props.size || 16);
    return React.createElement("span", {
      ...props,
      style: {
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: 5,
        background: "rgba(255,255,255,0.12)",
        verticalAlign: "middle",
        ...props.style
      },
      title: props.title || name || "icon"
    });
  };
}

export function buildSingleFileSrcDoc(rawCode, tileId, title = "TileOS tile") {
  const code = escapeScriptText(stripModuleSyntax(rawCode));
  const iconNames = [
    "Plus",
    "X",
    "Trash2",
    "Edit3",
    "Monitor",
    "RefreshCw",
    "Send",
    "Search",
    "User",
    "Layers",
    "Phone",
    "PhoneOff",
    "ChevronDown",
    "ChevronUp",
    "Code2",
    "Box",
    "Settings",
    "Maximize2",
    "Code",
    "Cpu",
    "Globe",
    "Command",
    "MessageSquare",
    "ChevronRight",
    "Smartphone",
    "Rocket",
    "Activity",
    "Sparkles",
    "Zap",
    "Database",
    "Eye",
    "Brain",
    "LayoutGrid",
    "LayoutDashboard",
    "PanelLeft",
    "PanelRight",
    "Pencil",
    "Play",
    "Pause",
    "Save",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Copy",
    "Check",
    "Circle",
    "CircleAlert",
    "GripVertical",
    "Lock",
    "Unlock",
    "CalendarDays",
    "Clock3",
    "Bookmark",
    "Heart",
    "Star",
    "Flame",
    "Map",
    "FileText",
    "FolderOpen",
    "GitBranch",
    "Workflow",
    "TerminalSquare"
  ];

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <script src="https://unpkg.com/lucide-react@0.263.1/dist/umd/lucide-react.production.min.js"></script>
    <style>
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #02040a;
        color: white;
        font-family:
          Inter,
          ui-sans-serif,
          system-ui,
          -apple-system,
          BlinkMacSystemFont,
          "SF Pro Display",
          "Segoe UI",
          sans-serif;
      }
      #root {
        min-height: 100vh;
        width: 100vw;
      }
      ::-webkit-scrollbar {
        width: 8px;
      }
      ::-webkit-scrollbar-thumb {
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.12);
      }
      .tile-fatal {
        min-height: 100vh;
        padding: 24px;
        color: #fca5a5;
        background: #02040a;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }
      .tile-fatal__title {
        font-size: 18px;
        font-weight: 800;
        margin-bottom: 10px;
      }
      .tile-fatal__stack {
        white-space: pre-wrap;
        background: rgba(248, 113, 113, 0.08);
        border: 1px solid rgba(248, 113, 113, 0.2);
        border-radius: 16px;
        padding: 14px;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    ${buildRunnerBridge(tileId, title)}
    <script type="text/babel">
      const { useState, useEffect, useRef, useMemo, useCallback, useReducer, useLayoutEffect } = React;
      const lucideBundle = window["lucide-react"] || {};
      const iconFallback = ${fallbackIcon.toString()};

      if (lucideBundle && typeof lucideBundle === "object") {
        Object.keys(lucideBundle).forEach((name) => {
          try {
            if (!window[name]) window[name] = lucideBundle[name];
          } catch (error) {}
        });
      }

      ${JSON.stringify(iconNames)}.forEach((name) => {
        if (!window[name]) window[name] = iconFallback(name);
      });

      function showFatal(msg) {
        const root = document.getElementById("root");
        root.innerHTML =
          '<div class="tile-fatal">' +
            '<div class="tile-fatal__title">Tile crashed</div>' +
            '<div class="tile-fatal__stack">' + String(msg) + '</div>' +
          '</div>';
      }

      class ErrorBoundary extends React.Component {
        constructor(props) {
          super(props);
          this.state = { error: null };
        }
        static getDerivedStateFromError(error) {
          return { error };
        }
        componentDidCatch(error) {
          console.error(error);
        }
        render() {
          if (this.state.error) {
            return React.createElement(
              "div",
              { className: "tile-fatal" },
              React.createElement("div", { className: "tile-fatal__title" }, "Tile crashed"),
              React.createElement("div", { className: "tile-fatal__stack" }, String(this.state.error.stack || this.state.error))
            );
          }
          return this.props.children;
        }
      }

      try {
        ${code}

        const mount = document.getElementById("root");
        const root = ReactDOM.createRoot(mount);

        let RenderTarget = typeof App !== "undefined" ? App : null;
        if (!RenderTarget && typeof Main !== "undefined") RenderTarget = Main;
        if (!RenderTarget && typeof Dashboard !== "undefined") RenderTarget = Dashboard;
        if (!RenderTarget && typeof Tile !== "undefined") RenderTarget = Tile;

        if (!RenderTarget) {
          showFatal('No component named "App" found. Define a component named App.');
        } else {
          root.render(
            React.createElement(ErrorBoundary, null, React.createElement(RenderTarget, null))
          );
          console.log("[MOUNT] ${escapeScriptText(title)}");
        }
      } catch (error) {
        showFatal(error && error.stack ? error.stack : error && error.message ? error.message : String(error));
      }
    </script>
  </body>
</html>`;
}

function ensureFullHtmlDocument(html) {
  const source = String(html || "");
  if (/<!doctype\s+html/i.test(source) || /<html[\s>]/i.test(source)) {
    return source;
  }
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body>${source}</body>
</html>`;
}

function resolveBundleFile(files, fileName) {
  const normalized = String(fileName || "")
    .replace(/^\.\/+/g, "")
    .replace(/^\/+/g, "")
    .trim();
  if (!normalized) return null;
  return files[normalized] != null ? normalized : null;
}

export function buildHtmlBundleSrcDoc(htmlSource, files, tileId, title = "TileOS tile") {
  const parser = new DOMParser();
  const document = parser.parseFromString(ensureFullHtmlDocument(htmlSource), "text/html");

  document.querySelectorAll('link[rel="stylesheet"][href]').forEach((node) => {
    const href = node.getAttribute("href") || "";
    const matched = resolveBundleFile(files, href);
    if (!matched) return;
    const style = document.createElement("style");
    style.textContent = String(files[matched] || "");
    node.replaceWith(style);
  });

  document.querySelectorAll("script[src]").forEach((node) => {
    const src = node.getAttribute("src") || "";
    const matched = resolveBundleFile(files, src);
    if (!matched) return;
    const script = document.createElement("script");
    const type = node.getAttribute("type");
    if (type) script.setAttribute("type", type);
    const scriptBody = String(files[matched] || "");
    script.textContent = escapeScriptText(scriptBody);
    node.replaceWith(script);
  });

  const bridgeDoc = parser.parseFromString(buildRunnerBridge(tileId, title), "text/html");
  const bridge = bridgeDoc.body.firstElementChild;
  const head = document.head || document.querySelector("head");
  if (head && bridge) {
    head.prepend(bridge);
  } else {
    document.body.prepend(bridge);
  }

  return "<!doctype html>\n" + document.documentElement.outerHTML;
}

export function buildTileSrcDoc(project, tileId) {
  const title = project?.title || "TileOS tile";
  const files = project?.files && typeof project.files === "object" ? project.files : null;
  const code = String(project?.code || "");
  const entry = String(project?.entry || "index.html");
  const bundleTextFiles = !files && /===\s*.+?\s*===/m.test(code) ? parseBundleText(code) : null;
  const effectiveFiles = files || bundleTextFiles;

  if (effectiveFiles && Object.keys(effectiveFiles).length > 0) {
    const htmlCandidate =
      effectiveFiles[entry] ||
      effectiveFiles["index.html"] ||
      effectiveFiles["main.html"] ||
      effectiveFiles[Object.keys(effectiveFiles)[0]];
    if (htmlCandidate && /<!doctype\s+html|<html[\s>]/i.test(String(htmlCandidate))) {
      return buildHtmlBundleSrcDoc(String(htmlCandidate), effectiveFiles, tileId, title);
    }
    return buildHtmlBundleSrcDoc(
      String(htmlCandidate || defaultBundleText(title)),
      effectiveFiles,
      tileId,
      title
    );
  }

  if (/<!doctype\s+html|<html[\s>]/i.test(code.trim())) {
    return buildHtmlBundleSrcDoc(code, {}, tileId, title);
  }

  return buildSingleFileSrcDoc(code || defaultSingleFileCode(title), tileId, title);
}

export function modelTone(model) {
  return DEFAULT_TONE[String(model || "").toLowerCase()] || "helpful and concise";
}

export function projectAccentBadge(project) {
  return String(project?.category || "web").toUpperCase();
}
