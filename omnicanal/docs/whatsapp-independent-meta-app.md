# WhatsApp conectado a otra app de Meta

Cuando Facebook e Instagram usan una app y WhatsApp conserva otra (por ejemplo, junto con ElevenLabs para llamadas), configurar `WHATSAPP_META_APP_SECRET` en el servicio del omnicanal.

El valor es el App Secret de la app de Meta que envía los webhooks de WhatsApp, no el access token, el verify token ni una API key de ElevenLabs. Copiarlo directamente desde Meta a la variable secreta del servicio correspondiente y desplegar. No incluirlo en Git, registros ni mensajes.

La clave adicional se considera exclusivamente para objetos `whatsapp_business_account`. Los eventos de Facebook e Instagram conservan su validación actual. Las firmas incorrectas siguen recibiendo HTTP 403. Si no se define la variable, se conserva el comportamiento previo.

Esta configuración no modifica el número, las suscripciones de ElevenLabs ni la configuración de llamadas. El token de envío y el estado habilitado del canal se configuran por separado.

Verificación: enviar un mensaje real al número conectado; comprobar `webhook inbound events parsed` y la conversación en la bandeja. La prueba de conexión de Graph por sí sola no comprueba firmas entrantes.
