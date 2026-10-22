import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { useAuth } from "./lib/auth";
import type { Role } from "./lib/types";
import { AdminTicketPage } from "./pages/admin/AdminTicketPage";
import { InsightsPage } from "./pages/admin/InsightsPage";
import { QueuePage } from "./pages/admin/QueuePage";
import { BooksPage } from "./pages/author/BooksPage";
import { NewTicketPage } from "./pages/author/NewTicketPage";
import { TicketDetailPage } from "./pages/author/TicketDetailPage";
import { TicketsPage } from "./pages/author/TicketsPage";
import { LoginPage } from "./pages/LoginPage";

function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={homeFor(user.role)} replace />;
  return <>{children}</>;
}

const homeFor = (role: Role) => (role === "ADMIN" ? "/admin/tickets" : "/books");

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  return <Navigate to={user ? homeFor(user.role) : "/login"} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireRole role="AUTHOR">
            <Layout />
          </RequireRole>
        }
      >
        <Route path="/books" element={<BooksPage />} />
        <Route path="/tickets" element={<TicketsPage />} />
        <Route path="/tickets/new" element={<NewTicketPage />} />
        <Route path="/tickets/:id" element={<TicketDetailPage />} />
      </Route>
      <Route
        element={
          <RequireRole role="ADMIN">
            <Layout />
          </RequireRole>
        }
      >
        <Route path="/admin/tickets" element={<QueuePage />} />
        <Route path="/admin/tickets/:id" element={<AdminTicketPage />} />
        <Route path="/admin/insights" element={<InsightsPage />} />
      </Route>
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
