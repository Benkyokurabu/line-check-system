import { spawnSync } from "node:child_process";

const steps = [
  ["npm run lint", "lint"],
  ["npx tsc --noEmit", "typecheck"],
  ["npm test", "test"],
  ["npm run build", "build"],
  ["npm run import:roster -- --preview", "roster preview"],
];

for (const [command, label] of steps) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(command, {
    stdio: "inherit",
    shell: true,
  });

  if (result.status !== 0) {
    if (result.error) console.error(result.error.message);
    console.error(`\nverify failed at: ${label}`);
    process.exit(result.status ?? 1);
  }
}

console.log("\nverify passed");