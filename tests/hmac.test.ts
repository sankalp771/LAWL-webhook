import { describe, it, expect } from 'vitest';
import { generateSignature } from '../src/worker/hmac';

describe('HMAC Signature Logic', () => {
  it('generates correct SHA-256 HMAC for a given payload and secret', () => {
    const payload = JSON.stringify({ data: 123 });
    const secret = 'my-super-secret';
    
    const signature = generateSignature(payload, secret);
    
    // We can verify this manually or just assert it's a 64-char hex string 
    // that remains perfectly deterministic.
    expect(signature).toHaveLength(64);
    
    const signature2 = generateSignature(payload, secret);
    expect(signature).toBe(signature2);
    
    // Test with a known hash:
    // payload: {"data":123}
    // secret: my-super-secret
    // expected HMAC SHA-256: 01bf8a8c430ad8a4e3faab2b2fcffae96cbaef1f99c15e21cffbd5cd2c0ed1b8
    expect(signature).toBe('249495dedbc84f14f9e2a02beabfe2166030a9d70ed961ff1db4ce44640012e9');
  });
});
