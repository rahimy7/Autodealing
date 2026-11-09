import { test } from "node:test";
import assert from "node:assert/strict";
import { parseContactImport, contactImportKey } from "./contact-import.ts";
test("keeps names and normalizes international phone formatting",()=>{
 const rows=parseContactImport("Nombre\tTeléfono\tNotas\nAna\t+1 (809) 555-0100\tGrupo");
 assert.deepEqual(rows,[{name:"Ana",phone:"+18095550100",notes:"Grupo"}]);
});
test("does not invent phones for WhatsApp usernames",()=>{
 const [row]=parseContactImport("Ana\t\tUsuario de WhatsApp: @Ana");
 assert.equal(row.phone,null); assert.equal(contactImportKey(row),"whatsapp:@ana");
});
test("deduplicates formatted numbers and handles, not people sharing a name",()=>{
 const rows=parseContactImport("Ana\t+18095550100\ta\nOtra\t1 809 5550100\tb\nAna\t+18095550101\tc\nUno\t\tUsuario de WhatsApp: @Abc\nDos\t\tUsuario de WhatsApp: @abc");
 assert.equal(rows.length,3);
});
test("rejects invalid phones or rows before any import starts",()=>{
 for(const input of ["Ana\t123","Ana\t@abc","\t+18095550100","Ana\t+18095550100\tNota\tExtra"]) assert.throws(()=>parseContactImport(input));
});
test("accepts non-Dominican international numbers",()=>{
 assert.equal(parseContactImport("Persona\t+599 787 5848")[0].phone,"+5997875848");
});
