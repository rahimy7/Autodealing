import { ConversationList } from "../../src/components/ConversationList";

// The admin sees the whole operation and can act on any chat from the thread's
// action sheet (assign, escalate, resolve).
export default function AdminInboxScreen() {
  return (
    <ConversationList
      emptyTitle="No hay conversaciones"
      emptyDescription="Aparecerán aquí en cuanto llegue un mensaje por cualquier canal."
    />
  );
}
