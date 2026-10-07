"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { type Project, type Asset, type Notification } from "./data";
import { track } from "./track";

export interface User {
  name: string;
  email: string;
  initials: string;
  plan: string;
  /** false only when the account still has a pending verification email. */
  emailVerified?: boolean;
  /** true for platform operators (ADMIN_EMAILS) — unlocks the console link. */
  isAdmin?: boolean;
}

export interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "info";
  /** Optional action button (e.g. Undo) — extends the toast's lifetime. */
  action?: { label: string; run: () => void };
}

interface AppState {
  user: User | null;
  ready: boolean;
  projects: Project[];
  assets: Asset[];
  notifications: Notification[];
  toasts: Toast[];
  login: (email: string, password: string) => Promise<boolean>;
  signup: (name: string, email: string, password: string, company?: string) => Promise<boolean>;
  logout: () => Promise<void>;
  uploadProject: (
    file: File | null,
    transcript: string,
    onProgress?: (pct: number) => void,
    titleOverride?: string,
    sourceUrl?: string
  ) => Promise<Project | null>;
  toggleAssetEvergreen: (id: string) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  removeProject: (id: string) => Promise<void>;
  approveProject: (id: string) => Promise<void>;
  toggleAssetLike: (id: string) => void;
  editAsset: (id: string, updates: { name?: string; content?: string }) => Promise<Asset | null>;
  addAssets: (assets: Asset[]) => void;
  regenerateAsset: (id: string, feedback?: string) => Promise<Asset | null>;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  addToast: (message: string, type?: Toast["type"], action?: Toast["action"]) => void;
  removeToast: (id: string) => void;
}

const AppContext = createContext<AppState | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

async function api(path: string, init?: RequestInit) {
  return fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
}

