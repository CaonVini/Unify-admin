"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ApiError, api, readSession, saveSession, Session } from "../lib/api";
import {
  catalogNameSchema,
  citySchema,
  loginSchema,
  propertySchema,
  PropertyInput,
  universitySchema,
} from "../lib/schemas";

type View = "overview" | "properties" | "catalog" | "events";
type Overview = {
  users: { total: number; verified: number; createdInRange: number };
  profiles: { total: number; completed: number; completionRate: number };
  engagement: {
    likes: number;
    matches: number;
    contactRequests: number;
    conversations: number;
    messages: number;
  };
  properties: { total: number; favorites: number };
  analytics: { eventsInRange: number };
};
type Property = PropertyInput & {
  id: string;
  ownerName?: string;
  totalMonthlyCost: number;
  city?: { name: string; state: string };
  createdAt: string;
};
type EventItem = {
  id: string;
  type: string;
  userId?: string;
  entityType?: string;
  entityId?: string;
  ipHash?: string;
  userAgent?: string;
  createdAt: string;
};
type DailyMetric = { id: string; date: string; key: string; value: number };
type City = { id: string; name: string; state: string; label: string };
type University = {
  id: string;
  cityId: string;
  name: string;
  acronym?: string;
  label: string;
  city: City;
};
type NamedCatalog = { id: string; name: string };
type CatalogKind = "cities" | "universities" | "habits" | "interests";
type LoginSession = Session & { refreshToken: string };
type PresignedUpload = {
  uploadUrl: string;
  method: "PUT";
  key: string;
  publicUrl: string;
  expiresInSeconds: number;
  maxSizeInBytes: number;
  requiredHeaders: Record<string, string>;
};
type EventFilters = {
  type: string;
  userId: string;
  entityType: string;
  entityId: string;
  from: string;
  to: string;
};
const EMPTY_EVENT_FILTERS: EventFilters = {
  type: "",
  userId: "",
  entityType: "",
  entityId: "",
  from: "",
  to: "",
};
const EVENT_TYPES = [
  "user.registered",
  "login.succeeded",
  "login.failed",
  "profile.created",
  "profile.updated",
  "profile.searched",
  "profile.viewed",
  "profile.liked",
  "profile.unliked",
  "match.created",
  "contactRequest.created",
  "contactRequest.accepted",
  "contactRequest.declined",
  "conversation.created",
  "message.sent",
  "property.created",
  "property.updated",
  "property.searched",
  "property.viewed",
  "property.favorited",
  "property.unfavorited",
  "admin.access.succeeded",
  "admin.access.failed",
];

function trustedUploadUrl(value: string) {
  const url = new URL(value);
  const configuredHosts = new Set(
    (process.env.NEXT_PUBLIC_UPLOAD_ALLOWED_HOSTS || "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
  const hostname = url.hostname.toLowerCase();
  const trustedR2 =
    hostname.endsWith(".r2.cloudflarestorage.com") ||
    hostname.endsWith(".r2.dev");
  if (
    url.protocol !== "https:" ||
    (!trustedR2 && !configuredHosts.has(hostname))
  ) {
    throw new Error("O destino retornado para o upload não é permitido.");
  }
  return url.toString();
}

const EMPTY_PROPERTY: PropertyInput = {
  cityId: "",
  title: "",
  description: "",
  neighborhood: "",
  street: "",
  addressNumber: "",
  addressComplement: "",
  rent: 0,
  iptu: 0,
  water: 0,
  internet: 0,
  condoFee: 0,
  rooms: 1,
  bathrooms: 1,
  area: undefined,
  vacancies: 1,
  furnished: false,
  petsAllowed: false,
  photos: [],
  amenities: [],
  rules: [],
  type: "studio",
  available: true,
  contactLink: "",
};
const fmt = new Intl.NumberFormat("pt-BR");
const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const date = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));

