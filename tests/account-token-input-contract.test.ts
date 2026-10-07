import {test,expect} from 'bun:test';
import {accountTokenRequestSchema} from '../src/web/pages/Account';
import {parseApiTokenInput} from '../src/server/api-token-input';
test('every Account scope and expiry choice passes server validation without coercion',()=>{for(const scope of ['read','write','full'] as const)for(const expiry of [undefined,1800,86400,604800,2592000]){const request=accountTokenRequestSchema.parse({label:'Scoped access',scope,repo:'pc8073e43b0cb',...(expiry===undefined?{}:{ttlSeconds:expiry})}),result=parseApiTokenInput(request,false);expect(result.ok).toBe(true);if(!result.ok)throw Error('Expected supported Account token request');expect(result.value.scope).toBe(scope);expect(result.value.ttlSeconds).toBe(expiry);}});
test('No expiry omits TTL; explicit zero remains invalid in both request contracts',()=>{const request=accountTokenRequestSchema.parse({label:'Explicit permanent access',scope:'read'});expect(Object.hasOwn(request,'ttlSeconds')).toBe(false);expect(parseApiTokenInput(request,false).ok).toBe(true);expect(accountTokenRequestSchema.safeParse({...request,ttlSeconds:0}).success).toBe(false);expect(parseApiTokenInput({...request,ttlSeconds:0},false).ok).toBe(false);});
test('Account wide selection omits repository while chosen repository remains exact',()=>{for(const repo of [undefined,'pc8073e43b0cb']){const input=accountTokenRequestSchema.parse({label:'Owner decision',scope:'write',ttlSeconds:1800,...(repo?{repo}:{})}),parsed=parseApiTokenInput(input,false);expect(parsed.ok).toBe(true);if(!parsed.ok)throw Error('Expected repository scope');expect(parsed.value.repo).toBe(repo);}});

import{createElement}from'react';import{renderToStaticMarkup}from'react-dom/server';import{CreatedAccountCredential}from'../src/web/pages/Account';
test('new account credential is masked by default with intentional reveal copy and download',()=>{
 const synthetic='SYNTHETIC_TOKEN_NOT_A_REAL_CREDENTIAL';const html=renderToStaticMarkup(createElement(CreatedAccountCredential,{token:synthetic}));
 expect(html).not.toContain(synthetic);expect(html).not.toContain('value="');expect(html).toContain('Credential hidden');expect(html).toContain('Reveal credential');expect(html).toContain('Copy credential');expect(html).toContain('Download credential');
});
