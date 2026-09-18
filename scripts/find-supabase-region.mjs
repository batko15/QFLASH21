// Findet die Supabase-Pooler-Region: sendet Postgres-Startup an jede Region und
// unterscheidet "tenant not found" (falsche Region) von "password failed" (richtige).
const REF = 'twredhbyehjxoadrbcqe';
const USER = `postgres.${REF}`;
const REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'ca-central-1',
  'sa-east-1', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-central-2',
  'eu-north-1', 'eu-south-1', 'ap-south-1', 'ap-southeast-1', 'ap-southeast-2',
  'ap-northeast-1', 'ap-northeast-2', 'ap-east-1', 'me-south-1', 'me-central-1',
];

function probe(host) {
  return new Promise((resolve) => {
    const s = net.connect(6543, host);
    s.setTimeout(7000);
    const done = (msg) => { try { s.destroy(); } catch {} resolve(msg); };
    s.on('connect', () => {
      // Postgres StartupMessage (Protokoll 3.0), user param
      const params = `user\0${USER}\0\0`;
      const len = 8 + params.length;
      const buf = Buffer.alloc(len);
      buf.writeInt32BE(len, 0);
      buf.writeInt32BE(196608, 4); // 3.0
      buf.write(params, 8, 'latin1');
      s.write(buf);
    });
    let data = Buffer.alloc(0);
    s.on('data', (chunk) => {
      data = Buffer.concat([data, chunk]);
      // ErrorResponse: 'E' + len + fields (code S/C/M ...), ReadyForQuery 'Z'
      const type = String.fromCharCode(data[0]);
      if (type === 'E') {
        const m = parseError(data);
        done(m.includes('not found') ? `TENANT_FEHLT → ${m}` : `TENANT_EXISTIERT → ${m}`);
      } else if (type === 'R') {
        done('TENANT_EXISTIERT → Auth-Request (MD5/SCRAM)');
      }
    });
    s.on('timeout', () => done('TIMEOUT'));
    s.on('error', (e) => done('ERR ' + e.code));
  });
}

function parseError(buf) {
  let i = 5;
  let msg = '';
  while (i < buf.length && buf[i] !== 0) {
    const field = String.fromCharCode(buf[i]);
    let j = buf.indexOf(0, i + 1);
    if (j === -1) break;
    const val = buf.slice(i + 1, j).toString('latin1');
    if (field === 'M') msg = val;
    i = j + 1;
  }
  return msg;
}

import net from 'net';
for (const r of REGIONS) {
  const host = `aws-0-${r}.pooler.supabase.com`;
  const res = await probe(host);
  if (!res.includes('TENANT_FEHLT')) console.log(`${r}: ${res}`);
  else console.log(`${r}: (tenant unbekannt)`);
}
