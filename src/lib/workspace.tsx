import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { db, dbReady, schema } from "../db";
import { CLIENT_KEY } from "./constants";
import { useAuth } from "./auth";
import { loadBoardColumns } from "./board";
import { getAccessibleClientIds } from "./access";
import type { BoardColumn, Client, Project } from "./types";

type WorkspaceContextValue = {
  clients: Client[];
  projects: Project[];
  columns: BoardColumn[];
  selectedClientId: number | null;
  selectedClient: Client | null;
  clientProjects: Project[];
  activeProject: Project | null;
  projectMode: boolean;
  ready: boolean;
  selectClient: (id: number | null) => void;
  refresh: () => Promise<void>;
  setProjects: (next: Project[] | ((prev: Project[]) => Project[])) => void;
  setColumns: (next: BoardColumn[] | ((prev: BoardColumn[]) => BoardColumn[])) => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function readStoredClient() {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(CLIENT_KEY);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [ready, setReady] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(readStoredClient);

  // Only an admin previewing as a client is scoped to the selected client, so
  // only then must switching clients reload the workspace.
  const scopeClientId = user?.view_as === "client" ? selectedClientId : null;

  const refresh = useCallback(async () => {
    try {
      await dbReady;
      const [clientRows, projectRows, allColumns, allowed] = await Promise.all([
        db.select().from(schema.clients),
        db.select().from(schema.projects),
        loadBoardColumns(),
        getAccessibleClientIds(user, scopeClientId),
      ]);
      let allClients = clientRows as Client[];
      let allProjects = projectRows as Project[];
      if (allowed) {
        const ids = new Set(allowed);
        allClients = allClients.filter((c) => ids.has(c.id));
        allProjects = allProjects.filter((p) => ids.has(p.client_id));
      }

      setClients(allClients);
      setProjects(allProjects);
      setColumns(allColumns);
    } catch (err) {
      console.error("workspace refresh failed", err);
    } finally {
      setReady(true);
    }
  }, [user, scopeClientId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const projectMatch = location.pathname.match(/^\/projects\/(\d+)/);
  const clientMatch = location.pathname.match(/^\/clients\/(\d+)/);
  const urlProjectId = projectMatch ? Number(projectMatch[1]) : null;
  const urlClientId = clientMatch ? Number(clientMatch[1]) : null;

  const activeProject = useMemo(
    () => (urlProjectId ? projects.find((p) => p.id === urlProjectId) ?? null : null),
    [projects, urlProjectId],
  );

  useEffect(() => {
    if (activeProject) {
      setSelectedClientId(activeProject.client_id);
      localStorage.setItem(CLIENT_KEY, String(activeProject.client_id));
      return;
    }
    if (urlClientId) {
      setSelectedClientId(urlClientId);
      localStorage.setItem(CLIENT_KEY, String(urlClientId));
    }
  }, [activeProject, urlClientId]);

  useEffect(() => {
    if (!ready || clients.length === 0) return;
    const stillValid = selectedClientId != null && clients.some((c) => c.id === selectedClientId);
    if (stillValid) return;
    const fallback = clients[0];
    if (!fallback) return;
    setSelectedClientId(fallback.id);
    localStorage.setItem(CLIENT_KEY, String(fallback.id));
  }, [ready, clients, selectedClientId]);

  const selectClient = useCallback((id: number | null) => {
    setSelectedClientId(id);
    if (id) localStorage.setItem(CLIENT_KEY, String(id));
    else localStorage.removeItem(CLIENT_KEY);
  }, []);

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selectedClientId) ?? null,
    [clients, selectedClientId],
  );

  const clientProjects = useMemo(
    () =>
      selectedClientId
        ? projects.filter((p) => p.client_id === selectedClientId)
        : [],
    [projects, selectedClientId],
  );

  const value = useMemo(
    () => ({
      clients,
      projects,
      columns,
      selectedClientId,
      selectedClient,
      clientProjects,
      activeProject,
      projectMode: Boolean(activeProject),
      ready,
      selectClient,
      refresh,
      setProjects,
      setColumns,
    }),
    [
      clients,
      projects,
      columns,
      selectedClientId,
      selectedClient,
      clientProjects,
      activeProject,
      ready,
      selectClient,
      refresh,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}
