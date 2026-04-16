import argon2 from 'argon2';

async function main() {
  const [, , ...passwords] = process.argv;
  if (passwords.length === 0) {
    console.error('Usage: tsx scripts/hash-passwords.ts <password1> [password2...]');
    process.exit(1);
  }
  for (const pw of passwords) {
    const hash = await argon2.hash(pw, {
      type: argon2.argon2id,
      memoryCost: 2 ** 16,
      timeCost: 3,
      parallelism: 4,
    });
    console.log(`${pw} → ${hash}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
