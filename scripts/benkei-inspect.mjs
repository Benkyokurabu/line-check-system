import fs from 'node:fs';
import { connectBenkeiDatabase } from './benkei-db.mjs';
const db = await connectBenkeiDatabase();
try {
  const staff = (await db.query('select id,staff_code,display_name,role,active,auth_user_id is not null has_identity from staff_accounts order by staff_code')).rows;
  fs.mkdirSync('analysis_outputs/benkei', { recursive: true });
  fs.writeFileSync('analysis_outputs/benkei/staff-inspection.json', JSON.stringify(staff, null, 2));
  console.log(JSON.stringify({ activeAccounts: staff.filter(s => s.active).length, authenticatedAccounts: staff.filter(s => s.active && s.has_identity).length, roles: Object.fromEntries([...new Set(staff.map(s => s.role))].map(role => [role, staff.filter(s => s.active && s.role === role).length])), specialAccounts: staff.filter(s => ['KUDO', 'KINJO'].includes(s.staff_code)).map(s => ({ code: s.staff_code, role: s.role, active: s.active })), benkeiExists: (await db.query("select to_regclass('public.bentan_benkei_items') is not null present")).rows[0].present }));
} finally { await db.end(); }
