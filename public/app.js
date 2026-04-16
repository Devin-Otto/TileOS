import { h, render } from "https://esm.sh/preact@10.26.4";
import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "https://esm.sh/preact@10.26.4/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import {
  MODEL_THEMES,
  buildTileSrcDoc,
  clamp,
  createEmptyProjectDraft,
  defaultBundleText,
  defaultSingleFileCode,
  formatDate,
  formatRelativeDate,
  normalizeTagsInput,
  parseBundleText,
  projectAccentBadge,
  projectSearchText,
  serializeBundleText,
  slugify,
  titleCase,
  truncate
} from "./runtime.js";

const html = htm.bind(h);
const MODULE_URL = new URL(import.meta.url);
const MODULE_BASE_PATH = MODULE_URL.pathname.replace(/\/app\.js$/u, "").replace(/\/+$/u, "");
const APP_BASE_PATH = MODULE_BASE_PATH === "/" ? "" : MODULE_BASE_PATH;

function withAppBasePath(pathname = "/") {
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (!APP_BASE_PATH) {
    return normalized;
  }
  return `${APP_BASE_PATH}${normalized}`;
}

function apiPath(pathname = "/") {
  return withAppBasePath(`/api${pathname.startsWith("/") ? pathname : `/${pathname}`}`);
}

const DEFAULT_CHAT = [
  {
    role: "assistant",
    text: "TileOS kernel online. Gemini is active. Voice chat is available. Open a tile or ask me to build one."
  }
];

const DEFAULT_MEMORY = {
  summary: "",
  facts: [],
  preferences: [],
  goals: []
};

const VOICE_TONE_OPTIONS = [
  "Sassy",
  "Angry",
  "Nerdy",
  "Cute",
  "Comedian",
  "Overly Optimistic",
  "Dog",
  "Cat",
  "Alien"
];

const GENDER_OPTIONS = ["Male", "Female"];

