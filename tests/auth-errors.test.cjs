const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
test('auth errors use the chosen language rather than returning Chinese server details', async () => {
  const { authError } = await import('../auth/errors.js');
  const source=fs.readFileSync('server/worker.mjs','utf8');
  const codes=[...new Set([...source.matchAll(/error\(\d+, '([A-Z_]+)'/g)].map(m=>m[1]))];
  for(const lang of ['en','th','en-th']) for(const code of [...codes,'UNAUTHENTICATED','UNKNOWN']) {
    const value=authError(code,lang,'中文服务端详情');
    assert.doesNotMatch(value,/[\u4e00-\u9fff]/,code);
    if(lang==='th' || lang==='en-th') assert.match(value,/[\u0e00-\u0e7f]/,code);
    if(lang==='en-th') assert.equal(value,`${authError(code,'en')} · ${authError(code,'th')}`);
  }
  assert.equal(authError('INVALID_PASSWORD','zh','当前密码错误'),'当前密码错误');
  assert.match(authError('INVALID_CREDENTIALS','en'),/username or password/);
  assert.match(authError('RATE_LIMITED','th'),/บ่อยเกินไป/);
});
