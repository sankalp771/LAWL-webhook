import { describe, it, expect } from 'vitest';
import { generateSignature } from '../src/worker/hmac';

describe('HMAC Signature Logic', () => {
  it('generates correct SHA-256 HMAC for a given payload and secret', () => {
    const payload = JSON.stringify({ data: 123 });
    const secret = 'my-super-secret';
    
    const signature = generateSignature(payload, secret);
    
    // We can verify this manually or just assert it's a 64-char hex string 
    // that remains perfectly deterministic.
    expect(signature).toHaveLength(71); // 'sha256=' (7 chars) + 64 hex chars
    
    const signature2 = generateSignature(payload, secret);
    expect(signature).toBe(signature2);
    
    expect(signature.startsWith('sha256=')).toBe(true);
    expect(signature).toBe('sha256=249495dedbc84f14f9e2a02beabfe2166030a9d70ed961ff1db4ce44640012e9');
  });
});
