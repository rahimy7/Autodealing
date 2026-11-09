import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useListConversations, useListAgents, getListConversationsQueryKey } from "@workspace/api-client-react";
import type { Conversation, Agent } from "@workspace/api-client-react";
import {
  Activity,
  Bot,
  ChevronDown,
  ChevronRight,
  Circle,
  Inbox,
  RefreshCcw,
  Tag,
  Users,
} from "lucide-react";
import { SiWhatsapp, SiInstagram, SiFacebook } from "react-icons/si";
import { useQueryClient } from "@tanstack/react-query";
import Layout from "@/components/layout/Layout";
import ContactAvatar from "@/components/ContactAvatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { STATUS_STYLES as AGENT_STATUS_STYLES, STATUS_LABELS as AGENT_STATUS_LABELS } from "@/lib/agent-ui";

const CHANNEL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  whatsapp: SiWhatsapp,
  instagram: SiInstagram,
  facebook: SiFacebook,
};

const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: "text-[#25D366]",
  instagram: "text-[#E1306C]",
  facebook: "text-[#1877F2]",
};

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
};

const CONVERSATION_STATUS_STYLES: Record<string, string> = {
  open: "bg-blue-500/15 text-blue-500",
  pending: "bg-yellow-500/15 text-yellow-600",
  bot: "bg-purple-500/15 text-purple-500",
  resolved: "bg-green-500/15 text-green-600",
};

const CONVERSATION_STATUS_LABELS: Record<string, string> = {
  open: "Abierto",
  pending: "Pendiente",
  bot: "Bot",
  resolved: "Resuelto",
};

const CHANNEL_TABS = ["all", "whatsapp", "instagram", "facebook"] as const;
type ChannelFilter = (typeof CHANNEL_TABS)[number];

const CONVERSATIONS_POLL_MS = 8000;

