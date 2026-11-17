// Leo, the dealership's mascot: what he answers by himself, without the AI.
// Pure functions over the public inventory and the dealer's data, so the tests run them in Node.
// The quick-reply chips always come here; typed questions come here when the AI is off or fails.

export const ACTIONS = ['inventory', 'testdrive', 'finance', 'trade', 'contact', 'call', 'directions'];

export const normalize = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9$.,\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Body types as visitors say them, in English and in the Spanish of the dealer's clients.
const BODY = [
  [['suv'], ['suv', 'suvs', 'crossover', 'crossovers', 'jeepeta', 'jeepetas', 'yipeta', 'yipetas']],
  [['truck'], ['truck', 'trucks', 'pickup', 'pickups', 'pick up', 'pick-up', 'troca', 'trocas']],
  [['suv', 'truck'], ['camioneta', 'camionetas']],
  [['sedan'], ['sedan', 'sedans', 'sedanes']],
  [['coupe'], ['coupe', 'coupes', 'deportivo', 'deportivos', 'sports car', 'sport car']],
  [['electric'], ['electric', 'electrico', 'electricos', 'electrica', 'electricas', 'ev', 'evs']],
  [['hatch'], ['hatchback', 'hatchbacks', 'hatch']],
  [['van'], ['van', 'vans', 'minivan', 'minivans', 'guagua', 'guaguas']],
];
const MAKE_ALIASES = { chevy: 'chevrolet', vw: 'volkswagen', benz: 'mercedes', mercedes: 'mercedes', 'land rover': 'land rover' };

const has = (n, words) => words.some((w) => (` ${n} `).includes(` ${w} `));
const stem = (n, stems) => stems.some((s) => n.split(' ').some((w) => w.startsWith(s)));

function amount(raw, unit) {
  let s = raw.replace(/\$/g, '');
  // "25.000" and "25,000" are thousands; "2.5k" is a decimal.
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, '');
  else s = s.replace(/,/g, '');
  let n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  if (unit) n *= 1000;
  else if (n < 1000) n *= 1000; // "menos de 20" in a car chat means $20,000
  return n >= 1000 && n <= 2_000_000 ? Math.round(n) : null;
}

const NUM = '\\$?\\s*(\\d[\\d.,]*)\\s*(k|mil|thousand|grand)?\\b';
export function parseBudget(n) {
  const between = n.match(new RegExp(`\\b(?:entre|between|from|de)\\s+${NUM}\\s*(?:y|and|a|to|-)\\s*${NUM}`));
  const years = between && !between[2] && !between[4] && [between[1], between[3]].every((x) => /^(19|20)\d\d$/.test(x));
  if (between && !years) {
    const hiUnit = between[4] || between[2];
    const lo = amount(between[1], between[2] || (Number(between[1]) < 1000 ? hiUnit : null));
    const hi = amount(between[3], hiUnit);
    if (lo && hi && hi > lo) return { min: lo, max: hi };
  }
  const max = n.match(new RegExp(`\\b(?:menos de|por menos de|debajo de|por debajo de|bajo|under|below|less than|hasta|maximo|max|no mas de|up to|budget(?: of| is)?|presupuesto(?: de| es)?|tengo)\\s+${NUM}`));
  if (max) { const v = amount(max[1], max[2]); if (v) return { max: v }; }
  const min = n.match(new RegExp(`\\b(?:mas de|over|above|more than|desde|from|arriba de|minimo)\\s+${NUM}`));
  if (min) { const v = amount(min[1], min[2]); if (v && !/^(19|20)\d\d$/.test(min[1])) return { min: v }; }
  const bare = n.match(/\$\s*(\d[\d.,]*)\s*(k|mil)?\b|\b(\d[\d.,]*)\s*(k|mil)\b/);
  if (bare) { const v = amount(bare[1] || bare[3], bare[2] || bare[4]); if (v) return { max: v }; }
  return {};
}

