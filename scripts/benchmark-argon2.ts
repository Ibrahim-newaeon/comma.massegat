// scripts/benchmark-argon2.ts
// Run on TARGET hardware: npx tsx scripts/benchmark-argon2.ts
// Target: 250-500ms. Adjust memoryCost in src/lib/password.ts to hit it.
import argon2 from 'argon2';

const OPTIONS = { type: argon2.argon2id, memoryCost: 262144, timeCost: 2, parallelism: 1 } as const;

async function main() {
  const samples: number[] = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    await argon2.hash('benchmark-password-sample', OPTIONS);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;

  console.log('Argon2id benchmark (10 runs)');
  console.log(`  memoryCost: ${OPTIONS.memoryCost} KiB, timeCost: ${OPTIONS.timeCost}, parallelism: ${OPTIONS.parallelism}`);
  console.log(`  min:    ${samples[0]?.toFixed(1)} ms`);
  console.log(`  median: ${samples[Math.floor(samples.length / 2)]?.toFixed(1)} ms`);
  console.log(`  mean:   ${mean.toFixed(1)} ms`);
  console.log(`  max:    ${samples[samples.length - 1]?.toFixed(1)} ms`);
  console.log(mean >= 250 && mean <= 500 ? '  ✓ Within target range' : '  ⚠️  OUTSIDE 250-500ms target — tune memoryCost');
}

main();
