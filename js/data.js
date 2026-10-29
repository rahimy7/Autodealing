// Inventory + showroom data. Replace with your DMS/feed data.
// `config` drives both the generated photos (tools/render.html) and the live 3D viewer.

export const DEALER = {
  name: 'Premier Line Motors',
  phone: '(201) 625-0077',
  phoneHref: 'tel:+12016250077',
  email: 'info@premierlinemotors.com',
  address: '623–625 River Street, Paterson, NJ 07524',
  mapsQuery: '623–625 River Street, Paterson, NJ 07524',
};

export const SHOWCASE = [
  {
    id: 'valtor-gt', year: 2025, make: 'Valtor', model: 'GT Coupe', trim: 'Launch Edition',
    cats: ['coupe'], condition: 'certified', price: 68900, msrp: 74500, miles: 1240,
    engine: '3.0L Twin-Turbo V6', hp: 503, drive: 'AWD', trans: { en: '8-Speed Dual-Clutch', es: 'Doble embrague 8 vel.' },
    economy: '19/26 MPG', zero60: 3.6, seats: 4, fuel: 'gas',
    ext: { en: 'Inferno Red Metallic', es: 'Rojo Inferno metalizado' }, int: { en: 'Black Nappa Leather', es: 'Cuero Nappa negro' },
    stock: 'NV2510', vin: '…4821', featured: true,
    config: { type: 'coupe', color: '#9e0f1c', rim: 'sport', rimFinish: 'black', caliper: '#f2b705' },
    desc: {
      en: 'A grand tourer with a race-bred heart. Adaptive dampers, carbon ceramic brakes and a 503 hp twin-turbo V6 that pulls all the way to redline. One owner, full service history.',
      es: 'Un gran turismo con corazón de carreras. Suspensión adaptativa, frenos carbono-cerámicos y un V6 biturbo de 503 hp que empuja hasta el corte. Un solo dueño, historial completo de servicio.',
    },
  },
  {
    id: 'valtor-spectre', year: 2026, make: 'Valtor', model: 'Spectre', trim: 'Hybrid V8',
    cats: ['coupe'], condition: 'new', price: 189000, msrp: 189000, miles: 12,
    engine: '4.0L Twin-Turbo V8 Hybrid', hp: 789, drive: 'AWD', trans: { en: '8-Speed Dual-Clutch', es: 'Doble embrague 8 vel.' },
    economy: '17/22 MPG', zero60: 2.7, seats: 2, fuel: 'hybrid',
    ext: { en: 'Solar Yellow', es: 'Amarillo Solar' }, int: { en: 'Alcantara & Carbon', es: 'Alcantara y carbono' },
    stock: 'NV2602', vin: '…0937', featured: true,
    config: { type: 'supercar', color: '#f0b400', rim: 'sport', rimFinish: 'black', caliper: '#111316' },
    desc: {
      en: 'Mid-engine, 789 combined horsepower and an active rear wing that reads the road. The Spectre is the most extreme machine we have ever put on our floor.',
      es: 'Motor central, 789 hp combinados y un alerón activo que lee el camino. El Spectre es la máquina más extrema que hemos tenido en nuestro salón.',
    },
  },
  {
    id: 'lumen-aero', year: 2026, make: 'Lumen', model: 'Aero', trim: 'Dual Motor',
    cats: ['suv', 'electric'], condition: 'new', price: 54500, msrp: 54500, miles: 8,
    engine: 'Dual-Motor Electric', hp: 480, drive: 'AWD', trans: { en: 'Single-Speed', es: 'Una velocidad' },
    economy: '312 mi range', zero60: 3.9, seats: 5, fuel: 'electric',
    ext: { en: 'Arctic Pearl / Black Roof', es: 'Perla Ártico / techo negro' }, int: { en: 'Vegan Leather, Light Gray', es: 'Cuero vegano gris claro' },
    stock: 'NV2618', vin: '…5530', featured: true,
    config: { type: 'crossover', color: '#e6e8eb', roofColor: '#0d0e10', rim: 'aero', rimFinish: 'gunmetal', metalness: 0.25 },
    desc: {
      en: 'Silent, quick and beautifully efficient. 312 miles of range, 250 kW fast charging and a panoramic glass roof that turns every drive into a skyline tour.',
      es: 'Silencioso, rápido y muy eficiente. 312 millas de autonomía, carga rápida de 250 kW y un techo panorámico que convierte cada viaje en un tour.',
    },
  },
  {
    id: 'lumen-arc', year: 2025, make: 'Lumen', model: 'Arc', trim: 'Long Range',
    cats: ['sedan', 'electric'], condition: 'certified', price: 46200, msrp: 51900, miles: 3900,
    engine: 'Rear-Motor Electric', hp: 335, drive: 'RWD', trans: { en: 'Single-Speed', es: 'Una velocidad' },
    economy: '341 mi range', zero60: 5.1, seats: 5, fuel: 'electric',
    ext: { en: 'Liquid Silver', es: 'Plata Líquida' }, int: { en: 'Black Vegan Leather', es: 'Cuero vegano negro' },
    stock: 'NV2533', vin: '…7702',
    config: { type: 'sedan', color: '#b9bfc7', rim: 'aero', rimFinish: 'silver', noGrille: true },
    desc: {
      en: 'The long-distance EV sedan. 341 miles of range, hands-free highway assist and a whisper-quiet cabin. Certified with remaining factory battery warranty.',
      es: 'El sedán eléctrico de larga distancia. 341 millas de autonomía, asistente de autopista manos libres y una cabina silenciosa. Certificado con garantía de batería vigente.',
    },
  },
  {
    id: 'kestrel-summit', year: 2025, make: 'Kestrel', model: 'Summit 4x4', trim: 'Crew Cab',
    cats: ['truck'], condition: 'used', price: 61750, msrp: 66200, miles: 8200,
    engine: '5.0L V8', hp: 400, drive: '4WD', trans: { en: '10-Speed Automatic', es: 'Automática 10 vel.' },
    economy: '16/22 MPG', zero60: 6.1, seats: 5, fuel: 'gas', towing: '13,000 lb',
    ext: { en: 'Gunmetal Gray', es: 'Gris Gunmetal' }, int: { en: 'Black Leather', es: 'Cuero negro' },
    stock: 'NV2547', vin: '…3315', featured: true,
    config: { type: 'truck', color: '#4c535b', rim: 'offroad', rimFinish: 'black' },
    desc: {
      en: 'Tows 13,000 lb, climbs anything and still rides like a luxury SUV. Includes tonneau cover, trailer brake controller and all-terrain tires.',
      es: 'Remolca 13,000 lb, sube lo que sea y aun así se maneja como una SUV de lujo. Incluye cubierta de caja, control de frenos de remolque y llantas todo terreno.',
    },
  },
  {
    id: 'kestrel-ironback', year: 2026, make: 'Kestrel', model: 'Ironback HD', trim: 'Platinum',
    cats: ['truck'], condition: 'new', price: 67300, msrp: 67300, miles: 15,
    engine: '6.7L Turbo-Diesel V8', hp: 475, drive: '4WD', trans: { en: '10-Speed Automatic', es: 'Automática 10 vel.' },
    economy: '18/24 MPG', zero60: 6.8, seats: 6, fuel: 'diesel', towing: '14,000 lb',
    ext: { en: 'Glacier White', es: 'Blanco Glaciar' }, int: { en: 'Saddle Leather', es: 'Cuero color silla' },
    stock: 'NV2605', vin: '…8841',
    config: { type: 'truck', color: '#ececea', rim: 'classic', rimFinish: 'chrome', grille: 'chrome', metalness: 0.2 },
    desc: {
      en: 'Heavy-duty capability with a Platinum cabin. Massaging seats, 360° camera and a diesel V8 with more torque than you will ever need.',
      es: 'Capacidad de trabajo pesado con cabina Platinum. Asientos con masaje, cámara 360° y un V8 diésel con más torque del que jamás necesitarás.',
    },
  },
  {
    id: 'kestrel-ridgeback', year: 2025, make: 'Kestrel', model: 'Ridgeback', trim: 'Trail',
    cats: ['suv'], condition: 'certified', price: 46800, msrp: 51400, miles: 5100,
    engine: '2.7L Turbo V6', hp: 330, drive: '4x4', trans: { en: '10-Speed Automatic', es: 'Automática 10 vel.' },
    economy: '19/24 MPG', zero60: 5.8, seats: 5, fuel: 'gas',
    ext: { en: 'Trail Olive', es: 'Verde Oliva Trail' }, int: { en: 'Ebony Cloth & Leather', es: 'Tela y cuero ébano' },
    stock: 'NV2551', vin: '…2264',
    config: { type: 'suv', color: '#4b5a3c', roofColor: '#0d0e10', rim: 'offroad', rimFinish: 'gunmetal' },
    desc: {
      en: 'Weekend-ready from the factory: locking rear differential, roof rails and skid plates. Certified with a 172-point inspection.',
      es: 'Listo para el fin de semana: diferencial trasero bloqueable, barras de techo y protectores. Certificado con inspección de 172 puntos.',
    },
  },
  {
    id: 'halden-regent', year: 2025, make: 'Halden', model: 'Regent', trim: 'PHEV',
    cats: ['sedan'], condition: 'certified', price: 72400, msrp: 81900, miles: 2600,
    engine: '3.0L I6 Plug-in Hybrid', hp: 483, drive: 'AWD', trans: { en: '8-Speed Automatic', es: 'Automática 8 vel.' },
    economy: '64 MPGe', zero60: 4.4, seats: 5, fuel: 'hybrid',
    ext: { en: 'Sapphire Blue', es: 'Azul Zafiro' }, int: { en: 'Cognac Merino Leather', es: 'Cuero Merino coñac' },
    stock: 'NV2539', vin: '…6118', featured: true,
    config: { type: 'sedan', color: '#14305a', rim: 'multi', rimFinish: 'silver', chromeTrim: true },
    desc: {
      en: 'Executive comfort with 40 miles of all-electric range. Rear massage seats, air suspension and a 1,500-watt sound system.',
      es: 'Confort ejecutivo con 40 millas de autonomía eléctrica. Asientos traseros con masaje, suspensión neumática y sonido de 1,500 watts.',
    },
  },
  {
    id: 'halden-crestline', year: 2026, make: 'Halden', model: 'Crestline', trim: '3-Row Signature',
    cats: ['suv'], condition: 'new', price: 84900, msrp: 84900, miles: 10,
    engine: '3.0L Turbo I6 Mild-Hybrid', hp: 375, drive: 'AWD', trans: { en: '8-Speed Automatic', es: 'Automática 8 vel.' },
    economy: '21/26 MPG', zero60: 5.4, seats: 7, fuel: 'hybrid',
    ext: { en: 'Obsidian Black', es: 'Negro Obsidiana' }, int: { en: 'Ivory Semi-Aniline', es: 'Cuero semianilina marfil' },
    stock: 'NV2611', vin: '…4407',
    config: { type: 'suv3', color: '#1a1d22', rim: 'multi', rimFinish: 'chrome', grille: 'chrome', chromeTrim: true },
    desc: {
      en: 'Seven seats of first-class travel. Three-zone climate, captain\'s chairs and a whisper-quiet mild-hybrid six.',
      es: 'Siete asientos de primera clase. Clima de tres zonas, asientos tipo capitán y un seis cilindros híbrido muy silencioso.',
    },
  },
  {
    id: 'orsa-pulse', year: 2025, make: 'Orsa', model: 'Pulse', trim: 'Sport',
    cats: ['hatch'], condition: 'used', price: 29800, msrp: 33400, miles: 9800,
    engine: '2.0L Turbo I4', hp: 241, drive: 'FWD', trans: { en: '6-Speed Manual', es: 'Manual 6 vel.' },
    economy: '25/33 MPG', zero60: 5.9, seats: 5, fuel: 'gas',
    ext: { en: 'Blaze Orange / Black Roof', es: 'Naranja Blaze / techo negro' }, int: { en: 'Plaid Sport Seats', es: 'Asientos deportivos a cuadros' },
    stock: 'NV2520', vin: '…1953',
    config: { type: 'hatch', color: '#dd520b', roofColor: '#0d0e10', rim: 'classic', rimFinish: 'gunmetal', caliper: '#c8102e' },
    desc: {
      en: 'The hot hatch that does it all: commute on Monday, carve canyons on Saturday. Manual gearbox, limited-slip differential, one owner.',
      es: 'El hot hatch que lo hace todo: al trabajo el lunes, curvas el sábado. Caja manual, diferencial de deslizamiento limitado, un dueño.',
    },
  },
  {
    id: 'orsa-vela', year: 2024, make: 'Orsa', model: 'Vela', trim: 'SE',
    cats: ['sedan'], condition: 'used', price: 24900, msrp: 27800, miles: 18400,
    engine: '1.5L Turbo I4', hp: 180, drive: 'FWD', trans: { en: 'CVT Automatic', es: 'Automática CVT' },
    economy: '31/40 MPG', zero60: 7.6, seats: 5, fuel: 'gas',
    ext: { en: 'Glacier Blue', es: 'Azul Glaciar' }, int: { en: 'Charcoal Cloth', es: 'Tela carbón' },
    stock: 'NV2408', vin: '…9072',
    config: { type: 'sedan', color: '#5b8db6', rim: 'classic', rimFinish: 'silver' },
    desc: {
      en: 'Up to 40 MPG, Apple CarPlay & Android Auto, adaptive cruise and a spotless history report. The smart first car.',
      es: 'Hasta 40 MPG, Apple CarPlay y Android Auto, crucero adaptativo e historial impecable. El primer auto inteligente.',
    },
  },
  {
    id: 'valtor-gt-track', year: 2024, make: 'Valtor', model: 'GT Track', trim: 'Manual',
    cats: ['coupe'], condition: 'certified', price: 61500, msrp: 70900, miles: 6700,
    engine: '3.0L Twin-Turbo V6', hp: 523, drive: 'RWD', trans: { en: '6-Speed Manual', es: 'Manual 6 vel.' },
    economy: '17/25 MPG', zero60: 3.9, seats: 2, fuel: 'gas',
    ext: { en: 'Satin Graphite', es: 'Grafito satinado' }, int: { en: 'Red Alcantara', es: 'Alcantara rojo' },
    stock: 'NV2431', vin: '…5586',
    config: { type: 'coupe', color: '#6f757b', finish: 'matte', rim: 'sport', rimFinish: 'bronze', caliper: '#d81e2c' },
    desc: {
      en: 'Rear-drive, six-speed manual and a satin wrap from the factory. The purist\'s Valtor, with track telemetry and bucket seats.',
      es: 'Tracción trasera, manual de seis velocidades y acabado satinado de fábrica. El Valtor para puristas, con telemetría de pista y asientos tipo bucket.',
    },
  },
];

