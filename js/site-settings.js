// Apply commercial data without replacing the original dealer structure.
try {
 const r=await fetch('/api/site',{cache:'no-store'});if(!r.ok)throw new Error();const d=await r.json();
 document.querySelectorAll('.premier-brand-logo').forEach(img=>{img.src='/api/site/logo';img.alt=d.name;});
 document.querySelectorAll('a[href^="tel:"]').forEach(a=>{a.href='tel:'+d.phoneNumber;const textNodes=[...a.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim());for(const n of textNodes)n.textContent=d.phone;});
 const address=document.querySelector('.addr');if(address){address.replaceChildren(document.createTextNode(d.address),document.createElement('br'),document.createTextNode(d.city));}
 const name=document.querySelector('.visit-card h3, .visit-info h3');if(name)name.textContent=d.name;
 document.querySelectorAll('a[href*="google.com/maps/search"]').forEach(a=>a.href='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(d.address+', '+d.city));
 document.querySelectorAll('.tb-item').forEach(n=>{if(n.textContent.includes('River Street')){const icon=n.querySelector('svg');n.replaceChildren();if(icon)n.append(icon);n.append(document.createTextNode(d.address+', '+d.city));}});
 for(const [label,key] of [['Instagram','instagram'],['Facebook','facebook'],['TikTok','tiktok']])document.querySelectorAll(`a[aria-label="${label}"]`).forEach(a=>{if(d[key]){a.href=d[key];a.target='_blank';a.rel='noopener';}else a.hidden=true;});
 const footer=document.querySelector('.footer-brand');if(footer){const email=document.createElement('a');email.href='mailto:'+d.email;email.textContent=d.email;email.className='site-email';footer.append(email);}
 document.title=document.title.replace('Premier Line Motors',d.name);
 document.querySelectorAll('a[aria-label^="Premier Line Motors"]').forEach(a=>a.setAttribute('aria-label',d.name));
 const heading=[...document.querySelectorAll('#visit h3')].find(n=>n.textContent==='Premier Line Motors');if(heading)heading.textContent=d.name;
 const word=document.querySelector('.footer-word');if(word)word.textContent=d.name.split(' ')[0].toUpperCase();
 document.querySelectorAll('.footer-bottom span').forEach(el=>{for(const node of el.childNodes)if(node.nodeType===Node.TEXT_NODE)node.textContent=node.textContent.replace('Premier Line Motors',d.name);});
 const copyright=document.querySelector('.footer-bottom');if(copyright){const admin=document.createElement('a');admin.href='/admin/';admin.textContent='Admin';copyright.append(admin);}
} catch { /* Keep the server-independent identity if the settings API is unavailable. */ }
