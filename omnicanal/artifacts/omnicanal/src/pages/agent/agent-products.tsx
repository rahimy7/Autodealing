import AgentLayout from "@/components/layout/AgentLayout";
import { ProductsCatalog } from "@/pages/products";

// Vista del catálogo para el perfil de agente: reutiliza el mismo componente que
// usa la vista de admin, envuelto en el shell del agente.
export default function AgentProductsPage() {
  return (
    <AgentLayout>
      <ProductsCatalog />
    </AgentLayout>
  );
}
