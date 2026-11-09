import { test } from "node:test";
import assert from "node:assert/strict";
import { metaProfilePatch, normalizeInstagramUsername } from "./meta-contact-profile.ts";
const profile = {name:"Ana Pérez",username:"ana.ig",pictureUrl:"https://example.com/avatar.jpg"};
test("Instagram stores display name and handle separately",()=>{
 assert.deepEqual(metaProfilePatch(null,"instagram",profile),{name:"Ana Pérez",metaProfileName:"Ana Pérez",instagramUsername:"ana.ig",avatar:profile.pictureUrl});
});
test("keeps the team's name and exposes the real Meta name",()=>{
 assert.equal(metaProfilePatch({name:"Hermana Ana"},"instagram",profile).name,undefined);
 assert.equal(metaProfilePatch({name:"Hermana Ana"},"instagram",profile).metaProfileName,"Ana Pérez");
});
test("backfills opaque IDs and placeholders",()=>{
 for(const contact of [{name:"Cliente 1234"},{name:"Comentario 1234"},{name:"1234",externalId:"1234"}]) {
  assert.equal(metaProfilePatch(contact,"instagram",profile).name,"Ana Pérez");
 }
});
test("refreshes only a previous synced name",()=>{
 assert.equal(metaProfilePatch({name:"Ana",metaProfileName:"Ana"},"instagram",profile).name,"Ana Pérez");
 assert.equal(metaProfilePatch({name:"@old",instagramUsername:"old"},"instagram",profile).name,"Ana Pérez");
});
test("WhatsApp saves incoming profile name without treating it as an Instagram handle",()=>{
 assert.deepEqual(metaProfilePatch(null,"whatsapp",{...profile,pictureUrl:null}),{name:"Ana Pérez",metaProfileName:"Ana Pérez"});
});
test("an unavailable profile never clears existing identity",()=>{
 assert.deepEqual(metaProfilePatch({name:"Ana"},"instagram",{name:null,username:null,pictureUrl:null}),{});
});
test("username fallback is recognizable and cannot contain links",()=>{
 assert.equal(metaProfilePatch(null,"instagram",{name:null,username:"@ana.ig",pictureUrl:null}).name,"@ana.ig");
 assert.equal(normalizeInstagramUsername("https://instagram.com/ana"),null);
 assert.equal(normalizeInstagramUsername(" @ana.ig "),"ana.ig");
});
