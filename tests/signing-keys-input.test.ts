import {expect,test} from 'bun:test';
import {publicSigningKeyInput} from '../src/web/components/SigningKeys';

test('public-key input rejects private material before signing-key registration',()=>{
  for(const kind of ['ssh','gpg'] as const){
    for(const marker of ['OPENSSH PRIVATE KEY','PGP PRIVATE KEY BLOCK','RSA PRIVATE KEY','EC PRIVATE KEY']){
      expect(()=>publicSigningKeyInput(kind,`-----BEGIN ${marker}-----\nconfidential\n-----END ${marker}-----`)).toThrow('only the public key');
    }
  }
});

test('signing-key input bounds reject oversized pasted material and wrong public-key kinds',()=>{
  expect(()=>publicSigningKeyInput('ssh','ssh-rsa AAAA comment')).toThrow();
  expect(()=>publicSigningKeyInput('ssh','ssh-ed25519 '+'A'.repeat(501))).toThrow();
  expect(()=>publicSigningKeyInput('gpg','-----BEGIN PGP PUBLIC KEY BLOCK-----\n'+'A'.repeat(20000)+'\n-----END PGP PUBLIC KEY BLOCK-----')).toThrow();
  expect(()=>publicSigningKeyInput('gpg','an email address')).toThrow();
});
