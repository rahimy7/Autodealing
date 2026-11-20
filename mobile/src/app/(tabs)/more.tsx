import { Linking, View } from "react-native";
import { useRouter } from "expo-router";
import { canSell, isAdmin, useAuth } from "@/lib/auth";
import { publicUrl } from "@/lib/api";
import { CardList, Icon, ListRow, Screen, Section, T, type IconName } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/labels";
import { colors } from "@/theme";

function Item({ icon, title, sub, onPress, danger }: { icon: IconName; title: string; sub?: string; onPress: () => void; danger?: boolean }) {
  return (
    <ListRow
      onPress={onPress}
      left={
        <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" }}>
          <Icon name={icon} size={20} color={danger ? colors.bad : colors.accent} />
        </View>
      }
      title={title}
      subtitle={sub}
      right={<Icon name="chevron-forward" size={18} color={colors.muted} />}
    />
  );
}

export default function More() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const go = (path: string) => () => router.push(path as any);
  const sells = canSell(user);
  return (
    <Screen>
      <CardList>
        {sells ? <Item icon="document-text-outline" title="Cotizaciones" sub="Las que generaste y su enlace para el cliente" onPress={go("/quotes")} /> : null}
        {sells ? <Item icon="bookmark-outline" title="Reservas" sub="Unidades apartadas para tus clientes" onPress={go("/holds")} /> : null}
        <Item icon="camera-outline" title={isAdmin(user) ? "Inventario" : "Mis unidades"} sub={isAdmin(user) ? "Por completar e inventario completo" : "Las que cargaste y su estado"} onPress={go("/units")} />
        {sells ? <Item icon="mail-unread-outline" title="Consultas web" sub="Solicitudes de la página web" onPress={go("/leads")} /> : null}
      </CardList>
      {isAdmin(user) ? (
        <Section title="Administración">
          <CardList>
            <Item icon="people-outline" title="Equipo" sub="Usuarios, perfiles, contraseñas y chats" onPress={go("/team")} />
            <Item icon="stats-chart-outline" title="Negocio" sub="Ventas, margen, inventario y el equipo" onPress={go("/business")} />
            <Item icon="settings-outline" title="Ajustes de cotización" sub="Impuesto, cargos, tasa y vigencia" onPress={go("/quote-settings")} />
            <Item icon="open-outline" title="Panel de administración" sub="Página web, Omnicanal, costos y reportes" onPress={() => Linking.openURL(publicUrl("/admin/"))} />
          </CardList>
        </Section>
      ) : null}
      <Section>
        <CardList>
          <Item icon="person-outline" title="Mi cuenta" sub={`${ROLE_LABEL[user?.role ?? "sales"]} · ${user?.username}`} onPress={go("/account")} />
          <Item icon="log-out-outline" danger title="Cerrar sesión" onPress={signOut} />
        </CardList>
      </Section>
      <T v="small" style={{ textAlign: "center", marginTop: 24 }}>Premier App · Premier Line Motors</T>
    </Screen>
  );
}