// Multipart POST with real upload-progress (fetch can't report upload progress).
function xhrPost(
  url: string,
  form: FormData,
  onProgress?: (pct: number) => void
): Promise<{ ok: boolean; status: number; data: unknown }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON response */
      }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, data });
    };
    xhr.onerror = () => resolve({ ok: false, status: 0, data: null });
    xhr.send(form);
  });
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback(
    (message: string, type: Toast["type"] = "success", action?: Toast["action"]) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev, { id, message, type, action }]);
      // Action toasts (Undo) linger long enough to actually be clicked.
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, action ? 6000 : 4000);
    },
    []
  );

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const applyBootstrap = useCallback(
    (data: {
      user: User | null;
      projects?: Project[];
      assets?: Asset[];
      notifications?: Notification[];
    }) => {
      setUser(data.user);
      setProjects(data.projects ?? []);
      setAssets(data.assets ?? []);
      setNotifications(data.notifications ?? []);
    },
    []
  );

  const refresh = useCallback(async () => {
    const res = await api("/api/bootstrap");
    if (res.ok) {
      applyBootstrap(await res.json());
    } else {
      applyBootstrap({ user: null });
    }
  }, [applyBootstrap]);

  // Referral attribution: a ?ref= on any landing survives until signup.
  useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get("ref");
      if (ref) localStorage.setItem("ef_ref", ref.slice(0, 40));
    } catch {
      /* ignore */
    }
  }, []);

  // Hydrate from the server session on first load.
  useEffect(() => {
    let active = true;
    api("/api/bootstrap")
      .then(async (res) => {
        if (!active) return;
        if (res.ok) applyBootstrap(await res.json());
        else applyBootstrap({ user: null });
      })
      .catch(() => active && applyBootstrap({ user: null }))
      .finally(() => active && setReady(true));
    return () => {
      active = false;
    };
  }, [applyBootstrap]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) return false;
      const { user: u } = await res.json();
      await refresh();
      addToast(`Welcome back, ${u.name}!`);
      return true;
    },
    [refresh, addToast]
  );

  const signup = useCallback(
    async (name: string, email: string, password: string, company?: string) => {
      const res = await api("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          name,
          email,
          password,
          company: company || undefined, // honeypot passthrough
          ref: localStorage.getItem("ef_ref") || undefined,
        }),
      });
      if (!res.ok) return false;
      const { user: u } = await res.json();
      track("signup_complete");
      await refresh();
      addToast(`Welcome to Virafold, ${u.name}!`);
      return true;
    },
    [refresh, addToast]
  );

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" });
    applyBootstrap({ user: null });
    addToast("Logged out successfully", "info");
  }, [applyBootstrap, addToast]);

  const uploadProject = useCallback(
    async (
      file: File | null,
      transcript: string,
      onProgress?: (pct: number) => void,
      titleOverride?: string,
      sourceUrl?: string
    ) => {
      const derivedFromFile = file?.name?.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
      const derivedFromText = transcript.trim().split(/\s+/).slice(0, 7).join(" ");
      // A URL-only upload lets the server derive the title from the article.
      const title = (
        titleOverride?.trim() ||
        derivedFromFile ||
        derivedFromText ||
        (sourceUrl?.trim() ? "" : "Untitled project")
      ).trim();

      const form = new FormData();
      if (title) form.append("title", title);
      form.append("locale", localStorage.getItem("ef_locale") || "en");
      if (transcript.trim()) form.append("transcript", transcript.trim());
      if (sourceUrl?.trim()) form.append("sourceUrl", sourceUrl.trim());
      if (file) form.append("file", file);

      const res = await xhrPost("/api/projects", form, onProgress);
      if (!res.ok) {
        addToast("Upload failed — please sign in again", "error");
        return null;
      }
      const { project, assets: newAssets } = res.data as {
        project: Project;
        assets: Asset[];
      };
      setProjects((prev) => [project, ...prev]);
      if (newAssets?.length) setAssets((prev) => [...newAssets, ...prev]);
      addToast(
        `Generated ${newAssets?.length ?? 0} assets for "${project.title}"`
      );
      api("/api/notifications")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setNotifications(d.notifications))
        .catch(() => {});
      return project;
    },
    [addToast]
  );

  // Server-created assets (e.g. A/B hook variants) merged into local state.
  const addAssets = useCallback((newAssets: Asset[]) => {
    if (newAssets?.length) setAssets((prev) => [...newAssets, ...prev]);
  }, []);

  // Optimistic local update + persisted PATCH (used by the processing sim).
  const updateProject = useCallback((id: string, updates: Partial<Project>) => {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
    api(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    }).catch(() => {});
  }, []);

  // Deletions are held client-side for a grace window so Undo can restore
  // the project and its assets without any server round-trip.
  const pendingDeletes = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const removeProject = useCallback(
    async (id: string) => {
      let removedProject: Project | undefined;
      let removedAssets: Asset[] = [];
      setProjects((prev) => {
        removedProject = prev.find((p) => p.id === id);
        return prev.filter((p) => p.id !== id);
      });
      setAssets((prev) => {
        removedAssets = prev.filter((a) => a.projectId === id);
        return prev.filter((a) => a.projectId !== id);
      });
      const timer = setTimeout(() => {
        pendingDeletes.current.delete(id);
        api(`/api/projects/${id}`, { method: "DELETE" }).catch(() => {});
      }, 5500);
      pendingDeletes.current.set(id, timer);
      addToast("Project removed", "info", {
        label: "Undo",
        run: () => {
          const tm = pendingDeletes.current.get(id);
          if (tm) clearTimeout(tm);
          pendingDeletes.current.delete(id);
          setProjects((prev) =>
            removedProject && !prev.some((p) => p.id === id)
              ? [removedProject, ...prev]
              : prev
          );
          setAssets((prev) => [
            ...removedAssets.filter((a) => !prev.some((x) => x.id === a.id)),
            ...prev,
          ]);
        },
      });
    },
    [addToast]
  );

  const approveProject = useCallback(
    async (id: string) => {
      const res = await api(`/api/projects/${id}/approve`, { method: "POST" });
      if (!res.ok) {
        addToast("Could not publish project", "error");
        return;
      }
      const { project } = await res.json();
      setProjects((prev) => prev.map((p) => (p.id === id ? project : p)));
      setAssets((prev) =>
        prev.map((a) => (a.projectId === id ? { ...a, status: "live" as const } : a))
      );
      addToast("Project approved & published!");
      api("/api/notifications")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setNotifications(d.notifications))
        .catch(() => {});
    },
    [addToast]
  );

  const toggleAssetLike = useCallback((id: string) => {
    setAssets((prev) =>
      prev.map((a) => (a.id === id ? { ...a, liked: !a.liked } : a))
    );
    api(`/api/assets/${id}/like`, { method: "POST" }).catch(() => {});
  }, []);

  const toggleAssetEvergreen = useCallback((id: string) => {
    setAssets((prev) =>
      prev.map((a) => (a.id === id ? { ...a, evergreen: !a.evergreen } : a))
    );
    api(`/api/assets/${id}/evergreen`, { method: "POST" }).catch(() => {});
  }, []);

  const editAsset = useCallback(
    async (id: string, updates: { name?: string; content?: string }) => {
      const res = await api(`/api/assets/${id}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
      });
      if (!res.ok) return null;
      const { asset } = (await res.json()) as { asset: Asset };
      setAssets((prev) => prev.map((a) => (a.id === id ? asset : a)));
      return asset;
    },
    []
  );

  const regenerateAsset = useCallback(async (id: string, feedback?: string) => {
    const res = await api(`/api/assets/${id}/regenerate`, {
      method: "POST",
      body: JSON.stringify({
        feedback: feedback ?? "",
        locale: localStorage.getItem("ef_locale") || "en",
      }),
    });
    if (!res.ok) return null;
    const { asset } = (await res.json()) as { asset: Asset };
    setAssets((prev) => prev.map((a) => (a.id === id ? asset : a)));
    return asset;
  }, []);

  const markNotificationRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
    api(`/api/notifications/${id}`, { method: "PATCH" }).catch(() => {});
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    api("/api/notifications/read-all", { method: "POST" }).catch(() => {});
  }, []);

  return (
    <AppContext.Provider
      value={{
        user,
        ready,
        projects,
        assets,
        notifications,
        toasts,
        login,
        signup,
        logout,
        uploadProject,
        updateProject,
        removeProject,
        approveProject,
        toggleAssetLike,
        toggleAssetEvergreen,
        editAsset,
        addAssets,
        regenerateAsset,
        markNotificationRead,
        markAllNotificationsRead,
        addToast,
        removeToast,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
