import { prisma } from '../lib/db';

const VALID_ROLES = ['admin', 'annotator', 'final_reviewer'] as const;
type Role = (typeof VALID_ROLES)[number];

async function main() {
  const [, , email, role] = process.argv;
  if (!email || !role) {
    console.error('Usage: tsx scripts/set-role.ts <email> <role>');
    console.error(`  role = ${VALID_ROLES.join(' | ')}`);
    process.exit(1);
  }
  if (!VALID_ROLES.includes(role as Role)) {
    console.error(`Invalid role: ${role}. Must be one of: ${VALID_ROLES.join(', ')}`);
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    if (user.role === role) {
      console.log(`user ${email}: already ${role}`);
    } else {
      await prisma.user.update({ where: { email }, data: { role: role as Role } });
      console.log(`user ${email}: ${user.role} -> ${role}`);
    }
  } else {
    console.log(`user ${email}: not in DB yet (will inherit from whitelist on first login)`);
  }
  await prisma.emailWhitelist.upsert({
    where: { email },
    create: { email, role: role as Role },
    update: { role: role as Role },
  });
  console.log(`whitelist ${email}: role=${role}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
