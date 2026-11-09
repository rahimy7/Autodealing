import { useLocation, useSearch } from "wouter";
import Layout from "@/components/layout/Layout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import RequestsTab from "@/components/purchasing/RequestsTab";
import PurchaseOrdersTab from "@/components/purchasing/OrdersTab";
import ReceiptsTab from "@/components/purchasing/ReceiptsTab";
import SuppliersTab from "@/components/purchasing/SuppliersTab";

const TABS = [
  { key: "requests", label: "Necesidades" },
  { key: "orders", label: "Órdenes de compra" },
  { key: "receipts", label: "Recepciones" },
  { key: "suppliers", label: "Proveedores" },
] as const;

// Compras (2026-10-04): pedido de compra (la necesidad, también por punto de
// reorden) → orden de compra al proveedor → recepción por lote.
export default function PurchasingPage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const fromUrl = new URLSearchParams(search).get("tab");
  const tab = TABS.some((t) => t.key === fromUrl) ? (fromUrl as (typeof TABS)[number]["key"]) : "requests";
  return (
    <Layout>
      <div className="p-6 space-y-5">
        <div>
          <h1 className="text-xl font-bold text-foreground">Compras</h1>
          <p className="text-sm text-muted-foreground">De la necesidad a la mercancía en el almacén: pedido de compra, orden al proveedor y recepción con su lote y vencimiento.</p>
        </div>
        <Tabs value={tab} onValueChange={(v) => setLocation(`/purchasing?tab=${v}`, { replace: true })}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key} data-testid={`tab-purchasing-${t.key}`}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="requests" className="pt-4">
            <RequestsTab />
          </TabsContent>
          <TabsContent value="orders" className="pt-4">
            <PurchaseOrdersTab />
          </TabsContent>
          <TabsContent value="receipts" className="pt-4">
            <ReceiptsTab />
          </TabsContent>
          <TabsContent value="suppliers" className="pt-4">
            <SuppliersTab />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
