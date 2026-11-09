import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {verifyWebhookSignature, webhookSecretsForObject} from './meta.ts';
const settings = {metaAppSecret:'new-meta-app',instagramAppSecret:'direct-instagram-app'};
const raw = Buffer.from('{"message":"test"}');
const sign = (secret, body=raw) => 'sha256='+crypto.createHmac('sha256',secret).update(body).digest('hex');
const valid = (object, secret, body=raw, header=sign(secret)) => verifyWebhookSignature(webhookSecretsForObject(object,settings,'whatsapp-only-app'),body,header);
test('accepts WhatsApp signed by its separate app',()=>assert.equal(valid('whatsapp_business_account','whatsapp-only-app'),true));
test('separate WhatsApp key cannot authenticate Instagram or Facebook',()=>{for(const object of ['instagram','page',undefined])assert.equal(valid(object,'whatsapp-only-app'),false);});
test('preserves existing shared Meta and Instagram signatures',()=>{assert.equal(valid('whatsapp_business_account','new-meta-app'),true);assert.equal(valid('page','new-meta-app'),true);assert.equal(valid('instagram','direct-instagram-app'),true);});
test('rejects invalid signatures, altered bodies and missing headers',()=>{assert.equal(valid('whatsapp_business_account','wrong-app'),false);assert.equal(valid('whatsapp_business_account','whatsapp-only-app',Buffer.from('changed')),false);assert.equal(valid('whatsapp_business_account','whatsapp-only-app',raw,''),false);assert.equal(valid('whatsapp_business_account','whatsapp-only-app',undefined,'bad'),false);});
test('empty WhatsApp override does not alter existing configuration',()=>{assert.deepEqual(webhookSecretsForObject('whatsapp_business_account',settings,'  '),Object.values(settings));});

