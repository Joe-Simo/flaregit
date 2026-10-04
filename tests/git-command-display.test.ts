import {test,expect} from 'bun:test';
import {separateGitCommands} from '../src/web/git-command-display';
test('displayed and copied Git commands exclude scoped credentials and retain normal Git auth',()=>{
 const token='fgg_synthetic_fixture';const value=separateGitCommands([`git -c http.extraHeader="Authorization: Bearer ${token}" clone https://flaregit.example/git/repo change && cd change`,`git checkout -b task/change`,`git -c http.extraHeader="Authorization: Bearer ${token}" push origin task/change`]);
 expect(value.token).toBe(token);expect(value.commands).toEqual(['git clone https://flaregit.example/git/repo change && cd change','git checkout -b task/change','git push origin task/change']);expect(value.commands.join('\n')).not.toContain(token);
 expect(()=>separateGitCommands(['git clone https://user:secret@example.invalid/repo'])).toThrow();expect(()=>separateGitCommands(['git -c Authorization=secret clone repo'])).toThrow();
});

test('credential-free server commands use the separate credential without injecting it into shell text',()=>{
 const token='fgg_separate_fixture';const commands=['git clone https://flaregit.example/git/repo','git push origin task/change'];
 expect(separateGitCommands(commands,token)).toEqual({commands,token});
 expect(()=>separateGitCommands(commands,'bad credential')).toThrow();
 expect(()=>separateGitCommands(commands)).toThrow('Git credential was not returned');
 expect(()=>separateGitCommands([`git -c http.extraHeader="Authorization: Bearer fgg_other_fixture" clone repo`],token)).toThrow();
});
