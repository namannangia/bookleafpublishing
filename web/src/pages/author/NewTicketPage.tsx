import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Field } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { fileSize } from "../../lib/format";
import type { BooksResponse } from "../../lib/types";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/webp,application/pdf";

export function NewTicketPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const books = useQuery({ queryKey: ["books"], queryFn: () => api.get<BooksResponse>("/books") });

  const [bookId, setBookId] = useState(params.get("book") ?? "");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.set("bookId", bookId);
      form.set("subject", subject);
      form.set("description", description);
      if (file) form.set("attachment", file);
      return api.post<{ id: string; reference: string }>("/tickets", form);
    },
    onSuccess: (ticket) => {
      void qc.invalidateQueries({ queryKey: ["tickets"] });
      navigate(`/tickets/${ticket.id}`, { state: { justCreated: ticket.reference } });
    },
    onError: (err) => {
      if (err instanceof ApiError) setFieldErrors(err.fields);
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    // Mirror the server's rules for instant feedback; the server still validates.
    const errs: Record<string, string> = {};
    if (subject.trim().length < 5) errs.subject = "Subject must be at least 5 characters.";
    if (description.trim().length < 20) errs.description = "Please describe the issue in at least 20 characters.";
    if (file && file.size > MAX_BYTES) errs.attachment = "The attachment is too large (max 5 MB).";
    setFieldErrors(errs);
    if (Object.keys(errs).length === 0) submit.mutate();
  };

  return (
    <div className="page narrow">
      <h1>Get help</h1>
      <p className="muted">Tell us what's going on. Our team usually responds within a business day, and urgent issues much sooner.</p>
      <form className="card form" onSubmit={onSubmit} noValidate>
        <Field label="Which book is this about?" error={fieldErrors.bookId}>
          <select value={bookId} onChange={(e) => setBookId(e.target.value)} disabled={books.isLoading}>
            <option value="">General / Account level</option>
            {books.data?.items.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Subject" error={fieldErrors.subject}>
          <input value={subject} maxLength={150} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Royalty for last quarter not received" />
        </Field>
        <Field
          label="Describe the issue"
          error={fieldErrors.description}
          hint="Include dates, amounts, links or order details if you have them; it helps us resolve things faster."
        >
          <textarea rows={7} value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Attachment (optional)" error={fieldErrors.attachment} hint="Photo or PDF, up to 5 MB. Useful for print defects or screenshots.">
          <input type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        {file && (
          <div className="muted small">
            {file.name} · {fileSize(file.size)}
          </div>
        )}
        {submit.error && !(submit.error instanceof ApiError && Object.keys(submit.error.fields).length) && (
          <div className="alert error">{submit.error.message}</div>
        )}
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={() => navigate(-1)}>
            Cancel
          </button>
          <button className="btn primary" disabled={submit.isPending}>
            {submit.isPending ? "Submitting…" : "Submit ticket"}
          </button>
        </div>
      </form>
    </div>
  );
}
