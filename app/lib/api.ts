export type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  isVerified: boolean;
};

export type Session = {
  accessToken: string;
  refreshToken?: string;
  adminAccessToken?: string;
  adminExpiresAt?: number;
  user: User;
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001").replace(/\/$/, "");

export async function api<T>(
  path: string,
  options: RequestInit & { session?: Session; admin?: boolean } = {},
): Promise<T> {
  const { session, admin, ...request } = options;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  const headers = new Headers(request.headers);
  headers.set("Accept", "application/json");
  if (request.body) headers.set("Content-Type", "application/json");
  if (session?.accessToken) headers.set("Authorization", `Bearer ${session.accessToken}`);
  if (admin && session?.adminAccessToken) headers.set("X-Admin-Access-Token", session.adminAccessToken);

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...request,
      headers,
      signal: request.signal || controller.signal,
      credentials: "include",
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const fallback: Record<number, string> = {
        400: "Revise os dados informados.", 401: "Sua sessão expirou.",
        403: "Você não tem permissão para esta ação.", 404: "Registro não encontrado.",
        409: "Este registro possui um conflito.", 422: "Alguns campos são inválidos.",
        429: "Muitas tentativas. Aguarde um pouco.", 500: "Não foi possível concluir agora.",
        503: "Serviço administrativo indisponível.",
      };
      throw new ApiError(response.status, payload?.message || fallback[response.status] || "Erro inesperado.");
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "Não foi possível conectar à API.");
  } finally {
    window.clearTimeout(timeout);
  }
}

export const SESSION_KEY = "unify.admin.session";

export function readSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveSession(session: Session | null) {
  if (!session) sessionStorage.removeItem(SESSION_KEY);
  else sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}
