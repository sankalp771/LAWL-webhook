import crypto from 'crypto';

export function generateSignature(payloadString: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
}
