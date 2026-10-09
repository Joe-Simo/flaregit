import {expect,test} from 'bun:test';
import {plainTextMentions} from '../src/server/plain-text-mentions';
test('literal mention tokens preserve full canonical handles and exclude email/URL adjacency',()=>{
 expect(plainTextMentions('Hi (@Alice), @alice and @a--b. person@alice.example üser@alice.test https://site/@alice @alice_ignored @alice@host')).toEqual(['alice','a--b']);
 expect(plainTextMentions('@'+'a'.repeat(39))).toEqual(['a'.repeat(39)]);
 expect(plainTextMentions('@'+'a'.repeat(40)+' @ends-')).toEqual([]);
 expect(plainTextMentions('`@alice`')).toEqual(['alice']); // Literal text, no Markdown parser.
});
test('mention parsing bounds are explicit and never truncate a recipient prefix',()=>{
 expect(()=>plainTextMentions(Array.from({length:21},(_,index)=>'@user'+index).join(' '))).toThrow('20');
 expect(()=>plainTextMentions('x'.repeat(10001))).toThrow('limit');
});
