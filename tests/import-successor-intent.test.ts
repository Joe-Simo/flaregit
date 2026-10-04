import {expect,test} from 'bun:test';
import {importSuccessorIntent} from '../src/web/import-successor-intent';
test('saved successor intent pins original inspection and generation across interruption',()=>{
 const intent={predecessorId:'import-history-12345678-1234-1234-1234-123456789abc',expectedGeneration:2};
 expect(importSuccessorIntent(JSON.parse(JSON.stringify(intent)))).toEqual(intent);
 for(const value of [null,{}, {...intent,expectedGeneration:-1},{...intent,expectedGeneration:1.5},{...intent,predecessorId:'other'}])expect(importSuccessorIntent(value)).toBeNull();
});
