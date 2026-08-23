// scripts/generate-vapid.mjs
// Generates a VAPID key pair for Web Push.  npm run vapid
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();

console.log('\nAdd these to .env:\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('VAPID_SUBJECT=mailto:you@yourcompany.com');
console.log('\n⚠️  Keep the private key secret, and keep the pair stable.');
console.log('   Changing it invalidates every existing subscription — every');
console.log('   user would silently stop receiving notifications until they');
console.log('   re-subscribed, with nothing in the UI to tell them.\n');
