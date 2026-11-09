import { useState, type ReactNode } from "react";
import { useListProducts, useListProductCategories, type Product } from "@workspace/api-client-react";
import { Search, Package, ExternalLink, FileText, Copy, Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import { ProductAdminSection, NewProductDialog } from "@/components/products/ProductAdmin";
import Layout from "@/components/layout/Layout";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

// El catálogo importado de la web del cliente (scripts/import-catalog.ts): lo que
// viene de la web se cambia en la web. Desde el 2026-10-04 el administrador pone
// aquí lo que la web no tiene —precio, SKU, inventario, componentes de un kit— y
// crea productos que no están en la web.

const ALL = "all";

// Contenido del catálogo sin envolver en ningún layout. Lo consumen la vista de
// admin (`ProductsPage`, con `Layout`) y la de agente (`AgentLayout`) reutilizando
// el mismo componente para no duplicar lógica.
export function ProductsCatalog() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(ALL);
  const [selected, setSelected] = useState<Product | null>(null);
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();
  // Editar precio, SKU e inventario es de la vista Catálogo; quien solo consulta
  // fichas para compartirlas en el chat (un agente) no ve esos controles.
  const { views } = useAuth();
  const isAdmin = views.has("products");

  const params =
    search || category !== ALL
      ? { search: search || undefined, category: category !== ALL ? category : undefined }
      : undefined;
  const { data: products, isLoading } = useListProducts(params);
  const { data: categories } = useListProductCategories();

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast({ title: "Enlace copiado", description: "Ya puedes pegarlo en el chat." });
    } catch {
      toast({ title: "No se pudo copiar", description: url, variant: "destructive" });
    }
  };

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Catálogo</h1>
            <p className="text-sm text-muted-foreground">
              Productos de la web — consulta y comparte fichas en el chat{isAdmin ? "; precio, SKU e inventario se ponen aquí" : ""}
            </p>
          </div>
          {isAdmin && (
            <Button size="sm" className="gap-1.5" onClick={() => setCreating(true)} data-testid="button-new-product">
              <Plus className="w-4 h-4" /> Nuevo producto
            </Button>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:flex-wrap">
          <div className="relative w-full sm:flex-1 sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="search"
              placeholder="Buscar productos..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm bg-card border border-card-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              data-testid="input-search-products"
            />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-full sm:w-64" data-testid="select-product-category">
              <SelectValue placeholder="Todas las categorías" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas las categorías</SelectItem>
              {(categories ?? []).map((c) => (
                <SelectItem key={c.name} value={c.name}>
                  {c.name} ({c.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground" data-testid="text-product-count">
            {products?.length ?? 0} productos
          </span>
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Cargando catálogo...</div>
        ) : (products ?? []).length === 0 ? (
          <div className="p-12 text-center" data-testid="products-empty">
            <Package className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">No hay productos que coincidan con la búsqueda.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="products-grid">
            {(products ?? []).map((product) => (
              <button
                key={product.id}
                onClick={() => setSelected(product)}
                className="text-left bg-card border border-card-border rounded-xl overflow-hidden hover:border-primary/50 transition-colors flex flex-col"
                data-testid={`product-card-${product.slug}`}
              >
                {product.imageUrl ? (
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    loading="lazy"
                    className="w-full h-36 object-contain bg-white/5 p-2"
                  />
                ) : (
                  <div className="w-full h-36 flex items-center justify-center bg-muted/20">
                    <Package className="w-8 h-8 text-muted-foreground/40" />
                  </div>
                )}
                <div className="p-4 space-y-2 flex-1 flex flex-col">
                  <div className="font-medium text-foreground text-sm leading-snug">{product.name}</div>
                  {(product.priceCents != null || product.sku || product.source === "manual" || product.active === false) && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      {product.priceCents != null && <span className="font-semibold text-foreground">{formatCents(product.priceCents, product.priceCurrency)}</span>}
                      {product.sku && <span>{product.sku}</span>}
                      {(product.components?.length ?? 0) > 0 && <span className="px-1.5 rounded bg-primary/10 text-primary">kit</span>}
                      {product.source === "manual" && <span className="px-1.5 rounded bg-muted">no está en la web</span>}
                      {product.active === false && <span className="px-1.5 rounded bg-muted">inactivo</span>}
                    </div>
                  )}
                  {product.description && (
                    <p className="text-xs text-muted-foreground line-clamp-3 flex-1">{product.description}</p>
                  )}
                  {product.categories.length > 0 && (
                    <span className="self-start text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/15 text-primary">
                      {product.categories[0]}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Detail */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{selected.name}</DialogTitle>
              </DialogHeader>
              <div className="space-y-5">
                <div className="flex gap-4">
                  {selected.imageUrl && (
                    <img
                      src={selected.imageUrl}
                      alt={selected.name}
                      className="w-32 h-32 object-contain bg-white/5 rounded-lg p-2 flex-shrink-0"
                    />
                  )}
                  <div className="space-y-2 min-w-0">
                    {selected.description && (
                      <p className="text-sm text-muted-foreground">{selected.description}</p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {selected.categoryPaths.map((path) => (
                        <span
                          key={path}
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/15 text-primary"
                        >
                          {path}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {isAdmin && <ProductAdminSection product={(products ?? []).find((p) => p.id === selected.id) ?? selected} />}

                {selected.uses && (
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-foreground">Usos</div>
                    <p className="text-sm text-muted-foreground" data-testid="product-uses">
                      {selected.uses}
                    </p>
                  </div>
                )}

                {selected.properties.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-foreground">Propiedades</div>
                    <ul
                      className="text-sm text-muted-foreground list-disc pl-5 space-y-0.5"
                      data-testid="product-properties"
                    >
                      {selected.properties.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {Object.keys(selected.specs).length > 0 && (
                  <div className="bg-card border border-card-border rounded-xl overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-card-border text-xs font-semibold text-foreground">
                      Especificaciones técnicas
                    </div>
                    <table className="w-full text-sm" data-testid="product-specs">
                      <tbody>
                        {Object.entries(selected.specs).map(([label, value]) => (
                          <tr key={label} className="border-b border-card-border/50 last:border-0">
                            <td className="px-4 py-2 text-xs text-muted-foreground align-top w-1/2">{label}</td>
                            <td className="px-4 py-2 text-foreground">{value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  {selected.url && (
                  <button
                    onClick={() => copyLink(selected.url)}
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
                    data-testid="button-copy-product-link"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copied ? "Copiado" : "Copiar enlace"}
                  </button>
                  )}
                  {selected.url && (
                  <a
                    href={selected.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-card border border-card-border text-muted-foreground hover:text-foreground transition-colors"
                    data-testid="link-product-page"
                  >
                    <ExternalLink className="w-4 h-4" /> Ver ficha
                  </a>
                  )}
                  {selected.technicalSheetUrl && (
                    <a
                      href={selected.technicalSheetUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-card border border-card-border text-muted-foreground hover:text-foreground transition-colors"
                      data-testid="link-technical-sheet"
                    >
                      <FileText className="w-4 h-4" /> Ficha técnica
                    </a>
                  )}
                  {selected.safetySheetUrl && (
                    <a
                      href={selected.safetySheetUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-card border border-card-border text-muted-foreground hover:text-foreground transition-colors"
                      data-testid="link-safety-sheet"
                    >
                      <FileText className="w-4 h-4" /> Ficha de seguridad
                    </a>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      {isAdmin && <NewProductDialog open={creating} onOpenChange={setCreating} />}
    </>
  );
}

// Envolturas por rol: el catálogo es el mismo, cambia solo el shell.
export default function ProductsPage(): ReactNode {
  return (
    <Layout>
      <ProductsCatalog />
    </Layout>
  );
}
