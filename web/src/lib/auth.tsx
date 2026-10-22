import { QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, type ReactNode } from "react";
import { ApiError, api } from "./api";
import type { SessionUser } from "./types";

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Drop cached data from the previous session, but keep the "me" query mounted so observers stay attached. */
const resetSessionCache = (qc: QueryClient, user: SessionUser | null) => {
  qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
  qc.setQueryData(["me"], user);
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return (await api.get<{ user: SessionUser }>("/auth/me")).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: Infinity,
  });

  const login = useCallback(
    async (email: string, password: string) => {
      const { user } = await api.post<{ user: SessionUser }>("/auth/login", { email, password });
      resetSessionCache(qc, user);
      return user;
    },
    [qc],
  );

  const logout = useCallback(async () => {
    await api.post("/auth/logout");
    resetSessionCache(qc, null);
  }, [qc]);

  return (
    <AuthContext.Provider value={{ user: data ?? null, loading: isLoading, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
