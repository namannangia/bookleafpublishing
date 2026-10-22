import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useRealtime } from "../lib/realtime";

const AUTHOR_NAV = [
  { to: "/books", label: "My Books" },
  { to: "/tickets", label: "My Tickets" },
  { to: "/tickets/new", label: "Get Help" },
];

const ADMIN_NAV = [
  { to: "/admin/tickets", label: "Ticket Queue" },
  { to: "/admin/insights", label: "AI Insights" },
];

export function Layout() {
  const { user, logout } = useAuth();
  const live = useRealtime(Boolean(user));
  const nav = user?.role === "ADMIN" ? ADMIN_NAV : AUTHOR_NAV;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">/</span>
          <span>
            BookLeaf <span className="brand-sub">{user?.role === "ADMIN" ? "Support Desk" : "Author Portal"}</span>
          </span>
        </div>
        <nav>
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end className={({ isActive }) => (isActive ? "active" : undefined)}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="topbar-right">
          <span className={`live live-${live}`} title={live === "live" ? "Updates arrive in real time" : "Reconnecting…"}>
            {live === "live" ? "Live" : "Reconnecting"}
          </span>
          <span className="user-name">{user?.name}</span>
          <button className="btn ghost small" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
