import {it,expect} from 'vitest';
import {recoveryEmail,newPassword} from '../src/lib/password-input';
it('validates recovery addresses and matching strong-enough passwords',()=>{
 expect(recoveryEmail.parse(' PERSON@Example.com ')).toBe('person@example.com');
 expect(newPassword.safeParse({password:'short',confirm:'short'}).success).toBe(false);
 expect(newPassword.safeParse({password:'long-enough',confirm:'different'}).success).toBe(false);
 expect(newPassword.safeParse({password:'long-enough',confirm:'long-enough'}).success).toBe(true);
});