function timeAgo(date: string) {
  const d = new Date(date);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return "ahora";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function ChannelBadge({ channel }: { channel: string }) {
  const Icon = CHANNEL_ICONS[channel];
  const color = CHANNEL_COLORS[channel] ?? "text-muted-foreground";
  if (!Icon) return null;
  return (
    <span title={CHANNEL_LABELS[channel] ?? channel} className={cn("inline-flex items-center", color)}>
      <Icon className="w-3.5 h-3.5" />
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "text-[10px] font-semibold px-2 py-0.5 rounded-full",
        CONVERSATION_STATUS_STYLES[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {CONVERSATION_STATUS_LABELS[status] ?? status}
    </span>
  );
}

function LabelPill({ name, color }: { name: string; color: string | null | undefined }) {
  const swatch = color && /^#?[0-9a-f]{3,8}$/i.test(color) ? (color.startsWith("#") ? color : `#${color}`) : null;
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full"
      style={
        swatch
          ? { backgroundColor: `${swatch}22`, color: swatch, border: `1px solid ${swatch}44` }
          : undefined
      }
    >
      <Tag className="w-3 h-3" />
      {name}
    </span>
  );
}

/** Compact row for the per-agent expandable list. */
function ConversationRow({ c }: { c: Conversation }) {
  return (
    <Link
      href="/inbox"
      className="block bg-card border border-card-border rounded-xl px-3 py-2 hover:border-primary/40 hover:bg-muted/30 transition-colors"
      data-testid={`monitor-conv-${c.id}`}
    >
      <div className="flex items-center gap-2.5">
        <ContactAvatar
          name={c.contactName}
          avatar={c.contactAvatar}
          className="w-7 h-7 bg-gradient-to-br from-primary/70 to-accent/70 text-[10px] font-bold text-primary-foreground"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <ChannelBadge channel={c.channel} />
            <span className="text-xs font-medium text-foreground truncate">
              {c.contactName ?? c.contactPhone ?? `#${c.contactId}`}
            </span>
            <StatusBadge status={c.status} />
            {c.labelName && <LabelPill name={c.labelName} color={c.labelColor} />}
          </div>
          {c.lastMessage && (
            <div className="text-[11px] text-muted-foreground truncate mt-0.5">{c.lastMessage}</div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className="text-[10px] text-muted-foreground tabular-nums">{timeAgo(c.updatedAt)}</span>
          {c.unreadCount > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary/20 text-primary tabular-nums min-w-5 text-center">
              {c.unreadCount}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

/** Larger, high-visibility tile used in the wallboard queue. */
function QueueTile({ c, tone }: { c: Conversation; tone: "queue" | "ai" }) {
  const accent =
    tone === "queue"
      ? "border-yellow-500/60 bg-yellow-500/10 hover:bg-yellow-500/15"
      : "border-purple-500/50 bg-purple-500/10 hover:bg-purple-500/15";
  return (
    <Link
      href="/inbox"
      className={cn(
        "block rounded-2xl border-2 p-3 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40",
        accent,
      )}
      data-testid={`queue-tile-${c.id}`}
    >
      <div className="flex items-start gap-3">
        <ContactAvatar
          name={c.contactName}
          avatar={c.contactAvatar}
          className="w-10 h-10 bg-gradient-to-br from-primary/70 to-accent/70 text-sm font-bold text-primary-foreground"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <ChannelBadge channel={c.channel} />
            <span className="text-sm font-semibold text-foreground truncate">
              {c.contactName ?? c.contactPhone ?? `#${c.contactId}`}
            </span>
          </div>
          <div className="flex items-center flex-wrap gap-1 mt-1">
            <StatusBadge status={c.status} />
            {c.labelName && <LabelPill name={c.labelName} color={c.labelColor} />}
            {c.groupName && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                {c.groupName}
              </span>
            )}
            {tone === "ai" && c.agentName && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-500">
                <Bot className="w-3 h-3" /> {c.agentName}
              </span>
            )}
          </div>
          {c.lastMessage && (
            <div className="text-xs text-muted-foreground line-clamp-2 mt-1.5">{c.lastMessage}</div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className="text-[10px] text-muted-foreground tabular-nums">{timeAgo(c.updatedAt)}</span>
          {c.unreadCount > 0 && (
            <span className="inline-flex items-center justify-center text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary text-primary-foreground tabular-nums min-w-6 animate-pulse">
              {c.unreadCount}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

export default function MonitorPage() {
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const queryClient = useQueryClient();
  const params = channelFilter === "all" ? undefined : { channel: channelFilter };

  const { data: conversations, isFetching } = useListConversations(params, {
    query: {
      queryKey: getListConversationsQueryKey(params),
      refetchInterval: CONVERSATIONS_POLL_MS,
      refetchOnWindowFocus: true,
      staleTime: 0,
    },
  });
  const { data: agents } = useListAgents();

  const humans = useMemo(() => (agents ?? []).filter((a) => a.type === "human"), [agents]);
  const virtualIds = useMemo(
    () => new Set((agents ?? []).filter((a) => a.type === "virtual").map((a) => a.id)),
    [agents],
  );

  const { queueUnassigned, queueAi, byAgent } = useMemo(() => {
    const list: Conversation[] = (conversations ?? []).filter((c) => c.status !== "resolved");
    const unassigned: Conversation[] = [];
    const ai: Conversation[] = [];
    const grouped = new Map<number, Conversation[]>();

    for (const c of list) {
      if (c.agentId == null) {
        unassigned.push(c);
        continue;
      }
      const assignedToAi = c.status === "bot" || virtualIds.has(c.agentId);
      if (assignedToAi) {
        ai.push(c);
        continue;
      }
      const arr = grouped.get(c.agentId) ?? [];
      arr.push(c);
      grouped.set(c.agentId, arr);
    }
    return { queueUnassigned: unassigned, queueAi: ai, byAgent: grouped };
  }, [conversations, virtualIds]);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });

  return (
    <Layout>
      <div className="p-4 sm:p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" /> Monitor de cola
            </h1>
            <p className="text-sm text-muted-foreground">
              Cola de trabajo en vivo · sin asignar, atendido por IA y asignaciones por agente.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn("w-2 h-2 rounded-full", isFetching ? "bg-primary animate-pulse" : "bg-green-500")} />
              {isFetching ? "Actualizando…" : "En vivo"}
            </span>
            <Button size="sm" variant="outline" className="gap-2" onClick={refresh} data-testid="button-refresh-monitor">
              <RefreshCcw className="w-3.5 h-3.5" /> Actualizar
            </Button>
          </div>
        </div>

        {/* Channel filter */}
        <div className="flex items-center gap-2 flex-wrap">
          {CHANNEL_TABS.map((ch) => {
            const Icon = ch === "all" ? Inbox : CHANNEL_ICONS[ch];
            const active = channelFilter === ch;
            return (
              <button
                key={ch}
                onClick={() => setChannelFilter(ch)}
                data-testid={`filter-channel-${ch}`}
                className={cn(
                  "inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors",
                  active
                    ? "bg-primary/15 text-primary border-primary/40"
                    : "bg-card text-muted-foreground border-card-border hover:border-primary/30",
                )}
              >
                {Icon && <Icon className={cn("w-3.5 h-3.5", ch !== "all" && !active ? CHANNEL_COLORS[ch] : "")} />}
                {ch === "all" ? "Todos" : CHANNEL_LABELS[ch]}
              </button>
            );
          })}
        </div>

        {/* Wallboard: unassigned queue + AI queue */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <QueueColumn
            title="Sin asignar"
            subtitle="Requieren asignación manual"
            count={queueUnassigned.length}
            tone="queue"
            items={queueUnassigned}
            emptyText="🎉 No hay conversaciones en cola."
          />
          <QueueColumn
            title="Atendidas por IA"
            subtitle="Bots / agentes virtuales activos"
            count={queueAi.length}
            tone="ai"
            items={queueAi}
            emptyText="Sin conversaciones atendidas por IA."
          />
        </div>

        {/* Per-agent badge board */}
        <section className="space-y-2" data-testid="section-by-agent">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            Asignaciones por agente
            <span className="text-xs text-muted-foreground font-normal">
              ({humans.length} agente{humans.length === 1 ? "" : "s"})
            </span>
          </h2>
          {humans.length === 0 ? (
            <div className="bg-card border border-card-border rounded-xl p-6 text-center text-sm text-muted-foreground">
              No hay agentes humanos configurados.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
              {humans.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  conversations={byAgent.get(agent.id) ?? []}
                  open={!!expanded[agent.id]}
                  onToggle={() => setExpanded((prev) => ({ ...prev, [agent.id]: !prev[agent.id] }))}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </Layout>
  );
}

function QueueColumn({
  title,
  subtitle,
  count,
  tone,
  items,
  emptyText,
}: {
  title: string;
  subtitle: string;
  count: number;
  tone: "queue" | "ai";
  items: Conversation[];
  emptyText: string;
}) {
  const header =
    tone === "queue"
      ? { badge: "bg-yellow-500 text-yellow-950", ring: "ring-yellow-500/30", icon: <Inbox className="w-4 h-4 text-yellow-600" /> }
      : { badge: "bg-purple-500 text-white", ring: "ring-purple-500/30", icon: <Bot className="w-4 h-4 text-purple-500" /> };
  return (
    <div className={cn("rounded-2xl border border-card-border bg-card/60 p-3 space-y-3 ring-1", header.ring)}>
      <div className="flex items-center gap-2 px-1">
        {header.icon}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-foreground truncate">{title}</div>
          <div className="text-[11px] text-muted-foreground truncate">{subtitle}</div>
        </div>
        <span
          className={cn(
            "inline-flex items-center justify-center min-w-7 h-6 px-2 rounded-full text-xs font-bold tabular-nums",
            header.badge,
            count > 0 && tone === "queue" && "animate-pulse",
          )}
          data-testid={`queue-count-${tone}`}
        >
          {count}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground text-center py-6">{emptyText}</div>
      ) : (
        <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
          {items.map((c) => (
            <QueueTile key={c.id} c={c} tone={tone} />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentCard({
  agent,
  conversations,
  open,
  onToggle,
}: {
  agent: Agent;
  conversations: Conversation[];
  open: boolean;
  onToggle: () => void;
}) {
  const total = conversations.length;
  const pending = conversations.filter((c) => c.status === "pending").length;
  return (
    <div className="bg-card border border-card-border rounded-xl" data-testid={`agent-card-${agent.id}`}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors rounded-xl"
      >
        <ContactAvatar name={agent.name} avatar={agent.avatar} className="w-8 h-8 bg-muted text-xs font-bold text-foreground" />
        <div className="min-w-0 flex-1 text-left">
          <div className="text-sm font-semibold text-foreground truncate flex items-center gap-2">
            {agent.name}
            <span className={cn("inline-flex items-center gap-1 text-[10px]", AGENT_STATUS_STYLES[agent.status])}>
              <Circle className="w-1.5 h-1.5 fill-current" /> {AGENT_STATUS_LABELS[agent.status]}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground truncate">{agent.email}</div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {pending > 0 && (
            <span
              className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[10px] font-bold bg-yellow-500/20 text-yellow-600 tabular-nums"
              title={`${pending} pendiente${pending === 1 ? "" : "s"}`}
            >
              {pending}
            </span>
          )}
          <span
            className={cn(
              "inline-flex items-center justify-center min-w-7 h-6 px-2 rounded-full text-xs font-bold tabular-nums",
              total > 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
            )}
            data-testid={`agent-count-${agent.id}`}
          >
            {total}
          </span>
          {open ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </button>
      {open && (
        <div className="border-t border-card-border p-2 space-y-1.5">
          {conversations.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-3">Sin conversaciones activas.</div>
          ) : (
            conversations.map((c) => <ConversationRow key={c.id} c={c} />)
          )}
        </div>
      )}
    </div>
  );
}
