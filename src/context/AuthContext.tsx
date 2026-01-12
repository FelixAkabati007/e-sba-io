import React, { createContext, useContext, useState, useEffect } from "react";
import { apiClient } from "../lib/apiClient";

type User = {
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
  login: (token: string, user: User) => void;
  logout: () => void;
  isAuthenticated: boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(
    localStorage.getItem("token")
  );

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

  const login = (newToken: string, newUser: User) => {
    localStorage.setItem("token", newToken);
    setToken(newToken);
    setUser(newUser);
  };

  const logout = () => {
    localStorage.removeItem("token");
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
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
};
