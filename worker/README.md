# Worker de leads · depascondiego.mx

Código del Cloudflare Worker `leads-depascondiego` (cuenta `diego-43d`). Recibe los POST del sitio (`LEADS_ENDPOINT`) y los manda al CRM.

## Qué hace

1. Si el POST trae teléfono: busca el contacto en LACRM por los últimos 10 dígitos; si no existe, lo crea (nombre, teléfono, origen) y le agrega una nota con todo el contexto (respuestas del filtro, resultado, página de origen).
2. Si no trae teléfono (clics en "Quiero saber más", botón del menú): no crea contacto, solo queda en los logs del Worker.
3. Si LACRM falla, el usuario no se entera: el sitio ya abrió WhatsApp. El error queda en los logs.

El destino está en `DESTINOS`. Para pasar a Kommo o a un sistema propio se agrega una función ahí y se cambia la variable `DESTINO`. El sitio no cambia.

## Instalar (una vez, unos 10 minutos)

1. **Respaldar lo actual:** Cloudflare > Workers > `leads-depascondiego` > Edit code. Copia todo y guárdalo aquí como `worker/leads-worker-anterior.js`. Hoy ese código no está en ningún otro lado.
2. **API key de LACRM:** LACRM > Settings > Programmer API > crear llave. Solo se ve una vez.
3. **Variables del Worker** (Settings > Variables and Secrets):
   - `LACRM_API_KEY` como **Secret**
   - `DESTINO` = `lacrm`
   - `LACRM_USER_ID` (opcional; si no se pone, el Worker lo obtiene solo)
4. Pega `leads-worker.js` en el editor y da **Deploy**.
5. **Prueba:** haz el filtro en depascondiego.mx/empieza-aqui.html con tu número. Debe aparecer el contacto en LACRM con la nota. Si no, revisa Workers > Logs.

## Pendiente de confirmar

- El formato de la API se tomó de la documentación de LACRM v2 (sep 2026). Si `GetContacts` o `CreateNote` responden con otro formato, el error sale en los logs con el texto de LACRM.
- Si el Worker actual hacía algo más (mandar correo, avisar por WhatsApp), hay que pasarlo a este código antes de reemplazarlo. Por eso el paso 1.
