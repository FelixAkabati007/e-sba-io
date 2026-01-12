import React from "react";
import { useAuth } from "../context/AuthContext";
import Login from "../pages/Login";

export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user, token, isAuthenticated } = useAuth();

  // If we have a token but no user yet (loading), we might want to show a spinner.
  // But for simplicity, we'll let AuthProvider handle the initial load.
  // If token is present but user is null, AuthProvider is fetching.
  // We can show a loading screen or just return null.

  if (token && !user) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  return <>{children}</>;
};
