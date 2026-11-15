import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Test-only PKI made with the openssl CLI: a company signing cert (.p12) and a TSA. */
export function makeTestPki() {
  const dir = mkdtempSync(join(tmpdir(), 'zenhere-pki-'));
  const run = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });
  run('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-days', '30', '-subj', '/CN=Test Root CA/O=ZenHere Test');
  // company certificate signed by the test CA
  run('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'co.key', '-out', 'co.csr', '-subj', '/CN=Test Company Co., Ltd./O=Test Company');
  writeFileSync(join(dir, 'co.ext'), 'keyUsage=critical,digitalSignature,nonRepudiation\n');
  run('x509', '-req', '-in', 'co.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'co.crt', '-days', '20', '-extfile', 'co.ext');
  run('pkcs12', '-export', '-inkey', 'co.key', '-in', 'co.crt', '-certfile', 'ca.crt', '-out', 'co.p12', '-passout', 'pass:secret123', '-keypbe', 'PBE-SHA1-3DES', '-certpbe', 'PBE-SHA1-3DES', '-macalg', 'sha1');
  // TSA certificate (extendedKeyUsage timeStamping, critical)
  run('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'tsa.key', '-out', 'tsa.csr', '-subj', '/CN=Test TSA');
  writeFileSync(join(dir, 'tsa.ext'), 'extendedKeyUsage=critical,timeStamping\nkeyUsage=critical,digitalSignature\n');
  run('x509', '-req', '-in', 'tsa.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'tsa.crt', '-days', '20', '-extfile', 'tsa.ext');
  writeFileSync(
    join(dir, 'tsa.cnf'),
    [
      '[ tsa ]',
      'default_tsa = tsa_config',
      '[ tsa_config ]',
      `dir = ${dir}`,
      'serial = $dir/tsaserial',
      'signer_cert = $dir/tsa.crt',
      'signer_key = $dir/tsa.key',
      'signer_digest = sha256',
      'default_policy = 1.2.3.4.1',
      'digests = sha256',
      'accuracy = secs:1',
      'ess_cert_id_alg = sha256',
      'certs = $dir/ca.crt',
      '',
    ].join('\n'),
  );
  writeFileSync(join(dir, 'tsaserial'), '01\n');
  return { dir, p12: readFileSync(join(dir, 'co.p12')), password: 'secret123' };
}
