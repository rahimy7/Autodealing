import { useLocation, useSearch } from "wouter";
import Layout from "@/components/layout/Layout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import StockTab from "@/components/inventory/StockTab";
import LotsTab from "@/components/inventory/LotsTab";
import KardexTab from "@/components/inventory/KardexTab";
import AdjustmentsTab from "@/components/inventory/AdjustmentsTab";
import WarehousesTab from "@/components/inventory/WarehousesTab";
import CostsTab from "@/components/inventory/CostsTab";

const TABS = [
  { key: "stock", label: "Existencias" },
  { key: "lots", label: "Lotes" },
  { key: "kardex", label: "Kárdex" },
  { key: "adjustments", label: "Ajustes y transferencias" },
  { key: "warehouses", label: "Almacenes" },
  { key: "costs", label: "Costos" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// Inventario por almacén con lotes y costo PEPS (2026-10-04): lo vendido queda
// comprometido y sale al despachar; cada lote guarda su costo y a qué clientes
// se fue.
export default function InventoryPage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const fromUrl = new URLSearchParams(search).get("tab");
  const tab: TabKey = TABS.some((t) => t.key === fromUrl) ? (fromUrl as TabKey) : "stock";

  return (
    <Layout>
      <div className="p-6 space-y-5">
        <div>
          <h1 className="text-xl font-bold text-foreground">Inventario</h1>
          <p className="text-sm text-muted-foreground">Lo vendido queda comprometido y sale del almacén al despacharse, por lote: primero lo que vence antes.</p>
        </div>
        <Tabs value={tab} onValueChange={(v) => setLocation(`/inventory?tab=${v}`, { replace: true })}>
          <TabsList className="flex-wrap h-auto">
            {TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key} data-testid={`tab-inventory-${t.key}`}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="stock" className="pt-4">
            <StockTab />
          </TabsContent>
          <TabsContent value="lots" className="pt-4">
            <LotsTab />
          </TabsContent>
          <TabsContent value="kardex" className="pt-4">
            <KardexTab />
          </TabsContent>
          <TabsContent value="adjustments" className="pt-4">
            <AdjustmentsTab />
          </TabsContent>
          <TabsContent value="warehouses" className="pt-4">
            <WarehousesTab />
          </TabsContent>
          <TabsContent value="costs" className="pt-4">
            <CostsTab />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
