import { useListWarehouses, getListWarehousesQueryKey } from "@workspace/api-client-react";
import { useModules } from "@/lib/platform";

/**
 * ¿Se lleva inventario de verdad? El módulo está encendido Y ya hay un almacén.
 * Con el módulo encendido pero sin almacén (así queda al desplegarlo), pasar un
 * pedido a Enviado sigue siendo cambiar su estado, no despacharlo.
 */
export function useInventoryReady(): boolean {
  const modules = useModules();
  const { data } = useListWarehouses({ query: { enabled: modules.inventory, queryKey: getListWarehousesQueryKey() } });
  return modules.inventory && (data?.length ?? 0) > 0;
}
