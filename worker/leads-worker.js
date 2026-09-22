/**
 * Cloudflare Worker · leads de depascondiego.mx
 *
 * Recibe los POST del sitio y los manda al CRM.
 * Destino actual: LACRM (Less Annoying CRM, API v2).
 * Para cambiar de CRM (Kommo o sistema propio) solo se agrega otra función
 * en DESTINOS y se cambia la variable DESTINO. El sitio no se toca.
 *
 * Variables del Worker (Settings > Variables):
 *   DESTINO          "lacrm" (default) o "ninguno" (solo registra en logs)
 *   LACRM_API_KEY    secreto. Se genera en LACRM > Settings > Programmer API
 *   LACRM_USER_ID    UserId a quien se asignan los contactos (si falta, se obtiene con GetUser)
 *   ORIGENES         opcional, dominios permitidos separados por coma
 *
 * Lo que manda el sitio (todos opcionales salvo phone para crear contacto):
 *   { name, phone, lead_name, note, source_page, origen, resultado, respuestas, proyectos }
 */

const ORIGENES_DEFAULT = ["https://depascondiego.mx", "https://www.depascondiego.mx"];

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ ok: false, error: "solo POST" }, 405, cors);

    let body;
    try {
      const raw = await request.text();
      if (raw.length > 20000) return json({ ok: false, error: "payload muy grande" }, 413, cors);
      body = JSON.parse(raw || "{}");
    } catch {
      return json({ ok: false, error: "JSON inválido" }, 400, cors);
    }

    const lead = normalizar(body);

    // Clics sin teléfono (botón de proyecto, nav) no crean contacto: solo quedan en logs.
    if (!lead.telefono) {
      console.log("evento sin teléfono", JSON.stringify({ titulo: lead.titulo, pagina: lead.pagina }));
      return json({ ok: true, contacto: false }, 200, cors);
    }

    const destino = (env.DESTINO || "lacrm").toLowerCase();
    const fn = DESTINOS[destino];
    if (!fn) return json({ ok: false, error: `destino desconocido: ${destino}` }, 500, cors);

    try {
      const res = await fn(lead, env);
      return json({ ok: true, contacto: true, ...res }, 200, cors);
    } catch (e) {
      // El sitio ya abrió WhatsApp: nunca bloqueamos al usuario. Queda en logs para reintentar a mano.
      console.error("error destino", destino, e.message, JSON.stringify(lead));
      return json({ ok: false, error: "no se pudo registrar" }, 502, cors);
    }
  },
};

/* ===== Destinos: agregar aquí Kommo o el sistema propio ===== */
const DESTINOS = {
  lacrm: enviarALACRM,
  ninguno: async (lead) => { console.log("lead (sin destino)", JSON.stringify(lead)); return { destino: "ninguno" }; },
};

async function enviarALACRM(lead, env) {
  if (!env.LACRM_API_KEY) throw new Error("falta LACRM_API_KEY");
  const call = (Function, Parameters = {}) => lacrm(env.LACRM_API_KEY, Function, Parameters);

  // 1) ¿Ya existe por teléfono? Se busca por los últimos 10 dígitos.
  const diez = lead.telefono.slice(-10);
  const encontrados = await call("GetContacts", { SearchTerms: diez, RecordTypeFilter: "Contacts", MaxNumberOfResults: 5 });
  const lista = (encontrados && (encontrados.Results || encontrados)) || [];
  let contactId = Array.isArray(lista) && lista.length ? (lista[0].ContactId || lista[0].Id) : null;
  let nuevo = false;

  // 2) Si no existe, se crea.
  if (!contactId) {
    const userId = env.LACRM_USER_ID || (await call("GetUser")).UserId;
    const creado = await call("CreateContact", {
      IsCompany: false,
      AssignedTo: userId,
      Name: lead.nombre || `Lead web ${diez}`,
      Phone: [{ Text: lead.telefono, Type: "Mobile" }],
      "Background Info": `Origen: depascondiego.mx${lead.pagina ? " · " + lead.pagina : ""}`,
    });
    contactId = creado.ContactId;
    nuevo = true;
  }

  // 3) Nota con todo el contexto del lead (respuestas del filtro, resultado, origen).
  await call("CreateNote", { ContactId: contactId, Note: textoNota(lead) });
  return { destino: "lacrm", contactId, nuevo };
}

async function lacrm(apiKey, Function, Parameters) {
  const r = await fetch("https://api.lessannoyingcrm.com/v2/", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: apiKey },
    body: JSON.stringify({ Function, Parameters }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`LACRM ${Function} ${r.status}: ${t.slice(0, 300)}`);
  try { return JSON.parse(t); } catch { return {}; }
}

/* ===== Utilidades ===== */
function normalizar(b) {
  const tel = String(b.phone || "").replace(/\D/g, "");
  const telefono = tel.length === 10 ? "+52" + tel : tel.length >= 12 ? "+" + tel : "";
  return {
    nombre: limpiar(b.name, 80),
    telefono,
    titulo: limpiar(b.lead_name, 120),
    nota: limpiar(b.note, 4000),
    pagina: limpiar(b.source_page, 120),
    origen: limpiar(b.origen, 120),
    resultado: limpiar(b.resultado, 60),
    respuestas: b.respuestas && typeof b.respuestas === "object" ? b.respuestas : null,
    proyectos: Array.isArray(b.proyectos) ? b.proyectos.slice(0, 10).map((p) => limpiar(p, 30)) : [],
  };
}
function limpiar(v, max) { return String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max); }
function textoNota(l) {
  const lineas = [l.titulo || "Lead depascondiego.mx", ""];
  if (l.nota) lineas.push(l.nota);
  if (l.origen && !l.nota.includes("Origen")) lineas.push(`Origen: ${l.origen}`);
  lineas.push("", `Recibido: ${new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" })}`);
  return lineas.join("\n");
}
function corsHeaders(request, env) {
  const permitidos = env.ORIGENES ? env.ORIGENES.split(",").map((s) => s.trim()) : ORIGENES_DEFAULT;
  const o = request.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": permitidos.includes(o) ? o : permitidos[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, "Content-Type": "application/json" } });
}
