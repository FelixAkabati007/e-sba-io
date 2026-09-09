import React, { createContext, useContext, useState, useEffect } from "react";
import { apiClient } from "../lib/apiClient";

export type User = {
  id: number;
  username: string;
  fullName: string;
  role: "HEAD" | "CLASS" | "SUBJECT";
  assignedClassId?: number;
  assignedClassName?: string;
  assignedSubjectId?: number;
  assignedSubjectName?: string;
};

type AuthContextType = {
  user: User | null;
  token: string | null;
  login: (token: string | undefined, user: User) => void;
  logout: () => void;
  isAuthenticated: boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>("cookie");

  useEffect(() => {
    if (token) {
      apiClient
        .request("/auth/me", "GET")
        .then((data) => {
          setUser((data as { user: User }).user);
        })
        .catch(() => {
          logout();
        });
    }
  }, [token]);

  const login = (_newToken: string | undefined, newUser: User) => {
    setToken("cookie");
    setUser(newUser);
  };

  const logout = () => {
    void apiClient.request("/auth/logout", "POST").catch(() => undefined);
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, token, login, logout, isAuthenticated: !!user }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    return {
      user: null,
      token: null,
      login: () => {},
      logout: () => {},
      isAuthenticated: false,
    };
  }
  return context;
};