// The four machines on the 3D turntable, with selectable paints.
export const SHOWROOM = [
  {
    id: 'valtor-gt', label: 'GT Coupe',
    stats: [{ k: 'hp', v: 503, max: 800 }, { k: 'zero60', v: 3.6, max: 8, inverse: true }, { k: 'top', v: 196, max: 220 }],
    paints: [
      { en: 'Inferno Red', es: 'Rojo Inferno', color: '#9e0f1c' },
      { en: 'Midnight Blue', es: 'Azul Medianoche', color: '#0f1d33' },
      { en: 'Arctic Pearl', es: 'Perla Ártico', color: '#e6e8eb', metalness: 0.25 },
      { en: 'Volt Cyan', es: 'Cian Volt', color: '#118da3' },
      { en: 'Satin Graphite', es: 'Grafito satinado', color: '#5d6268', finish: 'matte' },
    ],
  },
  {
    id: 'valtor-spectre', label: 'Spectre',
    stats: [{ k: 'hp', v: 789, max: 800 }, { k: 'zero60', v: 2.7, max: 8, inverse: true }, { k: 'top', v: 211, max: 220 }],
    paints: [
      { en: 'Solar Yellow', es: 'Amarillo Solar', color: '#f0b400' },
      { en: 'Verde Mantis', es: 'Verde Mantis', color: '#5fb023' },
      { en: 'Nero Gloss', es: 'Negro brillante', color: '#0c0d10' },
      { en: 'Ultraviolet', es: 'Ultravioleta', color: '#4b1fa8' },
      { en: 'Satin White', es: 'Blanco satinado', color: '#dfe2e5', finish: 'matte' },
    ],
  },
  {
    id: 'lumen-aero', label: 'Aero EV',
    stats: [{ k: 'hp', v: 480, max: 800 }, { k: 'zero60', v: 3.9, max: 8, inverse: true }, { k: 'range', v: 312, max: 400 }],
    paints: [
      { en: 'Arctic Pearl', es: 'Perla Ártico', color: '#e6e8eb', metalness: 0.25 },
      { en: 'Glacier Blue', es: 'Azul Glaciar', color: '#4f86b3' },
      { en: 'Stealth Gray', es: 'Gris Stealth', color: '#3b3f45' },
      { en: 'Copper Dusk', es: 'Cobre Ocaso', color: '#9a5a36' },
    ],
  },
  {
    id: 'kestrel-summit', label: 'Summit 4x4',
    stats: [{ k: 'hp', v: 400, max: 800 }, { k: 'tow', v: 13000, max: 15000 }, { k: 'zero60', v: 6.1, max: 8, inverse: true }],
    paints: [
      { en: 'Gunmetal Gray', es: 'Gris Gunmetal', color: '#4c535b' },
      { en: 'Lava Red', es: 'Rojo Lava', color: '#8f1414' },
      { en: 'Glacier White', es: 'Blanco Glaciar', color: '#ececea', metalness: 0.2 },
      { en: 'Desert Sand', es: 'Arena Desierto', color: '#a28a68' },
      { en: 'Matte Army', es: 'Verde militar mate', color: '#4b5338', finish: 'matte' },
    ],
  },
];

export const CATEGORIES = [
  { id: 'suv', img: 'kestrel-ridgeback' },
  { id: 'truck', img: 'kestrel-summit' },
  { id: 'sedan', img: 'halden-regent' },
  { id: 'coupe', img: 'valtor-gt' },
  { id: 'electric', img: 'lumen-aero' },
  { id: 'hatch', img: 'orsa-pulse' },
];

export const SPOTLIGHT = { id: 'valtor-spectre', frames: 36 };

// Inventory comes from Neon. Concept vehicles above remain only in the original 3D showcase.
export let INVENTORY_ERROR = false;
try { const r=await fetch('/api/site',{cache:'no-store'}); if(r.ok){const d=await r.json();Object.assign(DEALER,{name:d.name,phone:d.phone,phoneHref:'tel:'+d.phoneNumber,email:d.email,address:d.address+', '+d.city});} } catch {}
export const INVENTORY = await fetch('/api/inventory', {cache:'no-store'})
  .then(r=>{if(!r.ok)throw new Error('Inventory unavailable');return r.json();})
  .then(data=>{if(!Array.isArray(data))throw new Error('Invalid inventory');return data;})
  .catch(()=>{INVENTORY_ERROR=true;return [];});