export function AdminApp() {
  const refreshTokenRef = useRef<string | null>(null);
  const [session, setSessionState] = useState<Session | null>(null);
  const [stage, setStage] = useState<
    "loading" | "login" | "admin" | "app" | "denied"
  >("login");
  const [view, setView] = useState<View>("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [daily, setDaily] = useState<DailyMetric[]>([]);
  const [anonymousSearches, setAnonymousSearches] = useState(0);
  const [cities, setCities] = useState<City[]>([]);
  const [universities, setUniversities] = useState<University[]>([]);
  const [habits, setHabits] = useState<NamedCatalog[]>([]);
  const [interests, setInterests] = useState<NamedCatalog[]>([]);
  const [eventFilters, setEventFilters] =
    useState<EventFilters>(EMPTY_EVENT_FILTERS);
  const [eventOffset, setEventOffset] = useState(0);
  const [eventCount, setEventCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [showEditor, setShowEditor] = useState(false);
  const [editing, setEditing] = useState<Property | null>(null);
  const [search, setSearch] = useState("");
  const [idleWarning, setIdleWarning] = useState(false);

  const storeSession = useCallback((next: Session | null) => {
    setSessionState(next);
    saveSession(next);
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = refreshTokenRef.current;
    const activeSession = session;
    try {
      if (refreshToken) {
        await api("/auth/logout", {
          method: "POST",
          session: activeSession || undefined,
          body: JSON.stringify({ refreshToken }),
        });
      }
    } catch {
      // A limpeza local sempre acontece, mesmo se a revogação estiver indisponível.
    } finally {
      refreshTokenRef.current = null;
      storeSession(null);
      setOverview(null);
      setProperties([]);
      setEvents([]);
      setDaily([]);
      setAnonymousSearches(0);
      setCities([]);
      setUniversities([]);
      setHabits([]);
      setInterests([]);
      setEventFilters(EMPTY_EVENT_FILTERS);
      setEventOffset(0);
      setEventCount(0);
      setBusy(false);
      setNotice("");
      setShowEditor(false);
      setEditing(null);
      setSearch("");
      setIdleWarning(false);
      setView("overview");
      setStage("login");
      history.replaceState(null, "", "/");
    }
  }, [session, storeSession]);

  useEffect(() => {
    const saved = readSession();
    if (!saved) return setStage("login");
    if (saved.user?.role !== "admin") {
      storeSession(null);
      return setStage("denied");
    }
    setSessionState(saved);
    if (!saved.adminAccessToken || (saved.adminExpiresAt || 0) <= Date.now()) {
      setStage("admin");
      return;
    }
    setStage("loading");
    api<{ data: Overview }>("/admin/metrics/overview", {
      session: saved,
      admin: true,
    })
      .then((response) => {
        setOverview(response.data);
        setStage("app");
      })
      .catch((error) => {
        if (error instanceof ApiError && error.status === 403) {
          storeSession(null);
          setStage("denied");
          return;
        }
        if (error instanceof ApiError && error.status === 401) {
          const next = {
            ...saved,
            adminAccessToken: undefined,
            adminExpiresAt: undefined,
          };
          storeSession(next);
          setStage("admin");
          return;
        }
        storeSession(null);
        setStage("login");
      });
  }, [storeSession]);

  useEffect(() => {
    if (stage !== "app") return;
    let warningTimer: number;
    let logoutTimer: number;
    const reset = () => {
      setIdleWarning(false);
      clearTimeout(warningTimer);
      clearTimeout(logoutTimer);
      warningTimer = window.setTimeout(() => setIdleWarning(true), 24 * 60_000);
      logoutTimer = window.setTimeout(logout, 25 * 60_000);
    };
    const events = ["pointerdown", "keydown", "scroll"] as const;
    events.forEach((event) =>
      window.addEventListener(event, reset, { passive: true }),
    );
    reset();
    return () => {
      events.forEach((event) => window.removeEventListener(event, reset));
      clearTimeout(warningTimer);
      clearTimeout(logoutTimer);
    };
  }, [stage, logout]);

  const guarded = useCallback(
    async <T,>(path: string, options: RequestInit = {}) => {
      if (!session || session.user.role !== "admin")
        throw new ApiError(403, "Acesso negado.");
      try {
        return await api<T>(path, {
          ...options,
          session,
          admin:
            path.startsWith("/admin/") ||
            path === "/uploads/property-photo/presigned-url",
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          if (path.startsWith("/admin/")) {
            const next = {
              ...session,
              adminAccessToken: undefined,
              adminExpiresAt: undefined,
            };
            storeSession(next);
            setStage("admin");
          } else logout();
        }
        if (error instanceof ApiError && error.status === 403)
          setStage("denied");
        throw error;
      }
    },
    [session, logout, storeSession],
  );

  const loadEvents = useCallback(
    async (filters: EventFilters, offset = 0) => {
      const query = new URLSearchParams({
        limit: "50",
        offset: String(offset),
      });
      if (filters.type) query.set("type", filters.type);
      if (filters.userId) query.set("userId", filters.userId.trim());
      if (filters.entityType)
        query.set("entityType", filters.entityType.trim());
      if (filters.entityId) query.set("entityId", filters.entityId.trim());
      if (filters.from)
        query.set("from", new Date(`${filters.from}T00:00:00`).toISOString());
      if (filters.to)
        query.set("to", new Date(`${filters.to}T23:59:59.999`).toISOString());
      setBusy(true);
      try {
        const response = await guarded<{
          data: EventItem[];
          meta: { count: number };
        }>(`/admin/events?${query}`);
        setEvents(response.data);
        setEventCount(response.meta.count);
        setEventOffset(offset);
      } catch (error) {
        setNotice(
          error instanceof Error ? error.message : "Falha ao buscar eventos.",
        );
      } finally {
        setBusy(false);
      }
    },
    [guarded],
  );

  useEffect(() => {
    if (stage !== "app" || !session) return;
    const controller = new AbortController();
    const today = new Date();
    const from = new Date(today);
    from.setDate(today.getDate() - 29);
    const dailyQuery = new URLSearchParams({
      keys: "user.registered,profile.created,message.sent,property.searched",
      from: from.toISOString(),
      to: today.toISOString(),
    });
    const anonymousQuery = new URLSearchParams({
      type: "property.searched",
      from: from.toISOString(),
      to: today.toISOString(),
      limit: "200",
      offset: "0",
    });
    setBusy(true);
    Promise.all([
      guarded<{ data: Overview }>("/admin/metrics/overview", {
        signal: controller.signal,
      }),
      guarded<{ data: DailyMetric[] }>(`/admin/metrics/daily?${dailyQuery}`, {
        signal: controller.signal,
      }),
      guarded<{ data: EventItem[] }>(`/admin/events?${anonymousQuery}`, {
        signal: controller.signal,
      }),
      api<{ data: Property[] }>("/property-listings?limit=50&offset=0", {
        signal: controller.signal,
      }),
      guarded<{ data: EventItem[] }>("/admin/events?limit=8&offset=0", {
        signal: controller.signal,
      }),
      api<{ data: City[] }>("/catalog/cities", { signal: controller.signal }),
      api<{ data: University[] }>("/catalog/universities", {
        signal: controller.signal,
      }),
      api<{ data: NamedCatalog[] }>("/catalog/habits", {
        signal: controller.signal,
      }),
      api<{ data: NamedCatalog[] }>("/catalog/interests", {
        signal: controller.signal,
      }),
    ])
      .then(([m, d, searches, p, e, c, u, h, i]) => {
        setOverview(m.data);
        setDaily(d.data);
        setAnonymousSearches(
          searches.data.filter(
            (item) => !item.userId && !item.entityId && !item.entityType,
          ).length,
        );
        setProperties(p.data);
        setEvents(e.data);
        setCities(c.data);
        setUniversities(u.data);
        setHabits(h.data);
        setInterests(i.data);
        setEventCount(e.data.length);
      })
      .catch((error) => {
        if (!(error instanceof DOMException)) setNotice(error.message);
      })
      .finally(() => setBusy(false));
    return () => controller.abort();
  }, [stage, session?.adminAccessToken, guarded]);

  if (stage === "loading")
    return (
      <div className="center-screen">
        <div className="spinner" />
        <p>Validando sua sessão…</p>
      </div>
    );
  if (stage === "login")
    return (
      <Login
        onSuccess={(next) => {
          refreshTokenRef.current = next.refreshToken;
          const { refreshToken: _refreshToken, ...safeSession } = next;
          storeSession(safeSession);
          setStage(safeSession.user.role === "admin" ? "admin" : "denied");
        }}
      />
    );
  if (stage === "admin" && session)
    return (
      <AdminGate
        session={session}
        onSuccess={(token, minutes) => {
          const next = {
            ...session,
            adminAccessToken: token,
            adminExpiresAt: Date.now() + minutes * 60_000,
          };
          storeSession(next);
          setStage("app");
        }}
        onLogout={logout}
      />
    );
  if (stage === "denied") return <Denied onLogout={logout} />;

  const filteredProperties = properties.filter((item) =>
    `${item.title} ${item.neighborhood} ${item.city?.name || ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">U</span>
          <span>
            unify<small>ADMIN</small>
          </span>
        </div>
        <nav>
          <button
            className={view === "overview" ? "active" : ""}
            onClick={() => setView("overview")}
          >
            <i>◫</i>Visão geral
          </button>
          <button
            className={view === "properties" ? "active" : ""}
            onClick={() => setView("properties")}
          >
            <i>⌂</i>Imóveis
          </button>
          <button
            className={view === "catalog" ? "active" : ""}
            onClick={() => setView("catalog")}
          >
            <i>◇</i>Cadastros
          </button>
          <button
            className={view === "events" ? "active" : ""}
            onClick={() => setView("events")}
          >
            <i>∿</i>Eventos
          </button>
        </nav>
        <div className="sidebar-foot">
          <span className="avatar">{session?.user.name?.[0] || "A"}</span>
          <div>
            <strong>{session?.user.name}</strong>
            <small>Administrador</small>
          </div>
          <button aria-label="Sair" onClick={logout}>
            →
          </button>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <span className="eyebrow">CENTRAL DE OPERAÇÕES</span>
            <h1>
              {view === "overview"
                ? "Visão geral"
                : view === "properties"
                  ? "Gestão de imóveis"
                  : view === "catalog"
                    ? "Cadastros da plataforma"
                    : "Auditoria de eventos"}
            </h1>
          </div>
          <div className="status">
            <span />
            Ambiente seguro
          </div>
        </header>
        {notice && (
          <div className="notice" role="alert">
            {notice}
            <button onClick={() => setNotice("")}>Fechar</button>
          </div>
        )}
        {view === "overview" && (
          <ActivationOverviewPage
            data={overview}
            daily={daily}
            anonymousSearches={anonymousSearches}
            busy={busy}
          />
        )}
        {view === "properties" && (
          <PropertiesPage
            items={filteredProperties}
            search={search}
            setSearch={setSearch}
            busy={busy}
            onNew={() => {
              setEditing(null);
              setShowEditor(true);
            }}
            onEdit={(item) => {
              setEditing(item);
              setShowEditor(true);
            }}
          />
        )}
        {view === "catalog" && session && (
          <CatalogPage
            cities={cities}
            universities={universities}
            habits={habits}
            interests={interests}
            request={guarded}
            notify={setNotice}
            onCities={setCities}
            onUniversities={setUniversities}
            onHabits={setHabits}
            onInterests={setInterests}
          />
        )}
        {view === "events" && (
          <EventsPage
            items={events}
            busy={busy}
            filters={eventFilters}
            offset={eventOffset}
            count={eventCount}
            onFilter={(filters) => {
              setEventFilters(filters);
              loadEvents(filters, 0);
            }}
            onPage={(offset) => loadEvents(eventFilters, offset)}
          />
        )}
      </main>
      {showEditor && session && (
        <PropertyEditor
          initial={editing || EMPTY_PROPERTY}
          cities={cities}
          onClose={() => setShowEditor(false)}
          uploadPhoto={async (file) => {
            const response = await guarded<{ data: PresignedUpload }>(
              "/uploads/property-photo/presigned-url",
              {
                method: "POST",
                body: JSON.stringify({
                  fileName: file.name,
                  contentType: file.type,
                  fileSize: file.size,
                }),
              },
            );
            if (file.size > response.data.maxSizeInBytes) {
              throw new Error(
                `${file.name} excede o limite de ${formatBytes(response.data.maxSizeInBytes)}.`,
              );
            }
            const uploadUrl = trustedUploadUrl(response.data.uploadUrl);
            const publicUrl = trustedUploadUrl(response.data.publicUrl);
            const requiredType = response.data.requiredHeaders["Content-Type"];
            if (requiredType && requiredType !== file.type) {
              throw new Error(
                "O tipo da foto não corresponde à autorização de upload.",
              );
            }
            const controller = new AbortController();
            const timeout = window.setTimeout(() => controller.abort(), 60_000);
            let uploaded: Response;
            try {
              uploaded = await fetch(uploadUrl, {
                method: response.data.method,
                headers: { "Content-Type": file.type },
                body: file,
                signal: controller.signal,
                credentials: "omit",
                referrerPolicy: "no-referrer",
              });
            } finally {
              window.clearTimeout(timeout);
            }
            if (!uploaded.ok)
              throw new Error(
                "Não foi possível enviar a foto para o armazenamento.",
              );
            return {
              publicUrl,
              maxSizeInBytes: response.data.maxSizeInBytes,
            };
          }}
          onSave={async (value) => {
            setBusy(true);
            try {
              const path = editing
                ? `/property-listings/${editing.id}`
                : "/property-listings";
              const response = await guarded<{ data: Property }>(path, {
                method: editing ? "PUT" : "POST",
                body: JSON.stringify(value),
              });
              setProperties((old) =>
                editing
                  ? old.map((item) =>
                      item.id === editing.id
                        ? { ...item, ...response.data }
                        : item,
                    )
                  : [response.data, ...old],
              );
              setShowEditor(false);
              setNotice(
                editing
                  ? "Imóvel atualizado com sucesso."
                  : "Imóvel criado com sucesso.",
              );
            } catch (error) {
              setNotice(
                error instanceof Error
                  ? error.message
                  : "Não foi possível salvar.",
              );
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      {idleWarning && (
        <div className="idle-warning">
          <strong>Sessão prestes a expirar</strong>
          <span>Você será desconectado em 1 minuto por inatividade.</span>
          <button onClick={() => setIdleWarning(false)}>
            Continuar conectado
          </button>
        </div>
      )}
    </div>
  );
}

function Login({ onSuccess }: { onSuccess: (session: LoginSession) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const parsed = loginSchema.safeParse({
      email: form.get("email"),
      password: form.get("password"),
    });
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    setBusy(true);
    try {
      const response = await api<{ data: LoginSession }>("/auth/login", {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });
      onSuccess(response.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao entrar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <section className="auth-aside">
        <div className="brand light">
          <span className="brand-mark">U</span>
          <span>
            unify<small>ADMIN</small>
          </span>
        </div>
        <div>
          <span className="eyebrow">INTELIGÊNCIA OPERACIONAL</span>
          <h1>Decisões melhores começam com uma visão clara.</h1>
          <p>
            Acompanhe a comunidade, os imóveis e os sinais que movem a Unify em
            um só lugar.
          </p>
        </div>
        <small>Acesso exclusivo para a equipe autorizada.</small>
      </section>
      <section className="auth-form">
        <form onSubmit={submit} noValidate>
          <span className="mobile-logo">unify admin</span>
          <div>
            <span className="eyebrow">BEM-VINDO DE VOLTA</span>
            <h2>Acesse o painel</h2>
            <p>Use as mesmas credenciais da sua conta Unify.</p>
          </div>
          <label>
            E-mail
            <input
              type="email"
              name="email"
              autoComplete="username"
              placeholder="voce@unify.com"
              maxLength={254}
              required
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              placeholder="Sua senha"
              minLength={8}
              maxLength={128}
              required
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Entrando…" : "Entrar no painel"}
          </button>
          <p className="privacy">
            Suas credenciais são enviadas apenas para a API configurada da
            Unify.
          </p>
        </form>
      </section>
    </div>
  );
}

function AdminGate({
  session,
  onSuccess,
  onLogout,
}: {
  session: Session;
  onSuccess: (token: string, minutes: number) => void;
  onLogout: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(
      new FormData(event.currentTarget).get("code") || "",
    ).trim();
    if (!code || code.length > 100)
      return setError("Informe o código de acesso.");
    setBusy(true);
    setError("");
    try {
      const response = await api<{
        data: { adminAccessToken: string; expiresInMinutes: number };
      }>("/auth/admin/access", {
        method: "POST",
        session,
        body: JSON.stringify({ code }),
      });
      onSuccess(response.data.adminAccessToken, response.data.expiresInMinutes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Código inválido.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="gate">
      <div className="gate-card">
        <div className="shield">✓</div>
        <span className="eyebrow">SEGUNDA CAMADA</span>
        <h1>Confirme seu acesso</h1>
        <p>
          Olá, {session.user.name}. Digite o código administrativo para abrir o
          painel. Este acesso é temporário.
        </p>
        <form onSubmit={submit}>
          <label>
            Código do painel
            <input
              name="code"
              type="password"
              autoFocus
              autoComplete="one-time-code"
              maxLength={100}
              placeholder="••••••"
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="primary" disabled={busy}>
            {busy ? "Validando…" : "Confirmar acesso"}
          </button>
          <button type="button" className="text-button" onClick={onLogout}>
            Sair da conta
          </button>
        </form>
      </div>
    </div>
  );
}

function Denied({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="gate">
      <div className="gate-card">
        <div className="shield denied">!</div>
        <span className="eyebrow">ACESSO NEGADO</span>
        <h1>Esta área é restrita</h1>
        <p>
          Sua conta não possui permissão administrativa. Se isso parecer
          incorreto, fale com um responsável pela Unify.
        </p>
        <button className="primary" onClick={onLogout}>
          Voltar ao login
        </button>
      </div>
    </div>
  );
}

function OverviewPage({
  data,
  daily,
  anonymousSearches,
  events,
  busy,
}: {
  data: Overview | null;
  daily: DailyMetric[];
  anonymousSearches: number;
  events: EventItem[];
  busy: boolean;
}) {
  if (busy && !data) return <Loading />;
  if (!data) return <Empty text="Nenhuma métrica disponível." />;
  const verifiedRate = data.users.total
    ? Math.round((data.users.verified / data.users.total) * 100)
    : 0;
  const totalSearches = daily
    .filter((item) => item.key === "property.searched")
    .reduce((sum, item) => sum + item.value, 0);
  const cards = [
    [
      "Usuários",
      data.users.total,
      `${data.users.createdInRange} novos no período`,
      "indigo",
    ],
    [
      "Perfis completos",
      data.profiles.completed,
      `${data.profiles.completionRate}% de conclusão`,
      "green",
    ],
    [
      "Matches",
      data.engagement.matches,
      `${fmt.format(data.engagement.likes)} curtidas`,
      "violet",
    ],
    [
      "Imóveis ativos",
      data.properties.total,
      `${fmt.format(data.properties.favorites)} favoritos`,
      "orange",
    ],
    [
      "Buscas anônimas",
      anonymousSearches,
      `${fmt.format(totalSearches)} buscas totais em 30 dias`,
      "cyan",
    ],
  ] as const;
  const days = Array.from({ length: 14 }, (_, index) => {
    const value = new Date();
    value.setDate(value.getDate() - (13 - index));
    return value.toISOString().slice(0, 10);
  });
  const series = days.map((day) => ({
    day,
    users:
      daily.find((item) => item.date === day && item.key === "user.registered")
        ?.value || 0,
    profiles:
      daily.find((item) => item.date === day && item.key === "profile.created")
        ?.value || 0,
    messages:
      daily.find((item) => item.date === day && item.key === "message.sent")
        ?.value || 0,
  }));
  const maxDaily = Math.max(
    1,
    ...series.flatMap((item) => [item.users, item.profiles, item.messages]),
  );
  return (
    <>
      <section className="metric-grid">
        {cards.map(([label, value, detail, color]) => (
          <article className={`metric ${color}`} key={label}>
            <div className="metric-top">
              <span>{label}</span>
              <i />
            </div>
            <strong>{fmt.format(value)}</strong>
            <small>{detail}</small>
          </article>
        ))}
      </section>
      <section className="overview-chart panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">ÚLTIMOS 14 DIAS</span>
            <h2>Evolução da plataforma</h2>
          </div>
          <div className="chart-legend">
            <span className="users">Usuários</span>
            <span className="profiles">Perfis</span>
            <span className="messages">Mensagens</span>
          </div>
        </div>
        <div
          className="daily-chart"
          aria-label="Gráfico diário dos últimos 30 dias"
        >
          {series.map((item, index) => (
            <div
              className="day-column"
              key={item.day}
              title={`${item.day}: ${item.users} usuários, ${item.profiles} perfis, ${item.messages} mensagens`}
            >
              <div className="day-bars">
                <i
                  className="users"
                  style={{
                    height: `${Math.max(item.users ? 5 : 0, (item.users / maxDaily) * 100)}%`,
                  }}
                />
                <i
                  className="profiles"
                  style={{
                    height: `${Math.max(item.profiles ? 5 : 0, (item.profiles / maxDaily) * 100)}%`,
                  }}
                />
                <i
                  className="messages"
                  style={{
                    height: `${Math.max(item.messages ? 5 : 0, (item.messages / maxDaily) * 100)}%`,
                  }}
                />
              </div>
              {index % 5 === 0 && <small>{item.day.slice(8)}</small>}
            </div>
          ))}
        </div>
      </section>
      <section className="insight-grid">
        <article className="panel health-panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">QUALIDADE DA BASE</span>
              <h2>Saúde dos cadastros</h2>
            </div>
          </div>
          <div className="health-content">
            <div
              className="ring"
              style={
                { "--value": `${verifiedRate * 3.6}deg` } as React.CSSProperties
              }
            >
              <strong>{verifiedRate}%</strong>
              <small>verificados</small>
            </div>
            <div className="health-stats">
              <div>
                <span>Usuários verificados</span>
                <strong>
                  {fmt.format(data.users.verified)}{" "}
                  <small>de {fmt.format(data.users.total)}</small>
                </strong>
              </div>
              <div>
                <span>Perfis concluídos</span>
                <strong>
                  {fmt.format(data.profiles.completed)}{" "}
                  <small>de {fmt.format(data.profiles.total)}</small>
                </strong>
              </div>
              <div className="completion-track">
                <i
                  style={{
                    width: `${Math.min(100, data.profiles.completionRate)}%`,
                  }}
                />
              </div>
            </div>
          </div>
        </article>
        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">ENGAJAMENTO</span>
              <h2>Interações acumuladas</h2>
            </div>
          </div>
          <div className="engagement-rows">
            {[
              ["Mensagens", data.engagement.messages],
              ["Curtidas", data.engagement.likes],
              ["Contatos", data.engagement.contactRequests],
              ["Conversas", data.engagement.conversations],
              ["Matches", data.engagement.matches],
            ].map(([label, value], index) => {
              const percentage = Math.round(
                (Number(value) /
                  Math.max(
                    data.engagement.messages,
                    data.engagement.likes,
                    data.engagement.contactRequests,
                    data.engagement.conversations,
                    data.engagement.matches,
                    1,
                  )) *
                  100,
              );
              return (
                <div key={label}>
                  <header>
                    <span>
                      {index + 1}. {label}
                    </span>
                    <strong>
                      {fmt.format(Number(value))} <small>{percentage}%</small>
                    </strong>
                  </header>
                  <div className="engagement-track">
                    <i
                      style={{
                        width: `${Math.max(2, percentage)}%`,
                      }}
                    />
                  </div>
                  <small>
                    {percentage}% em relação à interação de maior volume
                  </small>
                </div>
              );
            })}
          </div>
        </article>
        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">TEMPO REAL</span>
              <h2>Atividade recente</h2>
            </div>
          </div>
          <div className="event-list">
            {events.slice(0, 5).map((item) => (
              <div key={item.id}>
                <span className="event-dot" />
                <p>
                  <strong>{eventLabel(item.type)}</strong>
                  <small>{date(item.createdAt)}</small>
                </p>
              </div>
            ))}
          </div>
        </article>
      </section>
    </>
  );
}

function ActivationOverviewPage({
  data,
  daily,
  anonymousSearches,
  busy,
}: {
  data: Overview | null;
  daily: DailyMetric[];
  anonymousSearches: number;
  busy: boolean;
}) {
  if (busy && !data) return <Loading />;
  if (!data) return <Empty text="Nenhuma métrica disponível." />;
  const verifiedRate = data.users.total
    ? Math.round((data.users.verified / data.users.total) * 100)
    : 0;
  const completedOfVerified = data.users.verified
    ? Math.round((data.profiles.completed / data.users.verified) * 100)
    : 0;
  const completedOfTotal = data.users.total
    ? Math.round((data.profiles.completed / data.users.total) * 100)
    : 0;
  const totalSearches = daily
    .filter((item) => item.key === "property.searched")
    .reduce((sum, item) => sum + item.value, 0);
  const cards = [
    [
      "Usuários",
      data.users.total,
      `${data.users.createdInRange} novos no período`,
      "indigo",
    ],
    [
      "Perfis completos",
      data.profiles.completed,
      `${data.profiles.completionRate}% de conclusão`,
      "green",
    ],
    [
      "Matches",
      data.engagement.matches,
      `${fmt.format(data.engagement.likes)} curtidas`,
      "violet",
    ],
    [
      "Imóveis ativos",
      data.properties.total,
      `${fmt.format(data.properties.favorites)} favoritos`,
      "orange",
    ],
    [
      "Buscas anônimas",
      anonymousSearches,
      `${fmt.format(totalSearches)} buscas totais em 30 dias`,
      "cyan",
    ],
  ] as const;
  const days = Array.from({ length: 14 }, (_, index) => {
    const value = new Date();
    value.setDate(value.getDate() - (13 - index));
    return value.toISOString().slice(0, 10);
  });
  const valueForDay = (day: string, key: string) =>
    daily.find((item) => item.date.slice(0, 10) === day && item.key === key)
      ?.value || 0;
  const series = days.map((day) => ({
    day,
    users: valueForDay(day, "user.registered"),
    profiles: valueForDay(day, "profile.created"),
    messages: valueForDay(day, "message.sent"),
    searches: valueForDay(day, "property.searched"),
  }));
  const maxDaily = Math.max(
    1,
    ...series.flatMap((item) => [
      item.users,
      item.profiles,
      item.messages,
      item.searches,
    ]),
  );
  return (
    <>
      <section className="metric-grid">
        {cards.map(([label, value, detail, color]) => (
          <article className={`metric ${color}`} key={label}>
            <div className="metric-top">
              <span>{label}</span>
              <i />
            </div>
            <strong>{fmt.format(value)}</strong>
            <small>{detail}</small>
          </article>
        ))}
      </section>
      <section className="overview-chart panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">ÚLTIMOS 14 DIAS</span>
            <h2>Evolução da plataforma</h2>
          </div>
          <div className="chart-legend">
            <span className="users">Usuários</span>
            <span className="profiles">Perfis</span>
            <span className="messages">Mensagens</span>
            <span className="searches">Buscas</span>
          </div>
        </div>
        <div
          className="daily-chart"
          aria-label="Métricas diárias dos últimos 14 dias"
        >
          {series.map((item, index) => (
            <div
              className="day-column"
              key={item.day}
              title={`${item.day}: ${item.users} usuários, ${item.profiles} perfis, ${item.messages} mensagens e ${item.searches} buscas`}
            >
              <div className="day-bars">
                <i
                  className="users"
                  style={{
                    height: `${Math.max(item.users ? 5 : 0, (item.users / maxDaily) * 100)}%`,
                  }}
                />
                <i
                  className="profiles"
                  style={{
                    height: `${Math.max(item.profiles ? 5 : 0, (item.profiles / maxDaily) * 100)}%`,
                  }}
                />
                <i
                  className="messages"
                  style={{
                    height: `${Math.max(item.messages ? 5 : 0, (item.messages / maxDaily) * 100)}%`,
                  }}
                />
                <i
                  className="searches"
                  style={{
                    height: `${Math.max(item.searches ? 5 : 0, (item.searches / maxDaily) * 100)}%`,
                  }}
                />
              </div>
              <small>
                {item.day.slice(8)}/{item.day.slice(5, 7)}
              </small>
            </div>
          ))}
        </div>
      </section>
      <section className="insight-grid two-columns">
        <article className="panel health-panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">FUNIL DE ATIVAÇÃO</span>
              <h2>Do cadastro ao perfil completo</h2>
            </div>
          </div>
          <div className="activation-funnel">
            <div>
              <header>
                <span>1. Cadastro realizado</span>
                <strong>
                  {fmt.format(data.users.total)} <small>100%</small>
                </strong>
              </header>
              <div>
                <i className="registered" style={{ width: "100%" }} />
              </div>
              <small>Base total de usuários</small>
            </div>
            <div>
              <header>
                <span>2. Conta verificada</span>
                <strong>
                  {fmt.format(data.users.verified)}{" "}
                  <small>{verifiedRate}%</small>
                </strong>
              </header>
              <div>
                <i className="verified" style={{ width: `${verifiedRate}%` }} />
              </div>
              <small>{verifiedRate}% dos cadastrados avançaram</small>
            </div>
            <div>
              <header>
                <span>3. Perfil completo</span>
                <strong>
                  {fmt.format(data.profiles.completed)}{" "}
                  <small>{completedOfVerified}%</small>
                </strong>
              </header>
              <div>
                <i
                  className="completed"
                  style={{ width: `${completedOfTotal}%` }}
                />
              </div>
              <small>
                {completedOfVerified}% dos verificados concluíram o perfil
              </small>
            </div>
          </div>
        </article>
        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">ENGAJAMENTO</span>
              <h2>Interações acumuladas</h2>
            </div>
          </div>
          <div className="engagement-rows">
            {[
              ["Mensagens", data.engagement.messages],
              ["Curtidas", data.engagement.likes],
              ["Contatos", data.engagement.contactRequests],
              ["Conversas", data.engagement.conversations],
              ["Matches", data.engagement.matches],
            ].map(([label, value], index) => {
              const percentage = Math.round(
                (Number(value) /
                  Math.max(
                    data.engagement.messages,
                    data.engagement.likes,
                    data.engagement.contactRequests,
                    data.engagement.conversations,
                    data.engagement.matches,
                    1,
                  )) *
                  100,
              );
              return (
                <div key={label}>
                  <header>
                    <span>
                      {index + 1}. {label}
                    </span>
                    <strong>
                      {fmt.format(Number(value))} <small>{percentage}%</small>
                    </strong>
                  </header>
                  <div className="engagement-track">
                    <i
                      style={{
                        width: `${Math.max(2, percentage)}%`,
                      }}
                    />
                  </div>
                  <small>
                    {percentage}% em relação à interação de maior volume
                  </small>
                </div>
              );
            })}
          </div>
        </article>
      </section>
    </>
  );
}

function PropertiesPage({
  items,
  search,
  setSearch,
  busy,
  onNew,
  onEdit,
}: {
  items: Property[];
  search: string;
  setSearch: (v: string) => void;
  busy: boolean;
  onNew: () => void;
  onEdit: (item: Property) => void;
}) {
  return (
    <section className="panel table-panel">
      <div className="toolbar">
        <div className="search">
          <span>⌕</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por título, bairro ou cidade"
          />
        </div>
        <button className="primary small" onClick={onNew}>
          + Novo imóvel
        </button>
      </div>
      {busy && !items.length ? (
        <Loading />
      ) : !items.length ? (
        <Empty text="Nenhum imóvel encontrado." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Imóvel</th>
                <th>Localização</th>
                <th>Mensalidade</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="property-cell">
                      <span className="property-thumb">
                        {item.photos?.[0] ? (
                          <img
                            src={safeImage(item.photos[0])}
                            alt=""
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          "⌂"
                        )}
                      </span>
                      <div>
                        <strong>{item.title}</strong>
                        <small>
                          {typeLabel(item.type)} · {item.rooms} quarto(s)
                        </small>
                      </div>
                    </div>
                  </td>
                  <td>
                    {item.neighborhood}
                    <small className="table-sub">
                      {item.city
                        ? `${item.city.name} · ${item.city.state}`
                        : "Cidade não informada"}
                    </small>
                  </td>
                  <td>
                    <strong>
                      {money.format(item.totalMonthlyCost || item.rent)}
                    </strong>
                  </td>
                  <td>
                    <span
                      className={item.available ? "pill success" : "pill muted"}
                    >
                      {item.available ? "Disponível" : "Indisponível"}
                    </span>
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      onClick={() => onEdit(item)}
                      aria-label={`Editar ${item.title}`}
                    >
                      ⋯
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EventsPage({
  items,
  busy,
  filters,
  offset,
  count,
  onFilter,
  onPage,
}: {
  items: EventItem[];
  busy: boolean;
  filters: EventFilters;
  offset: number;
  count: number;
  onFilter: (filters: EventFilters) => void;
  onPage: (offset: number) => void;
}) {
  const [draft, setDraft] = useState(filters);
  const set = (key: keyof EventFilters, value: string) =>
    setDraft((old) => ({ ...old, [key]: value }));
  function submit(event: FormEvent) {
    event.preventDefault();
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (
      (draft.userId && !uuid.test(draft.userId.trim())) ||
      (draft.entityId && !uuid.test(draft.entityId.trim()))
    )
      return;
    onFilter(draft);
  }
  const active = Object.values(filters).filter(Boolean).length;
  return (
    <>
      <section className="panel filter-panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">INVESTIGAÇÃO</span>
            <h2>Filtrar eventos</h2>
          </div>
          {active > 0 && <span className="pill info">{active} filtro(s)</span>}
        </div>
        <form className="event-filters" onSubmit={submit}>
          <label>
            Usuário (UUID)
            <input
              value={draft.userId}
              onChange={(e) => set("userId", e.target.value)}
              placeholder="Cole o ID completo do usuário"
              pattern="[0-9a-fA-F-]{36}"
            />
          </label>
          <label>
            Tipo de evento
            <select
              value={draft.type}
              onChange={(e) => set("type", e.target.value)}
            >
              <option value="">Todos os eventos</option>
              {EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tipo de entidade
            <input
              value={draft.entityType}
              onChange={(e) => set("entityType", e.target.value)}
              placeholder="profile ou propertyListing"
              maxLength={80}
            />
          </label>
          <label>
            Entidade (UUID)
            <input
              value={draft.entityId}
              onChange={(e) => set("entityId", e.target.value)}
              placeholder="ID da entidade"
              pattern="[0-9a-fA-F-]{36}"
            />
          </label>
          <label>
            De
            <input
              type="date"
              value={draft.from}
              max={draft.to || undefined}
              onChange={(e) => set("from", e.target.value)}
            />
          </label>
          <label>
            Até
            <input
              type="date"
              value={draft.to}
              min={draft.from || undefined}
              onChange={(e) => set("to", e.target.value)}
            />
          </label>
          <div className="filter-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setDraft(EMPTY_EVENT_FILTERS);
                onFilter(EMPTY_EVENT_FILTERS);
              }}
            >
              Limpar
            </button>
            <button className="primary small" disabled={busy}>
              {busy ? "Buscando…" : "Aplicar filtros"}
            </button>
          </div>
        </form>
      </section>
      <section className="panel table-panel event-results">
        <div className="result-summary">
          <strong>{count} evento(s) nesta consulta</strong>
          <span>Mostrando até 50 por página</span>
        </div>
        {busy && !items.length ? (
          <Loading />
        ) : !items.length ? (
          <Empty text="Nenhum evento encontrado com esses filtros." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Evento</th>
                  <th>Entidade</th>
                  <th>Usuário</th>
                  <th>Identificador/IP</th>
                  <th>Data</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <span className="pill info">{item.type}</span>
                    </td>
                    <td>
                      {item.entityType || "—"}
                      <small className="table-sub mono" title={item.entityId}>
                        {shortId(item.entityId)}
                      </small>
                    </td>
                    <td className="mono" title={item.userId}>
                      {shortId(item.userId)}
                    </td>
                    <td className="mono" title={item.ipHash}>
                      {shortId(item.ipHash)}
                    </td>
                    <td>{date(item.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pagination">
          <button
            className="secondary"
            disabled={busy || offset === 0}
            onClick={() => onPage(Math.max(0, offset - 50))}
          >
            ← Anterior
          </button>
          <span>Página {Math.floor(offset / 50) + 1}</span>
          <button
            className="secondary"
            disabled={busy || items.length < 50}
            onClick={() => onPage(offset + 50)}
          >
            Próxima →
          </button>
        </div>
      </section>
    </>
  );
}

function CatalogPage({
  cities,
  universities,
  habits,
  interests,
  request,
  notify,
  onCities,
  onUniversities,
  onHabits,
  onInterests,
}: {
  cities: City[];
  universities: University[];
  habits: NamedCatalog[];
  interests: NamedCatalog[];
  request: <T>(path: string, options?: RequestInit) => Promise<T>;
  notify: (message: string) => void;
  onCities: React.Dispatch<React.SetStateAction<City[]>>;
  onUniversities: React.Dispatch<React.SetStateAction<University[]>>;
  onHabits: React.Dispatch<React.SetStateAction<NamedCatalog[]>>;
  onInterests: React.Dispatch<React.SetStateAction<NamedCatalog[]>>;
}) {
  const [kind, setKind] = useState<CatalogKind>("cities");
  const [editor, setEditor] = useState<{
    kind: CatalogKind;
    item?: City | University | NamedCatalog;
  } | null>(null);
  const configs = {
    cities: { label: "Cidades", count: cities.length },
    universities: { label: "Universidades", count: universities.length },
    habits: { label: "Hábitos", count: habits.length },
    interests: { label: "Interesses", count: interests.length },
  };
  const items =
    kind === "cities"
      ? cities
      : kind === "universities"
        ? universities
        : kind === "habits"
          ? habits
          : interests;
  async function save(payload: Record<string, string>) {
    if (!editor) return;
    const id = editor.item?.id;
    const path = `/admin/catalog/${editor.kind}${id ? `/${id}` : ""}`;
    try {
      const response = await request<{
        data: City | University | NamedCatalog;
      }>(path, { method: id ? "PUT" : "POST", body: JSON.stringify(payload) });
      const update = <T extends { id: string }>(list: T[], value: T) =>
        id
          ? list.map((item) => (item.id === id ? value : item))
          : [...list, value];
      if (editor.kind === "cities")
        onCities((old) => update(old, response.data as City));
      if (editor.kind === "universities")
        onUniversities((old) => update(old, response.data as University));
      if (editor.kind === "habits")
        onHabits((old) => update(old, response.data as NamedCatalog));
      if (editor.kind === "interests")
        onInterests((old) => update(old, response.data as NamedCatalog));
      setEditor(null);
      notify(
        `${configs[editor.kind].label.slice(0, -1)} ${id ? "atualizado(a)" : "criado(a)"} com sucesso.`,
      );
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar o cadastro.",
      );
      throw error;
    }
  }
  return (
    <>
      <section className="catalog-tabs">
        {(Object.keys(configs) as CatalogKind[]).map((key) => (
          <button
            key={key}
            className={kind === key ? "active" : ""}
            onClick={() => setKind(key)}
          >
            <span>{configs[key].label}</span>
            <strong>{configs[key].count}</strong>
          </button>
        ))}
      </section>
      <section className="panel table-panel">
        <div className="toolbar">
          <div>
            <span className="eyebrow">CATÁLOGO</span>
            <h2>{configs[kind].label}</h2>
            <p className="toolbar-copy">
              Alterações são refletidas em toda a plataforma. Exclusões não são
              permitidas pela API.
            </p>
          </div>
          <button className="primary small" onClick={() => setEditor({ kind })}>
            + Adicionar
          </button>
        </div>
        {!items.length ? (
          <Empty
            text={`Nenhum cadastro em ${configs[kind].label.toLowerCase()}.`}
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  {kind === "cities" && <th>Estado</th>}
                  {kind === "universities" && (
                    <>
                      <th>Sigla</th>
                      <th>Cidade</th>
                    </>
                  )}
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.name}</strong>
                      <small className="table-sub mono">
                        {shortId(item.id)}
                      </small>
                    </td>
                    {kind === "cities" && <td>{(item as City).state}</td>}
                    {kind === "universities" && (
                      <>
                        <td>{(item as University).acronym || "—"}</td>
                        <td>{(item as University).city?.label || "—"}</td>
                      </>
                    )}
                    <td>
                      <button
                        className="icon-button edit-action"
                        onClick={() => setEditor({ kind, item })}
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {editor && (
        <CatalogEditor
          kind={editor.kind}
          item={editor.item}
          cities={cities}
          onClose={() => setEditor(null)}
          onSave={save}
        />
      )}
    </>
  );
}

function CatalogEditor({
  kind,
  item,
  cities,
  onClose,
  onSave,
}: {
  kind: CatalogKind;
  item?: City | University | NamedCatalog;
  cities: City[];
  onClose: () => void;
  onSave: (payload: Record<string, string>) => Promise<void>;
}) {
  const university = item as University | undefined;
  const city = item as City | undefined;
  const [name, setName] = useState(item?.name || "");
  const [state, setState] = useState(city?.state || "");
  const [cityId, setCityId] = useState(university?.cityId || "");
  const [acronym, setAcronym] = useState(university?.acronym || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed =
      kind === "cities"
        ? citySchema.safeParse({ name, state })
        : kind === "universities"
          ? universitySchema.safeParse({ name, cityId, acronym })
          : catalogNameSchema.safeParse({ name });
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    setBusy(true);
    setError("");
    try {
      await onSave(parsed.data as Record<string, string>);
    } catch {
    } finally {
      setBusy(false);
    }
  }
  const label =
    kind === "cities"
      ? "cidade"
      : kind === "universities"
        ? "universidade"
        : kind === "habits"
          ? "hábito"
          : "interesse";
  return (
    <div className="modal-backdrop">
      <section className="catalog-modal" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div>
            <span className="eyebrow">CADASTRO</span>
            <h2>
              {item ? "Editar" : "Adicionar"} {label}
            </h2>
          </div>
          <button onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>
        <form onSubmit={submit}>
          <label>
            Nome
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={
                kind === "universities" ? 160 : kind === "cities" ? 120 : 80
              }
              autoFocus
              required
            />
          </label>
          {kind === "cities" && (
            <label>
              Estado
              <input
                value={state}
                onChange={(e) =>
                  setState(e.target.value.toUpperCase().slice(0, 2))
                }
                maxLength={2}
                placeholder="SC"
                required
              />
            </label>
          )}
          {kind === "universities" && (
            <>
              <label>
                Cidade
                <select
                  value={cityId}
                  onChange={(e) => setCityId(e.target.value)}
                  required
                >
                  <option value="">Selecione uma cidade</option>
                  {cities.map((entry) => (
                    <option value={entry.id} key={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Sigla <span>opcional, máximo 30 caracteres</span>
                <input
                  value={acronym}
                  onChange={(e) => setAcronym(e.target.value)}
                  maxLength={30}
                  placeholder="UFFS"
                />
              </label>
            </>
          )}
          {error && <p className="form-error">{error}</p>}
          <div className="drawer-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancelar
            </button>
            <button className="primary" disabled={busy}>
              {busy ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function PropertyEditor({
  initial,
  cities,
  onClose,
  onSave,
  uploadPhoto,
}: {
  initial: PropertyInput;
  cities: City[];
  onClose: () => void;
  onSave: (value: PropertyInput) => Promise<void>;
  uploadPhoto: (
    file: File,
  ) => Promise<{ publicUrl: string; maxSizeInBytes: number }>;
}) {
  const [form, setForm] = useState<PropertyInput>(initial);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [maxUploadSize, setMaxUploadSize] = useState<number | null>(null);
  const total = useMemo(
    () =>
      form.rent +
      (form.iptu || 0) +
      (form.water || 0) +
      (form.internet || 0) +
      (form.condoFee || 0),
    [form],
  );
  const set = <K extends keyof PropertyInput>(
    key: K,
    value: PropertyInput[K],
  ) => setForm((old) => ({ ...old, [key]: value }));
  async function selectPhotos(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    if (form.photos.length + files.length > 20)
      return setError("O imóvel pode ter no máximo 20 fotos.");
    const invalid = files.find(
      (file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type),
    );
    if (invalid)
      return setError(
        `Formato não aceito em ${invalid.name}. Use JPG, PNG ou WebP.`,
      );
    if (maxUploadSize) {
      const oversized = files.find((file) => file.size > maxUploadSize);
      if (oversized)
        return setError(
          `${oversized.name} excede o limite de ${formatBytes(maxUploadSize)}.`,
        );
    }
    setUploading(true);
    setError("");
    const uploaded: string[] = [];
    try {
      for (let index = 0; index < files.length; index++) {
        setUploadProgress(
          `Enviando ${index + 1} de ${files.length}: ${files[index].name}`,
        );
        const result = await uploadPhoto(files[index]);
        setMaxUploadSize(result.maxSizeInBytes);
        uploaded.push(result.publicUrl);
      }
      setForm((old) => ({ ...old, photos: [...old.photos, ...uploaded] }));
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Falha ao enviar as fotos.",
      );
    } finally {
      setUploading(false);
      setUploadProgress("");
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (uploading) return setError("Aguarde o envio das fotos terminar.");
    const parsed = propertySchema.safeParse(form);
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    setSaving(true);
    setError("");
    await onSave(parsed.data).finally(() => setSaving(false));
  }
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-title"
      >
        <div className="drawer-head">
          <div>
            <span className="eyebrow">CATÁLOGO</span>
            <h2 id="editor-title">
              {"id" in initial ? "Editar imóvel" : "Novo imóvel"}
            </h2>
          </div>
          <button onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="form-section">
            <h3>Informações principais</h3>
            <label>
              Título
              <input
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                maxLength={120}
                required
              />
            </label>
            <label>
              Descrição
              <textarea
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                maxLength={2000}
                required
              />
            </label>
            <div className="two-col">
              <label>
                Tipo
                <select
                  value={form.type}
                  onChange={(e) =>
                    set("type", e.target.value as PropertyInput["type"])
                  }
                >
                  {[
                    "apartment",
                    "house",
                    "studio",
                    "room",
                    "sharedRoom",
                    "kitnet",
                  ].map((v) => (
                    <option key={v} value={v}>
                      {typeLabel(v)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Cidade
                <select
                  value={form.cityId}
                  onChange={(e) => set("cityId", e.target.value)}
                >
                  <option value="">Selecione</option>
                  {cities.map((city) => (
                    <option key={city.id} value={city.id}>
                      {city.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className="form-section">
            <h3>Localização</h3>
            <div className="two-col">
              <label>
                Bairro
                <input
                  value={form.neighborhood}
                  onChange={(e) => set("neighborhood", e.target.value)}
                  maxLength={120}
                  required
                />
              </label>
              <label>
                Rua
                <input
                  value={form.street}
                  onChange={(e) => set("street", e.target.value)}
                  maxLength={160}
                  required
                />
              </label>
            </div>
            <div className="two-col">
              <label>
                Número
                <input
                  value={form.addressNumber}
                  onChange={(e) => set("addressNumber", e.target.value)}
                />
              </label>
              <label>
                Complemento
                <input
                  value={form.addressComplement}
                  onChange={(e) => set("addressComplement", e.target.value)}
                />
              </label>
            </div>
          </div>
          <div className="form-section">
            <h3>Valores e estrutura</h3>
            <div className="three-col">
              {(["rent", "iptu", "water", "internet", "condoFee"] as const).map(
                (key) => (
                  <label key={key}>
                    {fieldLabel(key)}
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form[key] || 0}
                      onChange={(e) => set(key, Number(e.target.value))}
                    />
                  </label>
                ),
              )}
            </div>
            <div className="three-col">
              {(["rooms", "bathrooms", "vacancies"] as const).map((key) => (
                <label key={key}>
                  {fieldLabel(key)}
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={form[key]}
                    onChange={(e) => set(key, Number(e.target.value))}
                  />
                </label>
              ))}
            </div>
            <div className="total">
              Custo mensal estimado <strong>{money.format(total)}</strong>
            </div>
          </div>
          <div className="form-section">
            <div className="photo-heading">
              <div>
                <h3>Fotos do imóvel</h3>
                <p>
                  JPG, PNG ou WebP · máximo de 20 fotos
                  {maxUploadSize
                    ? ` · até ${formatBytes(maxUploadSize)} cada`
                    : ""}
                </p>
              </div>
              <label className={`photo-picker ${uploading ? "disabled" : ""}`}>
                {uploading ? "Enviando…" : "+ Selecionar fotos"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={selectPhotos}
                  disabled={uploading || form.photos.length >= 20}
                />
              </label>
            </div>
            {uploadProgress && (
              <div className="upload-progress">
                <i />
                <span>{uploadProgress}</span>
              </div>
            )}
            {form.photos.length > 0 ? (
              <div className="photo-grid">
                {form.photos.map((photo, index) => (
                  <div className="photo-item" key={`${photo}-${index}`}>
                    <img
                      src={safeImage(photo)}
                      alt={`Foto ${index + 1} do imóvel`}
                      referrerPolicy="no-referrer"
                    />
                    <span>{index === 0 ? "Capa" : index + 1}</span>
                    <button
                      type="button"
                      onClick={() =>
                        set(
                          "photos",
                          form.photos.filter(
                            (_, photoIndex) => photoIndex !== index,
                          ),
                        )
                      }
                      aria-label={`Remover foto ${index + 1}`}
                      disabled={uploading}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="photo-empty">
                <strong>Nenhuma foto enviada</strong>
                <span>
                  Selecione os arquivos para fazer upload direto ao
                  armazenamento.
                </span>
              </div>
            )}
          </div>
          <div className="form-section">
            <h3>Detalhes</h3>
            <div className="two-col">
              <label>
                Comodidades <span>separadas por vírgula</span>
                <input
                  value={form.amenities.join(", ")}
                  onChange={(e) =>
                    set(
                      "amenities",
                      e.target.value
                        .split(",")
                        .map((v) => v.trim())
                        .filter(Boolean),
                    )
                  }
                />
              </label>
              <label>
                Regras <span>separadas por vírgula</span>
                <input
                  value={form.rules.join(", ")}
                  onChange={(e) =>
                    set(
                      "rules",
                      e.target.value
                        .split(",")
                        .map((v) => v.trim())
                        .filter(Boolean),
                    )
                  }
                />
              </label>
            </div>
            <label>
              Link de contato
              <input
                type="url"
                value={form.contactLink}
                onChange={(e) => set("contactLink", e.target.value)}
                placeholder="https://wa.me/..."
              />
            </label>
            <div className="checks">
              <label>
                <input
                  type="checkbox"
                  checked={form.furnished}
                  onChange={(e) => set("furnished", e.target.checked)}
                />{" "}
                Mobiliado
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={form.petsAllowed}
                  onChange={(e) => set("petsAllowed", e.target.checked)}
                />{" "}
                Aceita pets
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={form.available}
                  onChange={(e) => set("available", e.target.checked)}
                />{" "}
                Disponível
              </label>
            </div>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="drawer-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancelar
            </button>
            <button className="primary" disabled={saving || uploading}>
              {uploading
                ? "Enviando fotos…"
                : saving
                  ? "Salvando…"
                  : "Salvar imóvel"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function Loading() {
  return (
    <div className="loading-block">
      <div className="spinner" />
      <span>Carregando dados…</span>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <span>○</span>
      <strong>{text}</strong>
      <small>Ajuste os filtros ou tente novamente em instantes.</small>
    </div>
  );
}
function eventLabel(key: string) {
  return (
    (
      {
        "user.registered": "Novo usuário",
        "profile.created": "Perfil criado",
        "message.sent": "Mensagem enviada",
        "match.created": "Novo match",
        "property.created": "Imóvel criado",
        "admin.access.succeeded": "Acesso administrativo",
      } as Record<string, string>
    )[key] || key
  );
}
function typeLabel(value: string) {
  return (
    (
      {
        apartment: "Apartamento",
        house: "Casa",
        studio: "Studio",
        room: "Quarto",
        sharedRoom: "Quarto compartilhado",
        kitnet: "Kitnet",
      } as Record<string, string>
    )[value] || value
  );
}
function fieldLabel(value: string) {
  return (
    {
      rent: "Aluguel",
      iptu: "IPTU",
      water: "Água",
      internet: "Internet",
      condoFee: "Condomínio",
      rooms: "Quartos",
      bathrooms: "Banheiros",
      vacancies: "Vagas",
    } as Record<string, string>
  )[value];
}
function shortId(value?: string) {
  return value ? `${value.slice(0, 8)}…` : "—";
}
function safeImage(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? value : "";
  } catch {
    return "";
  }
}
function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}