// What the visitor is looking for, from their words and the makes and models actually in stock.
export function parseSearch(text, inventory = []) {
  const n = normalize(text);
  const f = {};
  const newest = ['mas nuevo', 'mas nuevos', 'mas nueva', 'newest', 'latest', 'mas reciente', 'mas recientes'];
  const plain = newest.reduce((s, w) => s.replace(` ${w} `, ' '), ` ${n} `).trim();
  const cats = new Set();
  for (const [ids, words] of BODY) if (has(n, words)) ids.forEach((c) => cats.add(c));
  if (cats.size) f.cats = [...cats];
  if (has(plain, ['new', 'nuevo', 'nuevos', 'nueva', 'nuevas', '0 millas', 'zero miles'])) f.condition = 'new';
  if (has(n, ['used', 'usado', 'usados', 'usada', 'usadas', 'seminuevo', 'seminuevos', 'pre-owned', 'preowned'])) f.condition = 'used';
  if (has(n, ['certified', 'certificado', 'certificados', 'cpo'])) f.condition = 'certified';
  if (has(n, ['hybrid', 'hybrids', 'hibrido', 'hibridos', 'hibrida'])) f.fuel = 'hybrid';
  if (has(n, ['diesel'])) f.fuel = 'diesel';
  if (has(n, ['7 pasajeros', '8 pasajeros', '7 seats', '8 seats', 'seven seats', 'tercera fila', 'third row', '3rd row', '3 filas'])) f.minSeats = 7;
  Object.assign(f, parseBudget(n));
  const span = n.match(/\b(?:de|del|from|entre|between)\s+((?:19|20)\d\d)\s*(?:a|al|to|y|and|-)\s*((?:19|20)\d\d)\b/);
  const year = n.match(/\b(19[89]\d|20[0-3]\d)\b/);
  if (span && +span[2] >= +span[1]) Object.assign(f, { minYear: +span[1], maxYear: +span[2] });
  else if (year && f.min !== +year[1] && f.max !== +year[1]) {
    if (/\b(en adelante|o mas nuevo|or newer|and up|o mas reciente|\+)\b/.test(n) || new RegExp(`(desde|from|after|despues de)\\s+${year[1]}`).test(n)) f.minYear = +year[1];
    else f.year = +year[1];
  }
  const padded = ` ${n} `;
  const makes = [...new Set(inventory.map((v) => normalize(v.make)).filter(Boolean))];
  const aliased = Object.entries(MAKE_ALIASES).filter(([a]) => padded.includes(` ${a} `)).map(([, m]) => m);
  const make = makes.find((m) => padded.includes(` ${m} `) || aliased.some((a) => m.startsWith(a)));
  if (make) f.make = make;
  const models = [...new Set(inventory.map((v) => normalize(v.model)).filter((m) => m.length > 1))];
  const model = models.sort((a, b) => b.length - a.length).find((m) => padded.includes(` ${m} `));
  if (model) f.model = model;
  if (has(n, ['barato', 'baratos', 'barata', 'economico', 'economicos', 'economica', 'cheap', 'cheapest', 'affordable', 'mas barato', 'lowest price', 'menor precio'])) f.sort = 'price';
  else if (has(n, ['pocas millas', 'poco millaje', 'low miles', 'low mileage', 'menos millas'])) f.sort = 'miles';
  else if (has(n, newest)) f.sort = 'year';
  return f;
}

const isElectric = (v) => v.fuel === 'electric' || (v.cats || []).includes('electric');
// Demo units are the prototype's examples, not stock: Leo never offers them (like Omnicanal's AI).
export const forSale = (inventory) => inventory.filter((v) => !v.demo && ['available', 'reserved'].includes(v.status ?? 'available'));

export function searchInventory(f, inventory) {
  let list = forSale(inventory).filter((v) => {
    if (f.cats && !f.cats.some((c) => (c === 'electric' ? isElectric(v) : (v.cats || []).includes(c)))) return false;
    if (f.condition && v.condition !== f.condition) return false;
    if (f.fuel && v.fuel !== f.fuel) return false;
    if (f.minSeats && !(v.seats >= f.minSeats)) return false;
    if (f.make && normalize(v.make) !== f.make) return false;
    if (f.model && !normalize(v.model).includes(f.model)) return false;
    if (f.year && v.year !== f.year) return false;
    if (f.minYear && v.year < f.minYear) return false;
    if (f.maxYear && v.year > f.maxYear) return false;
    if ((f.max || f.min) && v.priceOnRequest) return false;
    if (f.max && v.price > f.max) return false;
    if (f.min && v.price < f.min) return false;
    return true;
  });
  const reservedLast = (a, b) => Number(a.status === 'reserved') - Number(b.status === 'reserved');
  const sorters = {
    price: (a, b) => Number(!!a.priceOnRequest) - Number(!!b.priceOnRequest) || a.price - b.price,
    miles: (a, b) => a.miles - b.miles,
    year: (a, b) => b.year - a.year,
    default: (a, b) => Number(!!b.featured) - Number(!!a.featured) || b.year - a.year,
  };
  const sorter = sorters[f.sort] || (f.max ? sorters.price : sorters.default);
  return list.sort((a, b) => reservedLast(a, b) || sorter(a, b));
}

