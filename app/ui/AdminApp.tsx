"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, api, readSession, saveSession, Session } from "../lib/api";
import { loginSchema, propertySchema, PropertyInput } from "../lib/schemas";

type View = "overview" | "properties" | "events";
type Overview = { users: { total: number; verified: number; createdInRange: number }; profiles: { total: number; completed: number; completionRate: number }; engagement: { likes: number; matches: number; contactRequests: number; conversations: number; messages: number }; properties: { total: number; favorites: number }; analytics: { eventsInRange: number } };
type Property = PropertyInput & { id: string; ownerName?: string; totalMonthlyCost: number; city?: { name: string; state: string }; createdAt: string };
type EventItem = { id: string; type: string; userId?: string; entityType?: string; entityId?: string; ipHash?: string; userAgent?: string; createdAt: string };
type City = { id: string; label: string };

const EMPTY_PROPERTY: PropertyInput = { cityId: "", title: "", description: "", neighborhood: "", street: "", addressNumber: "", addressComplement: "", rent: 0, iptu: 0, water: 0, internet: 0, condoFee: 0, rooms: 1, bathrooms: 1, area: undefined, vacancies: 1, furnished: false, petsAllowed: false, photos: [], amenities: [], rules: [], type: "studio", available: true, contactLink: "" };
const fmt = new Intl.NumberFormat("pt-BR");
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const date = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));

