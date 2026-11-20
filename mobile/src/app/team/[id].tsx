import { useCallback, useState } from "react";
import { Alert, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { strongPassword } from "@/lib/password";
import { shortDate } from "@/lib/format";
import { ROLE_HELP } from "@/lib/labels";
import { Button, Field, Loading, Screen, Section, Select, T, useNotify } from "@/components/ui";

export default function UserScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user: me, crm, refreshTeam } = useAuth();
  const router = useRouter();
  const notify = useNotify();
  const [u, setU] = useState<any>(null);
  const [agents, setAgents] = useState<any>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("sales");
  const [agentId, setAgentId] = useState("");
  const [password, setPassword] = useState(strongPassword());

  const load = useCallback(async () => {
    const list = await api<any[]>("/api/admin/users");
    const found = list.find((x) => x.id === id);
    setU(found);
    if (found) {
      setName(found.name);
      setRole(found.role);
      setAgentId(found.omni_agent_id ? String(found.omni_agent_id) : "");
    }
    if (crm?.connected) setAgents(await api<any>("/api/admin/crm/agents").catch(() => null));
  }, [id, crm?.connected]);
  useFocusEffect(useCallback(() => { load().catch((e) => notify(e.message, true)); }, [load, notify]));
  if (!u) return <Screen><Loading /></Screen>;
  const self = u.id === me?.id;
  const taken = new Map<number, string>((agents?.team || []).filter((t: any) => t.omni_agent_id && t.id !== u.id).map((t: any) => [t.omni_agent_id, t.name]));
  const run = (fn: () => Promise<unknown>, ok: string, after?: () => void) => async () => {
    try { await fn(); notify(ok); await refreshTeam(); after ? after() : await load(); } catch (e: any) { notify(e.message, true); }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: u.name }} />
      <View style={{ gap: 14 }}>
        <T v="small">{u.username} · desde {shortDate(u.created_at)}{u.active ? "" : " · desactivado"}</T>
        <Field label="Nombre" value={name} onChangeText={setName} maxLength={100} />
        <Select label="Perfil" value={role} options={[["sales", "Ventas"], ["service", "Servicio"], ["admin", "Administración"]]} onChange={(r) => !self && setRole(r)} />
        <T v="small">{self ? "No puedes cambiar tu propio perfil." : ROLE_HELP[role]}</T>
        <Button title="Guardar" onPress={run(() => api(`/api/admin/users/${u.id}`, { method: "PUT", body: { name, role } }), "Usuario actualizado.")} full />
      </View>

      {agents?.agents?.length ? (
        <Section title="Chats de Omnicanal">
          <View style={{ gap: 12 }}>
            <Select label="Agente vinculado" value={agentId} options={[["", "Sin vincular (no ve chats)"], ...agents.agents.map((a: any) => [String(a.id), `${a.name}${taken.has(a.id) ? " · de " + taken.get(a.id) : ""}${a.isActive ? "" : " (inactivo)"}`] as [string, string])]} onChange={setAgentId} />
            <T v="small">Con un agente vinculado ve y responde sus chats de WhatsApp, Instagram y Facebook.</T>
            <Button variant="secondary" title="Guardar vínculo" onPress={run(() => api(`/api/admin/crm/mapping/${u.id}`, { method: "PUT", body: { agentId: agentId ? Number(agentId) : null } }), agentId ? "Agente vinculado." : "Vínculo quitado.")} full />
          </View>
        </Section>
      ) : null}

      {self ? null : (
        <>
          <Section title="Contraseña">
            <View style={{ gap: 12 }}>
              <Field label="Nueva contraseña" value={password} onChangeText={setPassword} autoCapitalize="none" autoCorrect={false} maxLength={128} right={<Button title="Otra" variant="secondary" onPress={() => setPassword(strongPassword())} />} hint="Cierra sus sesiones abiertas. Compártela por un canal privado." />
              <Button variant="secondary" title="Restablecer contraseña" onPress={run(async () => { await api(`/api/admin/users/${u.id}/password`, { method: "POST", body: { password } }); await Clipboard.setStringAsync(password); }, "Contraseña restablecida y copiada. Sus sesiones se cerraron.", () => setPassword(strongPassword()))} full />
            </View>
          </Section>
          <Section>
            <Button
              variant={u.active ? "danger" : "primary"}
              title={u.active ? "Desactivar acceso" : "Reactivar acceso"}
              onPress={() => {
                const go = run(() => api(`/api/admin/users/${u.id}/active`, { method: "PUT", body: { active: !u.active } }), u.active ? "Acceso desactivado." : "Acceso reactivado.", () => router.back());
                if (!u.active) return go();
                Alert.alert(`¿Desactivar a ${u.name}?`, "Se cierran sus sesiones.", [{ text: "Cancelar", style: "cancel" }, { text: "Desactivar", style: "destructive", onPress: go }]);
              }}
              full
            />
          </Section>
        </>
      )}
    </Screen>
  );
}