const SEARCH_WORDS = ['tienen', 'tiene', 'tengan', 'busco', 'buscando', 'quiero', 'necesito', 'hay', 'inventario', 'carro', 'carros', 'auto', 'autos', 'vehiculo', 'vehiculos', 'coche', 'coches', 'modelo', 'modelos', 'disponible', 'disponibles', 'car', 'cars', 'vehicle', 'vehicles', 'inventory', 'stock', 'looking', 'have', 'want', 'need', 'show', 'muestrame', 'ensename', 'opciones', 'options'];

// The topic of a message, checked from the most specific to the most general.
export function detectIntent(text) {
  const n = normalize(text);
  if (!n) return null;
  if (has(n, ['prueba de manejo', 'test drive', 'test-drive', 'testdrive', 'manejarlo', 'manejarla', 'probarlo', 'probarla', 'agendar', 'schedule', 'appointment']) || stem(n, ['cita'])) return 'testdrive';
  if (has(n, ['trade', 'trade-in', 'trade in', 'tradein', 'mi carro actual', 'mi auto actual', 'vender mi', 'sell my', 'dar mi carro', 'entregar mi carro', 'tasacion', 'avaluo', 'appraisal', 'valorar mi', 'cuanto me dan', 'value my'])) return 'trade';
  if (stem(n, ['financ', 'credit', 'credito', 'prestamo', 'aprob', 'approv', 'mensualidad', 'enganche']) || has(n, ['loan', 'pagos', 'pago mensual', 'monthly', 'down payment', 'pago inicial', 'itin', 'ssn', 'seguro social', 'lease', 'leasing', 'interes', 'interest', 'apr', 'tasa'])) return 'finance';
  if (has(n, ['asesor', 'asesora', 'vendedor', 'vendedora', 'persona', 'humano', 'agente', 'representante', 'salesperson', 'human', 'agent', 'someone', 'real person', 'alguien', 'llamenme', 'llamame', 'llamarme', 'me llaman', 'me llamen', 'me pueden llamar', 'call me', 'contactenme', 'contact me', 'hablar con', 'talk to', 'speak to', 'speak with'])) return 'contact';
  if (has(n, ['descuento', 'descuentos', 'discount', 'discounts', 'negociable', 'negotiable', 'mejor precio', 'best price', 'rebaja', 'oferta', 'deal', 'garantia', 'warranty', 'carfax', 'historial', 'accidentes', 'accident'])) return 'specifics';
  if (stem(n, ['horario', 'abiert', 'cierra', 'abren']) || has(n, ['hora', 'horas', 'hours', 'open', 'opens', 'close', 'closes', 'closed', 'domingo', 'domingos', 'sabado', 'sabados', 'sunday', 'saturday'])) return 'hours';
  if (stem(n, ['direcc', 'ubica', 'locat']) || has(n, ['donde', 'where', 'address', 'directions', 'llegar', 'mapa', 'map', 'paterson'])) return 'location';
  if (stem(n, ['telefon']) || has(n, ['numero', 'phone', 'call', 'llamar', 'whatsapp', 'email', 'correo'])) return 'phone';
  if (Object.keys(parseSearch(n)).length || has(n, SEARCH_WORDS)) return 'inventory';
  if (has(n, ['gracias', 'thanks', 'thank you', 'thx', 'ok', 'okay', 'perfecto', 'genial', 'great', 'listo'])) return 'thanks';
  if (has(n, ['hola', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches', 'saludos', 'hi', 'hello', 'hey', 'good morning', 'good afternoon'])) return 'greeting';
  return null;
}

const TEXT = {
  es: {
    greeting: '¡Hola! Soy Leo, de {name}. Te busco un auto del inventario, te cuento cómo financiarlo o te paso con un asesor. ¿Qué tienes en mente?',
    thanks: '¡A la orden! Si se te ocurre algo más, aquí estoy.',
    one: 'Tengo esta opción para ti:',
    many: 'Encontré {n} opciones para ti.',
    more: ' Te muestro las primeras {k}; el resto está en el inventario.',
    tap: ' Toca una para ver fotos y detalles.',
    unpriced: 'No tengo precios publicados en ese rango: el precio de estas unidades te lo confirma un asesor. Estas coinciden con lo que buscas:',
    none: 'Ahora mismo no tengo algo así disponible. Si quieres, le paso tu búsqueda a un asesor para que te avise cuando entre uno.',
    sort_price: 'Estas son las opciones más económicas que tengo:',
    sort_miles: 'Estas son las de menos millaje:',
    sort_year: 'Estas son las más recientes:',
    browse: 'Tenemos {n} vehículos disponibles. Aquí van algunos; dime tipo, marca o presupuesto y te los filtro.',
    empty: 'No pude ver el inventario en este momento. Un asesor te ayuda enseguida.',
    hours: 'Horario: {hours}. Teléfono: {phone}. Estamos en {address}.',
    location: 'Estamos en {address}. Toca «Cómo llegar» para abrir el mapa.',
    phone: 'Llámanos al {phone} o escríbenos a {email}. Con gusto te atendemos.',
    finance: 'Sí. Con la calculadora de la página estimas tu pago mensual, y un asesor revisa tu caso de financiamiento. La aprobación y la tasa dependen del crédito de cada persona, así que eso te lo confirma el equipo.',
    trade: 'Podemos valorar tu auto actual. Llena año, marca, modelo y millaje en la sección de Trade-in y el equipo te contacta con una oferta.',
    testdrive: '¡Claro! Elige el vehículo y la fecha en el formulario de prueba de manejo y el equipo te confirma la cita.',
    testdriveFor: '¡Claro! Te dejo el {vehicle} listo en el formulario de prueba de manejo; elige la fecha y el equipo te confirma la cita.',
    contact: 'Con gusto te paso con un asesor. Déjame tu nombre y un teléfono o email, y te contactan.',
    specifics: 'Eso depende de cada vehículo y lo confirma un asesor. ¿Quieres que te contacten?',
    fallback: 'No estoy seguro de eso. Puedo buscarte autos por tipo, marca o presupuesto, o pasarle tu pregunta a un asesor.',
  },
  en: {
    greeting: "Hi! I'm Leo from {name}. I can find you a car in our inventory, explain financing or connect you with a salesperson. What do you have in mind?",
    thanks: "Anytime! If anything else comes up, I'm right here.",
    one: 'I have this one for you:',
    many: 'I found {n} options for you.',
    more: ' Here are the first {k}; the rest are in the inventory.',
    tap: ' Tap one for photos and details.',
    unpriced: "I don't have published prices in that range: a salesperson confirms the price of these. They match what you're looking for:",
    none: "I don't have anything like that available right now. I can pass your search to a salesperson so they let you know when one comes in.",
    sort_price: 'These are my most affordable options:',
    sort_miles: 'These have the lowest mileage:',
    sort_year: 'These are the newest:',
    browse: "We have {n} vehicles available. Here are a few; tell me a body type, make or budget and I'll narrow it down.",
    empty: "I can't see the inventory right now. A salesperson can help you right away.",
    hours: 'Hours: {hours}. Phone: {phone}. We are at {address}.',
    location: "We're at {address}. Tap “Directions” to open the map.",
    phone: "Call us at {phone} or email {email}. We're happy to help.",
    finance: "Yes. The calculator on this page estimates your monthly payment, and a salesperson reviews your financing. Approval and rate depend on each person's credit, so the team confirms those.",
    trade: 'We can value your current car. Enter its year, make, model and mileage in the Trade-in section and the team will contact you with an offer.',
    testdrive: 'Sure! Pick the vehicle and date in the test drive form and the team will confirm your appointment.',
    testdriveFor: "Sure! The {vehicle} is ready in the test drive form; pick a date and the team will confirm your appointment.",
    contact: "Happy to connect you with a salesperson. Leave your name and a phone or email, and they'll reach out.",
    specifics: 'That depends on each vehicle and a salesperson confirms it. Would you like them to contact you?',
    fallback: "I'm not sure about that. I can look up cars by body type, make or budget, or pass your question to a salesperson.",
  },
};
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

export const vehicleTitle = (v) => `${v.year} ${v.make} ${v.model}`;

// A reply Leo can give by himself. `context.vehicle` is the vehicle the chat is about, if any.
export function localAnswer(text, { inventory = [], dealer = {}, lang = 'es', hours = '', context = {} } = {}) {
  const T = TEXT[lang] || TEXT.es;
  const vars = { name: dealer.name || '', phone: dealer.phone || '', email: dealer.email || '', address: dealer.address || '', hours: (hours || '').replace(/\.$/, '') };
  let intent = detectIntent(text);
  // A make or model on its own ("¿Camry?") is a search too, but only the inventory knows them.
  if (!intent) { const f = parseSearch(text, inventory); if (f.make || f.model) intent = 'inventory'; }
  const say = (key, actions = [], extra = {}) => ({ intent, text: fill(T[key], { ...vars, ...extra }), vehicles: [], actions });
  switch (intent) {
    case 'greeting': return say('greeting', []);
    case 'thanks': return say('thanks', []);
    case 'hours': return say('hours', ['call', 'directions']);
    case 'location': return say('location', ['directions', 'call']);
    case 'phone': return say('phone', ['call', 'contact']);
    case 'finance': return { ...say('finance', ['finance', 'contact']), vehicles: context.vehicle ? [context.vehicle.id] : [] };
    case 'trade': return say('trade', ['trade', 'contact']);
    case 'contact': return { ...say('contact', []), handoff: true };
    case 'specifics': return say('specifics', ['contact', 'call']);
    case 'testdrive': {
      const v = context.vehicle;
      return v ? { ...say('testdriveFor', ['testdrive'], { vehicle: vehicleTitle(v) }), vehicles: [v.id] } : say('testdrive', ['testdrive']);
    }
    case 'inventory': {
      const stock = forSale(inventory);
      if (!stock.length) return say('empty', ['contact', 'call']);
      const filters = parseSearch(text, inventory);
      const searching = Object.keys(filters).some((k) => k !== 'sort');
      const found = searchInventory(filters, inventory);
      if (!searching && filters.sort) return { intent, text: T['sort_' + filters.sort], vehicles: found.slice(0, 4).map((v) => v.id), actions: ['inventory'], filters };
      if (!searching) return { intent, text: fill(T.browse, { n: stock.length }), vehicles: found.slice(0, 4).map((v) => v.id), actions: ['inventory'], filters };
      if (!found.length) {
        // A budget can't match units whose price is given by a salesperson: show those instead of "none".
        const { max, min, ...rest } = filters;
        const unpriced = max || min ? searchInventory(rest, inventory).filter((v) => v.priceOnRequest) : [];
        if (unpriced.length) return { intent, text: T.unpriced, vehicles: unpriced.slice(0, 4).map((v) => v.id), actions: ['contact'], filters: rest };
        return { ...say('none', ['inventory', 'contact']), filters };
      }
      const k = Math.min(4, found.length);
      const head = found.length === 1 ? T.one : fill(T.many, { n: found.length }) + (found.length > k ? fill(T.more, { k }) : '') + T.tap;
      return { intent, text: head, vehicles: found.slice(0, k).map((v) => v.id), actions: found.length > k ? ['inventory'] : [], filters };
    }
    default: return say('fallback', ['inventory', 'contact']);
  }
}

// The inventory filters the page can apply for "see all" (js/app.js, premier:action).
export function pageFilters(f = {}) {
  const cat = f.cats?.length === 1 ? f.cats[0] : 'all';
  const q = [f.make, f.model, f.fuel, f.year].filter(Boolean).join(' ');
  const sort = { price: 'priceAsc', miles: 'milesAsc', year: 'yearDesc' }[f.sort] || (f.max ? 'priceAsc' : 'featured');
  return { q, cat, cond: f.condition || '', max: f.max ? Math.min(200000, f.max) : 200000, sort, saved: false };
}

// The visitor's questions, as the note a salesperson reads with the inquiry.
export function transcript(messages, lang = 'es', limit = 2800) {
  const head = lang === 'en' ? 'From the chat with Leo on the website:' : 'Desde el chat con Leo en la página web:';
  const lines = messages.filter((m) => m.role === 'user' && m.content).map((m) => '• ' + String(m.content).replace(/\s+/g, ' ').trim());
  let out = head;
  for (const line of lines.slice(-8)) if ((out + '\n' + line).length <= limit) out += '\n' + line;
  return out;
}
