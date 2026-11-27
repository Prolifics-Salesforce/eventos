import type { formField } from "@/db/schema";

type Field = typeof formField.$inferSelect;

/** Renders an event's own questions. Each input is named `answer.<key>`. */
export function FieldInputs({ fields }: { fields: Field[] }) {
  return (
    <>
      {[...fields].sort((a, b) => a.position - b.position).map((f) => {
        const name = `answer.${f.key}`;
        if (f.type === "terms") return <label className="check" key={f.id}><input type="checkbox" name={name} required /> {f.label}</label>;
        if (f.type === "checkbox") return <label className="check" key={f.id}><input type="checkbox" name={name} required={f.required} /> {f.label}</label>;
        if (f.type === "select") {
          return (
            <label key={f.id}>{f.label}{f.required ? "" : " (optional)"}
              <select name={name} required={f.required} defaultValue=""><option value="" disabled={f.required}>Choose…</option>{f.options.map((o) => <option key={o}>{o}</option>)}</select>
            </label>
          );
        }
        const kind = { phone: { type: "tel", autoComplete: "tel", placeholder: "+919876543210" }, company: { autoComplete: "organization" }, website: { inputMode: "url" as const, placeholder: "example.com" }, social: { placeholder: "linkedin.com/in/…" } }[f.type as string] ?? {};
        return <label key={f.id}>{f.label}{f.required ? "" : " (optional)"}<input name={name} required={f.required} maxLength={2000} {...kind} /></label>;
      })}
    </>
  );
}
