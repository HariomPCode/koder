"use client";

import { createContext, useEffect, useState, ReactNode } from "react";
import {
  api,
  AUTH_EXPIRED_EVENT,
  ApiError,
} from "@/lib/api-client";
import type { User } from "@/types/api";

export type AuthStatus =
  | "checking"
  | "authenticated"
  | "unauthenticated"
  | "error";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  status: AuthStatus;
  error: string | null;
  refreshUser: () => Promise<boolean>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  status: "checking",
  error: null,
  refreshUser: async () => false,
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [error, setError] = useState<string | null>(null);

  const refreshUser = async () => {
    setStatus("checking");
    setError(null);
    try {
      const data = await api.get<{ user: User }>("/api/v1/user");
      setUser(data.user);
      setStatus("authenticated");
      return true;
    } catch (caughtError) {
      setUser(null);
      if (caughtError instanceof ApiError && [401, 403].includes(caughtError.status)) {
        setStatus("unauthenticated");
      } else {
        setStatus("error");
        setError("Unable to verify your session. Please try again.");
      }
      return false;
    }
  };

  const logout = async () => {
    setUser(null);
    setStatus("unauthenticated");
    setError(null);
    try {
      await api.post("/api/v1/auth/signout");
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    const handleAuthExpired = () => {
      setUser(null);
      setStatus("unauthenticated");
      setError(null);
      if (window.location.pathname !== "/signin" && window.location.pathname !== "/signup") {
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.assign(`/signin?next=${encodeURIComponent(next)}`);
      }
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    const timer = window.setTimeout(() => {
      void refreshUser();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading: status === "checking",
        status,
        error,
        refreshUser,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
