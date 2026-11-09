import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCreditNotes,
  getListCreditNotesQueryKey,
  useCreateCreditNote,
  useApplyCreditNote,
  useRefundCreditNote,
  useVoidCreditNote,
  useListContacts,
  getListContactsQueryKey,
  type CreditNote,
  type CreditNoteReason,
} from "@workspace/api-client-react";
import { Plus, ReceiptText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useClient } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { apiErrorMessage, centsToInput, formatCents, formatDateTime, invalidateApi, parseCents } from "@/lib/money";

export const CREDIT_REASON_LABELS: Record<CreditNoteReason, string> = {
  return: "Devolución",
  discount: "Descuento posterior",
  price_adjustment: "Ajuste de precio",
  goodwill: "Cortesía",
  other: "Otro",
};

function ContactSearch({ onPick }: { onPick: (c: { id: number; name: string }) => void }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  const params = { search: debounced || undefined };
  const { data: contacts } = useListContacts(params, { query: { enabled: debounced.length > 1, queryKey: getListContactsQueryKey(params) } });
  return (
    <div className="space-y-1.5">
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cliente por nombre o teléfono…" data-testid="input-credit-contact-search" />
      {debounced.length > 1 && (contacts ?? []).length > 0 && (
        <div className="border border-card-border rounded-lg divide-y divide-card-border max-h-40 overflow-y-auto">
          {(contacts ?? []).slice(0, 8).map((c) => (
            <button key={c.id} type="button" onClick={() => onPick({ id: c.id, name: c.name })} className="w-full text-left px-3 py-2 text-sm hover:bg-muted">
              {c.name} <span className="text-xs text-muted-foreground">{c.phone ?? ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NewCreditNoteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const { locale } = useClient();
  const queryClient = useQueryClient();
  const create = useCreateCreditNote();
  const [contact, setContact] = useState<{ id: number; name: string } | null>(null);
  const [orderCode, setOrderCode] = useState("");
  const [reason, setReason] = useState<CreditNoteReason>("discount");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(locale.currency);
  const [ncf, setNcf] = useState("");
  const [notes, setNotes] = useState("");

  const submit = () => {
    const amountCents = parseCents(amount);
    if (!contact || amountCents == null || amountCents <= 0) {
      toast({ title: "Elige el cliente y pon el monto", variant: "destructive" });
      return;
    }
    const orderId = orderCode.trim() ? Number(orderCode.replace(/\D/g, "")) || null : null;
    create.mutate(
      { data: { contactId: contact.id, orderId, reason, amountCents, currency, fiscalNumber: ncf.trim() || null, notes: notes.trim() || null } },
      {
        onSuccess: (n) => {
          void invalidateApi(queryClient, "/api/credit-notes", "/api/orders");
          toast({ title: `Nota de crédito ${n.code} emitida` });
          setContact(null);
          setAmount("");
          setOrderCode("");
          onOpenChange(false);
        },
        onError: (err) => toast({ title: apiErrorMessage(err, "No se pudo emitir"), variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva nota de crédito</DialogTitle>
          <DialogDescription>Saldo a favor del cliente: se usa para pagar otro pedido o se le devuelve en dinero. Si el NCF se emitió en otro sistema, anótalo.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {contact ? (
            <div className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2 text-sm">
              {contact.name}
              <button type="button" onClick={() => setContact(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <ContactSearch onPick={setContact} />
          )}
          <div className="grid grid-cols-2 gap-2">
            <Select value={reason} onValueChange={(v) => setReason(v as CreditNoteReason)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(CREDIT_REASON_LABELS) as CreditNoteReason[])
                  .filter((r) => r !== "return")
                  .map((r) => (
                    <SelectItem key={r} value={r}>
                      {CREDIT_REASON_LABELS[r]}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Input value={orderCode} onChange={(e) => setOrderCode(e.target.value)} placeholder="Pedido (opcional) PED-…" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Monto" className="col-span-2" data-testid="input-credit-amount" />
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...new Set([locale.currency, "USD", "DOP"])].map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input value={ncf} onChange={(e) => setNcf(e.target.value)} placeholder="NCF (opcional)" />
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notas" className="text-sm resize-none" />
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button className="flex-1" onClick={submit} disabled={create.isPending} data-testid="button-create-credit-note">
              Emitir
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UseNoteDialog({ note, mode, onClose }: { note: CreditNote | null; mode: "apply" | "refund"; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const apply = useApplyCreditNote();
  const refund = useRefundCreditNote();
  const [amount, setAmount] = useState("");
  const [orderCode, setOrderCode] = useState("");
  const [method, setMethod] = useState("");
  useEffect(() => {
    if (note) {
      setAmount(centsToInput(note.balanceCents));
      setOrderCode("");
      setMethod("");
    }
  }, [note]);

  const submit = () => {
    if (!note) return;
    const amountCents = parseCents(amount);
    if (amountCents == null || amountCents <= 0) {
      toast({ title: "Pon el monto", variant: "destructive" });
      return;
    }
    const done = {
      onSuccess: () => {
        void invalidateApi(queryClient, "/api/credit-notes", "/api/orders");
        toast({ title: mode === "apply" ? "Aplicada al pedido" : "Reembolso registrado" });
        onClose();
      },
      onError: (err: unknown) => toast({ title: apiErrorMessage(err, "No se pudo registrar"), variant: "destructive" }),
    };
    if (mode === "apply") {
      const orderId = Number(orderCode.replace(/\D/g, ""));
      if (!orderId) {
        toast({ title: "Pon el pedido (PED-…)", variant: "destructive" });
        return;
      }
      apply.mutate({ id: note.id, data: { orderId, amountCents } }, done);
    } else {
      refund.mutate({ id: note.id, data: { amountCents, method: method.trim() || null } }, done);
    }
  };

  return (
    <Dialog open={note != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {mode === "apply" ? "Pagar un pedido con" : "Reembolsar"} {note?.code}
          </DialogTitle>
          <DialogDescription>Saldo: {note ? formatCents(note.balanceCents, note.currency) : ""}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {mode === "apply" ? (
            <Input value={orderCode} onChange={(e) => setOrderCode(e.target.value)} placeholder="Pedido del mismo cliente (PED-…)" data-testid="input-apply-order" />
          ) : (
            <Input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="Cómo se devolvió (transferencia, Zelle…)" />
          )}
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Monto" />
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancelar
            </Button>
            <Button className="flex-1" onClick={submit} disabled={apply.isPending || refund.isPending}>
              Registrar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function CreditNotesView() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [withBalance, setWithBalance] = useState(false);
  const params = { withBalance: withBalance || undefined };
  const { data: notes, isLoading } = useListCreditNotes(params, { query: { queryKey: getListCreditNotesQueryKey(params) } });
  const voidNote = useVoidCreditNote();
  const [creating, setCreating] = useState(false);
  const [using, setUsing] = useState<{ note: CreditNote; mode: "apply" | "refund" } | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={withBalance} onCheckedChange={setWithBalance} />
          Solo con saldo a favor
        </label>
        <Button size="sm" className="gap-1.5 ml-auto" onClick={() => setCreating(true)} data-testid="button-new-credit-note">
          <Plus className="w-4 h-4" /> Nota de crédito
        </Button>
      </div>
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-10 rounded-lg bg-muted/40 animate-pulse" />)}</div>
        ) : (notes ?? []).length === 0 ? (
          <div className="p-10 text-center">
            <ReceiptText className="w-7 h-7 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Sin notas de crédito.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-card-border text-xs text-muted-foreground">
                  <th className="text-left font-medium px-4 py-3">Nota</th>
                  <th className="text-left font-medium px-3 py-3">Cliente</th>
                  <th className="text-left font-medium px-3 py-3">Motivo</th>
                  <th className="text-right font-medium px-3 py-3">Monto</th>
                  <th className="text-right font-medium px-3 py-3">Usado</th>
                  <th className="text-right font-medium px-3 py-3">Saldo</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {(notes ?? []).map((n) => (
                  <tr key={n.id} className={cn("border-b border-card-border/60 hover:bg-muted/40", n.status === "void" && "opacity-50")} data-testid={`credit-note-row-${n.id}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium">
                        {n.code}
                        {n.status === "void" && <span className="text-xs text-muted-foreground"> · anulada</span>}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {formatDateTime(n.createdAt)}
                        {n.fiscalNumber ? ` · NCF ${n.fiscalNumber}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">{n.contactName ?? "—"}</td>
                    <td className="px-3 py-2.5 text-xs">
                      {CREDIT_REASON_LABELS[n.reason]}
                      {n.orderCode && (
                        <button type="button" onClick={() => setLocation(`/orders?order=${n.orderId}`)} className="block text-primary hover:underline">
                          {n.orderCode}
                        </button>
                      )}
                      {n.returnCode && <span className="block text-muted-foreground">{n.returnCode}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatCents(n.amountCents, n.currency)}</td>
                    <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">
                      {n.applications.map((a) => (
                        <div key={`${a.orderId}-${a.createdAt}`}>
                          {a.orderCode}: {formatCents(a.amountCents, n.currency)}
                        </div>
                      ))}
                      {n.refundedCents > 0 && (
                        <div>
                          Reembolso {formatCents(n.refundedCents, n.currency)}
                          {n.refundMethod ? ` (${n.refundMethod})` : ""}
                        </div>
                      )}
                      {!n.applications.length && !n.refundedCents && "—"}
                    </td>
                    <td className={cn("px-3 py-2.5 text-right tabular-nums font-semibold", n.balanceCents > 0 && "text-emerald-600 dark:text-emerald-400")}>{formatCents(n.balanceCents, n.currency)}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {n.status === "issued" && n.balanceCents > 0 && (
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setUsing({ note: n, mode: "apply" })}>
                            Usar en pedido
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setUsing({ note: n, mode: "refund" })}>
                            Reembolsar
                          </Button>
                          {n.appliedCents === 0 && n.refundedCents === 0 && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              onClick={() => {
                                if (!window.confirm(`¿Anular ${n.code}?`)) return;
                                voidNote.mutate(
                                  { id: n.id },
                                  {
                                    onSuccess: () => void invalidateApi(queryClient, "/api/credit-notes", "/api/orders"),
                                    onError: (err) => toast({ title: apiErrorMessage(err, "No se pudo anular"), variant: "destructive" }),
                                  },
                                );
                              }}
                            >
                              Anular
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <NewCreditNoteDialog open={creating} onOpenChange={setCreating} />
      <UseNoteDialog note={using?.note ?? null} mode={using?.mode ?? "apply"} onClose={() => setUsing(null)} />
    </div>
  );
}
