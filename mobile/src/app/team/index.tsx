import { useCallback, useState } from "react";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ROLE_HELP, ROLE_LABEL } from "@/lib/labels";
import { Avatar, Button, CardList, Icon, ListRow, Loading, Pill, Screen, Section, T } from "@/components/ui";
import { colors } from "@/theme";

export default function Team() {
  const { user } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<any[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => setUsers(await api<any[]>("/api/admin/users").catch(() => [])), []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (!users) return <Screen><Loading /></Screen>;
  return (
    <Screen refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}>
      <Stack.Screen options={{ title: "Equipo", headerRight: () => <Button size="sm" icon="add" title="Nuevo" onPress={() => router.push("/team/new")} /> }} />
      <T v="small">{users.filter((u) => u.active).length} personas activas. Cada una entra con su usuario a esta app y al panel.</T>
      {["admin", "sales", "service"].map((role) => {
        const list = users.filter((u) => u.role === role);
        return (
          <Section key={role} title={`${ROLE_LABEL[role]} · ${list.length}`}>
            {list.length ? (
              <CardList>
                {list.map((u) => (
                  <ListRow
                    key={u.id}
                    onPress={() => router.push({ pathname: "/team/[id]", params: { id: u.id } })}
                    left={<Avatar name={u.name} />}
                    title={`${u.name}${u.id === user?.id ? " (tú)" : ""}`}
                    subtitle={`${u.username}${u.omni_agent_id ? " · agente de Omnicanal" : ""}`}
                    right={u.active ? <Icon name="chevron-forward" size={18} color={colors.muted} /> : <Pill tone="bad">Desactivado</Pill>}
                  />
                ))}
              </CardList>
            ) : <T v="muted">{ROLE_HELP[role]}</T>}
          </Section>
        );
      })}
    </Screen>
  );
}
