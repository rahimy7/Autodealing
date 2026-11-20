// What a quote shows, in the app and in the customer's page (server/quote-page.js).
import { Text, View } from "react-native";
import { usd, usd2 } from "@/lib/format";
import type { QuoteFigures } from "@/lib/quote-math";
import { T } from "@/components/ui";
import { colors, font } from "@/theme";

export interface QuoteSettings { taxRate: number; docFee: number; apr: number; term: number; validDays: number; note: string }

export function figureRows(f: QuoteFigures) {
  return [
    { label: "Precio del vehículo", value: usd2(f.price) },
    ...(f.fees > 0 ? [{ label: "Cargos de documentación", value: usd2(f.fees) }] : []),
    ...(f.taxRate > 0 ? [{ label: `Impuesto (${f.taxRate}%)`, value: usd2(f.tax) }] : []),
    { label: "Total", value: usd2(f.total), strong: true },
    ...(f.tradeIn > 0 ? [{ label: "Intercambio", value: "− " + usd2(f.tradeIn) }] : []),
    ...(f.down > 0 ? [{ label: "Pago inicial", value: "− " + usd2(f.down) }] : []),
    { label: f.termMonths > 0 ? "Monto a financiar" : "Saldo a pagar", value: usd2(f.balance), strong: true },
    ...(f.termMonths > 0 ? [{ label: "Total de pagos", value: usd2(f.totalOfPayments) }, { label: "Intereses estimados", value: usd2(f.interest) }] : []),
  ];
}
export function Headline({ f }: { f: QuoteFigures }) {
  return f.termMonths > 0 ? (
    <View>
      <T v="eyebrow">Pago mensual estimado</T>
      <Text style={{ fontFamily: font.display, fontSize: 34, color: colors.text, letterSpacing: -1.2, marginTop: 4 }}>
        {usd(f.monthly)}
        <Text style={{ fontFamily: font.bold, fontSize: 14, color: colors.text2, letterSpacing: 0 }}> /mes</Text>
      </Text>
      <T v="small">{f.termMonths} meses · {f.apr}% APR</T>
    </View>
  ) : (
    <View>
      <T v="eyebrow">Pago de contado</T>
      <Text style={{ fontFamily: font.display, fontSize: 34, color: colors.text, letterSpacing: -1.2, marginTop: 4 }}>{usd(f.balance)}</Text>
    </View>
  );
}

