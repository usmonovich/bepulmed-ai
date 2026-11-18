#!/usr/bin/env node
// Создаёт сотрудника клиники и печатает его токен ОДИН раз. В базе хранится только SHA-256.
// Пример:
//   node scripts/create-staff.mjs --clinic demo-clinic --role registrar --name "Регистратор 1" > staff.sql
//   npx wrangler d1 execute bepulmed --local --file staff.sql      (или --remote)
import { createHash, randomBytes, randomUUID } from "node:crypto";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, all) => (v.startsWith("--") ? [...acc, [v.slice(2), all[i + 1]]] : acc), []),
);
const roles = ["registrar", "doctor", "admin"];
if (!args.clinic || !roles.includes(args.role) || !args.name) {
  console.error("Usage: --clinic <id> --role registrar|doctor|admin --name <name> [--doctor <doctor_id>]");
  process.exit(1);
}
if (args.role === "doctor" && !args.doctor) {
  console.error("Role doctor requires --doctor <doctor_id>");
  process.exit(1);
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const token = randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(token).digest("hex");
console.error(`TOKEN (${args.role}, ${args.name}): ${token}`);
console.error("Сохраните токен: повторно его получить нельзя.");
console.log(
  `INSERT INTO clinic_staff (id, clinic_id, name, role, doctor_id, token_hash) VALUES (${q(randomUUID())}, ${q(args.clinic)}, ${q(args.name)}, ${q(args.role)}, ${args.doctor ? q(args.doctor) : "NULL"}, ${q(hash)});`,
);
