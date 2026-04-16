module.exports = {
  memory: {
    summary:
      "TileOS is a private glassmorphic portfolio OS for live web apps, with in-place previews, admin editing, and a sleek Apple-inspired presentation.",
    facts: [
      "The project should feel like a polished operating system rather than a plain gallery.",
      "Tile previews should open in a pseudo-browser window on the same page.",
      "The client must not expose secrets or API keys."
    ],
    preferences: [
      "Use dark glass surfaces with subtle blue and teal accents.",
      "Keep the dashboard fast by only booting tile runtimes when opened.",
      "Support chat-driven tile creation and editing."
    ],
    goals: [
      "Build a premium public portfolio that feels like a developer operating system.",
      "Keep the admin workflow simple, private, and reliable."
    ]
  },
  projects: [
    {
      id: "welcome-beacon",
      title: "Welcome Beacon",
      description: "A live greeting tile with time, status, and a polished glass panel.",
      category: "web",
      tags: ["glass", "welcome", "system"],
      order: 0,
      createdAt: "2026-04-06T00:00:00.000Z",
      updatedAt: "2026-04-06T00:00:00.000Z",
      code: `function App() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-8">
      <div className="w-full max-w-xl rounded-[28px] border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl p-8">
        <div className="text-[11px] uppercase tracking-[0.4em] text-white/40">TileOS Online</div>
        <h1 className="mt-4 text-5xl font-black tracking-tight">Welcome back.</h1>
        <p className="mt-4 max-w-md text-white/60 leading-relaxed">
          This is a live portfolio tile running inside a sandboxed glass window.
        </p>
        <div className="mt-8 grid grid-cols-2 gap-4">
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <div className="text-[10px] uppercase tracking-[0.3em] text-white/35">Status</div>
            <div className="mt-2 text-lg font-semibold text-emerald-300">System stable</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <div className="text-[10px] uppercase tracking-[0.3em] text-white/35">Clock</div>
            <div className="mt-2 text-lg font-semibold text-sky-200">{now.toLocaleTimeString()}</div>
          </div>
        </div>
      </div>
    </div>
  );
}`,
      entry: "index.html"
    },
    {
      id: "signal-board",
      title: "Signal Board",
      description: "A compact metrics dashboard with animated glass cards.",
      category: "ai",
      tags: ["dashboard", "metrics", "signal"],
      order: 1,
      createdAt: "2026-04-06T00:00:00.000Z",
      updatedAt: "2026-04-06T00:00:00.000Z",
      code: `function App() {
  const stats = useMemo(() => [
    { label: "Latency", value: "18ms", tone: "text-emerald-300" },
    { label: "Reliability", value: "99.9%", tone: "text-sky-300" },
    { label: "Deploys", value: "42", tone: "text-violet-300" }
  ], []);

  return (
    <div className="min-h-screen bg-slate-950 text-white p-8">
      <div className="mx-auto max-w-4xl">
        <div className="rounded-[32px] border border-white/10 bg-white/5 backdrop-blur-2xl shadow-2xl p-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.4em] text-white/35">Signal Board</div>
              <h2 className="mt-3 text-4xl font-black tracking-tight">Realtime system pulse</h2>
            </div>
            <div className="rounded-full border border-white/10 bg-black/25 px-4 py-2 text-xs text-white/60">
              Live
            </div>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {stats.map((stat) => (
              <div key={stat.label} className="rounded-3xl border border-white/10 bg-black/25 p-5">
                <div className="text-[10px] uppercase tracking-[0.3em] text-white/35">{stat.label}</div>
                <div className={"mt-3 text-3xl font-black " + stat.tone}>{stat.value}</div>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full w-2/3 rounded-full bg-gradient-to-r from-sky-400 via-cyan-300 to-emerald-300" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}`,
      entry: "index.html"
    },
    {
      id: "glass-notes",
      title: "Glass Notes",
      description: "A simple notes tile that demonstrates live state and interactivity.",
      category: "mobile",
      tags: ["notes", "ui", "state"],
      order: 2,
      createdAt: "2026-04-06T00:00:00.000Z",
      updatedAt: "2026-04-06T00:00:00.000Z",
      code: `function App() {
  const [notes, setNotes] = useState([
    "Ship the TileOS public portfolio.",
    "Keep all keys server-side.",
    "Use glassmorphism sparingly and intentionally."
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
        <div className="text-[11px] uppercase tracking-[0.4em] text-white/35">Glass Notes</div>
        <h3 className="mt-3 text-3xl font-black tracking-tight">Focus board</h3>
        <div className="mt-5 flex gap-3">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addNote();
            }}
            placeholder="Capture a thought..."
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
            <div key={note + "-" + index} className="rounded-2xl border border-white/10 bg-black/25 p-4 text-sm text-white/80">
              {note}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}`,
      entry: "index.html"
    },
    {
      id: "launch-panel",
      title: "Launch Panel",
      description: "A clean hero tile for announcements and featured project storytelling.",
      category: "web",
      tags: ["hero", "launch", "featured"],
      order: 3,
      createdAt: "2026-04-06T00:00:00.000Z",
      updatedAt: "2026-04-06T00:00:00.000Z",
      code: `function App() {
  return (
    <div className="min-h-screen bg-slate-950 p-8 text-white">
      <div className="mx-auto flex min-h-[80vh] max-w-5xl items-center">
        <div className="w-full overflow-hidden rounded-[36px] border border-white/10 bg-gradient-to-br from-white/10 via-white/5 to-transparent p-10 shadow-2xl">
          <div className="text-[11px] uppercase tracking-[0.4em] text-white/35">Featured Build</div>
          <h1 className="mt-4 max-w-2xl text-5xl font-black tracking-tight md:text-6xl">
            A portfolio that behaves like a private operating system.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-white/60">
            Tiles are live, editable, searchable, and controlled from a glass-side chat workspace.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <span className="rounded-full border border-white/10 bg-black/20 px-4 py-2 text-xs uppercase tracking-[0.25em] text-white/50">
              Live preview
            </span>
            <span className="rounded-full border border-white/10 bg-black/20 px-4 py-2 text-xs uppercase tracking-[0.25em] text-white/50">
              Admin control
            </span>
            <span className="rounded-full border border-white/10 bg-black/20 px-4 py-2 text-xs uppercase tracking-[0.25em] text-white/50">
              Secret-safe
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}`,
      entry: "index.html"
    },
    {
      id: "hello-world-expand",
      title: "Hello World Expand",
      description: "A hello world tile that grows a little more with every click.",
      category: "web",
      tags: ["hello", "expand", "interactive"],
      order: 4,
      createdAt: "2026-04-07T04:54:59.387Z",
      updatedAt: "2026-04-07T04:54:59.387Z",
      code: `function App() {
  const [clicks, setClicks] = useState(0);
  const size = Math.min(240 + clicks * 44, 620);
  const scale = 1 + clicks * 0.02;

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-8">
      <button
        onClick={() => setClicks((value) => Math.min(value + 1, 10))}
        className="relative overflow-hidden rounded-[32px] border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl transition-all duration-500 ease-out text-left"
        style={{ width: size, height: size, transform: "scale(" + scale + ")" }}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-white/15 via-transparent to-sky-500/10"></div>
        <div className="relative flex h-full w-full flex-col items-center justify-center p-8 text-center">
          <div className="text-[11px] uppercase tracking-[0.4em] text-white/35">Hello World Expand</div>
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
      }`,
      entry: "index.html"
    },
    {
      id: "that-launches-youtube",
      title: "That Launches Youtube",
      description: "A glass launcher tile that opens YouTube in a new tab.",
      category: "web",
      tags: ["youtube", "launch"],
      order: 6,
      createdAt: "2026-04-07T05:08:17.739Z",
      updatedAt: "2026-04-07T05:08:17.739Z",
      code: `function App() {
  const openYoutube = () => {
    const url = "https://www.youtube.com";
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) window.location.href = url;
  };

  return (
    <div
      onClick={openYoutube}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openYoutube();
        }
      }}
      className="min-h-screen cursor-pointer bg-slate-950 p-8 text-left text-white outline-none"
    >
      <div className="mx-auto flex min-h-[80vh] max-w-5xl items-center">
        <div className="w-full rounded-[36px] border border-white/10 bg-white/5 p-10 shadow-2xl backdrop-blur-2xl transition-transform duration-300 hover:scale-[1.01]">
          <div className="text-[11px] uppercase tracking-[0.4em] text-white/35">YouTube Launcher</div>
          <h1 className="mt-4 text-5xl font-black tracking-tight md:text-6xl">Open YouTube.</h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-white/60">
            Click anywhere on this tile to launch YouTube in a new tab.
          </p>
          <div className="mt-8 inline-flex items-center gap-3 rounded-full bg-red-500 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-red-500/25">
            Launch YouTube
          </div>
        </div>
      </div>
    </div>
  );
      }`,
      entry: "index.html"
    },
    {
      id: "app-that-has-sphere",
      title: "App That Has Sphere",
      description: "make a tile app that has a sphere",
      category: "mobile",
      tags: ["gemini", "generated"],
      order: 7,
      createdAt: "2026-04-07T05:15:00.000Z",
      updatedAt: "2026-04-07T05:15:00.000Z",
      code: `function App() {
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
            <div className="text-[11px] uppercase tracking-[0.4em] text-white/35">App That Has Sphere</div>
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
}`,
      entry: "index.html"
    }
  ]
};
