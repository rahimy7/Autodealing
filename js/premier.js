const es = {
 skip:'Ir al inventario',bilingual:'English & Español',navInventory:'Inventario',navFinance:'Financiamiento',navAbout:'Nosotros',navVisit:'Visítanos',call:'Hablemos ↗',
 heroEyebrow:'TU PRÓXIMA ETAPA COMIENZA AQUÍ',heroTitle:'Un mejor camino.<br><em>Una experiencia Premier.</em>',heroLead:'Encuentra un vehículo usado que se adapte a tu vida. Desde tu primera consulta hasta la entrega de las llaves, nuestro equipo está aquí para ayudarte.',explore:'Explorar inventario ↗',talk:'Habla con nuestro equipo →',heroPlace:'PATERSON, NUEVA JERSEY',heroUsed:'VEHÍCULOS USADOS',artCaption:'Tu camino. Nuestro compromiso.',welcome:'BIENVENIDO A PREMIER',scroll:'Descubre más ↓',
 strip1:'Venta de vehículos usados',strip2:'Opciones de financiamiento',strip3:'Atención personalizada',strip4:'English & Español',inventoryEyebrow:'02 / ENCUENTRA TU PRÓXIMO VEHÍCULO',inventoryTitle:'El vehículo ideal.<br><em>Para tu próxima etapa.</em>',inventoryLead:'Consulta la disponibilidad con nuestro equipo de ventas. Te ayudamos a encontrar un vehículo acorde a tus necesidades y presupuesto.',searchLabel:'Buscar vehículos',searchPlaceholder:'Marca, modelo o año',bodyLabel:'Carrocería',allStyles:'Todos los estilos',sortLabel:'Ordenar por',newest:'Año más reciente',priceLow:'Precio: menor a mayor',priceHigh:'Precio: mayor a menor',emptyTitle:'Encontremos tu próximo vehículo.',emptyLead:'Estamos actualizando el inventario en línea. Contáctanos para conocer vehículos disponibles, fotografías, precios y características.',availability:'Consultar disponibilidad ↗',inventoryNote:'Nuestro equipo confirma la disponibilidad y los precios. Publicaremos las fotografías y características a medida que se actualice el inventario.',
 financeEyebrow:'03 / HABLEMOS DE POSIBILIDADES',financeTitle:'Tu próximo paso.<br><em>Con atención personal.</em>',financeLead:'Consulta con nuestro equipo las opciones de financiamiento mediante entidades financieras y programas Buy Here Pay Here. Te orientamos sobre las alternativas disponibles para tu situación.',financeCta:'Consultar financiamiento ↗',financeFine:'Todo financiamiento está sujeto a evaluación y aprobación. Las tasas, el pago inicial y los plazos dependen del solicitante, el vehículo y el programa. No se garantiza aprobación.',step1Title:'Cuéntanos qué estás buscando.',step1Lead:'Comparte tus preferencias y el tipo de vehículo que necesitas.',step2Title:'Conoce tus opciones.',step2Lead:'Nuestro equipo te ayuda a revisar los vehículos disponibles y las alternativas de pago.',step3Title:'Da el próximo paso con confianza.',step3Lead:'Coordina una visita, haz tus preguntas y revisa los detalles con nosotros.',
 aboutEyebrow:'04 / PREMIER LINE MOTORS',aboutTitle:'Más que un auto.<br><em>Una conversación.</em>',aboutLead:'Somos un concesionario de vehículos usados en Paterson, Nueva Jersey. Nos enfocamos en la atención personalizada: entender lo que necesitas y acompañarte durante el proceso de compra.',aboutSecond:'Desde conocer los vehículos y las opciones de financiamiento hasta revisar documentos y coordinar la entrega, puedes hablar directamente con nuestro equipo en inglés o español.',value1Title:'Orientación personal',value1Lead:'Contacto directo con nuestro equipo de ventas durante tu compra.',value2Title:'Opciones para tu camino',value2Lead:'Vehículos usados de diferentes marcas y modelos.',value3Title:'Aquí para responder',value3Lead:'Pregúntanos por un vehículo, una visita o los próximos pasos del financiamiento.',
 contactEyebrow:'05 / DEMOS EL PRÓXIMO PASO',contactTitle:'Tu experiencia<br><em>Premier comienza aquí.</em>',contactLead:'Visítanos en Paterson o contáctanos. Estamos listos para conversar sobre tu próximo vehículo.',visitLabel:'VISITA NUESTRO CONCESIONARIO',directions:'Cómo llegar ↗',hours:'Llámanos para confirmar el horario y coordinar tu visita.',formTitle:'Cuéntanos cómo podemos ayudarte.',name:'Nombre completo',phone:'Teléfono',interest:'Me interesa',interestVehicle:'Un vehículo / disponibilidad',interestFinance:'Información de financiamiento',interestVisit:'Una visita o prueba de manejo',interestOther:'Otra consulta',message:'Tu mensaje',formHint:'Este formulario prepara un mensaje de WhatsApp. Revísalo y pulsa Enviar en WhatsApp para contactar a nuestro equipo. No incluyas documentos financieros ni de identidad.',formSubmit:'Continuar en WhatsApp ↗',emailInstead:'¿Prefieres email? Escríbenos ↗',footerTag:'Tu camino. Nuestro compromiso.<br>Paterson, Nueva Jersey · English & Español',backTop:'Volver arriba ↑',privacy:'Privacidad',rights:'Todos los derechos reservados.',privacyText:'Este sitio guarda tu elección de idioma en el navegador. Al continuar, el formulario de contacto incluye tus datos en un enlace de WhatsApp. Revisa y envía el mensaje en WhatsApp para completar tu consulta. WhatsApp gestiona esa comunicación según su propia política de privacidad. Los proveedores externos de mapas y fuentes pueden recibir información de conexión al cargar sus servicios. Para consultas de privacidad escribe a info@premierlinemotors.com. Este sitio no recopila solicitudes de crédito ni documentos financieros.',whatsappPrivacy:'Política de privacidad de WhatsApp ↗',
};
const nodes = [...document.querySelectorAll('[data-i18n]')];
const en = Object.fromEntries(nodes.map(n=>[n.dataset.i18n,n.innerHTML]));
en.searchPlaceholder = 'Make, model or year';
let lang = (navigator.language || 'en').startsWith('es') ? 'es' : 'en';
try { const saved=localStorage.getItem('premier:language');if(['en','es'].includes(saved))lang=saved; } catch {}
let inventory=[];
const $ = id => document.getElementById(id);
function setLanguage(next){
 lang=next;const strings=lang==='es'?es:en;
 for(const node of nodes)node.innerHTML=strings[node.dataset.i18n]??en[node.dataset.i18n];
 document.querySelectorAll('[data-placeholder]').forEach(n=>n.placeholder=strings[n.dataset.placeholder]);
 document.documentElement.lang=lang;
 document.title=lang==='es'?'Premier Line Motors | Vehículos usados en Paterson, NJ':'Premier Line Motors | Used Cars in Paterson, NJ';
 document.querySelector('meta[name="description"]').content=lang==='es'?'Consulta vehículos usados y opciones de financiamiento en Premier Line Motors. Visítanos en 623–625 River Street, Paterson, NJ. Atención en inglés y español.':'Explore used vehicles and financing options at Premier Line Motors. Visit 623–625 River Street, Paterson, NJ. English and Spanish spoken.';
 $('language').textContent=lang==='en'?'ES':'EN';$('language').setAttribute('aria-label',lang==='en'?'Cambiar a español':'Switch to English');
 $('menu').setAttribute('aria-label',lang==='en'?'Open menu':'Abrir menú');
 $('formStatus').textContent='';
 try{localStorage.setItem('premier:language',lang);}catch{}
 renderInventory();
}
$('language').addEventListener('click',()=>setLanguage(lang==='en'?'es':'en'));
$('menu').addEventListener('click',()=>{const open=$('navigation').classList.toggle('open');$('menu').setAttribute('aria-expanded',String(open));});
$('navigation').addEventListener('click',e=>{if(e.target.closest('a')){$('navigation').classList.remove('open');$('menu').setAttribute('aria-expanded','false');}});
$('year').textContent=new Date().getFullYear();
$('privacyButton').addEventListener('click',()=>$('privacyDialog').showModal());
$('privacyClose').addEventListener('click',()=>$('privacyDialog').close());
$('contactForm').addEventListener('submit',e=>{
 e.preventDefault();const form=e.currentTarget;if(!form.reportValidity())return;
 const values=new FormData(form);
 if(!String(values.get('name')).trim()||!String(values.get('message')).trim())return;
 const subject=form.elements.interest.selectedOptions[0].textContent;
 const text=[lang==='es'?'Hola, Premier Line Motors.':'Hello, Premier Line Motors.',`${lang==='es'?'Nombre':'Name'}: ${String(values.get('name')).trim()}`,`${lang==='es'?'Teléfono':'Phone'}: ${String(values.get('phone')).trim()}`,subject,String(values.get('message')).trim()].join('\n');
 const url=`https://wa.me/12016250077?text=${encodeURIComponent(text)}`;
 // Keep the form filled: opening WhatsApp is not a delivered message.
 const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';a.click();
 $('formStatus').textContent=lang==='es'?'Revisa y envía el mensaje en WhatsApp para completar tu consulta.':'Review and send your message in WhatsApp to complete your inquiry.';
 $('emailFallback').href=`mailto:info@premierlinemotors.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
});
// Real inventory only. Entries need id, year, make, model, price, miles, body, photos[].
function validVehicle(v){return v&&typeof v.id==='string'&&Number.isInteger(v.year)&&typeof v.make==='string'&&typeof v.model==='string'&&Number.isFinite(v.price)&&v.price>=0&&Number.isFinite(v.miles)&&v.miles>=0&&Array.isArray(v.photos)&&v.photos.length>0&&v.photos.every(p=>typeof p==='string'&&(/^https:\/\//.test(p)||/^img\/[\w./-]+$/.test(p)));}
function renderInventory(){
 const q=$('search').value.toLowerCase().trim();const body=$('body').value;
 const list=inventory.filter(v=>(!q||`${v.year} ${v.make} ${v.model}`.toLowerCase().includes(q))&&(!body||v.body===body));
 list.sort($('sort').value==='low'?(a,b)=>a.price-b.price:$('sort').value==='high'?(a,b)=>b.price-a.price:(a,b)=>b.year-a.year);
 $('inventoryTools').hidden=inventory.length===0;$('emptyInventory').hidden=list.length>0;
 $('resultCount').textContent=inventory.length?(lang==='es'?`${list.length} vehículos`:`${list.length} vehicles`):'';
 const grid=$('vehicles');grid.replaceChildren();
 for(const v of list){
  const article=document.createElement('article');article.className='vehicle-card';
  const image=document.createElement('img');image.src=v.photos[0];image.alt=`${v.year} ${v.make} ${v.model}`;image.loading='lazy';article.append(image);
  const content=document.createElement('div');content.className='vehicle-body';
  const heading=document.createElement('h3');heading.textContent=image.alt;content.append(heading);
  const detail=document.createElement('p');detail.textContent=`${v.miles.toLocaleString('en-US')} mi${v.body?' · '+v.body:''}`;content.append(detail);
  const price=document.createElement('p');price.className='vehicle-price';price.textContent=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(v.price);content.append(price);
  const link=document.createElement('a');link.className='btn outline';link.textContent=lang==='es'?'Consultar este vehículo ↗':'Ask about this vehicle ↗';link.href=`https://wa.me/12016250077?text=${encodeURIComponent((lang==='es'?'Me interesa: ':'I’m interested in: ')+heading.textContent+' / '+v.id)}`;link.target='_blank';link.rel='noopener';content.append(link);article.append(content);grid.append(article);
 }
 if(inventory.length&&!list.length){$('emptyInventory').querySelector('h3').textContent=lang==='es'?'No hay coincidencias.':'No matching vehicles.';$('emptyInventory').querySelector('p').textContent=lang==='es'?'Prueba otra búsqueda o contacta a nuestro equipo.':'Try another search or contact our team.';}
}
for(const id of ['search','body','sort'])$(id).addEventListener(id==='search'?'input':'change',renderInventory);
setLanguage(lang);
fetch('data/inventory.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error('Inventory unavailable');return r.json();}).then(data=>{
 if(!Array.isArray(data))throw new Error('Invalid inventory');inventory=data.filter(validVehicle);
 for(const type of [...new Set(inventory.map(v=>v.body).filter(Boolean))].sort()){const option=document.createElement('option');option.value=type;option.textContent=type;$('body').append(option);}renderInventory();
}).catch(()=>{inventory=[];renderInventory();});
