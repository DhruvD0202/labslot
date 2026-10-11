import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { DateTime } from 'luxon';
import { pathToFileURL } from 'node:url';
import { createPool, transaction } from '../server/db.js';

export async function seed(pool) {
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 12 || Buffer.byteLength(password) > 72) throw new Error('Set DEMO_PASSWORD (12–72 bytes) before seeding.');
  const hash = await bcrypt.hash(password, 12);
  const accounts = [
    ['Aarav Sharma','student@labslot.demo','student'],
    ['Dr. Meera Iyer','faculty@labslot.demo','faculty'],
    ['Riya Patel','riya@labslot.demo','student'],
  ];
  for (const [name,email,role] of accounts) {
    await pool.query('INSERT INTO users(name,email,role,password_hash) VALUES ($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING', [name,email,role,hash]);
  }
  const { rows: users } = await pool.query("SELECT * FROM users WHERE email LIKE '%@labslot.demo'");
  const faculty = users.find(user => user.email === 'faculty@labslot.demo');
  const student = users.find(user => user.email === 'student@labslot.demo');
  const riya = users.find(user => user.email === 'riya@labslot.demo');
  const assets = [
    ['MIC-001','Confocal microscope','Microscopy','Research Block · Lab 204','High-resolution fluorescence imaging for cell and tissue research.'],
    ['GPU-001','NVIDIA A100 workstation','Computing','Research Block · Lab 108','Dedicated GPU workstation for deep learning and scientific computing.'],
    ['SPC-001','UV–Vis spectrometer','Spectroscopy','Science Block · Lab 312','Precision absorbance measurements for material and chemical analysis.'],
    ['PRN-001','Formlabs 3D printer','Fabrication','Innovation Centre · Studio 02','Stereolithography printer for detailed research prototypes.'],
  ];
  for (const asset of assets) {
    await pool.query(`INSERT INTO equipment(asset_tag,name,type,location,description) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT(asset_tag) DO NOTHING`, asset);
  }
  const { rows: equipment } = await pool.query('SELECT * FROM equipment ORDER BY asset_tag');
  // Seed only an empty schedule. Restarting never resets or overwrites user work.
  if ((await pool.query('SELECT 1 FROM reservations LIMIT 1')).rowCount) return;
  const base = DateTime.now().setZone('Asia/Kolkata').plus({ days: 2 }).startOf('day');
  const local = (day, hour, minute = 0) => base.plus({ days: day, hours: hour, minutes: minute }).toFormat("yyyy-MM-dd'T'HH:mm:ss");
  const microscope = equipment.find(e => e.asset_tag === 'MIC-001');
  const gpu = equipment.find(e => e.asset_tag === 'GPU-001');
  const spectrometer = equipment.find(e => e.asset_tag === 'SPC-001');
  const items = [
    [microscope.id,student.id,'booking',local(0,9),local(0,11),'Cell morphology study'],
    [microscope.id,faculty.id,'booking',local(0,13),local(0,15),'Fluorescence imaging'],
    [microscope.id,riya.id,'booking',local(1,10),local(1,12),'Tissue sample analysis'],
    [microscope.id,null,'maintenance',local(1,14),local(1,16),'Scheduled lens calibration'],
    [microscope.id,student.id,'booking',local(2,11),local(2,13),'Confocal imaging · Phase II'],
    [microscope.id,riya.id,'booking',local(3,9),local(3,10,30),'Live-cell observation'],
    [gpu.id,student.id,'booking',local(0,10),local(0,13),'Model training experiment'],
    [gpu.id,faculty.id,'booking',local(1,9),local(1,12),'Molecular dynamics simulation'],
    [spectrometer.id,null,'maintenance',local(0,10),local(0,12),'Lamp calibration and baseline check'],
    [spectrometer.id,riya.id,'booking',local(2,9),local(2,11),'Absorbance measurements'],
  ];
  await transaction(pool, faculty.id, async client => {
    for (const item of items) await client.query(`INSERT INTO reservations(equipment_id,user_id,kind,start_time,end_time,reason)
      VALUES ($1,$2,$3,$4,$5,$6)`, item);
    await client.query(`INSERT INTO waitlist(equipment_id,user_id,requested_start,requested_end,reason)
      VALUES ($1,$2,$3,$4,$5)`, [microscope.id,student.id,local(1,10),local(1,12),'Follow-up tissue imaging']);
  });
  console.log('Demo accounts and equipment are ready. Existing data is preserved on restart.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = createPool(process.env.DATABASE_URL);
  try { await seed(pool); } finally { await pool.end(); }
}
