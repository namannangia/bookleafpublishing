import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Field } from "../components/ui";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";

/** Demo accounts from the seeded dataset, so reviewers can switch roles in one click. */
const DEMO_ACCOUNTS = [
  { label: "Admin · Aisha Khan", email: "admin@bookleafpub.com", password: "Admin@123" },
  { label: "Author · Priya Sharma", email: "priya.sharma@email.com", password: "Author@123" },
  { label: "Author · Sneha Kulkarni (book in production)", email: "sneha.kulkarni@email.com", password: "Author@123" },
  { label: "Author · Kavita Deshmukh (below payout threshold)", email: "kavita.deshmukh@email.com", password: "Author@123" },
];

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to={user.role === "ADMIN" ? "/admin/tickets" : "/books"} replace />;

  async function signIn(e: string, p: string) {
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      const u = await login(e, p);
      navigate(u.role === "ADMIN" ? "/admin/tickets" : "/books", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.fields);
      } else setError("Couldn't reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void signIn(email, password);
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="brand large">
          <span className="brand-mark">/</span>
          <span>BookLeaf Publishing</span>
        </div>
        <h1>Sign in</h1>
        <p className="muted">Authors: track your books and get help. BookLeaf team: manage the support queue.</p>
        <form onSubmit={onSubmit} noValidate>
          <Field label="Email" error={fieldErrors.email}>
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password" error={fieldErrors.password}>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          {error && <div className="alert error">{error}</div>}
          <button className="btn primary block" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <div className="demo-accounts">
          <span className="field-label">Demo accounts</span>
          {DEMO_ACCOUNTS.map((a) => (
            <button key={a.email} className="btn ghost small block left" disabled={submitting} onClick={() => void signIn(a.email, a.password)}>
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
