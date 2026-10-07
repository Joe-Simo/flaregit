import {expect,test} from 'bun:test';
import {inboxDestination,inboxShortcutAllowed} from '../src/web/inbox-navigation';
const modifiers={metaKey:false,ctrlKey:false,altKey:false};
test('Enter on triage controls never activates the global notification shortcut',()=>{expect(inboxShortcutAllowed(modifiers,true)).toBe(false);expect(inboxShortcutAllowed(modifiers,false)).toBe(true);expect(inboxShortcutAllowed({...modifiers,ctrlKey:true},false)).toBe(false);});
test('issue and review events open their repository section without guessing an ID',()=>{expect(inboxDestination({project_id:'private-project',type:'issue.opened'})).toBe('/p/private-project/issues');expect(inboxDestination({project_id:'private-project',type:'review.requested'})).toBe('/p/private-project/changes');expect(inboxDestination({project_id:'private-project',type:'comment.added'})).toBe('/p/private-project/activity');});
