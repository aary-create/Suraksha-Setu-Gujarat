"use client";
import { useId, useState } from "react";
import { ChevronDown } from "./Icon";

// Everything that isn't "what is happening" and "what do I do" lives behind
// one of these. Collapsed by default so the screen stays answerable at a
// glance; one tap away so nothing is actually hidden.
export default function Disclosure({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="disclosure" data-open={open}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        {title}
        <ChevronDown />
      </button>
      {open && <div className="disclosure-body" id={id}>{children}</div>}
    </section>
  );
}