export function AdminApp() {
  const [session, setSessionState] = useState<Session | null>(null);
  const [stage, setStage] = useState<"loading" | "login" | "admin" | "app" | "denied">("loading");
  const [view, setView] = useState<View>("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [showEditor, setShowEditor] = useState(false);
  const [editing, setEditing] = useState<Property | null>(null);
  const [search, setSearch] = useState("");
  const [idleWarning, setIdleWarning] = useState(false);

  const storeSession = useCallback((next: Session | null) => {
    setSessionState(next); saveSession(next);
  }, []);

  const logout = useCallback(() => {
    storeSession(null); setOverview(null); setProperties([]); setEvents([]); setStage("login");
    history.replaceState(null, "", "/");
  }, [storeSession]);

  useEffect(() => {
    const saved = readSession();
    if (!saved) return setStage("login");
    if (saved.user?.role !== "admin") { storeSession(null); return setStage("denied"); }
    setSessionState(saved);
    if (!saved.adminAccessToken || (saved.adminExpiresAt || 0) <= Date.now()) setStage("admin");
    else setStage("app");
  }, [storeSession]);

  useEffect(() => {
    if (stage !== "app") return;
    let warningTimer: number; let logoutTimer: number;
    const reset = () => {
      setIdleWarning(false); clearTimeout(warningTimer); clearTimeout(logoutTimer);
      warningTimer = window.setTimeout(() => setIdleWarning(true), 24 * 60_000);
      logoutTimer = window.setTimeout(logout, 25 * 60_000);
    };
    const events = ["pointerdown", "keydown", "scroll"] as const;
    events.forEach((event) => window.addEventListener(event, reset, { passive: true })); reset();
    return () => { events.forEach((event) => window.removeEventListener(event, reset)); clearTimeout(warningTimer); clearTimeout(logoutTimer); };
  }, [stage, logout]);

  const guarded = useCallback(async <T,>(path: string, options: RequestInit = {}) => {
    if (!session || session.user.role !== "admin") throw new ApiError(403, "Acesso negado.");
    try { return await api<T>(path, { ...options, session, admin: path.startsWith("/admin/") }); }
    catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        if (path.startsWith("/admin/")) { const next = { ...session, adminAccessToken: undefined, adminExpiresAt: undefined }; storeSession(next); setStage("admin"); }
        else logout();
      }
      if (error instanceof ApiError && error.status === 403) setStage("denied");
      throw error;
    }
  }, [session, logout, storeSession]);

  useEffect(() => {
    if (stage !== "app" || !session) return;
    const controller = new AbortController();
    setBusy(true);
    Promise.all([
      guarded<{ data: Overview }>("/admin/metrics/overview", { signal: controller.signal }),
      api<{ data: Property[] }>("/property-listings?limit=50&offset=0", { signal: controller.signal }),
      guarded<{ data: EventItem[] }>("/admin/events?limit=8&offset=0", { signal: controller.signal }),
      api<{ data: City[] }>("/catalog/cities", { signal: controller.signal }),
    ]).then(([m, p, e, c]) => { setOverview(m.data); setProperties(p.data); setEvents(e.data); setCities(c.data); })
      .catch((error) => { if (!(error instanceof DOMException)) setNotice(error.message); }).finally(() => setBusy(false));
    return () => controller.abort();
  }, [stage, session?.adminAccessToken, guarded]);

  if (stage === "loading") return <div className="center-screen"><div className="spinner" /><p>Validando sua sessão…</p></div>;
  if (stage === "login") return <Login onSuccess={(next) => { storeSession(next); setStage(next.user.role === "admin" ? "admin" : "denied"); }} />;
  if (stage === "admin" && session) return <AdminGate session={session} onSuccess={(token, minutes) => { const next = { ...session, adminAccessToken: token, adminExpiresAt: Date.now() + minutes * 60_000 }; storeSession(next); setStage("app"); }} onLogout={logout} />;
  if (stage === "denied") return <Denied onLogout={logout} />;

  const filteredProperties = properties.filter((item) => `${item.title} ${item.neighborhood} ${item.city?.name || ""}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">U</span><span>unify<small>ADMIN</small></span></div>
        <nav>
          <button className={view === "overview" ? "active" : ""} onClick={() => setView("overview")}><i>◫</i>Visão geral</button>
          <button className={view === "properties" ? "active" : ""} onClick={() => setView("properties")}><i>⌂</i>Imóveis</button>
          <button className={view === "events" ? "active" : ""} onClick={() => setView("events")}><i>∿</i>Eventos</button>
        </nav>
        <div className="sidebar-foot"><span className="avatar">{session?.user.name?.[0] || "A"}</span><div><strong>{session?.user.name}</strong><small>Administrador</small></div><button aria-label="Sair" onClick={logout}>→</button></div>
      </aside>
      <main>
        <header><div><span className="eyebrow">CENTRAL DE OPERAÇÕES</span><h1>{view === "overview" ? "Visão geral" : view === "properties" ? "Gestão de imóveis" : "Auditoria de eventos"}</h1></div><div className="status"><span />Ambiente seguro</div></header>
        {notice && <div className="notice" role="alert">{notice}<button onClick={() => setNotice("")}>Fechar</button></div>}
        {view === "overview" && <OverviewPage data={overview} events={events} busy={busy} onProperties={() => setView("properties")} />}
        {view === "properties" && <PropertiesPage items={filteredProperties} search={search} setSearch={setSearch} busy={busy} onNew={() => { setEditing(null); setShowEditor(true); }} onEdit={(item) => { setEditing(item); setShowEditor(true); }} />}
        {view === "events" && <EventsPage items={events} busy={busy} />}
      </main>
      {showEditor && session && <PropertyEditor initial={editing || EMPTY_PROPERTY} cities={cities} onClose={() => setShowEditor(false)} onSave={async (value) => {
        setBusy(true); try {
          const path = editing ? `/property-listings/${editing.id}` : "/property-listings";
          const response = await guarded<{ data: Property }>(path, { method: editing ? "PUT" : "POST", body: JSON.stringify(value) });
          setProperties((old) => editing ? old.map((item) => item.id === editing.id ? { ...item, ...response.data } : item) : [response.data, ...old]);
          setShowEditor(false); setNotice(editing ? "Imóvel atualizado com sucesso." : "Imóvel criado com sucesso.");
        } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível salvar."); } finally { setBusy(false); }
      }} />}
      {idleWarning && <div className="idle-warning"><strong>Sessão prestes a expirar</strong><span>Você será desconectado em 1 minuto por inatividade.</span><button onClick={() => setIdleWarning(false)}>Continuar conectado</button></div>}
    </div>
  );
}

function Login({ onSuccess }: { onSuccess: (session: Session) => void }) {
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); const form = new FormData(event.currentTarget);
    const parsed = loginSchema.safeParse({ email: form.get("email"), password: form.get("password") });
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    setBusy(true); try { const response = await api<{ data: Session }>("/auth/login", { method: "POST", body: JSON.stringify(parsed.data) }); onSuccess(response.data); } catch (e) { setError(e instanceof Error ? e.message : "Falha ao entrar."); } finally { setBusy(false); }
  }
  return <div className="auth-layout"><section className="auth-aside"><div className="brand light"><span className="brand-mark">U</span><span>unify<small>ADMIN</small></span></div><div><span className="eyebrow">INTELIGÊNCIA OPERACIONAL</span><h1>Decisões melhores começam com uma visão clara.</h1><p>Acompanhe a comunidade, os imóveis e os sinais que movem a Unify em um só lugar.</p></div><small>Acesso exclusivo para a equipe autorizada.</small></section><section className="auth-form"><form onSubmit={submit} noValidate><span className="mobile-logo">unify admin</span><div><span className="eyebrow">BEM-VINDO DE VOLTA</span><h2>Acesse o painel</h2><p>Use as mesmas credenciais da sua conta Unify.</p></div><label>E-mail<input type="email" name="email" autoComplete="username" placeholder="voce@unify.com" maxLength={254} required /></label><label>Senha<input type="password" name="password" autoComplete="current-password" placeholder="Sua senha" minLength={8} maxLength={128} required /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary" disabled={busy}>{busy ? "Entrando…" : "Entrar no painel"}</button><p className="privacy">Suas credenciais são enviadas apenas para a API configurada da Unify.</p></form></section></div>;
}

function AdminGate({ session, onSuccess, onLogout }: { session: Session; onSuccess: (token: string, minutes: number) => void; onLogout: () => void }) {
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const code = String(new FormData(event.currentTarget).get("code") || "").trim(); if (!code || code.length > 100) return setError("Informe o código de acesso."); setBusy(true); setError(""); try { const response = await api<{ data: { adminAccessToken: string; expiresInMinutes: number } }>("/auth/admin/access", { method: "POST", session, body: JSON.stringify({ code }) }); onSuccess(response.data.adminAccessToken, response.data.expiresInMinutes); } catch (e) { setError(e instanceof Error ? e.message : "Código inválido."); } finally { setBusy(false); } }
  return <div className="gate"><div className="gate-card"><div className="shield">✓</div><span className="eyebrow">SEGUNDA CAMADA</span><h1>Confirme seu acesso</h1><p>Olá, {session.user.name}. Digite o código administrativo para abrir o painel. Este acesso é temporário.</p><form onSubmit={submit}><label>Código do painel<input name="code" type="password" autoFocus autoComplete="one-time-code" maxLength={100} placeholder="••••••" /></label>{error && <p className="form-error">{error}</p>}<button className="primary" disabled={busy}>{busy ? "Validando…" : "Confirmar acesso"}</button><button type="button" className="text-button" onClick={onLogout}>Sair da conta</button></form></div></div>;
}

function Denied({ onLogout }: { onLogout: () => void }) { return <div className="gate"><div className="gate-card"><div className="shield denied">!</div><span className="eyebrow">ACESSO NEGADO</span><h1>Esta área é restrita</h1><p>Sua conta não possui permissão administrativa. Se isso parecer incorreto, fale com um responsável pela Unify.</p><button className="primary" onClick={onLogout}>Voltar ao login</button></div></div>; }

function OverviewPage({ data, events, busy, onProperties }: { data: Overview | null; events: EventItem[]; busy: boolean; onProperties: () => void }) {
  if (busy && !data) return <Loading />; if (!data) return <Empty text="Nenhuma métrica disponível." />;
  const cards = [["Usuários", data.users.total, `+${data.users.createdInRange} no período`, "indigo"], ["Perfis completos", data.profiles.completed, `${data.profiles.completionRate}% de conclusão`, "green"], ["Matches", data.engagement.matches, `${fmt.format(data.engagement.likes)} curtidas`, "violet"], ["Imóveis", data.properties.total, `${fmt.format(data.properties.favorites)} favoritos`, "orange"]] as const;
  return <><section className="metric-grid">{cards.map(([label, value, detail, color]) => <article className={`metric ${color}`} key={label}><div className="metric-top"><span>{label}</span><i /></div><strong>{fmt.format(value)}</strong><small>{detail}</small></article>)}</section><section className="content-grid"><article className="panel chart-panel"><div className="panel-head"><div><span className="eyebrow">ENGAJAMENTO</span><h2>Pulso da comunidade</h2></div><span className="period">Período atual</span></div><div className="bar-chart">{[["Curtidas", data.engagement.likes], ["Mensagens", data.engagement.messages], ["Contatos", data.engagement.contactRequests], ["Conversas", data.engagement.conversations]].map(([label, value]) => <div className="bar-row" key={label}><span>{label}</span><div><i style={{ width: `${Math.min(100, (Number(value) / Math.max(data.engagement.messages, data.engagement.likes, 1)) * 100)}%` }} /></div><strong>{fmt.format(Number(value))}</strong></div>)}</div></article><article className="panel"><div className="panel-head"><div><span className="eyebrow">ATIVIDADE</span><h2>Eventos recentes</h2></div></div><div className="event-list">{events.slice(0, 5).map((item) => <div key={item.id}><span className="event-dot" /><p><strong>{eventLabel(item.type)}</strong><small>{date(item.createdAt)}</small></p></div>)}</div></article></section><section className="quick"><div><span className="eyebrow">GESTÃO</span><h2>Pronto para revisar o catálogo?</h2><p>{data.properties.total} imóveis publicados na plataforma.</p></div><button className="secondary" onClick={onProperties}>Gerenciar imóveis →</button></section></>;
}

function PropertiesPage({ items, search, setSearch, busy, onNew, onEdit }: { items: Property[]; search: string; setSearch: (v: string) => void; busy: boolean; onNew: () => void; onEdit: (item: Property) => void }) {
  return <section className="panel table-panel"><div className="toolbar"><div className="search"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por título, bairro ou cidade" /></div><button className="primary small" onClick={onNew}>+ Novo imóvel</button></div>{busy && !items.length ? <Loading /> : !items.length ? <Empty text="Nenhum imóvel encontrado." /> : <div className="table-wrap"><table><thead><tr><th>Imóvel</th><th>Localização</th><th>Mensalidade</th><th>Status</th><th /></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><div className="property-cell"><span className="property-thumb">{item.photos?.[0] ? <img src={safeImage(item.photos[0])} alt="" /> : "⌂"}</span><div><strong>{item.title}</strong><small>{typeLabel(item.type)} · {item.rooms} quarto(s)</small></div></div></td><td>{item.neighborhood}<small className="table-sub">{item.city ? `${item.city.name} · ${item.city.state}` : "Cidade não informada"}</small></td><td><strong>{money.format(item.totalMonthlyCost || item.rent)}</strong></td><td><span className={item.available ? "pill success" : "pill muted"}>{item.available ? "Disponível" : "Indisponível"}</span></td><td><button className="icon-button" onClick={() => onEdit(item)} aria-label={`Editar ${item.title}`}>⋯</button></td></tr>)}</tbody></table></div>}</section>;
}

function EventsPage({ items, busy }: { items: EventItem[]; busy: boolean }) { return <section className="panel table-panel">{busy && !items.length ? <Loading /> : !items.length ? <Empty text="Nenhum evento registrado." /> : <div className="table-wrap"><table><thead><tr><th>Evento</th><th>Entidade</th><th>Usuário</th><th>Data</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><span className="pill info">{item.type}</span></td><td>{item.entityType || "—"}<small className="table-sub mono">{shortId(item.entityId)}</small></td><td className="mono">{shortId(item.userId)}</td><td>{date(item.createdAt)}</td></tr>)}</tbody></table></div>}</section>; }

function PropertyEditor({ initial, cities, onClose, onSave }: { initial: PropertyInput; cities: City[]; onClose: () => void; onSave: (value: PropertyInput) => Promise<void> }) {
  const [form, setForm] = useState<PropertyInput>(initial); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const total = useMemo(() => form.rent + (form.iptu || 0) + (form.water || 0) + (form.internet || 0) + (form.condoFee || 0), [form]);
  const set = <K extends keyof PropertyInput>(key: K, value: PropertyInput[K]) => setForm((old) => ({ ...old, [key]: value }));
  async function submit(event: FormEvent) { event.preventDefault(); const parsed = propertySchema.safeParse(form); if (!parsed.success) return setError(parsed.error.issues[0].message); setSaving(true); setError(""); await onSave(parsed.data).finally(() => setSaving(false)); }
  return <div className="modal-backdrop" role="presentation"><section className="drawer" role="dialog" aria-modal="true" aria-labelledby="editor-title"><div className="drawer-head"><div><span className="eyebrow">CATÁLOGO</span><h2 id="editor-title">{("id" in initial) ? "Editar imóvel" : "Novo imóvel"}</h2></div><button onClick={onClose} aria-label="Fechar">×</button></div><form onSubmit={submit}><div className="form-section"><h3>Informações principais</h3><label>Título<input value={form.title} onChange={(e) => set("title", e.target.value)} maxLength={120} required /></label><label>Descrição<textarea value={form.description} onChange={(e) => set("description", e.target.value)} maxLength={2000} required /></label><div className="two-col"><label>Tipo<select value={form.type} onChange={(e) => set("type", e.target.value as PropertyInput["type"])}>{["apartment", "house", "studio", "room", "sharedRoom", "kitnet"].map((v) => <option key={v} value={v}>{typeLabel(v)}</option>)}</select></label><label>Cidade<select value={form.cityId} onChange={(e) => set("cityId", e.target.value)}><option value="">Selecione</option>{cities.map((city) => <option key={city.id} value={city.id}>{city.label}</option>)}</select></label></div></div><div className="form-section"><h3>Localização</h3><div className="two-col"><label>Bairro<input value={form.neighborhood} onChange={(e) => set("neighborhood", e.target.value)} maxLength={120} required /></label><label>Rua<input value={form.street} onChange={(e) => set("street", e.target.value)} maxLength={160} required /></label></div><div className="two-col"><label>Número<input value={form.addressNumber} onChange={(e) => set("addressNumber", e.target.value)} /></label><label>Complemento<input value={form.addressComplement} onChange={(e) => set("addressComplement", e.target.value)} /></label></div></div><div className="form-section"><h3>Valores e estrutura</h3><div className="three-col">{(["rent", "iptu", "water", "internet", "condoFee"] as const).map((key) => <label key={key}>{fieldLabel(key)}<input type="number" min="0" step="0.01" value={form[key] || 0} onChange={(e) => set(key, Number(e.target.value))} /></label>)}</div><div className="three-col">{(["rooms", "bathrooms", "vacancies"] as const).map((key) => <label key={key}>{fieldLabel(key)}<input type="number" min="1" max="50" value={form[key]} onChange={(e) => set(key, Number(e.target.value))} /></label>)}</div><div className="total">Custo mensal estimado <strong>{money.format(total)}</strong></div></div><div className="form-section"><h3>Detalhes</h3><label>URLs das fotos <span>uma por linha</span><textarea value={form.photos.join("\n")} onChange={(e) => set("photos", e.target.value.split("\n").map((v) => v.trim()).filter(Boolean))} placeholder="https://..." /></label><div className="two-col"><label>Comodidades <span>separadas por vírgula</span><input value={form.amenities.join(", ")} onChange={(e) => set("amenities", e.target.value.split(",").map((v) => v.trim()).filter(Boolean))} /></label><label>Regras <span>separadas por vírgula</span><input value={form.rules.join(", ")} onChange={(e) => set("rules", e.target.value.split(",").map((v) => v.trim()).filter(Boolean))} /></label></div><label>Link de contato<input type="url" value={form.contactLink} onChange={(e) => set("contactLink", e.target.value)} placeholder="https://wa.me/..." /></label><div className="checks"><label><input type="checkbox" checked={form.furnished} onChange={(e) => set("furnished", e.target.checked)} /> Mobiliado</label><label><input type="checkbox" checked={form.petsAllowed} onChange={(e) => set("petsAllowed", e.target.checked)} /> Aceita pets</label><label><input type="checkbox" checked={form.available} onChange={(e) => set("available", e.target.checked)} /> Disponível</label></div></div>{error && <p className="form-error">{error}</p>}<div className="drawer-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={saving}>{saving ? "Salvando…" : "Salvar imóvel"}</button></div></form></section></div>;
}

function Loading() { return <div className="loading-block"><div className="spinner" /><span>Carregando dados…</span></div>; }
function Empty({ text }: { text: string }) { return <div className="empty"><span>○</span><strong>{text}</strong><small>Ajuste os filtros ou tente novamente em instantes.</small></div>; }
function eventLabel(key: string) { return ({ "user.registered": "Novo usuário", "profile.created": "Perfil criado", "message.sent": "Mensagem enviada", "match.created": "Novo match", "property.created": "Imóvel criado", "admin.access.succeeded": "Acesso administrativo" } as Record<string, string>)[key] || key; }
function typeLabel(value: string) { return ({ apartment: "Apartamento", house: "Casa", studio: "Studio", room: "Quarto", sharedRoom: "Quarto compartilhado", kitnet: "Kitnet" } as Record<string, string>)[value] || value; }
function fieldLabel(value: string) { return ({ rent: "Aluguel", iptu: "IPTU", water: "Água", internet: "Internet", condoFee: "Condomínio", rooms: "Quartos", bathrooms: "Banheiros", vacancies: "Vagas" } as Record<string, string>)[value]; }
function shortId(value?: string) { return value ? `${value.slice(0, 8)}…` : "—"; }
function safeImage(value: string) { try { const url = new URL(value); return url.protocol === "https:" ? value : ""; } catch { return ""; } }
