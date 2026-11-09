import { test } from "node:test";
import assert from "node:assert/strict";
import { contactTagsForClient } from "./contact-tags.ts";
test("Linaje Real offers the five requested church categories",()=>{
 assert.deepEqual(contactTagsForClient("linaje-real").options.map(x=>x.label),["Ancianos","Jóvenes","Junta","Visitas","Miembros"]);
});
test("existing Lead contacts remain the same elders and campaign filter",()=>{
 assert.equal(contactTagsForClient("linaje-real").options[0].value,"lead");
 assert.equal(contactTagsForClient("linaje-real").labels.lead,"Ancianos");
});
test("other clients retain their commercial categories",()=>{
 for(const id of ["procollagen","decolor","desconocido"]) assert.deepEqual(contactTagsForClient(id).options.map(x=>x.label),["Lead","VIP","En Proceso","Soporte"]);
});
