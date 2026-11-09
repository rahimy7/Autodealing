import { ConversationList } from "../../src/components/ConversationList";
import { useAuth } from "../../src/lib/auth";

export default function AgentMyChatsScreen() {
  const { user } = useAuth();
  const agentId = user?.agentId ?? undefined;

  return (
    <ConversationList
      agentId={agentId}
      myAgentId={user?.agentId ?? null}
      showOwner={false}
      emptyTitle="No tienes conversaciones"
      emptyDescription="Cuando te asignen un chat aparecerá aquí y te llegará una notificación."
    />
  );
}