function useStoredState(key, initialValue) {
  const [value, setValue] = useState(() => {
    if (typeof window === "undefined") return initialValue;
    try {
      const raw = window.localStorage.getItem(key);
      return raw == null ? initialValue : JSON.parse(raw);
    } catch (error) {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {}
  }, [key, value]);

  return [value, setValue];
}

function useDebouncedEffect(effect, deps, delay) {
  useEffect(() => {
    const handle = setTimeout(effect, delay);
    return () => clearTimeout(handle);
  }, deps);
}

function modelLabel(model) {
  return MODEL_THEMES[model]?.label || titleCase(model || "Gemini");
}

function sortProjects(list) {
  return [...list].sort((a, b) => {
    const leftRank = a.visibility === "published" ? 0 : 1;
    const rightRank = b.visibility === "published" ? 0 : 1;
    return (
      leftRank - rightRank ||
      a.order - b.order ||
      String(a.createdAt).localeCompare(String(b.createdAt))
    );
  });
}

function moveItem(list, sourceId, targetId) {
  const ordered = sortProjects(list);
  const fromIndex = ordered.findIndex((item) => item.id === sourceId);
  const toIndex = ordered.findIndex((item) => item.id === targetId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return ordered;
  const next = [...ordered];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next.map((item, index) => ({ ...item, order: index }));
}

function reorderOneStep(list, projectId, direction) {
  const ordered = sortProjects(list);
  const index = ordered.findIndex((item) => item.id === projectId);
  if (index < 0) return ordered;
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= ordered.length) return ordered;
  const next = [...ordered];
  [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  return next.map((item, idx) => ({ ...item, order: idx }));
}

function formatConsoleMessage(item) {
  const ts = new Date(item.ts || Date.now()).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  return `[${ts}] ${item.msg || ""}`;
}

function projectVisibilityLabel(project) {
  if (!project) return "published";
  if (project.visibility === "draft") {
    return project.viewerOwned ? "your draft" : "draft";
  }
  return "published";
}

function getSpeechRecognitionConstructor() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function pickPreferredVoice(voices, preferredLang, preferredGender) {
  const list = Array.isArray(voices) ? voices : [];
  const normalized = String(preferredLang || "en-US").toLowerCase();
  const prefix = normalized.split("-")[0];
  const gender = String(preferredGender || "Male").toLowerCase();
  const voiceHints =
    gender === "female"
      ? [
          "female",
          "samantha",
          "victoria",
          "zira",
          "karen",
          "tessa",
          "moira",
          "fiona",
          "emma",
          "linda",
          "jenny"
        ]
      : [
          "male",
          "daniel",
          "david",
          "alex",
          "fred",
          "mark",
          "tom",
          "thomas",
          "john",
          "peter",
          "matt"
        ];
  return (
    list.find((voice) =>
      voiceHints.some((hint) => String(voice.name || "").toLowerCase().includes(hint))
    ) ||
    list.find((voice) => voice.default && String(voice.lang || "").toLowerCase().startsWith(prefix)) ||
    list.find((voice) => String(voice.lang || "").toLowerCase() === normalized) ||
    list.find((voice) => String(voice.lang || "").toLowerCase().startsWith(prefix)) ||
    list[0] ||
    null
  );
}

function App() {
  const [boot, setBoot] = useState({ loading: true, error: "" });
  const [appTitle, setAppTitle] = useState("TileOS");
  const [projects, setProjects] = useState([]);
  const [memory, setMemory] = useState(DEFAULT_MEMORY);
  const [sessionAdmin, setSessionAdmin] = useState(false);
  const [availableModels, setAvailableModels] = useState([]);

  const [sidebarCollapsed, setSidebarCollapsed] = useStoredState("tileos.sidebarCollapsed", false);
  const [activeModel, setActiveModel] = useStoredState("tileos.activeModel", "gemini");
  const [categoryFilter, setCategoryFilter] = useStoredState("tileos.categoryFilter", "all");
  const [chatHistory, setChatHistory] = useStoredState("tileos.chatHistory", DEFAULT_CHAT);
  const [tileLogs, setTileLogs] = useStoredState("tileos.tileLogs", {});
  const [voicePanelOpen, setVoicePanelOpen] = useStoredState("tileos.voicePanelOpen", true);
  const [voiceTone, setVoiceTone] = useStoredState("tileos.voiceTone", "Comedian");
  const [voiceGender, setVoiceGender] = useStoredState("tileos.voiceGender", "Male");
  const [voicePitchSemis, setVoicePitchSemis] = useStoredState("tileos.voicePitchSemis", 0);

  const [search, setSearch] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatImage, setChatImage] = useState(null);
  const [sending, setSending] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("idle");
  const [voiceError, setVoiceError] = useState("");
  const [voiceSupported, setVoiceSupported] = useState(true);

  const [activeProjectId, setActiveProjectId] = useState("");
  const [windowMode, setWindowMode] = useState("preview");
  const [windowTab, setWindowTab] = useState("internals");
  const [windowMaximized, setWindowMaximized] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorDraft, setEditorDraft] = useState(createEmptyProjectDraft());
  const [editorSaving, setEditorSaving] = useState(false);

  const [loginOpen, setLoginOpen] = useState(false);
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [dragSourceId, setDragSourceId] = useState("");

  const historyRef = useRef(null);
  const consoleRef = useRef(null);
  const recognitionRef = useRef(null);
  const voiceEnabledRef = useRef(false);
  const voiceSpeakingRef = useRef(false);
  const voicePendingReplyRef = useRef(false);
  const voiceRestartTimerRef = useRef(null);
  const submitHandlerRef = useRef(null);

  const isAdmin = sessionAdmin;

  useEffect(() => {
    document.documentElement.dataset.model = activeModel;
  }, [activeModel]);

  useEffect(() => {
    if (activeModel !== "gemini") {
      setActiveModel("gemini");
    }
  }, [activeModel, setActiveModel]);

  useEffect(() => {
    voiceEnabledRef.current = voiceEnabled;
  }, [voiceEnabled]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch(apiPath("/bootstrap"), { credentials: "same-origin" });
        const data = await response.json();
        if (!alive) return;
        if (!response.ok) throw new Error(data.message || "Bootstrap failed");
        setAppTitle(data.appTitle || "TileOS");
        setProjects(sortProjects(data.projects || []));
        setMemory(data.memory || DEFAULT_MEMORY);
        setSessionAdmin(Boolean(data.session?.isAdmin));
        setAvailableModels(data.models || []);
        if (data.session?.isAdmin) {
          setLoginOpen(false);
        }
        setBoot({ loading: false, error: "" });
      } catch (error) {
        if (!alive) return;
        setBoot({ loading: false, error: error?.message || "Failed to load TileOS" });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const handler = (event) => {
      const data = event.data;
      if (!data || data.type !== "TILEOS_LOG" || !data.tileId) return;
      setTileLogs((previous) => {
        const next = { ...previous };
        const list = next[data.tileId] ? [...next[data.tileId]] : [];
        list.push({
          ts: data.ts || Date.now(),
          level: data.level || "log",
          msg: data.msg || "",
          meta: data.meta || null
        });
        next[data.tileId] = list.slice(-250);
        return next;
      });
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  useDebouncedEffect(
    () => {
      try {
        window.localStorage.setItem("tileos.tileLogs", JSON.stringify(tileLogs));
      } catch (error) {}
    },
    [tileLogs],
    50
  );

  useEffect(() => {
    const active = projects.find((project) => project.id === activeProjectId);
    if (!active && activeProjectId) {
      setActiveProjectId("");
      setWindowTab("internals");
    }
  }, [projects, activeProjectId]);

  useEffect(() => {
    if (!historyRef.current) return;
    historyRef.current.scrollTop = historyRef.current.scrollHeight;
  }, [chatHistory, sidebarCollapsed, sending]);

  useEffect(() => {
    if (!consoleRef.current) return;
    consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [tileLogs, activeProjectId, windowTab]);

  useEffect(() => {
    const SpeechRecognition = getSpeechRecognitionConstructor();
    if (!SpeechRecognition) {
      setVoiceSupported(false);
      setVoiceStatus("unsupported");
      return undefined;
    }

    setVoiceSupported(true);

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.lang = navigator.language || "en-US";

    const clearRestartTimer = () => {
      if (voiceRestartTimerRef.current) {
        clearTimeout(voiceRestartTimerRef.current);
        voiceRestartTimerRef.current = null;
      }
    };

    const scheduleRestart = (delay = 260) => {
      clearRestartTimer();
      voiceRestartTimerRef.current = window.setTimeout(() => {
        voiceRestartTimerRef.current = null;
        if (!voiceEnabledRef.current || voiceSpeakingRef.current || voicePendingReplyRef.current) return;
        try {
          recognition.start();
          setVoiceStatus("listening");
        } catch (error) {}
      }, delay);
    };

    const startVoiceListening = () => {
      if (!voiceEnabledRef.current || voiceSpeakingRef.current || voicePendingReplyRef.current) return false;
      clearRestartTimer();
      try {
        recognition.start();
        setVoiceError("");
        setVoiceStatus("listening");
        return true;
      } catch (error) {
        return false;
      }
    };

    recognition.onstart = () => {
      if (!voiceEnabledRef.current || voiceSpeakingRef.current) return;
      setVoiceStatus("listening");
      setVoiceError("");
    };

    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || "";
      const text = transcript.trim();
      if (!text) return;
      voicePendingReplyRef.current = true;
      setChatInput(text);
      if (submitHandlerRef.current) {
        submitHandlerRef.current(text, { source: "voice" });
      }
    };

    recognition.onerror = (event) => {
      if (!event || event.error === "aborted") return;
      if (event.error === "no-speech") {
        if (voiceEnabledRef.current && !voiceSpeakingRef.current) {
          scheduleRestart(300);
        }
        return;
      }

      const label = event.error ? `Voice error: ${event.error}` : "Voice error";
      setVoiceError(label);
      if (voiceEnabledRef.current && !voiceSpeakingRef.current) {
        setVoiceStatus("listening");
        scheduleRestart(600);
      } else {
        setVoiceStatus("idle");
      }
    };

    recognition.onend = () => {
      if (!voiceEnabledRef.current) {
        setVoiceStatus("idle");
        voicePendingReplyRef.current = false;
        voiceSpeakingRef.current = false;
        clearRestartTimer();
        return;
      }

      if (voiceSpeakingRef.current || voicePendingReplyRef.current) {
        return;
      }

      setVoiceStatus("listening");
      scheduleRestart(240);
    };

    recognitionRef.current = recognition;

    return () => {
      clearRestartTimer();
      try {
        recognition.abort();
      } catch (error) {}
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
      }
    };
  }, []);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) || null,
    [projects, activeProjectId]
  );

  const visibleProjects = useMemo(() => {
    const text = search.trim().toLowerCase();
    return sortProjects(projects).filter((project) => {
      if (categoryFilter !== "all" && project.category !== categoryFilter) return false;
      if (!text) return true;
      return projectSearchText(project).includes(text);
    });
  }, [projects, search, categoryFilter]);

  const stats = useMemo(() => {
    const published = projects.filter((project) => project.visibility === "published").length;
    const drafts = projects.filter((project) => project.visibility === "draft").length;
    return {
      total: projects.length,
      visible: visibleProjects.length,
      published,
      drafts,
      memoryFacts: memory?.facts?.length || 0,
      openLogs: activeProject ? (tileLogs[activeProject.id] || []).length : 0
    };
  }, [projects, visibleProjects, memory, activeProject, tileLogs]);

  const activeLogList = activeProject ? tileLogs[activeProject.id] || [] : [];
  const activeVoiceTone = VOICE_TONE_OPTIONS.includes(voiceTone) ? voiceTone : "Comedian";
  const activeVoiceGender = GENDER_OPTIONS.includes(voiceGender) ? voiceGender : "Male";
  const activeVoicePitchSemis = clamp(Number(voicePitchSemis) || 0, -12, 12);
  const activeCodeSource = useMemo(() => {
    if (!activeProject) return "";
    if (activeProject.files) {
      return serializeBundleText(activeProject.files, activeProject.entry || "index.html");
    }
    return String(activeProject.code || "");
  }, [activeProject]);

  const activeSrcDoc = useMemo(() => {
    if (!activeProject) return "";
    return buildTileSrcDoc(activeProject, activeProject.id);
  }, [activeProject?.id, activeProject?.updatedAt, activeProject?.code, activeProject?.entry, activeProject?.files]);

  useEffect(() => {
    if (!activeProject) return;
    if (windowMode === "edit") {
      setEditorDraft({
        id: activeProject.id,
        title: activeProject.title || "Untitled Tile",
        description: activeProject.description || "",
        category: activeProject.category || "web",
        tags: Array.isArray(activeProject.tags) ? activeProject.tags.join(", ") : "",
        mode: activeProject.files ? "bundle" : "single",
        entry: activeProject.entry || "index.html",
        code: activeProject.files
          ? serializeBundleText(activeProject.files, activeProject.entry || "index.html")
          : String(activeProject.code || "")
      });
    }
  }, [activeProject?.id, windowMode]);

  const clearVoiceRestartTimer = () => {
    if (voiceRestartTimerRef.current) {
      clearTimeout(voiceRestartTimerRef.current);
      voiceRestartTimerRef.current = null;
    }
  };

  const stopVoiceChat = () => {
    clearVoiceRestartTimer();
    voicePendingReplyRef.current = false;
    voiceSpeakingRef.current = false;
    setVoiceError("");
    setVoiceStatus("idle");
    try {
      recognitionRef.current?.abort();
    } catch (error) {}
    try {
      window.speechSynthesis?.cancel();
    } catch (error) {}
  };

  const startVoiceChat = () => {
    if (!voiceEnabledRef.current) {
      return false;
    }

    if (!voiceSupported) {
      setVoiceError("Voice input is not supported in this browser.");
      setVoiceStatus("unsupported");
      return false;
    }

    const recognition = recognitionRef.current;
    if (!recognition) return false;

    voicePendingReplyRef.current = false;
    voiceSpeakingRef.current = false;
    setVoiceError("");
    clearVoiceRestartTimer();
    try {
      recognition.start();
      setVoiceStatus("listening");
      return true;
    } catch (error) {
      setVoiceError(error?.message ? `Voice start failed: ${error.message}` : "Voice start failed.");
      setVoiceStatus("idle");
      return false;
    }
  };

  const speakAssistantReply = async (text) => {
    const message = String(text || "").trim();
    if (!message) {
      voicePendingReplyRef.current = false;
      if (voiceEnabledRef.current) {
        setVoiceStatus("listening");
        clearVoiceRestartTimer();
        voiceRestartTimerRef.current = window.setTimeout(() => {
          voiceRestartTimerRef.current = null;
          startVoiceChat();
        }, 240);
      }
      return false;
    }

    const speech = window.speechSynthesis;
    const Utterance = window.SpeechSynthesisUtterance;
    if (!speech || !Utterance) {
      voicePendingReplyRef.current = false;
      if (voiceEnabledRef.current) {
        setVoiceStatus("listening");
        clearVoiceRestartTimer();
        voiceRestartTimerRef.current = window.setTimeout(() => {
          voiceRestartTimerRef.current = null;
          startVoiceChat();
        }, 240);
      }
      return false;
    }

    clearVoiceRestartTimer();
    try {
      speech.cancel();
    } catch (error) {}

    return await new Promise((resolve) => {
      const utterance = new Utterance(message);
      const voice = pickPreferredVoice(
        speech.getVoices?.() || [],
        navigator.language || "en-US",
        activeVoiceGender
      );
      if (voice) utterance.voice = voice;
      utterance.rate = 1;
      utterance.pitch = clamp(Math.pow(2, activeVoicePitchSemis / 12), 0.5, 2);
      utterance.volume = 1;

      utterance.onstart = () => {
        voiceSpeakingRef.current = true;
        setVoiceStatus("speaking");
      };

      utterance.onend = () => {
        voiceSpeakingRef.current = false;
        voicePendingReplyRef.current = false;
        if (voiceEnabledRef.current) {
          setVoiceStatus("listening");
          clearVoiceRestartTimer();
          voiceRestartTimerRef.current = window.setTimeout(() => {
            voiceRestartTimerRef.current = null;
            startVoiceChat();
          }, 260);
        } else {
          setVoiceStatus("idle");
        }
        resolve(true);
      };

      utterance.onerror = () => {
        voiceSpeakingRef.current = false;
        voicePendingReplyRef.current = false;
        if (voiceEnabledRef.current) {
          setVoiceStatus("listening");
          clearVoiceRestartTimer();
          voiceRestartTimerRef.current = window.setTimeout(() => {
            voiceRestartTimerRef.current = null;
            startVoiceChat();
          }, 260);
        } else {
          setVoiceStatus("idle");
        }
        resolve(false);
      };

      speech.speak(utterance);
    });
  };

  const refreshState = async () => {
    const response = await fetch(apiPath("/bootstrap"), { credentials: "same-origin" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Failed to refresh");
    setAppTitle(data.appTitle || "TileOS");
    setProjects(sortProjects(data.projects || []));
    setMemory(data.memory || DEFAULT_MEMORY);
    setSessionAdmin(Boolean(data.session?.isAdmin));
    setAvailableModels(data.models || []);
  };

  const openProject = (project, mode = "preview") => {
    setActiveProjectId(project.id);
    setWindowMode(mode);
    setWindowTab("internals");
    setWindowMaximized(false);
  };

  const openEditor = (project = null) => {
    if (project && !project.canEdit && !isAdmin) {
      return;
    }
    if (project) {
      const code = project.files
        ? serializeBundleText(project.files, project.entry || "index.html")
        : String(project.code || "");
      setEditorDraft({
        id: project.id,
        title: project.title || "Untitled Tile",
        description: project.description || "",
        category: project.category || "web",
        tags: Array.isArray(project.tags) ? project.tags.join(", ") : "",
        mode: project.files ? "bundle" : "single",
        entry: project.entry || "index.html",
        code
      });
    } else {
      setEditorDraft(createEmptyProjectDraft());
    }
    setEditorOpen(true);
  };

  const publishProject = async (project) => {
    if (!isAdmin) return;
    const response = await fetch(apiPath(`/projects/${encodeURIComponent(project.id)}/publish`), {
      method: "POST",
      credentials: "same-origin"
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Publish failed");
    setProjects(sortProjects(data.projects || []));
    await refreshState().catch(() => {});
  };

  const unpublishProject = async (project) => {
    if (!isAdmin) return;
    const response = await fetch(apiPath(`/projects/${encodeURIComponent(project.id)}/unpublish`), {
      method: "POST",
      credentials: "same-origin"
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Unpublish failed");
    setProjects(sortProjects(data.projects || []));
    await refreshState().catch(() => {});
  };

  const handleLogin = async () => {
    setLoginError("");
    try {
      const response = await fetch(apiPath("/auth/login"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: loginPassword })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Login failed");
      setSessionAdmin(true);
      setLoginOpen(false);
      setLoginPassword("");
      await refreshState().catch(() => {});
    } catch (error) {
      setLoginError(error?.message || "Login failed");
    }
  };

  const handleLogout = async () => {
    await fetch(apiPath("/auth/logout"), {
      method: "POST",
      credentials: "same-origin"
    });
    setSessionAdmin(false);
    setLoginOpen(false);
    await refreshState().catch(() => {});
  };

  const saveEditorDraft = async () => {
    const existingProject = editorDraft.id
      ? projects.find((project) => project.id === editorDraft.id) || null
      : null;
    if (existingProject && !existingProject.canEdit && !isAdmin) return;
    setEditorSaving(true);
    try {
      const tags = normalizeTagsInput(editorDraft.tags);
      const payload = {
        title: editorDraft.title.trim() || "Untitled Tile",
        description: editorDraft.description.trim(),
        category: editorDraft.category,
        tags,
        entry: editorDraft.entry || "index.html"
      };

      if (editorDraft.mode === "bundle") {
        const bundleText = editorDraft.code.trim();
        const files = parseBundleText(bundleText);
        payload.code = bundleText || defaultBundleText(payload.title);
        if (Object.keys(files).length) {
          payload.files = files;
        } else if (!bundleText) {
          payload.files = parseBundleText(defaultBundleText(payload.title));
        }
      } else {
        payload.code = editorDraft.code.trim() || defaultSingleFileCode(payload.title);
      }

      const response = await fetch(
        editorDraft.id ? apiPath(`/projects/${encodeURIComponent(editorDraft.id)}`) : apiPath("/projects"),
        {
          method: editorDraft.id ? "PUT" : "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Save failed");
      setProjects(sortProjects(data.projects || []));
      if (data.project?.id) {
        setActiveProjectId(data.project.id);
        setWindowMode("preview");
      }
      setEditorOpen(false);
      await refreshState().catch(() => {});
    } catch (error) {
      setChatHistory((previous) => [
        ...previous,
        { role: "assistant", text: `Save failed: ${error?.message || "unknown error"}` }
      ]);
    } finally {
      setEditorSaving(false);
    }
  };

  const saveActiveProjectCode = async () => {
    if (!activeProject || (!activeProject.canEdit && !isAdmin)) return;
    const payload = {
      title: activeProject.title,
      description: activeProject.description || "",
      category: activeProject.category || "web",
      tags: Array.isArray(activeProject.tags) ? activeProject.tags : [],
      entry: activeProject.entry || "index.html",
      code: activeProject.code || ""
    };
    if (activeProject.files && Object.keys(activeProject.files).length > 0) {
      payload.files = activeProject.files;
      payload.code = serializeBundleText(activeProject.files, activeProject.entry || "index.html");
    } else if (/^===\s*.+?\s*===/m.test(payload.code)) {
      payload.files = parseBundleText(payload.code);
    }
    const response = await fetch(apiPath(`/projects/${encodeURIComponent(activeProject.id)}`), {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Save failed");
    setProjects(sortProjects(data.projects || []));
    await refreshState().catch(() => {});
  };

  const deleteProject = async (project) => {
    if (!isAdmin) return;
    const ok = window.confirm(`Delete "${project.title}"?`);
    if (!ok) return;
    const response = await fetch(apiPath(`/projects/${encodeURIComponent(project.id)}`), {
      method: "DELETE",
      credentials: "same-origin"
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Delete failed");
    setProjects(sortProjects(data.projects || []));
    if (activeProjectId === project.id) {
      setActiveProjectId("");
    }
    await refreshState().catch(() => {});
  };

  const reorderProjects = async (nextProjects) => {
    setProjects(sortProjects(nextProjects));
    const response = await fetch(apiPath("/projects/reorder"), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: nextProjects.map((project) => project.id) })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Reorder failed");
    setProjects(sortProjects(data.projects || []));
    await refreshState().catch(() => {});
  };

  const handleChatSubmit = async (overrideText = "") => {
    const text = String(overrideText || chatInput).trim();
    const attachment = chatImage;
    if (!text && !attachment) return;

    if (!attachment && text.toLowerCase() === "clear") {
      setChatHistory([]);
      setChatInput("");
      setChatImage(null);
      setSending(false);
      if (voiceEnabledRef.current) {
        voicePendingReplyRef.current = false;
        setVoiceStatus("listening");
        clearVoiceRestartTimer();
        voiceRestartTimerRef.current = window.setTimeout(() => {
          voiceRestartTimerRef.current = null;
          startVoiceChat();
        }, 320);
      }
      return;
    }

    const voiceCallActive = voiceEnabledRef.current;
    if (voiceCallActive) {
      voicePendingReplyRef.current = true;
      clearVoiceRestartTimer();
      setVoiceStatus("thinking");
      try {
        recognitionRef.current?.abort();
      } catch (error) {}
    }

    const userMessage = {
      role: "user",
      text,
      image: attachment?.dataUrl || ""
    };
    setChatHistory((previous) => [...previous, userMessage]);
    setChatInput("");
    setChatImage(null);
    setSending(true);

    try {
      const response = await fetch(apiPath("/chat"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          model: "gemini",
          activeProjectId: activeProjectId || "",
          image: attachment || null,
          tone: activeVoiceTone,
          voiceGender: activeVoiceGender,
          voicePitchSemis: activeVoicePitchSemis
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Chat failed");

      const assistantText = data.reply || "Done.";
      setChatHistory((previous) => [
        ...previous,
        {
          role: "assistant",
          text: assistantText
        }
      ]);

      if (data.projects) {
        setProjects(sortProjects(data.projects));
      }
      if (data.memory) {
        setMemory(data.memory);
      }
      if (data.focusProjectId) {
        setActiveProjectId(data.focusProjectId);
        setWindowMode(data.action === "update" ? "edit" : "preview");
      }

      if (voiceEnabledRef.current) {
        setSending(false);
        await speakAssistantReply(assistantText);
      }
    } catch (error) {
      setChatHistory((previous) => [
        ...previous,
        {
          role: "assistant",
          text: `Kernel error: ${error?.message || "could not reach TileOS core"}`
        }
      ]);
      if (voiceEnabledRef.current) {
        voicePendingReplyRef.current = false;
        setVoiceStatus("listening");
        clearVoiceRestartTimer();
        voiceRestartTimerRef.current = window.setTimeout(() => {
          voiceRestartTimerRef.current = null;
          startVoiceChat();
        }, 320);
      }
    } finally {
      setSending(false);
      await refreshState().catch(() => {});
    }
  };

  useEffect(() => {
    submitHandlerRef.current = handleChatSubmit;
  }, [handleChatSubmit]);

  const toggleVoiceChat = () => {
    if (voiceEnabledRef.current) {
      voiceEnabledRef.current = false;
      setVoiceEnabled(false);
      stopVoiceChat();
      return;
    }

    if (!voiceSupported) {
      setVoiceError("Voice input is not supported in this browser.");
      setVoiceStatus("unsupported");
      return;
    }

    voiceEnabledRef.current = true;
    setVoiceEnabled(true);
    setVoiceError("");
    if (!startVoiceChat()) {
      voiceEnabledRef.current = false;
      setVoiceEnabled(false);
    }
  };

  const handleProjectDrop = async (sourceId, targetId) => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const nextProjects = moveItem(projects, sourceId, targetId);
    await reorderProjects(nextProjects);
  };

  const renderProjectCard = (project) => {
    const lastUpdated = formatRelativeDate(project.updatedAt || project.createdAt);
    const logs = tileLogs[project.id] || [];
    const lastLog = logs[logs.length - 1];
    const hasError = lastLog?.level === "error";
    const hasWarn = lastLog?.level === "warn";
    const visibilityLabel = projectVisibilityLabel(project);

    return html`
      <article
        className=${`tile ${dragSourceId === project.id ? "is-dragging" : ""}`}
        draggable=${Boolean(project.canReorder)}
        onDragStart=${() => setDragSourceId(project.id)}
        onDragEnd=${() => setDragSourceId("")}
        onDragOver=${(event) => {
          if (project.canReorder) event.preventDefault();
        }}
        onDrop=${(event) => {
          if (!project.canReorder) return;
          event.preventDefault();
          handleProjectDrop(dragSourceId, project.id);
          setDragSourceId("");
        }}
        onClick=${() => openProject(project, "preview")}
        onDblClick=${() => {
          if (project.canEdit || isAdmin) openEditor(project);
        }}
      >
        <div className="tile__glow"></div>
        <div className="tile__header">
          <div className="tile__badge">${projectAccentBadge(project)}</div>
          <div className="tile__actions">
            <button
              className="tile__action"
              title="Open"
              onClick=${(event) => {
                event.stopPropagation();
                openProject(project, "preview");
              }}
              >
                ↗
              </button>
            ${project.canEdit
              ? html`
                  <button
                    className="tile__action"
                    title="Edit"
                    onClick=${(event) => {
                      event.stopPropagation();
                      openEditor(project);
                    }}
                    >
                      ✎
                    </button>
                `
              : null}
            ${project.canPublish
              ? html`
                  <button
                    className="tile__action"
                    title="Publish"
                    onClick=${(event) => {
                      event.stopPropagation();
                      publishProject(project).catch((error) => {
                        setChatHistory((previous) => [
                          ...previous,
                          { role: "assistant", text: `Publish failed: ${error?.message || "unknown error"}` }
                        ]);
                      });
                    }}
                  >
                    ↑
                  </button>
                `
              : null}
            ${project.canUnpublish
              ? html`
                  <button
                    className="tile__action"
                    title="Unpublish"
                    onClick=${(event) => {
                      event.stopPropagation();
                      unpublishProject(project).catch((error) => {
                        setChatHistory((previous) => [
                          ...previous,
                          { role: "assistant", text: `Unpublish failed: ${error?.message || "unknown error"}` }
                        ]);
                      });
                    }}
                  >
                    ↓
                  </button>
                `
              : null}
            ${project.canDelete
              ? html`
                  <button
                    className="tile__action"
                    title="Delete"
                    onClick=${(event) => {
                      event.stopPropagation();
                      deleteProject(project).catch((error) => {
                        setChatHistory((previous) => [
                          ...previous,
                          {
                            role: "assistant",
                            text: `Delete failed: ${error?.message || "unknown error"}`
                          }
                        ]);
                      });
                    }}
                  >
                    ×
                  </button>
                `
              : null}
          </div>
        </div>
        <h3 className="tile__title">${project.title}</h3>
        <p className="tile__description">${truncate(project.description || "A live tile ready to preview, edit, and deploy.", 150)}</p>
        <div className="tile__footer">
          <div className="tile__tags">
            <span className="tile__tag tile__tag--visibility">${visibilityLabel}</span>
            ${(project.tags || []).slice(0, 3).map(
              (tag) => html`<span className="tile__tag" key=${tag}>${tag}</span>`
            )}
          </div>
          <div className="tile__indicator">
            <span>${hasError ? "error" : hasWarn ? "warn" : visibilityLabel}</span>
            <span>${lastUpdated}</span>
          </div>
        </div>
      </article>
    `;
  };

  const selectedLogList = activeProject ? tileLogs[activeProject.id] || [] : [];

  if (boot.loading) {
    return html`
      <div className="shell" style="align-items:center;justify-content:center;">
        <div className="hero__panel" style="width:min(760px,92vw);text-align:left;">
          <div className="hero__label">Booting</div>
          <div className="hero__value">TileOS is warming up.</div>
          <div className="hero__caption">Loading the private portfolio OS and restoring the project library.</div>
        </div>
      </div>
    `;
  }

  if (boot.error) {
    return html`
      <div className="shell" style="align-items:center;justify-content:center;">
        <div className="hero__panel" style="width:min(760px,92vw);text-align:left;">
          <div className="hero__label">Startup error</div>
          <div className="hero__value">TileOS could not boot.</div>
          <div className="hero__caption">${boot.error}</div>
        </div>
      </div>
    `;
  }

  return html`
    <div className="shell">
      <aside className=${`sidebar ${sidebarCollapsed ? "is-collapsed" : ""}`}>
        <button
          className="sidebar__collapse"
          type="button"
          title=${sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick=${() => setSidebarCollapsed((value) => !value)}
        >
          ${sidebarCollapsed ? "›" : "‹"}
        </button>
        <div className="sidebar__top">
          <div className="brand">
            <div className="brand__mark">T</div>
            <div className="brand__text">
              <div className="brand__name">${appTitle}</div>
              <div className="brand__tagline">Glassmorphic portfolio OS</div>
            </div>
          </div>
          <div className="model-selector">
            <button
              className="model-chip is-active"
              type="button"
              title="Gemini is the only active assistant"
            >
              Gemini
            </button>
          </div>
          <div className="hint-line">
            Gemini is the only active assistant. Everyone can create tiles; admin login unlocks edit and delete controls.
          </div>
        </div>

        <div className="sidebar__section">
          <div className="voice-panel">
            <button
              className="voice-panel__header"
              type="button"
              aria-expanded=${voicePanelOpen}
              onClick=${() => setVoicePanelOpen((value) => !value)}
            >
              <div className="voice-panel__header-copy">
                <div className="voice-panel__title">Voice & Personality</div>
                <div className="voice-panel__summary">
                  ${activeVoiceTone} • ${activeVoiceGender} • ${activeVoicePitchSemis >= 0 ? "+" : ""}${activeVoicePitchSemis}
                </div>
              </div>
              <div className="voice-panel__chevron">${voicePanelOpen ? "⌃" : "⌄"}</div>
            </button>

            ${voicePanelOpen
              ? html`
                  <div className="voice-panel__body">
                    <div className="voice-panel__field">
                      <div className="voice-panel__label">Tone</div>
                      <select
                        className="voice-panel__select"
                        value=${activeVoiceTone}
                        onChange=${(event) => setVoiceTone(event.currentTarget.value)}
                      >
                        ${VOICE_TONE_OPTIONS.map(
                          (tone) => html`<option value=${tone}>${tone}</option>`
                        )}
                      </select>
                      <div className="voice-panel__note">
                        Note: Dog/Cat/Alien intentionally produce unreadable outputs.
                      </div>
                    </div>

                    <div className="voice-panel__field">
                      <div className="voice-panel__label">Voice</div>
                      <div className="voice-panel__gender-row">
                        ${GENDER_OPTIONS.map(
                          (gender) => html`
                            <button
                              className=${`voice-panel__gender-option ${activeVoiceGender === gender ? "is-active" : ""}`}
                              type="button"
                              onClick=${() => setVoiceGender(gender)}
                            >
                              <span className="voice-panel__gender-radio" aria-hidden="true"></span>
                              <span>${gender}</span>
                            </button>
                          `
                        )}
                      </div>
                    </div>

                    <div className="voice-panel__field">
                      <div className="voice-panel__label">Pitch</div>
                      <input
                        className="voice-panel__range"
                        type="range"
                        min="-12"
                        max="12"
                        step="1"
                        value=${activeVoicePitchSemis}
                        onInput=${(event) => setVoicePitchSemis(Number(event.currentTarget.value))}
                      />
                      <div className="voice-panel__range-row">
                        <span>-12</span>
                        <span>${activeVoicePitchSemis}</span>
                        <span>+12</span>
                      </div>
                      <div className="voice-panel__note">
                        Pitch is applied at playback, so it stays reliable even when the browser voice engine is picky.
                      </div>
                    </div>
                  </div>
                `
              : null}
          </div>
        </div>

        <div className="sidebar__section">
          <div className="sidebar__section-label">Recent Sessions</div>
        </div>

        <div className="chat">
          <div className="chat__history" ref=${historyRef}>
            ${chatHistory.map(
              (message, index) => html`
                <div className=${`message ${message.role === "user" ? "message--user" : "message--assistant"}`}>
                  <div className="message__meta">
                    <span>${message.role}</span>
                    <span>${index === chatHistory.length - 1 ? "latest" : ""}</span>
                  </div>
                  ${message.image
                    ? html`
                        <div className="message__attachment">
                          <img src=${message.image} alt="attachment" />
                        </div>
                      `
                    : null}
                  <div className="message__bubble">${message.text}</div>
                </div>
              `
            )}
            ${sending
              ? html`
                  <div className="message">
                    <div className="message__meta">
                      <span>assistant</span>
                      <span>thinking</span>
                    </div>
                    <div className="message__bubble">Thinking...</div>
                  </div>
                `
              : null}
          </div>

          <div className="composer">
            <div className="composer__row">
              <input
                id="tileos-image-input"
                type="file"
                accept="image/*"
                hidden
                onChange=${(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    setChatImage({
                      name: file.name,
                      mime: file.type || "image/png",
                      dataUrl: String(reader.result || "")
                    });
                  };
                  reader.readAsDataURL(file);
                }}
              />
              <button
                className="icon-button"
                type="button"
                title="Attach an image"
                onClick=${() => document.getElementById("tileos-image-input")?.click()}
              >
                +
              </button>
              <textarea
                className="composer__field"
                value=${chatInput}
                placeholder=${voiceEnabled
                  ? voiceStatus === "speaking"
                    ? "Assistant speaking..."
                    : voiceStatus === "thinking"
                    ? "Thinking..."
                    : voiceStatus === "listening"
                    ? "Listening..."
                    : "Voice call ready..."
                  : "Message TileOS..."}
                rows="2"
                onInput=${(event) => setChatInput(event.currentTarget.value)}
                onKeyDown=${(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    handleChatSubmit();
                  }
                }}
              ></textarea>
              <div className="composer__actions">
                <button
                  className=${`icon-button ${voiceEnabled ? "is-active" : ""}`}
                  type="button"
                  title=${voiceSupported
                    ? voiceEnabled
                      ? "End voice call"
                      : "Start voice call"
                    : "Voice input is not supported in this browser"}
                  aria-pressed=${voiceEnabled}
                  disabled=${!voiceSupported}
                  onClick=${toggleVoiceChat}
                >
                  ◉
                </button>
                <button
                  className=${`icon-button ${sending ? "is-active" : ""}`}
                  type="button"
                  title="Send message"
                  onClick=${handleChatSubmit}
                >
                  ↗
                </button>
              </div>
            </div>

            ${chatImage
              ? html`
                  <div className="composer__preview">
                    <div className="composer__preview-chip">
                      <span>Image attached</span>
                      <button
                        className="toolbar-button is-muted"
                        type="button"
                        onClick=${() => setChatImage(null)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                `
              : null}

            ${voiceEnabled || voiceError
              ? html`
                  <div className="composer__voice-line">
                    <div className=${`composer__voice-chip ${voiceEnabled ? "is-live" : ""}`}>
                      <span className="composer__voice-dot"></span>
                      <span>
                        ${voiceStatus === "listening"
                          ? "Listening"
                          : voiceStatus === "speaking"
                          ? "Speaking"
                          : voiceStatus === "thinking"
                          ? "Thinking"
                          : voiceStatus === "unsupported"
                          ? "Unsupported"
                          : "Voice on"}
                      </span>
                    </div>
                    ${voiceError
                      ? html`<div className="composer__voice-error">${voiceError}</div>`
                      : null}
                  </div>
                `
              : null}
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="workspace__topbar">
          <div className="workspace__title">
            <div className="workspace__kicker">Portfolio OS</div>
            <div className="workspace__headline">Live tiles, personal drafts, and a curated public showcase.</div>
            <div className="workspace__subtext">
              Anyone can generate tiles here. Your drafts stay in your workspace until an admin publishes them into the shared showcase.
            </div>
          </div>

            <div className="workspace__actions">
              <div className="search">
                <span className="search__icon">⌕</span>
                <input
                  className="search__input"
                value=${search}
                placeholder="Search projects..."
                onInput=${(event) => setSearch(event.currentTarget.value)}
              />
              </div>
              <button className="toolbar-button" type="button" onClick=${refreshState}>Refresh</button>
              <button className="toolbar-button is-primary" type="button" onClick=${() => openEditor()}>
                New Tile
              </button>
              ${isAdmin
                ? html`
                    <button className="toolbar-button" type="button" onClick=${handleLogout}>
                      Logout
                    </button>
                  `
                : html`
                    <button className="toolbar-button" type="button" onClick=${() => setLoginOpen(true)}>
                      Admin Login
                    </button>
                  `}
            </div>
          </header>

        <div className="workspace__content">
          <section className="hero">
            <div className="hero__panel">
              <div className="hero__label">Workspace</div>
              <div className="hero__value">${stats.published} published tiles</div>
              <div className="hero__caption">
                ${stats.drafts} draft tile${stats.drafts === 1 ? "" : "s"} are currently visible in this workspace. Open a tile to inspect its internals and console output.
              </div>
              <div className="hero__mini-grid" style="margin-top:16px;">
                <div className="hero__mini">
                  <div className="hero__mini-number">${stats.visible}</div>
                  <div className="hero__mini-label">Visible tiles</div>
                </div>
                <div className="hero__mini">
                  <div className="hero__mini-number">${stats.drafts}</div>
                  <div className="hero__mini-label">Drafts</div>
                </div>
              </div>
            </div>
            <div className="hero__panel hero__panel--stats">
              <div>
                <div className="hero__label">Selected model</div>
                <div className="hero__value">${modelLabel(activeModel)}</div>
                <div className="hero__caption">
                  The selector changes the visual accent and the chat personality, while secrets remain on the server.
                </div>
              </div>
              <div className="hero__mini-grid">
                <div className="hero__mini">
                  <div className="hero__mini-number">${sessionAdmin ? "Admin" : "Viewer"}</div>
                  <div className="hero__mini-label">Mode</div>
                </div>
                <div className="hero__mini">
                  <div className="hero__mini-number">${stats.memoryFacts}</div>
                  <div className="hero__mini-label">Memory facts</div>
                </div>
                <div className="hero__mini">
                  <div className="hero__mini-number">${stats.openLogs}</div>
                  <div className="hero__mini-label">Console lines</div>
                </div>
              </div>
            </div>
          </section>

          <section className="section">
            <div className="section__header">
              <div>
                <div className="section__title">Project Library</div>
                <div className="section__meta">
                  Published tiles are shared with everyone. Drafts belong to the current workspace until an admin publishes them.
                </div>
              </div>
              <div className="workspace__filters">
                ${["all", "web", "mobile", "ai"].map(
                  (filter) => html`
                    <button
                      className=${`pill-button ${categoryFilter === filter ? "is-active" : ""}`}
                      type="button"
                      onClick=${() => setCategoryFilter(filter)}
                    >
                      ${titleCase(filter)}
                    </button>
                  `
                )}
              </div>
            </div>

            ${visibleProjects.length
              ? html`
                  <div className="project-grid">
                    ${visibleProjects.map((project) => renderProjectCard(project))}
                  </div>
                `
              : html`
                  <div className="empty-state">
                    No tiles match your filters.
                  </div>
                `}
          </section>
        </div>
      </main>

      ${activeProject
        ? html`
            <div
              className="glass-window"
              style=${windowMaximized ? "inset:0;border-radius:0;" : ""}
            >
              <header className="glass-window__header">
                <div className="window__traffic">
                  <button className="close" type="button" title="Close" onClick=${() => setActiveProjectId("")}></button>
                  <button className="minimize" type="button" title="Toggle inspector" onClick=${() => {
                    setWindowTab((current) => (current === "console" ? "internals" : "console"));
                  }}></button>
                  <button className="maximize" type="button" title="Toggle maximize" onClick=${() => setWindowMaximized((value) => !value)}></button>
                </div>

                <div className="window__address">
                  <div className="window__address-pill">
                    <span>tileos://</span>
                    <strong>${slugify(activeProject.title)}</strong>
                    <span style="color:rgba(255,255,255,0.38);">·</span>
                    <span style="color:rgba(255,255,255,0.62);">${activeProject.category}</span>
                  </div>
                </div>

                <div style="display:flex;gap:8px;align-items:center;">
                  ${activeProject.canEdit
                    ? html`
                        <button
                          className="toolbar-button"
                          type="button"
                            onClick=${() => openEditor(activeProject)}
                        >
                          Edit Tile
                        </button>
                      `
                    : null}
                  <button
                    className="toolbar-button"
                    type="button"
                    onClick=${refreshState}
                  >
                    Refresh
                  </button>
                </div>
              </header>

              <div className="window__body">
                <div className="window__preview">
                  <iframe
                    className="window__iframe"
                    key=${`${activeProject.id}-${activeProject.updatedAt}-${activeProject.code?.length || 0}`}
                    srcDoc=${activeSrcDoc}
                    sandbox="allow-scripts allow-forms allow-modals allow-popups"
                    title=${activeProject.title}
                    onLoad=${() => {
                      setTileLogs((previous) => {
                        const next = { ...previous };
                        const list = next[activeProject.id] ? [...next[activeProject.id]] : [];
                        list.push({
                          ts: Date.now(),
                          level: "log",
                          msg: `[IFRAME] Loaded ${activeProject.title}`
                        });
                        next[activeProject.id] = list.slice(-250);
                        return next;
                      });
                    }}
                  ></iframe>
                </div>

                <aside className="window__inspector">
                  <div className="window__tabs">
                    <button
                      className=${`window__tab ${windowTab === "internals" ? "is-active" : ""}`}
                      type="button"
                      onClick=${() => setWindowTab("internals")}
                    >
                      Internals
                    </button>
                    <button
                      className=${`window__tab ${windowTab === "console" ? "is-active" : ""}`}
                      type="button"
                      onClick=${() => setWindowTab("console")}
                    >
                      Console
                    </button>
                    <button
                      className=${`window__tab ${windowTab === "details" ? "is-active" : ""}`}
                      type="button"
                      onClick=${() => setWindowTab("details")}
                    >
                      Details
                    </button>
                  </div>

                  <div className="window__panel">
                    ${windowTab === "internals"
                      ? html`
                          <div className="window__internals">
                            <textarea
                              className="window__textarea"
                              readOnly=${!activeProject.canEdit && !isAdmin}
                              value=${activeCodeSource}
                              onInput=${async (event) => {
                                if (!activeProject.canEdit && !isAdmin) return;
                                const nextCode = event.currentTarget.value;
                                setProjects((current) =>
                                  current.map((project) =>
                                    project.id === activeProject.id
                                      ? project.files
                                        ? (() => {
                                            const parsedFiles = parseBundleText(nextCode);
                                            return {
                                              ...project,
                                              code: nextCode,
                                              files: Object.keys(parsedFiles).length ? parsedFiles : undefined,
                                              updatedAt: new Date().toISOString()
                                            };
                                          })()
                                        : {
                                            ...project,
                                            code: nextCode,
                                            updatedAt: new Date().toISOString()
                                          }
                                      : project
                                  )
                                );
                              }}
                            ></textarea>
                            <div className="hint-line" style="margin-top:10px;">
                              ${activeProject.canEdit || isAdmin
                                ? "Edit the code here and use the save button in the editor modal for metadata changes."
                                : "Read-only internals view. Published showcase tiles require admin mode for live edits."}
                            </div>
                          </div>
                        `
                      : null}

                    ${windowTab === "console"
                      ? html`
                          <div className="window__console" ref=${consoleRef}>
                            ${selectedLogList.length
                              ? selectedLogList.map(
                                  (logItem, index) => html`
                                    <div className=${`window__console-item level-${logItem.level || "log"}`}>
                                      ${formatConsoleMessage(logItem)}
                                    </div>
                                  `
                                )
                              : html`
                                  <div className="empty-state" style="margin:0;">
                                    No logs yet. Open the tile or interact with it to collect console output.
                                  </div>
                                `}
                          </div>
                        `
                      : null}

                    ${windowTab === "details"
                      ? html`
                          <div className="window__internals">
                            <div className="window__details">
                              <div className="window__detail">
                                <div className="window__detail-label">Title</div>
                                <div className="window__detail-value">${activeProject.title}</div>
                              </div>
                              <div className="window__detail">
                                <div className="window__detail-label">Description</div>
                                <div className="window__detail-value">${activeProject.description || "No description provided."}</div>
                              </div>
                              <div className="window__detail">
                                <div className="window__detail-label">Category</div>
                                <div className="window__detail-value">${activeProject.category}</div>
                              </div>
                              <div className="window__detail">
                                <div className="window__detail-label">Visibility</div>
                                <div className="window__detail-value">${projectVisibilityLabel(activeProject)}</div>
                              </div>
                              <div className="window__detail">
                                <div className="window__detail-label">Updated</div>
                                <div className="window__detail-value">${formatDate(activeProject.updatedAt || activeProject.createdAt)}</div>
                              </div>
                              <div className="window__detail">
                                <div className="window__detail-label">Tags</div>
                                <div className="window__detail-value">
                                  ${(activeProject.tags || []).join(", ") || "No tags yet."}
                                </div>
                              </div>
                              <div className="window__detail">
                                <div className="window__detail-label">Source mode</div>
                                <div className="window__detail-value">
                                  ${activeProject.files ? "Folder bundle" : "Single-file React / HTML"}
                                </div>
                              </div>
                            </div>
                          </div>
                        `
                      : null}
                  </div>

                  <div className="window__footer">
                    <div className="status">
                      <span className="status__dot"></span>
                      <span>${activeProject.files ? "Bundle aware" : "Single-file runtime"}</span>
                    </div>
                    <div style="display:flex;gap:8px;align-items:center;">
                      ${activeProject.canPublish
                        ? html`
                            <button
                              className="toolbar-button"
                              type="button"
                              onClick=${() =>
                                publishProject(activeProject).catch((error) => {
                                  setChatHistory((previous) => [
                                    ...previous,
                                    { role: "assistant", text: `Publish failed: ${error?.message || "unknown error"}` }
                                  ]);
                                })}
                            >
                              Publish
                            </button>
                          `
                        : null}
                      ${activeProject.canUnpublish
                        ? html`
                            <button
                              className="toolbar-button"
                              type="button"
                              onClick=${() =>
                                unpublishProject(activeProject).catch((error) => {
                                  setChatHistory((previous) => [
                                    ...previous,
                                    { role: "assistant", text: `Unpublish failed: ${error?.message || "unknown error"}` }
                                  ]);
                                })}
                            >
                              Unpublish
                            </button>
                          `
                        : null}
                      ${(activeProject.canEdit || isAdmin) && windowTab === "internals"
                        ? html`
                            <button className="toolbar-button is-primary" type="button" onClick=${saveActiveProjectCode}>
                              Save Code
                            </button>
                          `
                        : null}
                      ${activeProject.canEdit
                        ? html`
                            <button
                              className="toolbar-button"
                              type="button"
                              onClick=${() => openEditor(activeProject)}
                            >
                              Open Studio
                            </button>
                          `
                        : null}
                      <button className="toolbar-button" type="button" onClick=${() => setActiveProjectId("")}>
                        Close
                      </button>
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          `
        : null}

      ${editorOpen
        ? html`
            <div className="modal">
              <div className="modal__shell">
                <div className="editor__header">
                  <div className="editor__title">
                    <strong>${editorDraft.id ? "Edit Tile" : "Create Tile"}</strong>
                    <span>Build drafts in your workspace here. Admin can later publish finished tiles into the shared showcase.</span>
                  </div>
                  <div className="modal__title">Tile Studio</div>
                </div>

                <div className="modal__body">
                  <section className="editor">
                    <div className="editor__body">
                      <div className="editor__grid">
                        <div className="editor__field">
                          <div className="editor__label">Title</div>
                          <input
                            className="editor__input"
                            value=${editorDraft.title}
                            onInput=${(event) =>
                              setEditorDraft((previous) => ({ ...previous, title: event.currentTarget.value }))}
                          />
                        </div>

                        <div className="editor__field">
                          <div className="editor__label">Description</div>
                          <textarea
                            className="editor__textarea"
                            style="min-height:110px;"
                            value=${editorDraft.description}
                            onInput=${(event) =>
                              setEditorDraft((previous) => ({ ...previous, description: event.currentTarget.value }))}
                          ></textarea>
                        </div>

                        <div className="editor__field">
                          <div className="editor__label">Category</div>
                          <select
                            className="editor__select"
                            value=${editorDraft.category}
                            onChange=${(event) =>
                              setEditorDraft((previous) => ({ ...previous, category: event.currentTarget.value }))}
                          >
                            <option value="web">Web</option>
                            <option value="mobile">Mobile</option>
                            <option value="ai">AI</option>
                          </select>
                        </div>

                        <div className="editor__field">
                          <div className="editor__label">Tags</div>
                          <input
                            className="editor__input"
                            value=${editorDraft.tags}
                            onInput=${(event) =>
                              setEditorDraft((previous) => ({ ...previous, tags: event.currentTarget.value }))}
                            placeholder="glass, portfolio, live"
                          />
                        </div>

                        <div className="editor__field">
                          <div className="editor__label">Mode</div>
                          <div className="editor__mode-row">
                            <button
                              className=${`editor__mode ${editorDraft.mode === "single" ? "is-active" : ""}`}
                              type="button"
                              onClick=${() =>
                                setEditorDraft((previous) => ({
                                  ...previous,
                                  mode: "single",
                                  code: previous.code || defaultSingleFileCode(previous.title)
                                }))}
                            >
                              Single file
                            </button>
                            <button
                              className=${`editor__mode ${editorDraft.mode === "bundle" ? "is-active" : ""}`}
                              type="button"
                              onClick=${() =>
                                setEditorDraft((previous) => ({
                                  ...previous,
                                  mode: "bundle",
                                  code: previous.code || defaultBundleText(previous.title)
                                }))}
                            >
                              Folder bundle
                            </button>
                          </div>
                        </div>

                        <div className="editor__field">
                          <div className="editor__label">Entry file</div>
                          <input
                            className="editor__input"
                            value=${editorDraft.entry}
                            onInput=${(event) =>
                              setEditorDraft((previous) => ({ ...previous, entry: event.currentTarget.value }))}
                            placeholder="index.html"
                          />
                        </div>

                        <div className="editor__hint">
                          ${editorDraft.mode === "bundle"
                            ? "Bundle mode accepts sections like === index.html ===, === styles.css ===, and === script.js ===. The preview inlines CSS and JS from the bundle."
                            : "Single-file mode supports JSX. Imports are stripped automatically and Babel runs only when a tile is opened."}
                        </div>
                      </div>
                    </div>

                    <div className="editor__footer">
                      <button className="toolbar-button is-muted" type="button" onClick=${() => setEditorOpen(false)}>
                        Cancel
                      </button>
                      <button
                        className="toolbar-button is-primary"
                        type="button"
                        onClick=${saveEditorDraft}
                        disabled=${editorSaving}
                      >
                        ${editorSaving ? "Saving..." : editorDraft.id ? "Save Tile" : "Create Tile"}
                      </button>
                    </div>
                  </section>

                  <section className="editor" style="border-right:0;">
                    <div className="editor__body">
                      <div className="editor__field" style="height:100%;min-height:0;">
                        <div className="editor__label">
                          ${editorDraft.mode === "bundle" ? "Bundle text" : "React / JSX code"}
                        </div>
                        <textarea
                          className="editor__textarea"
                          style="min-height:calc(100% - 32px);height:100%;"
                          value=${editorDraft.code}
                          onInput=${(event) =>
                            setEditorDraft((previous) => ({ ...previous, code: event.currentTarget.value }))}
                          spellcheck="false"
                        ></textarea>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            </div>
          `
        : null}

      ${loginOpen
        ? html`
            <div className="modal login">
              <div className="modal__shell">
                <div className="modal__header">
                  <div className="editor__title">
                    <strong>Admin Login</strong>
                    <span>Unlock editing, reorder, and deployment controls.</span>
                  </div>
                  <div className="modal__title">Protected</div>
                </div>
                <div className="login__body">
                  <p>
                    Enter the admin password configured on the server. Nothing is stored in the browser bundle.
                  </p>
                  <div className="login__field">
                    <div className="editor__label">Password</div>
                    <input
                      className="editor__input"
                      type="password"
                      value=${loginPassword}
                      onInput=${(event) => setLoginPassword(event.currentTarget.value)}
                      onKeyDown=${(event) => {
                        if (event.key === "Enter") {
                          handleLogin();
                        }
                      }}
                    />
                  </div>
                  ${loginError
                    ? html`<div className="login__error">${loginError}</div>`
                    : html`<div className="hint-line">Use server-side credentials to protect the admin editor.</div>`}
                </div>
                <div className="login__actions">
                  <button className="toolbar-button is-muted" type="button" onClick=${() => setLoginOpen(false)}>
                    Cancel
                  </button>
                  <button className="toolbar-button is-primary" type="button" onClick=${handleLogin}>
                    Unlock
                  </button>
                </div>
              </div>
            </div>
          `
        : null}
    </div>
  `;
}

render(html`<${App} />`, document.getElementById("app"));
