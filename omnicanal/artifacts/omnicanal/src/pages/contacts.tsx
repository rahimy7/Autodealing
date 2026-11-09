import { useContactTags } from "@/hooks/use-contact-tags";
import ImportContacts from "@/components/ImportContacts";
import { useState } from "react";
import { useLocation } from "wouter";
import { useListContacts, useCreateContact, useDeleteContact, getListContactsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Users, Trash2, Search, MessageSquare, ChevronRight } from "lucide-react";
import { SiWhatsapp, SiInstagram, SiFacebook, SiGmail } from "react-icons/si";
import Layout from "@/components/layout/Layout";
import MetaContactProfile from "@/components/MetaContactProfile";
import ContactAvatar from "@/components/ContactAvatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const TAG_STYLES: Record<string, string> = {
  jovenes: "bg-yellow-500/15 text-yellow-600",
  junta: "bg-purple-500/15 text-purple-600",
  visitas: "bg-orange-500/15 text-orange-600",
  miembros: "bg-green-500/15 text-green-600",
  lead: "bg-blue-500/15 text-blue-400",
  vip: "bg-yellow-500/15 text-yellow-400",
  in_process: "bg-purple-500/15 text-purple-400",
  support: "bg-red-500/15 text-red-400",
};


const CHANNEL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  whatsapp: (props) => <SiWhatsapp {...props} />,
  instagram: (props) => <SiInstagram {...props} />,
  facebook: (props) => <SiFacebook {...props} />,
  email: (props) => <SiGmail {...props} />,
};

const formSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  phone: z.string().optional(),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  tag: z.enum(["lead", "vip", "in_process", "support", "jovenes", "junta", "visitas", "miembros"]).optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function ContactsPage() {
  const { labels: TAG_LABELS, options: tagOptions } = useContactTags();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string>("all");

  const { data: contacts, isLoading } = useListContacts(
    search || tagFilter !== "all" ? { search: search || undefined, tag: tagFilter !== "all" ? tagFilter : undefined } : undefined
  );
  const createContact = useCreateContact();
  const deleteContact = useDeleteContact();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", phone: "", email: "", notes: "" },
  });

  const onSubmit = (values: FormValues) => {
    createContact.mutate({ data: { ...values, email: values.email || undefined } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        setOpen(false);
        form.reset();
        toast({ title: "Contacto creado", description: "El contacto fue agregado exitosamente." });
      },
    });
  };

  const handleDelete = (id: number) => {
    deleteContact.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        toast({ title: "Contacto eliminado" });
      },
    });
  };

  return (
    <Layout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Contactos</h1>
            <p className="text-sm text-muted-foreground">Contactos de la comunidad y perfiles de redes sociales</p>
          </div>
          <div className="flex items-center gap-2"><ImportContacts />
          <Button onClick={() => setOpen(true)} data-testid="button-new-contact" className="gap-2">
            <Plus className="w-4 h-4" /> Nuevo Contacto
          </Button></div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="search"
              placeholder="Buscar por nombre, @usuario, teléfono o correo..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm bg-card border border-card-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              data-testid="input-search-contacts"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {["all", ...tagOptions.map(option => option.value)].map((tag) => (
              <button
                key={tag}
                onClick={() => setTagFilter(tag)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${tagFilter === tag ? "bg-primary/20 text-primary" : "bg-card border border-card-border text-muted-foreground hover:text-foreground"}`}
                data-testid={`filter-tag-${tag}`}
              >
                {tag === "all" ? "Todos" : TAG_LABELS[tag]}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-card-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Contactos</h2>
            <span className="text-xs text-muted-foreground">{contacts?.length ?? 0} contactos</span>
          </div>
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Cargando contactos...</div>
          ) : (
            <table className="w-full text-sm" data-testid="contacts-table">
              <thead>
                <tr className="border-b border-card-border">
                  <th className="text-left text-xs font-medium text-muted-foreground px-5 py-3">Contacto</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-5 py-3">Teléfono</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-5 py-3">Etiqueta</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-5 py-3">Canales</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-5 py-3">Conversaciones</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {(contacts ?? []).map((contact) => (
                  <tr key={contact.id} onClick={() => setLocation(`/contacts/${contact.id}`)} className="border-b border-card-border/50 hover:bg-muted/20 transition-colors cursor-pointer" data-testid={`contact-row-${contact.id}`}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <ContactAvatar
                          name={contact.name}
                          avatar={contact.avatar}
                          className="w-8 h-8 bg-primary/20 text-xs font-bold text-primary"
                        />
                        <div>
                          <div className="font-medium text-foreground">{contact.name}</div>
                          <MetaContactProfile contact={contact} />
                          {contact.email && <div className="text-xs text-muted-foreground">{contact.email}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{contact.phone ?? "—"}</td>
                    <td className="px-5 py-3">
                      {contact.tag ? (
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${TAG_STYLES[contact.tag]}`}>
                          {TAG_LABELS[contact.tag]}
                        </span>
                      ) : <span className="text-muted-foreground/50">—</span>}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5">
                        {(contact.channels ?? []).map((ch) => {
                          const Icon = CHANNEL_ICONS[ch];
                          return Icon ? <Icon key={ch} className={`w-3.5 h-3.5 ${ch === "whatsapp" ? "text-[#25D366]" : ch === "instagram" ? "text-[#E1306C]" : ch === "email" ? "text-[#EA4335]" : "text-[#1877F2]"}`} /> : null;
                        })}
                        {(contact.channels ?? []).length === 0 && <span className="text-muted-foreground/40 text-xs">—</span>}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className="flex items-center justify-end gap-1.5 text-muted-foreground">
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span className="tabular-nums">{contact.totalConversations}</span>
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-red-400 h-8 w-8 p-0" onClick={(e) => { e.stopPropagation(); handleDelete(contact.id); }} data-testid={`button-delete-contact-${contact.id}`}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                        <ChevronRight className="w-4 h-4 text-muted-foreground/40" />
                      </div>
                    </td>
                  </tr>
                ))}
                {(contacts ?? []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center">
                      <Users className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">No se encontraron contactos</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo Contacto</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre completo</FormLabel>
                  <FormControl><Input placeholder="Ej: María García" {...field} data-testid="input-contact-name" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField control={form.control} name="phone" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Teléfono</FormLabel>
                    <FormControl><Input placeholder="+1-809-555-0100" {...field} data-testid="input-contact-phone" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl><Input type="email" placeholder="correo@email.com" {...field} data-testid="input-contact-email" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="tag" render={({ field }) => (
                <FormItem>
                  <FormLabel>Etiqueta</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-contact-tag"><SelectValue placeholder="Seleccionar etiqueta..." /></SelectTrigger></FormControl>
                    <SelectContent>
                      {tagOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas (opcional)</FormLabel>
                  <FormControl><Textarea placeholder="Observaciones sobre el contacto..." rows={2} {...field} data-testid="textarea-contact-notes" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button type="submit" className="flex-1" disabled={createContact.isPending} data-testid="button-submit-contact">
                  {createContact.isPending ? "Creando..." : "Crear Contacto"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
