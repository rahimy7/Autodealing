import { useEffect, useLayoutEffect, useRef, useState } from "react";

// Abre el chat en el último mensaje, como WhatsApp, y lo deja ahí.
//
// Bajar una sola vez al llegar los mensajes no alcanza: las fotos y los videos no
// tienen alto hasta que cargan, y al cargar empujan el final del hilo fuera de la
// vista. El chat quedaba a mitad de camino, sin los últimos mensajes a la vista.
// Por eso cada foto o video que termina de cargar lo vuelve a bajar, mientras
// quien mira siga abajo; si subió a leer, no se lo mueve.

// Margen para seguir contando como "abajo" aunque falten unos píxeles.
const NEAR_BOTTOM_PX = 80;

/** Devuelve el ref para el contenedor con scroll del hilo. */
export function useChatScroll(conversationId: number | null | undefined, messageCount: number) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const atBottom = useRef(true);

  // Al abrir un chat y con cada mensaje nuevo, al final.
  useLayoutEffect(() => {
    if (!container) return;
    atBottom.current = true;
    container.scrollTop = container.scrollHeight;
  }, [container, conversationId, messageCount]);

  useEffect(() => {
    if (!container) return;
    const onScroll = () => {
      atBottom.current = container.scrollHeight - container.scrollTop - container.clientHeight < NEAR_BOTTOM_PX;
    };
    // load y loadedmetadata no suben por el árbol: se escuchan en captura.
    const onMediaSized = () => {
      if (atBottom.current) container.scrollTop = container.scrollHeight;
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    container.addEventListener("load", onMediaSized, true);
    container.addEventListener("loadedmetadata", onMediaSized, true);
    return () => {
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("load", onMediaSized, true);
      container.removeEventListener("loadedmetadata", onMediaSized, true);
    };
  }, [container]);

  return setContainer;
}
