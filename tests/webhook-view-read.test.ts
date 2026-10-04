import {expect,test} from 'bun:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readWebhookView} from '../src/web/webhook-view-read';
import {WebhooksCard} from '../src/web/components/WebhooksCard';
test('members load delivery history without requesting private webhook settings',async()=>{
 let settingsReads=0;const history=[{id:'dlv_saved',status:'failed'}];const result=await readWebhookView(false,async()=>{settingsReads++;throw Error('Private settings must not be read');},async()=>history);
 expect(settingsReads).toBe(0);expect(result).toEqual({hooks:null,deliveries:history,failures:[]});
 const failed=await readWebhookView(false,async()=>{settingsReads++;return [];},async()=>{throw Error('History unavailable');});expect(settingsReads).toBe(0);expect(failed.failures).toEqual(['Delivery log: History unavailable']);
});
test('owner settings failure preserves successfully loaded delivery history',async()=>{
 const result=await readWebhookView(true,async()=>{throw Error('Settings unavailable');},async()=>[{id:'dlv_saved'}]);expect(result.deliveries).toEqual([{id:'dlv_saved'}]);expect(result.failures).toEqual(['Webhook settings: Settings unavailable']);
});
test('member webhook view shows delivery loading without owner settings or false empty configuration',()=>{
 const html=renderToStaticMarkup(createElement(WebhooksCard,{projectId:'p1',isOwner:false}));expect(html).toContain('Loading deliveries');expect(html).not.toContain('Loading webhooks');expect(html).not.toContain('No webhooks yet');expect(html).not.toContain('Webhook URL');expect(html).not.toContain('Signing secret');
 const owner=renderToStaticMarkup(createElement(WebhooksCard,{projectId:'p1',isOwner:true}));expect(owner).toContain('Webhook URL');expect(owner).toContain('Loading webhooks');
});
