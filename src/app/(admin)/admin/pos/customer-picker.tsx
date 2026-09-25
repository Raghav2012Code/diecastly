"use client";

import { useEffect, useState } from "react";
import { Search, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchCustomersAction, type PosCustomerOption } from "./actions";

/**
 * Optional customer for a sale. Walk-in is the default so most sales need no
 * data entry; an existing buyer can be searched by phone or name, or a new one
 * quick-added. Customers are created/updated by the sale RPC, never here.
 */
export function CustomerPicker({
  customer,
  onChange,
}: {
  customer: PosCustomerOption | null;
  onChange: (customer: PosCustomerOption | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"search" | "add">("search");
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<PosCustomerOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || mode !== "search") return;
    let active = true;
    const handle = setTimeout(async () => {
      setSearching(true);
      const result = await searchCustomersAction(term);
      if (!active) return;
      setSearching(false);
      setResults(result.ok ? result.data : []);
    }, 160);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [open, mode, term]);

  function close() {
    setOpen(false);
    setMode("search");
    setTerm("");
    setResults([]);
    setName("");
    setPhone("");
    setFormError(null);
  }

  function pick(option: PosCustomerOption) {
    onChange(option);
    close();
  }

  function saveNew() {
    const trimmedName = name.trim();
    const digits = phone.replace(/\D/g, "");
    if (!trimmedName) {
      setFormError("Enter the customer's name.");
      return;
    }
    if (digits.length < 6) {
      setFormError("Enter a phone number with at least 6 digits.");
      return;
    }
    onChange({ id: null, name: trimmedName, phone: phone.trim(), email: null });
    close();
  }

  return (
    <div className="no-print">
      <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-muted-foreground">Customer</p>
          <p className="truncate text-sm">
            {customer ? `${customer.name} · ${customer.phone}` : "Walk-in"}
          </p>
        </div>
        {customer ? (
          <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
            Clear
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setOpen((value) => !value)}>
            <UserPlus className="h-3.5 w-3.5" />
            Attach
          </Button>
        )}
      </div>

      {open ? (
        <div className="mt-2 rounded-md border border-border bg-card p-3">
          {mode === "search" ? (
            <>
              <div className="relative">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  autoFocus
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                  placeholder="Search by phone or name"
                  aria-label="Search customers"
                  className="pl-8"
                />
              </div>
              <ul className="mt-2 max-h-52 overflow-y-auto">
                {results.length === 0 ? (
                  <li className="px-1 py-2 text-xs text-muted-foreground">
                    {searching
                      ? "Searching…"
                      : term.trim()
                        ? "No customer matches."
                        : "Type to search, or add a new customer."}
                  </li>
                ) : (
                  results.map((option) => (
                    <li key={option.id ?? option.phone}>
                      <button
                        type="button"
                        onClick={() => pick(option)}
                        className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="truncate">{option.name}</span>
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                          {option.phone}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
              <Button
                variant="ghost"
                size="sm"
                className="mt-1"
                onClick={() => {
                  setMode("add");
                  setFormError(null);
                  setName(term.trim());
                  setPhone("");
                }}
              >
                <UserPlus className="h-3.5 w-3.5" />
                Add a new customer
              </Button>
            </>
          ) : (
            <div className="space-y-2">
              <Input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Name"
                aria-label="Customer name"
              />
              <Input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="Phone"
                inputMode="tel"
                aria-label="Customer phone"
              />
              {formError ? (
                <p role="alert" className="text-xs text-destructive">
                  {formError}
                </p>
              ) : null}
              <div className="flex justify-between gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setMode("search");
                    setFormError(null);
                  }}
                >
                  Back
                </Button>
                <Button size="sm" onClick={saveNew}>
                  Attach customer
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
